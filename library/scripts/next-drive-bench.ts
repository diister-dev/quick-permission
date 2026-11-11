import {
  ALL,
  action,
  bundle,
  createSystem,
  entity,
  list,
  permissions,
} from "../next/mod.ts";
import type { Grant } from "../types.ts";

type NodeDoc = {
  _id: string;
  kind: "folder" | "file";
  parentId: string | null;
  path: string[];
  ownerId: string;
};

type Share = { nodeId: string; role: "viewer" | "editor" | "owner" };

const DEPTH = 8;
const FILES_PER_FOLDER = 100;
const BRANCHES = 200;

const nodes = new Map<string, NodeDoc>();
const leafFolders: string[] = [];
let queries = 0;

for (let branch = 0; branch < BRANCHES; branch++) {
  let parent: NodeDoc | null = null;
  for (let level = 0; level < DEPTH; level++) {
    const id = `node:f${branch}_${level}`;
    const folder: NodeDoc = {
      _id: id,
      kind: "folder",
      parentId: parent?._id ?? null,
      path: [...(parent?.path ?? []), id],
      ownerId: "user:owner",
    };
    nodes.set(id, folder);
    parent = folder;
  }
  const leaf = parent as NodeDoc;
  leafFolders.push(leaf._id);
  for (let file = 0; file < FILES_PER_FOLDER; file++) {
    const id = `node:d${branch}_${file}`;
    nodes.set(id, {
      _id: id,
      kind: "file",
      parentId: leaf._id,
      path: [...leaf.path, id],
      ownerId: "user:owner",
    });
  }
}

const node = entity("node", {
  load: (id) => {
    queries++;
    return nodes.get(id);
  },
  conditions: { owner: { owner: (doc) => doc.ownerId } },
});

const drive = permissions(node, "drive", {
  read: action({ fields: "doc" }),
  update: action({ fields: "input" }),
  delete: action(),
  share: action(),
  list: list("read"),
  viewer: bundle(["list"]),
  editor: bundle(["viewer", "update"]),
  owner: bundle(["editor", "delete", "share"]),
});

function sharesOf(count: number): Share[] {
  const roles = ["viewer", "editor", "owner"] as const;
  return Array.from({ length: count }, (_, index) => ({
    nodeId: `node:f${index % BRANCHES}_${Math.floor(index / BRANCHES) % DEPTH}`,
    role: roles[index % roles.length],
  }));
}

function onePerShare(shares: readonly Share[]): Grant[] {
  return shares.map((share) =>
    drive.grant(share.role, {
      id: `share:${share.nodeId}:${share.role}`,
      on: ALL,
      where: { path: share.nodeId },
    }),
  );
}

function onePerRole(shares: readonly Share[]): Grant[] {
  const byRole = new Map<Share["role"], string[]>();
  for (const share of shares) {
    byRole.set(share.role, [...(byRole.get(share.role) ?? []), share.nodeId]);
  }
  return [...byRole].map(([role, ids]) =>
    drive.grant(role, {
      id: `shares:${role}`,
      on: ALL,
      where: { path: { $in: ids } },
    }),
  );
}

function walkingProvider(shares: readonly Share[]) {
  const byNode = new Map(shares.map((share) => [share.nodeId, share.role]));
  return {
    name: "walk",
    cacheKey: (
      subject: { id: string },
      _key: string,
      target?: readonly unknown[],
    ) => `walk::${subject.id}::${String(target?.[0])}`,
    fetch: (
      _subject: unknown,
      _key: string,
      target?: readonly unknown[],
    ): Grant[] => {
      const id = target?.[0];
      if (typeof id !== "string" || id.endsWith("*")) return [];
      const grants: Grant[] = [];
      let cursor = nodes.get(id);
      while (cursor) {
        queries++;
        const role = byNode.get(cursor._id);
        if (role) grants.push(drive.grant(role, { on: id }));
        cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
      }
      return grants;
    },
  };
}

async function measure(label: string, runs: number, body: () => Promise<void>) {
  for (let i = 0; i < Math.min(runs, 200); i++) await body();
  queries = 0;
  const started = performance.now();
  for (let i = 0; i < runs; i++) await body();
  const micros = ((performance.now() - started) * 1000) / runs;
  console.log(
    `  ${label.padEnd(34)} ${micros.toFixed(1).padStart(9)} µs   ${(queries / runs).toFixed(1).padStart(7)} reads`,
  );
}

function ancestorProvider(shares: readonly Share[]) {
  const rolesByNode = new Map<string, Share["role"][]>();
  for (const share of shares) {
    rolesByNode.set(share.nodeId, [
      ...(rolesByNode.get(share.nodeId) ?? []),
      share.role,
    ]);
  }
  const everywhere = onePerRole(shares);
  return {
    name: "ancestors",
    cacheKey: (
      holder: { id: string },
      _key: string,
      target?: readonly unknown[],
    ) => `ancestors::${holder.id}::${String(target?.[0])}`,
    fetch: (
      _holder: unknown,
      _key: string,
      target?: readonly unknown[],
    ): Grant[] => {
      const id = target?.[0];
      if (typeof id !== "string" || id.endsWith("*")) return everywhere;
      queries++;
      const doc = nodes.get(id);
      if (!doc) return [];
      return doc.path.flatMap((ancestor) =>
        (rolesByNode.get(ancestor) ?? []).map((role) =>
          drive.grant(role, { id: `share:${ancestor}:${role}`, on: id }),
        ),
      );
    },
  };
}

const subject = { id: "user:1" };
const deepFile = "node:d3_7";
const leaf = nodes.get(leafFolders[3]) as NodeDoc;
const page = [...nodes.values()].filter((doc) => doc.parentId === leaf._id);

for (const count of [10, 100, 1000]) {
  const shares = sharesOf(count);
  console.log(`\n${count} shares held by the subject`);
  const strategies = [
    ["walk the tree per target", [walkingProvider(shares)]],
    [
      "path, one grant per share",
      [
        {
          cacheKey: (s: { id: string }) => s.id,
          fetch: () => onePerShare(shares),
        },
      ],
    ],
    [
      "path, one grant per role",
      [
        {
          cacheKey: (s: { id: string }) => s.id,
          fetch: () => onePerRole(shares),
        },
      ],
    ],
    ["path, grants of the target's ancestors", [ancestorProvider(shares)]],
  ] as const;

  for (const [name, providers] of strategies) {
    const system = createSystem({
      permissions: [drive],
      providers: [...providers],
    });
    const walking = name.startsWith("walk");
    const single = Math.max(20, Math.round(20000 / count));
    const paged = Math.max(3, Math.round(300 / count));
    await measure(`${name}: 1 file`, single, async () => {
      await system
        .context({ subject })
        .check("drive.update", deepFile, { input: {} });
    });
    await measure(`${name}: 100 files`, paged, async () => {
      const ctx = system.context({ subject });
      if (walking) {
        ctx.seed(node, page);
        await Promise.all(page.map((doc) => ctx.check("drive.read", doc._id)));
        return;
      }
      const scope = await ctx.scope("drive.list");
      if (!scope.ok) return;
      await scope.projectAll(page);
    });
  }
}

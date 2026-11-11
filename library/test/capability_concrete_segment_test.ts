import { test } from "node:test";
import { ALL, action, createSystem, entity, permissions } from "../mod.ts";
import { assert, assertEquals } from "./+assert.ts";

type ExpoDoc = { readonly _id: string; readonly entreprise: string };
type OrgDoc = { readonly _id: string; readonly kind: string };

const EXPOS: Readonly<Record<string, ExpoDoc>> = {
  "exposition:beta-owned": {
    _id: "exposition:beta-owned",
    entreprise: "entreprise:beta",
  },
  "exposition:globex-owned": {
    _id: "exposition:globex-owned",
    entreprise: "entreprise:globex",
  },
};

function participantsSystem() {
  const counter = { fetches: 0 };
  const exposition = entity("exposition", {
    load: (id): ExpoDoc | null => {
      counter.fetches += 1;
      return EXPOS[id] ?? null;
    },
  });
  const participant = exposition.child<{ _id: string }>("participant", {});
  const participants = permissions(participant, "participants", {
    list: action(),
  });
  const system = createSystem({
    permissions: [participants],
    providers: [
      () => [
        participants.grant("list", {
          id: "g-entreprise-beta",
          on: ALL,
          parents: { exposition: { entreprise: "entreprise:beta" } },
        }),
      ],
    ],
  });
  return { counter, system };
}

test("capability with a concrete parent: the parent is loaded and its condition evaluated", async () => {
  const { counter, system } = participantsSystem();
  const ctx = system.context({ subject: { id: "user:lucas" } });

  assertEquals(
    await ctx.could("participants.list", "exposition:beta-owned"),
    true,
    "Beta's expo should pass",
  );
  assertEquals(
    counter.fetches > 0,
    true,
    "the exposition should have been loaded",
  );
  const scope = await ctx.scope("participants.list", "exposition:beta-owned");
  assert(scope.ok);
  assertEquals(scope.query.filter, {});
  assertEquals(scope.query.stages, null);

  assertEquals(
    await ctx.could("participants.list", "exposition:globex-owned"),
    false,
    "Globex's expo should deny, Beta admin not authorized",
  );
});

test("capability with every segment a wildcard: nothing is loaded and scope refuses the wildcard parent", async () => {
  const { counter, system } = participantsSystem();
  const ctx = system.context({ subject: { id: "user:lucas" } });

  assertEquals(await ctx.could("participants.list"), true);
  assertEquals(counter.fetches, 0, "no load when the parent is a wildcard");
  const scope = await ctx.scope("participants.list", "exposition:*");
  assert(!scope.ok);
  assertEquals(scope.reasons, [
    "scope(participants.list) needs 1 concrete parent ids",
  ]);
});

test("capability over three segments, two concrete: each concrete one is loaded once", async () => {
  const ORGS: Readonly<Record<string, OrgDoc>> = {
    "org:exhibitor-1": { _id: "org:exhibitor-1", kind: "exhibitor" },
    "org:sponsor-1": { _id: "org:sponsor-1", kind: "sponsor" },
  };
  const counts = { expo: 0, org: 0, role: 0 };
  const exposition = entity("exposition", {
    load: (id): ExpoDoc | null => {
      counts.expo += 1;
      return EXPOS[id] ?? null;
    },
  });
  const org = exposition.child("org", {
    load: (_expo, id): OrgDoc | null => {
      counts.org += 1;
      return ORGS[id] ?? null;
    },
  });
  const role = org.child("role", {
    load: (): { _id: string } | null => {
      counts.role += 1;
      return null;
    },
  });
  const roles = permissions(role, "expo.orgs.roles", { read: action() });
  const system = createSystem({
    permissions: [roles],
    providers: [
      () => [
        roles.grant("read", {
          id: "g",
          on: ALL,
          parents: {
            exposition: { entreprise: "entreprise:beta" },
            org: { kind: "exhibitor" },
          },
        }),
      ],
    ],
  });

  const result = await system
    .context({ subject: { id: "user:lucas" } })
    .could("expo.orgs.roles.read", "exposition:beta-owned", "org:exhibitor-1");
  assertEquals(result, true);
  assertEquals(counts.expo, 1, "exposition loaded (segment 0 concrete)");
  assertEquals(counts.org, 1, "org loaded (segment 1 concrete)");
  assertEquals(counts.role, 0, "role not loaded (segment 2 wildcard)");
});

test("concrete check: denies when one document fails its condition", async () => {
  const ORGS: Readonly<Record<string, OrgDoc>> = {
    "org:sponsor-1": { _id: "org:sponsor-1", kind: "sponsor" },
  };
  const exposition = entity("exposition", {
    load: (id): ExpoDoc | null => EXPOS[id] ?? null,
  });
  const org = exposition.child("org", {
    load: (_expo, id): OrgDoc | null => ORGS[id] ?? null,
  });
  const orgs = permissions(org, "expo.orgs", { read: action() });
  const system = createSystem({
    permissions: [orgs],
    providers: [
      () => [
        orgs.grant("read", {
          id: "g",
          on: ALL,
          where: { kind: "exhibitor" },
          parents: { exposition: { entreprise: "entreprise:beta" } },
        }),
      ],
    ],
  });

  const result = await system
    .context({ subject: { id: "user:lucas" } })
    .check("expo.orgs.read", "exposition:beta-owned", "org:sponsor-1");
  assertEquals(result.ok, false);
});

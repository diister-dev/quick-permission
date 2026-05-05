import {
  createPermissionFactory,
  createSystem,
  filter,
  match,
  payload,
  target,
} from "../mod.ts";
import type { Provider } from "../mod.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

type DiiventoMeta = { description: string; group?: string };
const { permission, intermediate } = createPermissionFactory<DiiventoMeta>();

type Exposition = { _id: string; name: string };
type Badge = { _id: string; expositionId: string };
type User = { _id: string; email: string };
type Collaborator = { _id: string; exhibitorId: string };

const stubExposition: Exposition = { _id: "exposition:1", name: "Show" };
const stubBadge: Badge = { _id: "badge:42", expositionId: "exposition:1" };
const stubUser: User = { _id: "user:abc", email: "a@b.c" };
const stubCollab: Collaborator = {
  _id: "collaborator:7",
  exhibitorId: "exhibitor:3",
};

const schema = {
  "users.create": permission({
    metadata: { description: "Create a user" },
    target: target.none(),
  }).rules([]),

  "users.read": permission({
    metadata: { description: "Read user profile" },
    target: target.optional("user"),
    fetch: ([_id]) => Promise.resolve(stubUser),
  }).rules([
    match("user", (v) => v),
    filter((v) => v),
  ]),

  "expositions.badges.read": permission({
    metadata: { description: "Read a badge", group: "Expositions / Badges" },
    target: target.path("exposition", "badge"),
    fetch: ([_e, _b]) =>
      Promise.resolve({ exposition: stubExposition, badge: stubBadge }),
  }).rules([
    match("exposition", (v) => v.exposition),
    match("badge", (v) => v.badge),
    filter((v) => v.badge),
  ]),

  "expositions.collaborators.manage": permission({
    metadata: { description: "Manage a collaborator", group: "Expositions / Collaborators" },
    target: target.path("exposition", "collaborator"),
    fetch: ([_e, _c]) =>
      Promise.resolve({
        exposition: stubExposition,
        collaborator: stubCollab,
      }),
    payload: payload<{ exhibitorId: string }>(),
  }).rules([
    match("exposition", (v) => v.exposition),
    match("collaborator", (v) => v.collaborator),
    filter((v) => v.collaborator),
  ]),

  "expositions.manage": intermediate({
    metadata: { description: "Manage an exposition (macro)", group: "Expositions" },
    target: target.required("exposition"),
    expandsTo: (grant) => {
      const t = Array.isArray(grant.target) ? grant.target : [grant.target];
      const expoId = (t[0] as string | undefined) ?? "exposition:*";
      return [
        { ...grant, key: "expositions.badges.read", target: [expoId, "badge:*"] },
        { ...grant, key: "expositions.collaborators.manage", target: [expoId, "collaborator:*"] },
      ];
    },
  }).rules([]),
};

Deno.test("integration — list() returns flat keys", () => {
  const sys = createSystem<DiiventoMeta>({ schema });
  const keys = sys.list().map((p) => p.key).sort();
  assertEq(keys, [
    "expositions.badges.read",
    "expositions.collaborators.manage",
    "expositions.manage",
    "users.create",
    "users.read",
  ]);
});

Deno.test("integration — list() exposes intermediate kind", () => {
  const sys = createSystem<DiiventoMeta>({ schema });
  const list = sys.list();
  const manage = list.find((p) => p.key === "expositions.manage")!;
  assertEq(manage.kind, "intermediate");
  const badge = list.find((p) => p.key === "expositions.badges.read")!;
  assertEq(badge.kind, "permission");
});

Deno.test("integration — tree() groups by dotted key", () => {
  const sys = createSystem<DiiventoMeta>({ schema });
  const tree = sys.tree();
  const expo = tree.children.expositions;
  if (expo.kind !== "group") throw new Error("expected group");
  assertEq(expo.children["manage"]?.kind, "intermediate");
});

Deno.test("integration — schema() looks up a flat key", () => {
  const sys = createSystem<DiiventoMeta>({ schema });
  const r = sys.schema("expositions.badges.read");
  if (!r || r.kind !== "permission") throw new Error("not found");
  assertEq(r.metadata?.description, "Read a badge");
});

Deno.test("integration — intermediate grant expands to children with target rewrite", async () => {
  const provider: Provider = (subject) => {
    if (subject.id === "user:admin") {
      return [{ id: "owner", key: "expositions.manage", target: ["exposition:1"] }];
    }
    return [];
  };
  const sys = createSystem<DiiventoMeta>({ schema, providers: [provider] });

  // Direct check on the intermediate key — works.
  assertEq(
    (await sys.can({ id: "user:admin" }, "expositions.manage", ["exposition:1"])).ok,
    true,
  );

  // Children — covered via expandsTo.
  assertEq(
    (await sys.can(
      { id: "user:admin" },
      "expositions.badges.read",
      ["exposition:1", "badge:42"],
    )).ok,
    true,
  );
});

Deno.test("integration — target spec is JSON-serializable for HTTP transport", () => {
  const sys = createSystem<DiiventoMeta>({ schema });
  const list = sys.list();
  const json = JSON.stringify(list);
  const parsed = JSON.parse(json) as typeof list;
  const badge = parsed.find((p) => p.key === "expositions.badges.read")!;
  assertEq(badge.target.kind, "path");
  if (badge.target.kind === "path") {
    assertEq(badge.target.segments[0].name, "exposition");
    assertEq(badge.target.segments[1].name, "badge");
  }
});

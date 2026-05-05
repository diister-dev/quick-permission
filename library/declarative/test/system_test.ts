import { createSystem } from "../system.ts";
import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";
import { match, filter } from "../rules.ts";
import { payload } from "../payload.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

function assert(cond: boolean, msg = "") {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

type Meta = { description: string; group?: string };
const { permission } = createPermissionFactory<Meta>();

const usersCreate = permission({
  metadata: { description: "Create user" },
  target: target.none(),
}).rules([]);

const usersRead = permission({
  metadata: { description: "Read user" },
  target: target.optional("user"),
  fetch: ([id]) => Promise.resolve({ id: id ?? "" }),
}).rules([
  match("user", (v) => v),
  filter((v) => v),
]);

const badgeRead = permission({
  metadata: { description: "Read badge" },
  target: target.path("exposition", "badge"),
  fetch: ([e, b]) => Promise.resolve({ exposition: { id: e }, badge: { id: b } }),
  payload: payload<{ exhibitorId: string }>(),
}).rules([
  match("exposition", (v) => v.exposition),
  match("badge", (v) => v.badge),
  filter((v) => v.badge),
]);

const schema = {
  "users.create": usersCreate,
  "users.read": usersRead,
  "expositions.badges.read": badgeRead,
};

const sys = createSystem({ schema });

Deno.test("createSystem.list() — flat keys", () => {
  const list = sys.list();
  const keys = list.map((p) => p.key).sort();
  assertEq(keys, [
    "expositions.badges.read",
    "users.create",
    "users.read",
  ]);
});

Deno.test("createSystem.list() — entries carry metadata + target spec", () => {
  const list = sys.list();
  const create = list.find((p) => p.key === "users.create")!;
  assertEq(create.metadata, { description: "Create user" });
  assertEq(create.target.kind, "none");
});

Deno.test("createSystem.list() — target spec is JSON-serializable", () => {
  const list = sys.list();
  const read = list.find((p) => p.key === "expositions.badges.read")!;
  const json = JSON.parse(JSON.stringify(read.target));
  assertEq(json.kind, "path");
  assertEq(json.segments.length, 2);
  assertEq(json.segments[0].name, "exposition");
  assertEq(json.segments[1].name, "badge");
});

Deno.test("createSystem.schema(key) — returns a schema entry by key", () => {
  const r = sys.schema("expositions.badges.read");
  assert(r !== undefined);
  assertEq(r!.kind, "permission");
});

Deno.test("createSystem.schema(key) — returns undefined for unknown keys", () => {
  assertEq(sys.schema("nope"), undefined);
});

Deno.test("createSystem.tree() — groups dotted keys hierarchically", () => {
  const tree = sys.tree();
  // "users" is a group node (no schema entry at "users")
  const usersNode = tree.children["users"];
  assert(usersNode !== undefined);
  assertEq(usersNode.kind, "group");
  if (usersNode.kind === "group") {
    assertEq(usersNode.children["create"]?.kind, "permission");
    assertEq(usersNode.children["read"]?.kind, "permission");
  }
});

Deno.test("createSystem.tree() — leaves carry their metadata", () => {
  const tree = sys.tree();
  const usersNode = tree.children["users"];
  if (usersNode?.kind !== "group") throw new Error("expected group");
  const create = usersNode.children["create"];
  if (create?.kind !== "permission") throw new Error("expected permission");
  assertEq(create.metadata, { description: "Create user" });
});

Deno.test("createSystem.list() — payload spec is reflected as 'hasPayload'", () => {
  const list = sys.list();
  const read = list.find((p) => p.key === "expositions.badges.read")!;
  assertEq(read.hasPayload, true);
  const create = list.find((p) => p.key === "users.create")!;
  assertEq(create.hasPayload, false);
});

import { intermediate, permission } from "../permission.ts";
import { target } from "../target.ts";
import { custom, filter, match } from "../rules.ts";
import { payload } from "../payload.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

function assert(cond: boolean, msg = "") {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

Deno.test("permission(...).rules([]) — kind 'permission', empty rules", () => {
  const p = permission({
    metadata: { description: "Create user" },
    target: target.none(),
  }).rules([]);
  assertEq(p.kind, "permission");
  assertEq(p.metadata, { description: "Create user" });
  assertEq(p.target.kind, "none");
  assertEq(p.rules.length, 0);
});

Deno.test("permission(...).rules([...]) — rules persisted", () => {
  const fetch = ([id]: readonly [string]) => Promise.resolve({ id });
  const p = permission({
    metadata: { description: "Read user" },
    target: target.required("user"),
    fetch,
  }).rules([
    match("user", (v) => v.id),
    filter((v) => v),
  ]);
  assertEq(p.kind, "permission");
  assertEq(p.rules.length, 2);
  assertEq(p.rules[0].kind, "match");
  assertEq(p.rules[1].kind, "filter");
});

Deno.test("permission with payload — payload spec persisted", () => {
  const p = permission({
    metadata: { description: "..." },
    target: target.required("collaborator"),
    fetch: ([id]: readonly [string]) => Promise.resolve({ id }),
    payload: payload<{ exhibitorId: string }>(),
  }).rules([
    custom((ctx) => ctx.payload.exhibitorId.length > 0),
  ]);
  assert(p.payload !== undefined);
  assertEq(p.rules[0].kind, "custom");
});

Deno.test("permission without .rules() is a builder, not yet a permission", () => {
  const builder = permission({
    metadata: { description: "..." },
    target: target.none(),
  });
  assert(typeof builder.rules === "function");
});

Deno.test("intermediate({metadata, target, expandsTo}).rules([]) — kind 'intermediate'", () => {
  const node = intermediate({
    metadata: { description: "Manage users" },
    target: target.none(),
    expandsTo: (grant) => [
      { ...grant, key: "users.create" },
      { ...grant, key: "users.read" },
    ],
  }).rules([]);

  assertEq(node.kind, "intermediate");
  assertEq(node.metadata, { description: "Manage users" });
  assertEq(typeof node.expandsTo, "function");
});

Deno.test("intermediate.expandsTo — receives a grant, returns child grants", () => {
  const node = intermediate({
    metadata: { description: "Manage users" },
    target: target.none(),
    expandsTo: (grant) => [
      { ...grant, key: "users.create" },
      { ...grant, key: "users.read" },
    ],
  }).rules([]);

  const children = node.expandsTo({ id: "g1", key: "users.manage", target: ["user:*"] });
  assertEq(children.length, 2);
  assertEq(children[0].key, "users.create");
  assertEq(children[0].target, ["user:*"]);
});

Deno.test("intermediate with rules — checks apply on direct check of the intermediate key", () => {
  const node = intermediate({
    metadata: { description: "Manage users" },
    target: target.required("user"),
    fetch: ([id]: readonly [string]) => Promise.resolve({ id }),
    expandsTo: () => [],
  }).rules([match("user", (v) => v)]);

  assertEq(node.kind, "intermediate");
  assertEq(node.rules.length, 1);
});

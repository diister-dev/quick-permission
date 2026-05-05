import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

function assert(cond: boolean, msg = "") {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

type DiiventoMeta = {
  description: string;
  group?: string;
};

Deno.test("createPermissionFactory<TMeta>() — exposes permission/intermediate", () => {
  const f = createPermissionFactory<DiiventoMeta>();
  assert(typeof f.permission === "function");
  assert(typeof f.intermediate === "function");
});

Deno.test("factory.permission constrains metadata to TMeta", () => {
  const { permission } = createPermissionFactory<DiiventoMeta>();
  const p = permission({
    metadata: { description: "test" },
    target: target.none(),
  }).rules([]);
  assertEq(p.metadata, { description: "test" });
});

Deno.test("factory.intermediate constrains metadata to TMeta + carries expandsTo", () => {
  const { intermediate } = createPermissionFactory<DiiventoMeta>();
  const node = intermediate({
    metadata: { description: "Group", group: "Core" },
    target: target.none(),
    expandsTo: () => [],
  }).rules([]);
  assertEq(node.metadata, { description: "Group", group: "Core" });
  assertEq(typeof node.expandsTo, "function");
});

Deno.test("factory without generic — TMeta defaults to Record<string, unknown>", () => {
  const { permission } = createPermissionFactory();
  const p = permission({
    metadata: { foo: "bar", anything: 42 },
    target: target.none(),
  }).rules([]);
  assert(p.metadata !== undefined);
});

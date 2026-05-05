import { target, seg } from "../target.ts";

function assert(cond: boolean, msg = "") {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

Deno.test("target.none — empty segments, kind 'none'", () => {
  const t = target.none();
  assertEq(t.kind, "none");
  assertEq([...t.segments], []);
});

Deno.test("target.optional('user') — single segment with name=type='user'", () => {
  const t = target.optional("user");
  assertEq(t.kind, "optional");
  assertEq(t.segments.length, 1);
  assertEq(t.segments[0].name, "user");
  assertEq(t.segments[0].types, "user");
});

Deno.test("target.required('badge') — single segment", () => {
  const t = target.required("badge");
  assertEq(t.kind, "required");
  assertEq(t.segments[0].name, "badge");
  assertEq(t.segments[0].types, "badge");
});

Deno.test("target.path('a', 'b') — 2 segments, ordered by argument position", () => {
  const t = target.path("exposition", "badge");
  assertEq(t.kind, "path");
  assertEq(t.segments.length, 2);
  assertEq(t.segments[0].name, "exposition");
  assertEq(t.segments[1].name, "badge");
});

Deno.test("seg(name, type) — name distinct from type", () => {
  const s = seg("source", "user");
  assertEq(s.name, "source");
  assertEq(s.types, "user");
});

Deno.test("seg with multi-type array", () => {
  const s = seg("subject", ["user", "service-account"]);
  assertEq(s.name, "subject");
  assertEq([...(s.types as readonly string[])], ["user", "service-account"]);
});

Deno.test("seg with wildcard type", () => {
  const s = seg("any", "*");
  assertEq(s.name, "any");
  assertEq(s.types, "*");
});

Deno.test("target.path with mixed string + seg() args", () => {
  const t = target.path("exposition", seg("entity", ["badge", "visitor"]));
  assertEq(t.kind, "path");
  assertEq(t.segments[0].name, "exposition");
  assertEq(t.segments[0].types, "exposition");
  assertEq(t.segments[1].name, "entity");
  assertEq([...(t.segments[1].types as readonly string[])], ["badge", "visitor"]);
});

Deno.test("seg validate option — stored on segment for runtime checks", () => {
  const s = seg("user", "user", { validate: (v) => typeof v === "string" && v.startsWith("user:") });
  assert(typeof s.validate === "function");
  assert(s.validate!("user:abc") === true);
  assert(s.validate!("badge:abc") === false);
});

Deno.test("target.required with seg() preserves the segment as-is", () => {
  const s = seg("source", "user");
  const t = target.required(s);
  assertEq(t.segments[0].name, "source");
  assertEq(t.segments[0].types, "user");
});

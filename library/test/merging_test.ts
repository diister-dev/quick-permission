/**
 * Tests for mergeOutputs and mergeValue: the recursive "most permissive"
 * accumulation strategy used by the permission system.
 */
import { mergeFilters, mergeOutputs } from "../core/merging.ts";

function assert(condition: boolean, message: string = "") {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function eq(a: unknown, b: unknown, message: string = "") {
  assert(JSON.stringify(a) === JSON.stringify(b), `${message}\n  expected: ${JSON.stringify(b)}\n  got:      ${JSON.stringify(a)}`);
}

// ─── mergeFilters ─────────────────────────────────────────────────────────────

Deno.test("mergeFilters - union of flat boolean specs", () => {
  eq(
    mergeFilters({ a: true, b: true }, { b: true, c: true }),
    { a: true, b: true, c: true },
    "union",
  );
});

Deno.test("mergeFilters - true wins over false (most permissive)", () => {
  eq(
    mergeFilters({ a: false }, { a: true }),
    { a: true },
    "true beats false",
  );
});

Deno.test("mergeFilters - nested specs recurse", () => {
  eq(
    mergeFilters(
      { user: { name: true, email: false } },
      { user: { email: true, role: true } },
    ),
    { user: { name: true, email: true, role: true } },
  );
});

// ─── mergeOutputs basics ──────────────────────────────────────────────────────

Deno.test("mergeOutputs - undefined inputs", () => {
  eq(mergeOutputs(undefined, { a: 1 }), { a: 1 });
  eq(mergeOutputs({ a: 1 }, undefined), { a: 1 });
});

Deno.test("mergeOutputs - disjoint keys", () => {
  eq(
    mergeOutputs({ a: 1 }, { b: 2 }),
    { a: 1, b: 2 },
  );
});

// ─── numeric values ───────────────────────────────────────────────────────────

Deno.test("mergeOutputs - numbers take Math.max", () => {
  eq(mergeOutputs({ rateLimit: 10 }, { rateLimit: 100 }), { rateLimit: 100 });
  eq(mergeOutputs({ rateLimit: 100 }, { rateLimit: 10 }), { rateLimit: 100 }, "order-independent");
});

// ─── booleans ─────────────────────────────────────────────────────────────────

Deno.test("mergeOutputs - booleans take OR", () => {
  eq(mergeOutputs({ canExport: false }, { canExport: true }), { canExport: true });
  eq(mergeOutputs({ canExport: true }, { canExport: false }), { canExport: true });
});

// ─── arrays ───────────────────────────────────────────────────────────────────

Deno.test("mergeOutputs - arrays union with dedup", () => {
  eq(
    mergeOutputs({ tags: ["a", "b"] }, { tags: ["b", "c"] }),
    { tags: ["a", "b", "c"] },
  );
});

// ─── nested objects (the key fix) ─────────────────────────────────────────────

Deno.test("mergeOutputs - nested numeric: most permissive at every leaf", () => {
  // This is the case that was broken: {{...current, ...incoming}} was order-dependent.
  // With recursion, nested numbers also Math.max correctly.
  eq(
    mergeOutputs(
      { rateLimit: { max: 10, window: 3600 } },
      { rateLimit: { max: 100, window: 60 } },
    ),
    { rateLimit: { max: 100, window: 3600 } },
    "max picks largest at each leaf",
  );

  // Order-independent
  eq(
    mergeOutputs(
      { rateLimit: { max: 100, window: 60 } },
      { rateLimit: { max: 10, window: 3600 } },
    ),
    { rateLimit: { max: 100, window: 3600 } },
    "swapped order yields the same result",
  );
});

Deno.test("mergeOutputs - deeply nested: 3 levels", () => {
  eq(
    mergeOutputs(
      { quotas: { api: { reads: 100, writes: 10 } } },
      { quotas: { api: { reads: 50, writes: 50 } } },
    ),
    { quotas: { api: { reads: 100, writes: 50 } } },
  );
});

Deno.test("mergeOutputs - nested objects with mixed types", () => {
  eq(
    mergeOutputs(
      { policy: { active: false, retries: 1, tags: ["a"] } },
      { policy: { active: true, retries: 5, tags: ["b"] } },
    ),
    { policy: { active: true, retries: 5, tags: ["a", "b"] } },
  );
});

// ─── filter / updateFilter / writeFilter ──────────────────────────────────────

Deno.test("mergeOutputs - filter uses union (deeply nested)", () => {
  eq(
    mergeOutputs(
      { filter: { _id: true, name: true } },
      { filter: { _id: true, email: true } },
    ),
    { filter: { _id: true, name: true, email: true } },
  );
});

Deno.test("mergeOutputs - writeFilter uses union", () => {
  eq(
    mergeOutputs(
      { writeFilter: { firstname: true } },
      { writeFilter: { lastname: true } },
    ),
    { writeFilter: { firstname: true, lastname: true } },
  );
});

// ─── dates ────────────────────────────────────────────────────────────────────

Deno.test("mergeOutputs - dates take latest", () => {
  const earlier = new Date("2024-01-01");
  const later = new Date("2025-01-01");
  const r = mergeOutputs({ expires: earlier }, { expires: later });
  assert(r.expires instanceof Date);
  assert(r.expires.getTime() === later.getTime(), "latest date wins");

  const r2 = mergeOutputs({ expires: later }, { expires: earlier });
  assert(r2.expires.getTime() === later.getTime(), "order-independent");
});

// ─── type mismatch ────────────────────────────────────────────────────────────

Deno.test("mergeOutputs - mismatched types: incoming wins", () => {
  eq(mergeOutputs({ x: 1 }, { x: "string" }), { x: "string" });
  eq(mergeOutputs({ x: [1] }, { x: { a: 1 } }), { x: { a: 1 } });
});

// ─── edge: null handling ──────────────────────────────────────────────────────

Deno.test("mergeOutputs - null in nested object does not crash", () => {
  // null is treated as a primitive (not an object branch)
  eq(
    mergeOutputs({ x: null }, { x: { a: 1 } }),
    { x: { a: 1 } },
    "null replaced by object",
  );
});

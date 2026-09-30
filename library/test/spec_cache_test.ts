import { test } from "node:test";
import { assert, assertEquals, assertThrows } from "./+assert.ts";
import { compileSpec, evaluateSpec, prepareSpec } from "../mongo-query.ts";

test("equal JSON specs share one compiled tester", () => {
  const a = compileSpec({ status: { $in: ["active", "pending"] } });
  const b = compileSpec({ status: { $in: ["active", "pending"] } });
  assert(a === b);
  assertEquals(a({ status: "active" }), true);
  assertEquals(a({ status: "archived" }), false);
});

test("specs that JSON cannot represent are compiled afresh", () => {
  const regexA = compileSpec({ name: { $regex: /^a/ } });
  const regexB = compileSpec({ name: { $regex: /^a/ } });
  assert(regexA !== regexB);
  const dateA = compileSpec({ at: new Date(0) });
  const dateB = compileSpec({ at: new Date(0) });
  assert(dateA !== dateB);
  assert(compileSpec({ n: NaN }) !== compileSpec({ n: null }));
  assert(compileSpec({ n: -0 }) !== compileSpec({ n: 0 }));
  assertEquals(evaluateSpec({ n: null }, { n: null }), true);
  assertEquals(evaluateSpec({ n: NaN }, { n: null }), false);
});

test("mutating a spec after it was cached never changes the cached tester", () => {
  const spec = { status: { $in: ["active"] } };
  const tester = compileSpec(spec);
  spec.status.$in.push("archived");
  assertEquals(tester({ status: "archived" }), false);
  assertEquals(
    compileSpec({ status: { $in: ["active"] } })({ status: "archived" }),
    false,
  );
  assertEquals(evaluateSpec(spec, { status: "archived" }), true);
});

test("a forbidden operator is rejected on every call, cached or not", () => {
  const spec: Record<string, unknown> = { status: "active" };
  compileSpec(spec);
  spec.$where = "true";
  assertThrows(() => compileSpec(spec));
  assertThrows(() =>
    evaluateSpec({ nested: { $or: [{ $function: {} }] } }, {}),
  );
  assertThrows(() => prepareSpec({ $expr: {} }));
});

test("prepareSpec validates eagerly and compiles once, lazily", () => {
  const prepared = prepareSpec({ tier: "gold" });
  const first = prepared();
  const second = prepared();
  assert(first === second);
  assertEquals(prepared()({ tier: "gold" }), true);
});

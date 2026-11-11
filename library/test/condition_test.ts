import { test } from "node:test";
import {
  allOf,
  compileCondition,
  conditionProblem,
  conjunction,
  deepEqual,
  holds,
  implies,
  prepareCondition,
  validateCondition,
} from "../condition.ts";
import { assert, assertEquals, assertThrows } from "./+assert.ts";

test("$eq matches when value is equal", () => {
  assertEquals(holds({ a: { $eq: 1 } }, { a: 1 }), true);
});

test("$eq does not match when value differs", () => {
  assertEquals(holds({ a: { $eq: 1 } }, { a: 2 }), false);
});

test("$ne matches when value differs", () => {
  assertEquals(holds({ a: { $ne: 1 } }, { a: 2 }), true);
});

test("$ne does not match when value is equal", () => {
  assertEquals(holds({ a: { $ne: 1 } }, { a: 1 }), false);
});

test("$in matches when value is in array", () => {
  assertEquals(holds({ a: { $in: [1, 2, 3] } }, { a: 2 }), true);
});

test("$in does not match when value is absent", () => {
  assertEquals(holds({ a: { $in: [1, 2, 3] } }, { a: 9 }), false);
});

test("$nin matches when value is not in array", () => {
  assertEquals(holds({ a: { $nin: [1, 2, 3] } }, { a: 9 }), true);
});

test("$nin does not match when value is in array", () => {
  assertEquals(holds({ a: { $nin: [1, 2, 3] } }, { a: 2 }), false);
});

test("$gt matches when value is strictly greater", () => {
  assertEquals(holds({ a: { $gt: 5 } }, { a: 6 }), true);
});

test("$gt does not match when value is equal", () => {
  assertEquals(holds({ a: { $gt: 5 } }, { a: 5 }), false);
});

test("$gte matches when value is equal or greater", () => {
  assertEquals(holds({ a: { $gte: 5 } }, { a: 5 }), true);
});

test("$gte does not match when value is less", () => {
  assertEquals(holds({ a: { $gte: 5 } }, { a: 4 }), false);
});

test("$lt matches when value is strictly less", () => {
  assertEquals(holds({ a: { $lt: 5 } }, { a: 4 }), true);
});

test("$lt does not match when value is equal", () => {
  assertEquals(holds({ a: { $lt: 5 } }, { a: 5 }), false);
});

test("$lte matches when value is equal or less", () => {
  assertEquals(holds({ a: { $lte: 5 } }, { a: 5 }), true);
});

test("$lte does not match when value is greater", () => {
  assertEquals(holds({ a: { $lte: 5 } }, { a: 6 }), false);
});

test("$exists true matches when field is present", () => {
  assertEquals(holds({ a: { $exists: true } }, { a: 1 }), true);
});

test("$exists true does not match when field is missing", () => {
  assertEquals(holds({ a: { $exists: true } }, { b: 1 }), false);
});

test("$exists false matches when field is missing", () => {
  assertEquals(holds({ a: { $exists: false } }, { b: 1 }), true);
});

test("$type matches by alias when type is correct", () => {
  assertEquals(holds({ a: { $type: "string" } }, { a: "x" }), true);
});

test("$type does not match when type differs", () => {
  assertEquals(holds({ a: { $type: "string" } }, { a: 1 }), false);
});

test("$and matches when all clauses match", () => {
  assertEquals(holds({ $and: [{ a: 1 }, { b: 2 }] }, { a: 1, b: 2 }), true);
});

test("$and does not match when one clause fails", () => {
  assertEquals(holds({ $and: [{ a: 1 }, { b: 2 }] }, { a: 1, b: 9 }), false);
});

test("$or matches when one clause matches", () => {
  assertEquals(holds({ $or: [{ a: 1 }, { a: 2 }] }, { a: 2 }), true);
});

test("$or does not match when no clause matches", () => {
  assertEquals(holds({ $or: [{ a: 1 }, { a: 2 }] }, { a: 9 }), false);
});

test("$nor matches when no clause matches", () => {
  assertEquals(holds({ $nor: [{ a: 1 }, { a: 2 }] }, { a: 9 }), true);
});

test("$nor does not match when any clause matches", () => {
  assertEquals(holds({ $nor: [{ a: 1 }, { a: 2 }] }, { a: 1 }), false);
});

test("$not matches when inner predicate fails", () => {
  assertEquals(holds({ a: { $not: { $eq: 1 } } }, { a: 2 }), true);
});

test("$not does not match when inner predicate succeeds", () => {
  assertEquals(holds({ a: { $not: { $eq: 1 } } }, { a: 1 }), false);
});

test("$regex matches when pattern matches", () => {
  assertEquals(holds({ a: { $regex: "^foo" } }, { a: "foobar" }), true);
});

test("$regex does not match when pattern fails", () => {
  assertEquals(holds({ a: { $regex: "^foo" } }, { a: "barfoo" }), false);
});

test("$regex with $options i matches case-insensitively", () => {
  assertEquals(
    holds({ a: { $regex: "^foo", $options: "i" } }, { a: "FOOBAR" }),
    true,
  );
});

test("$regex without $options i fails a case mismatch", () => {
  assertEquals(holds({ a: { $regex: "^foo" } }, { a: "FOOBAR" }), false);
});

test("$all matches when all values are present in array", () => {
  assertEquals(holds({ a: { $all: [1, 2] } }, { a: [1, 2, 3] }), true);
});

test("$all does not match when a value is missing", () => {
  assertEquals(holds({ a: { $all: [1, 2, 9] } }, { a: [1, 2, 3] }), false);
});

test("$elemMatch matches when an element satisfies the sub-query", () => {
  assertEquals(
    holds(
      { items: { $elemMatch: { x: { $gt: 5 } } } },
      { items: [{ x: 1 }, { x: 7 }] },
    ),
    true,
  );
});

test("$elemMatch does not match when no element satisfies", () => {
  assertEquals(
    holds(
      { items: { $elemMatch: { x: { $gt: 5 } } } },
      { items: [{ x: 1 }, { x: 2 }] },
    ),
    false,
  );
});

test("$size matches when array length equals param", () => {
  assertEquals(holds({ a: { $size: 3 } }, { a: [1, 2, 3] }), true);
});

test("$size does not match when length differs", () => {
  assertEquals(holds({ a: { $size: 3 } }, { a: [1, 2] }), false);
});

test("validateCondition rejects $where", () => {
  assertThrows(
    () => validateCondition({ $where: "function() { return true; }" }),
    Error,
    "Forbidden operator",
  );
});

test("validateCondition rejects $expr nested in $and", () => {
  assertThrows(
    () => validateCondition({ $and: [{ $expr: { $eq: ["$a", 1] } }] }),
    Error,
    "Forbidden operator",
  );
});

test("validateCondition accepts a fully allowed condition", () => {
  validateCondition({
    $and: [
      { a: { $eq: 1 } },
      { b: { $in: [1, 2] } },
      { c: { $regex: "^x", $options: "i" } },
    ],
  });
});

test("equal JSON conditions share one compiled tester", () => {
  const a = compileCondition({ status: { $in: ["active", "pending"] } });
  const b = compileCondition({ status: { $in: ["active", "pending"] } });
  assert(a === b);
  assertEquals(a({ status: "active" }), true);
  assertEquals(a({ status: "archived" }), false);
});

test("conditions that JSON cannot represent are compiled afresh", () => {
  const regexA = compileCondition({ name: { $regex: /^a/ } });
  const regexB = compileCondition({ name: { $regex: /^a/ } });
  assert(regexA !== regexB);
  const dateA = compileCondition({ at: new Date(0) });
  const dateB = compileCondition({ at: new Date(0) });
  assert(dateA !== dateB);
  assert(compileCondition({ n: NaN }) !== compileCondition({ n: null }));
  assert(compileCondition({ n: -0 }) !== compileCondition({ n: 0 }));
  assertEquals(holds({ n: null }, { n: null }), true);
  assertEquals(holds({ n: NaN }, { n: null }), false);
});

test("mutating a condition after it was cached never changes the cached tester", () => {
  const condition = { status: { $in: ["active"] } };
  const tester = compileCondition(condition);
  condition.status.$in.push("archived");
  assertEquals(tester({ status: "archived" }), false);
  assertEquals(
    compileCondition({ status: { $in: ["active"] } })({ status: "archived" }),
    false,
  );
  assertEquals(holds(condition, { status: "archived" }), true);
});

test("a forbidden operator is rejected on every call, cached or not", () => {
  const condition: Record<string, unknown> = { status: "active" };
  compileCondition(condition);
  condition.$where = "true";
  assertThrows(() => compileCondition(condition));
  assertThrows(() => holds({ nested: { $or: [{ $function: {} }] } }, {}));
  assertThrows(() => prepareCondition({ $expr: {} }));
});

test("prepareCondition validates eagerly and compiles once, lazily", () => {
  const prepared = prepareCondition({ tier: "gold" });
  const first = prepared();
  const second = prepared();
  assert(first === second);
  assertEquals(prepared()({ tier: "gold" }), true);
});

test("conditionProblem returns null for a valid condition", () => {
  assertEquals(conditionProblem({ a: { $in: [1, 2] }, b: "x" }), null);
});

test("conditionProblem returns the message for a forbidden operator", () => {
  const problem = conditionProblem({ $and: [{ $where: "true" }] });
  assert(problem !== null);
  assert(problem.includes("Forbidden operator"));
  assert(problem.includes('"$where"'));
});

test("implies holds between equal conditions", () => {
  assertEquals(implies({ a: 1, b: { $gt: 2 } }, { a: 1, b: { $gt: 2 } }), true);
});

test("implies treats an extra clause as narrower", () => {
  assertEquals(implies({ a: 1, b: 2 }, { a: 1 }), true);
});

test("implies treats an $and that adds clauses as narrower", () => {
  assertEquals(implies({ $and: [{ a: 1 }, { b: 2 }] }, { a: 1 }), true);
});

test("implies treats an $in shrunk to a subset as narrower", () => {
  assertEquals(implies({ a: { $in: [1] } }, { a: { $in: [1, 2] } }), true);
  assertEquals(
    implies({ a: { $in: [1, 3] } }, { a: { $in: [1, 2, 3] } }),
    true,
  );
});

test("implies treats an $in shrunk to a single value as narrower", () => {
  assertEquals(implies({ a: 1 }, { a: { $in: [1, 2] } }), true);
  assertEquals(implies({ a: { $eq: 2 } }, { a: { $in: [1, 2] } }), true);
});

test("implies does not treat a wider $in as narrower", () => {
  assertEquals(
    implies({ a: { $in: [1, 2, 3] } }, { a: { $in: [1, 2] } }),
    false,
  );
});

test("implies does not treat an $or as narrower", () => {
  assertEquals(
    implies({ $or: [{ a: 1 }, { a: 2 }] }, { a: { $in: [1, 2] } }),
    false,
  );
});

test("implies does not treat a different operator as narrower", () => {
  assertEquals(implies({ a: { $gt: 1 } }, { a: { $gte: 1 } }), false);
});

test("implies does not hold when a clause is missing", () => {
  assertEquals(implies({ b: 1 }, { a: 1, b: 1 }), false);
});

test("implies always holds against an undefined wide condition", () => {
  assertEquals(implies({ a: 1 }, undefined), true);
  assertEquals(implies(undefined, undefined), true);
});

test("an undefined narrow condition never implies a defined wide one", () => {
  assertEquals(implies(undefined, { a: 1 }), false);
  assertEquals(implies(undefined, {}), false);
});

test("conjunction returns required alone when nothing exists", () => {
  const required = { a: 1 };
  assert(conjunction(required, undefined) === required);
});

test("conjunction returns existing when it already implies required", () => {
  const existing = { a: 1, b: 2 };
  assert(conjunction({ a: 1 }, existing) === existing);
});

test("conjunction combines required and existing otherwise", () => {
  assertEquals(conjunction({ a: 1 }, { b: 2 }), {
    $and: [{ a: 1 }, { b: 2 }],
  });
});

test("allOf of no parts is the empty condition", () => {
  assertEquals(allOf([]), {});
});

test("allOf of only empty parts is the empty condition", () => {
  assertEquals(allOf([{}, {}]), {});
});

test("allOf of one part is that part", () => {
  assertEquals(allOf([{ _id: "a" }]), { _id: "a" });
});

test("allOf of several parts is their $and", () => {
  assertEquals(allOf([{ _id: "a" }, { status: "active" }]), {
    $and: [{ _id: "a" }, { status: "active" }],
  });
});

test("allOf drops empty parts", () => {
  assertEquals(allOf([{ _id: "a" }, {}, { status: "x" }]), {
    $and: [{ _id: "a" }, { status: "x" }],
  });
});

test("deepEqual compares primitives", () => {
  assertEquals(deepEqual(1, 1), true);
  assertEquals(deepEqual("a", "a"), true);
  assertEquals(deepEqual(1, "1"), false);
  assertEquals(deepEqual(null, null), true);
  assertEquals(deepEqual(null, {}), false);
});

test("deepEqual compares nested objects", () => {
  assertEquals(
    deepEqual({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 2 }] } }),
    true,
  );
  assertEquals(
    deepEqual({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 3 }] } }),
    false,
  );
});

test("deepEqual compares arrays", () => {
  assertEquals(deepEqual([1, 2], [1, 2]), true);
  assertEquals(deepEqual([1, 2], [2, 1]), false);
  assertEquals(deepEqual([1], { 0: 1 }), false);
});

test("deepEqual ignores key order", () => {
  assertEquals(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
});

test("deepEqual tells apart different lengths", () => {
  assertEquals(deepEqual([1, 2], [1, 2, 3]), false);
  assertEquals(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
});

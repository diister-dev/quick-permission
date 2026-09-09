import { test } from "node:test";
import { assertEquals, assertThrows } from "./+assert.ts";
import { evaluateSpec, validateSpec } from "../mongo-query.ts";

// $eq

test("$eq matches when value is equal", () => {
  assertEquals(evaluateSpec({ a: { $eq: 1 } }, { a: 1 }), true);
});

test("$eq does not match when value differs", () => {
  assertEquals(evaluateSpec({ a: { $eq: 1 } }, { a: 2 }), false);
});

// $ne

test("$ne matches when value differs", () => {
  assertEquals(evaluateSpec({ a: { $ne: 1 } }, { a: 2 }), true);
});

test("$ne does not match when value is equal", () => {
  assertEquals(evaluateSpec({ a: { $ne: 1 } }, { a: 1 }), false);
});

// $in

test("$in matches when value is in array", () => {
  assertEquals(evaluateSpec({ a: { $in: [1, 2, 3] } }, { a: 2 }), true);
});

test("$in does not match when value is absent", () => {
  assertEquals(evaluateSpec({ a: { $in: [1, 2, 3] } }, { a: 9 }), false);
});

// $nin

test("$nin matches when value is not in array", () => {
  assertEquals(evaluateSpec({ a: { $nin: [1, 2, 3] } }, { a: 9 }), true);
});

test("$nin does not match when value is in array", () => {
  assertEquals(evaluateSpec({ a: { $nin: [1, 2, 3] } }, { a: 2 }), false);
});

// $gt

test("$gt matches when value is strictly greater", () => {
  assertEquals(evaluateSpec({ a: { $gt: 5 } }, { a: 6 }), true);
});

test("$gt does not match when value is equal", () => {
  assertEquals(evaluateSpec({ a: { $gt: 5 } }, { a: 5 }), false);
});

// $gte

test("$gte matches when value is equal or greater", () => {
  assertEquals(evaluateSpec({ a: { $gte: 5 } }, { a: 5 }), true);
});

test("$gte does not match when value is less", () => {
  assertEquals(evaluateSpec({ a: { $gte: 5 } }, { a: 4 }), false);
});

// $lt

test("$lt matches when value is strictly less", () => {
  assertEquals(evaluateSpec({ a: { $lt: 5 } }, { a: 4 }), true);
});

test("$lt does not match when value is equal", () => {
  assertEquals(evaluateSpec({ a: { $lt: 5 } }, { a: 5 }), false);
});

// $lte

test("$lte matches when value is equal or less", () => {
  assertEquals(evaluateSpec({ a: { $lte: 5 } }, { a: 5 }), true);
});

test("$lte does not match when value is greater", () => {
  assertEquals(evaluateSpec({ a: { $lte: 5 } }, { a: 6 }), false);
});

// $exists

test("$exists:true matches when field is present", () => {
  assertEquals(evaluateSpec({ a: { $exists: true } }, { a: 1 }), true);
});

test("$exists:true does not match when field is missing", () => {
  assertEquals(evaluateSpec({ a: { $exists: true } }, { b: 1 }), false);
});

test("$exists:false matches when field is missing", () => {
  assertEquals(evaluateSpec({ a: { $exists: false } }, { b: 1 }), true);
});

// $type

test("$type matches by alias when type is correct", () => {
  assertEquals(evaluateSpec({ a: { $type: "string" } }, { a: "x" }), true);
});

test("$type does not match when type differs", () => {
  assertEquals(evaluateSpec({ a: { $type: "string" } }, { a: 1 }), false);
});

// $and

test("$and matches when all clauses match", () => {
  assertEquals(
    evaluateSpec({ $and: [{ a: 1 }, { b: 2 }] }, { a: 1, b: 2 }),
    true,
  );
});

test("$and does not match when one clause fails", () => {
  assertEquals(
    evaluateSpec({ $and: [{ a: 1 }, { b: 2 }] }, { a: 1, b: 9 }),
    false,
  );
});

// $or

test("$or matches when one clause matches", () => {
  assertEquals(evaluateSpec({ $or: [{ a: 1 }, { a: 2 }] }, { a: 2 }), true);
});

test("$or does not match when no clause matches", () => {
  assertEquals(evaluateSpec({ $or: [{ a: 1 }, { a: 2 }] }, { a: 9 }), false);
});

// $nor

test("$nor matches when no clause matches", () => {
  assertEquals(evaluateSpec({ $nor: [{ a: 1 }, { a: 2 }] }, { a: 9 }), true);
});

test("$nor does not match when any clause matches", () => {
  assertEquals(evaluateSpec({ $nor: [{ a: 1 }, { a: 2 }] }, { a: 1 }), false);
});

// $not

test("$not matches when inner predicate fails", () => {
  assertEquals(evaluateSpec({ a: { $not: { $eq: 1 } } }, { a: 2 }), true);
});

test("$not does not match when inner predicate succeeds", () => {
  assertEquals(evaluateSpec({ a: { $not: { $eq: 1 } } }, { a: 1 }), false);
});

// $regex (+ $options)

test("$regex matches when pattern matches", () => {
  assertEquals(evaluateSpec({ a: { $regex: "^foo" } }, { a: "foobar" }), true);
});

test("$regex does not match when pattern fails", () => {
  assertEquals(evaluateSpec({ a: { $regex: "^foo" } }, { a: "barfoo" }), false);
});

test("$regex with $options:i matches case-insensitively", () => {
  assertEquals(
    evaluateSpec({ a: { $regex: "^foo", $options: "i" } }, { a: "FOOBAR" }),
    true,
  );
});

test("$regex without $options:i fails case-sensitive mismatch", () => {
  assertEquals(evaluateSpec({ a: { $regex: "^foo" } }, { a: "FOOBAR" }), false);
});

// $all

test("$all matches when all values are present in array", () => {
  assertEquals(evaluateSpec({ a: { $all: [1, 2] } }, { a: [1, 2, 3] }), true);
});

test("$all does not match when a value is missing", () => {
  assertEquals(
    evaluateSpec({ a: { $all: [1, 2, 9] } }, { a: [1, 2, 3] }),
    false,
  );
});

// $elemMatch

test("$elemMatch matches when an element satisfies the sub-query", () => {
  assertEquals(
    evaluateSpec(
      { items: { $elemMatch: { x: { $gt: 5 } } } },
      { items: [{ x: 1 }, { x: 7 }] },
    ),
    true,
  );
});

test("$elemMatch does not match when no element satisfies", () => {
  assertEquals(
    evaluateSpec(
      { items: { $elemMatch: { x: { $gt: 5 } } } },
      { items: [{ x: 1 }, { x: 2 }] },
    ),
    false,
  );
});

// $size

test("$size matches when array length equals param", () => {
  assertEquals(evaluateSpec({ a: { $size: 3 } }, { a: [1, 2, 3] }), true);
});

test("$size does not match when length differs", () => {
  assertEquals(evaluateSpec({ a: { $size: 3 } }, { a: [1, 2] }), false);
});

// Whitelist barrier

test("validateSpec rejects $where", () => {
  assertThrows(
    () => validateSpec({ $where: "function() { return true; }" }),
    Error,
    "Forbidden Mongo operator",
  );
});

test("validateSpec rejects $expr nested in $and", () => {
  assertThrows(
    () => validateSpec({ $and: [{ $expr: { $eq: ["$a", 1] } }] }),
    Error,
    "Forbidden Mongo operator",
  );
});

test("validateSpec accepts a fully whitelisted spec", () => {
  validateSpec({
    $and: [
      { a: { $eq: 1 } },
      { b: { $in: [1, 2] } },
      { c: { $regex: "^x", $options: "i" } },
    ],
  });
});

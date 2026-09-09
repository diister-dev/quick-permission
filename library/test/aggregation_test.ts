/**
 * Unit tests for the cross-grant aggregation primitives.
 * Aggregation behaviors are also exercised end-to-end by `constraints_test.ts`
 * and `filter_union_test.ts` — these tests pin down the contract shape.
 */

import { test } from "node:test";
import { assertEquals } from "./+assert.ts";
import {
  aggregateConstraints,
  combineGrantConstraints,
  type FilterUnion,
  mergeFilterSpec,
  projectFields,
  resolveFilteredData,
} from "../aggregation.ts";

test("combineGrantConstraints — empty input → undefined", () => {
  assertEquals(combineGrantConstraints([]), undefined);
});

test("combineGrantConstraints — only empty objects → {}", () => {
  assertEquals(combineGrantConstraints([{}, {}]), {});
});

test("combineGrantConstraints — single concrete entry → as-is", () => {
  assertEquals(combineGrantConstraints([{ _id: "a" }]), { _id: "a" });
});

test("combineGrantConstraints — N concrete entries → $and", () => {
  assertEquals(combineGrantConstraints([{ _id: "a" }, { status: "active" }]), {
    $and: [{ _id: "a" }, { status: "active" }],
  });
});

test("combineGrantConstraints — empty entries are filtered out", () => {
  assertEquals(combineGrantConstraints([{ _id: "a" }, {}, { status: "x" }]), {
    $and: [{ _id: "a" }, { status: "x" }],
  });
});

test("aggregateConstraints — empty input → undefined", () => {
  assertEquals(aggregateConstraints([]), undefined);
});

test("aggregateConstraints — any undefined entry → undefined (any wins)", () => {
  assertEquals(aggregateConstraints([{ _id: "a" }, undefined]), undefined);
});

test("aggregateConstraints — any {} entry → {} (any wins among concrete)", () => {
  assertEquals(aggregateConstraints([{ _id: "a" }, {}]), {});
});

test("aggregateConstraints — single concrete → as-is", () => {
  assertEquals(aggregateConstraints([{ _id: "a" }]), { _id: "a" });
});

test("aggregateConstraints — N concrete → $or", () => {
  assertEquals(aggregateConstraints([{ _id: "a" }, { _id: "b" }]), {
    $or: [{ _id: "a" }, { _id: "b" }],
  });
});

test("projectFields — non-object passes through", () => {
  assertEquals(projectFields(42, { a: true }), 42);
  assertEquals(projectFields(null, { a: true }), null);
  assertEquals(projectFields([1, 2], { a: true }), [1, 2]);
});

test("projectFields — keeps only fields with true value present in source", () => {
  assertEquals(
    projectFields({ a: 1, b: 2, c: 3 }, { a: true, c: true, missing: true }),
    { a: 1, c: 3 },
  );
});

test("projectFields — false fields excluded", () => {
  assertEquals(projectFields({ a: 1, b: 2 }, { a: true, b: false }), { a: 1 });
});

test("mergeFilterSpec — undefined + spec → spec", () => {
  assertEquals(mergeFilterSpec(undefined, { a: true }), { a: true });
});

test("mergeFilterSpec — null is sticky", () => {
  assertEquals(mergeFilterSpec(null, { a: true }), null);
});

test("mergeFilterSpec — null contribution saturates", () => {
  assertEquals(mergeFilterSpec({ a: true }, null), null);
});

test("mergeFilterSpec — Record + Record unions", () => {
  assertEquals(mergeFilterSpec({ a: true }, { b: true }), { a: true, b: true });
});

test("resolveFilteredData — null union returns reference source", () => {
  const ref = { a: 1, b: 2 };
  assertEquals(resolveFilteredData(null, ref, "fallback"), ref);
});

test("resolveFilteredData — Record union projects", () => {
  assertEquals(resolveFilteredData({ a: true }, { a: 1, b: 2 }, "fallback"), {
    a: 1,
  });
});

test("resolveFilteredData — undefined union → fallback", () => {
  const fallback: FilterUnion = undefined;
  assertEquals(resolveFilteredData(fallback, { a: 1 }, "fallback"), "fallback");
});

test("resolveFilteredData — Record union with undefined source → fallback", () => {
  assertEquals(
    resolveFilteredData({ a: true }, undefined, "fallback"),
    "fallback",
  );
});

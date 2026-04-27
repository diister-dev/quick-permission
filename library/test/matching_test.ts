import { matchPath } from "../core/matching.ts";

function assert(condition: boolean, message: string = "") {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

Deno.test("matchPath - exact single segment", () => {
  assert(matchPath(["a"], ["a"]) === true, "exact match");
  assert(matchPath(["a"], ["b"]) === false, "different value");
});

Deno.test("matchPath - segment wildcard", () => {
  assert(matchPath(["anything"], ["*"]) === true, "* matches any string");
  assert(matchPath([42], ["*"]) === true, "* matches any value");
  assert(matchPath([null], ["*"]) === true, "* matches null");
});

Deno.test("matchPath - prefix wildcard on string segments", () => {
  assert(matchPath(["article:123"], ["article:*"]) === true, "prefix matches");
  assert(matchPath(["article:"], ["article:*"]) === true, "prefix empty suffix matches");
  assert(matchPath(["other:123"], ["article:*"]) === false, "different prefix");
});

Deno.test("matchPath - composite paths", () => {
  assert(matchPath(["expo:1", "badge:42"], ["expo:1", "badge:*"]) === true);
  assert(matchPath(["expo:1", "badge:42"], ["*", "*"]) === true);
  assert(matchPath(["expo:1", "badge:42"], ["expo:2", "badge:*"]) === false);
});

Deno.test("matchPath - arity mismatch", () => {
  assert(matchPath(["a"], ["a", "b"]) === false, "shorter than pattern");
  assert(matchPath(["a", "b"], ["a"]) === false, "longer than pattern");
});

Deno.test("matchPath - empty paths", () => {
  assert(matchPath([], []) === true, "empty matches empty");
  assert(matchPath(["a"], []) === false, "non-empty does not match empty");
});

Deno.test("matchPath - prefix wildcard does not cross segment boundaries", () => {
  // The prefix wildcard is per-segment, so "a:*" should not match across an array boundary.
  assert(matchPath(["a:1", "b"], ["a:*"]) === false, "different arity, no cross-segment match");
});

Deno.test("matchPath - non-string values are matched by equality", () => {
  assert(matchPath([42], [42]) === true);
  assert(matchPath([42], [43]) === false);
  const obj = { x: 1 };
  assert(matchPath([obj], [obj]) === true, "same reference");
  assert(matchPath([{ x: 1 }], [{ x: 1 }]) === false, "structural equality not supported");
});

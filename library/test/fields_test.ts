import { test } from "node:test";
import { fieldsProblem, fieldsWithin, selectFields, widen } from "../fields.ts";
import { assertEquals } from "./+assert.ts";

test("selectFields passes a non-object source through", () => {
  assertEquals(selectFields(42, { a: true }), 42);
  assertEquals(selectFields(null, { a: true }), null);
  assertEquals(selectFields([1, 2], { a: true }), [1, 2]);
  assertEquals(selectFields("text", { a: true }), "text");
  assertEquals(selectFields(undefined, { a: true }), undefined);
});

test("selectFields keeps only selected fields present in the source", () => {
  assertEquals(
    selectFields({ a: 1, b: 2, c: 3 }, { a: true, c: true, missing: true }),
    { a: 1, c: 3 },
  );
});

test("selectFields does not copy an unlisted field", () => {
  assertEquals(selectFields({ a: 1, b: 2 }, { a: true }), { a: 1 });
});

test("selectFields selects inside nested objects", () => {
  assertEquals(
    selectFields(
      { a: 1, b: { c: 2, d: 3, e: { f: 4, g: 5 } } },
      { a: true, b: { c: true, e: { g: true } } },
    ),
    { a: 1, b: { c: 2, e: { g: 5 } } },
  );
});

test("selectFields copies a whole branch selected with true", () => {
  assertEquals(selectFields({ b: { c: 2, d: 3 } }, { b: true }), {
    b: { c: 2, d: 3 },
  });
});

test("selectFields selects inside arrays of objects", () => {
  assertEquals(
    selectFields(
      {
        items: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
      { items: { x: true } },
    ),
    { items: [{ x: 1 }, { x: 3 }] },
  );
});

test("selectFields replaces non-object array items with null under a nested selection", () => {
  assertEquals(
    selectFields({ items: [{ x: 1, y: 2 }, 7] }, { items: { x: true } }),
    {
      items: [{ x: 1 }, null],
    },
  );
});

test("selectFields leaves out a field whose value is a scalar under a nested selection", () => {
  assertEquals(selectFields({ a: 5, b: 1 }, { a: { c: true }, b: true }), {
    b: 1,
  });
});

test("widen from nothing gives the addition", () => {
  assertEquals(widen(undefined, { a: true }), { a: true });
});

test("widen keeps all once all is reached", () => {
  assertEquals(widen("all", { a: true }), "all");
});

test("widen saturates when the addition is all", () => {
  assertEquals(widen({ a: true }, "all"), "all");
});

test("widen unions two selections", () => {
  assertEquals(widen({ a: true }, { b: true }), { a: true, b: true });
});

test("widen merges nested selections", () => {
  assertEquals(widen({ a: { b: true } }, { a: { c: true } }), {
    a: { b: true, c: true },
  });
});

test("widen lets a whole branch absorb a nested selection", () => {
  assertEquals(widen({ a: true }, { a: { b: true } }), { a: true });
  assertEquals(widen({ a: { b: true } }, { a: true }), { a: true });
});

test("fieldsWithin accepts a subset", () => {
  assertEquals(fieldsWithin({ a: true }, { a: true, b: true }), true);
});

test("fieldsWithin accepts a nested subset", () => {
  assertEquals(
    fieldsWithin({ a: { b: true } }, { a: { b: true, c: true } }),
    true,
  );
});

test("fieldsWithin lets a whole allowed branch cover any nested ask", () => {
  assertEquals(fieldsWithin({ a: { b: { c: true } } }, { a: true }), true);
});

test("fieldsWithin refuses a whole branch when only part of it is allowed", () => {
  assertEquals(fieldsWithin({ a: true }, { a: { b: true } }), false);
});

test("fieldsWithin refuses an unknown field", () => {
  assertEquals(fieldsWithin({ z: true }, { a: true }), false);
  assertEquals(fieldsWithin({ a: { z: true } }, { a: { b: true } }), false);
});

test("fieldsProblem returns null for a valid selection", () => {
  assertEquals(
    fieldsProblem({ a: true, b: { c: true, d: { e: true } } }),
    null,
  );
});

test("fieldsProblem names a selection that is not a record", () => {
  assertEquals(fieldsProblem(["a"]), "fields must be a selection of fields");
  assertEquals(fieldsProblem(null), "fields must be a selection of fields");
});

test("fieldsProblem names the path of a false leaf", () => {
  assertEquals(
    fieldsProblem({ a: true, b: false }),
    "fields.b must be true or a nested selection",
  );
});

test("fieldsProblem names the path of a string leaf", () => {
  assertEquals(
    fieldsProblem({ a: { b: "yes" } }),
    "fields.a.b must be true or a nested selection",
  );
});

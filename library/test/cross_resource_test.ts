import { test } from "node:test";
import {
  action,
  compilePermissions,
  defineRule,
  entity,
  permissions,
} from "../mod.ts";
import { assertEquals, assertThrows } from "./+assert.ts";

const user = entity("user", {
  load: (id): { _id: string; name: string } => ({ _id: id, name: "Test" }),
});

test("defineRule: the catalog exposes the `when` a rule declares", () => {
  const rule = defineRule({
    name: "flagged-test",
    when: "myFlag",
    check: () => true,
  });
  const users = permissions(user, "users", {
    read: action({ rules: [rule] }),
  });
  const [entry] = compilePermissions([users]).catalog();
  assertEquals(entry.accepts.when, ["myFlag"]);
});

test("defineRule: rows without perDocument is refused", () => {
  assertThrows(() =>
    defineRule({
      name: "invalid",
      rows: () => null,
      check: () => true,
    }),
  );
});

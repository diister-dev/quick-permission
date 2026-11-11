import { test } from "node:test";
import {
  action,
  bundle,
  createSystem,
  entity,
  list,
  permissions,
} from "../mod.ts";
import { assert, assertEquals } from "./+assert.ts";

test("catalog expandsTo: flattens nested bundles to actions only", () => {
  const user = entity<{ _id: string }>("user", {});
  const users = permissions(user, "users", {
    read: action(),
    update: action(),
    delete: action(),
    list: list("read"),
    manage: bundle(["list", "update", "delete"]),
  });
  const system = createSystem({ permissions: [users] });

  const byKey = new Map(system.catalog().map((item) => [item.key, item]));
  const read = byKey.get("users.read");
  const update = byKey.get("users.update");
  const listing = byKey.get("users.list");
  const manage = byKey.get("users.manage");
  assert(read && update && listing && manage);

  assertEquals(read.expandsTo, []);
  assertEquals(update.expandsTo, []);
  assertEquals([...listing.expandsTo].sort(), ["users.read"]);
  assertEquals([...manage.expandsTo].sort(), [
    "users.delete",
    "users.read",
    "users.update",
  ]);
});

test("catalog expandsTo: an action reached through several bundles appears once", () => {
  const x = entity<{ _id: string }>("x", {});
  const leaves = permissions(x, "leaf", { x: action() });
  const mids = permissions(x, "mid", {
    a: bundle(["leaf.x"]),
    b: bundle(["leaf.x"]),
  });
  const roots = permissions(x, { root: bundle(["mid.a", "mid.b", "leaf.x"]) });
  const system = createSystem({ permissions: [leaves, mids, roots] });

  const root = system.catalog().find((item) => item.key === "root");
  assert(root);
  assertEquals([...root.expandsTo], ["leaf.x"]);
});

test("catalog expandsTo: a bundle on a parent reaches an action on its child", () => {
  const expo = entity<{ _id: string }>("expo", {});
  const child = expo.child<{ _id: string }>("entity", {});
  const expos = permissions(expo, "expo", {
    manage: bundle(["expo.entity.read"]),
  });
  const children = permissions(child, "expo.entity", { read: action() });
  const system = createSystem({ permissions: [expos, children] });

  const manage = system.catalog().find((item) => item.key === "expo.manage");
  assert(manage);
  assertEquals([...manage.expandsTo], ["expo.entity.read"]);
});

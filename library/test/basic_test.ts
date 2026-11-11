import { test } from "node:test";
import { ALL, action, createSystem, entity, permissions } from "../mod.ts";
import { assert, assertEquals } from "./+assert.ts";

test("load is invoked with the target ids", async () => {
  const loaded: string[][] = [];
  const user = entity("user", {
    load: (id) => {
      loaded.push([id]);
      return { _id: id, name: "Alice" };
    },
  });
  const users = permissions(user, "users", { read: action() });
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [users.grant("read", { on: "user:abc", where: { name: "Alice" } })],
    ],
  });

  const result = await system
    .context({ subject: { id: "user:caller" } })
    .check("users.read", "user:abc");
  assertEquals(result.ok, true);
  assertEquals(loaded, [["user:abc"]]);
});

test("a grant without where passes on the document", async () => {
  const user = entity("user", {
    load: (id) => ({ _id: id, name: "Alice" }),
  });
  const users = permissions(user, "users", { read: action() });
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("read", { on: ALL })]],
  });

  const result = await system
    .context({ subject: { id: "user:1" } })
    .check("users.read", "user:abc");
  assertEquals(result.ok, true);
});

test("a where that does not hold on the document denies", async () => {
  const user = entity("user", {
    load: (id) => ({ _id: id, status: "active" }),
  });
  const users = permissions(user, "users", { read: action() });
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [users.grant("read", { on: ALL, where: { status: "suspended" } })],
    ],
  });

  const result = await system
    .context({ subject: { id: "user:1" } })
    .check("users.read", "user:abc");
  assertEquals(result.ok, false);
});

test("fields: doc without a field list returns the full document", async () => {
  const user = entity("user", {
    load: () => ({ _id: "user:abc", firstname: "Alice", email: "a@ex.com" }),
  });
  const users = permissions(user, "users", {
    read: action({ fields: "doc" }),
  });
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("read", { on: ALL })]],
  });

  const result = await system
    .context({ subject: { id: "user:1" } })
    .check("users.read", "user:abc");
  assert(result.ok);
  assertEquals(result.doc, {
    _id: "user:abc",
    firstname: "Alice",
    email: "a@ex.com",
  });
});

test("fields: doc with a field list projects only allowed fields", async () => {
  const user = entity("user", {
    load: () => ({ _id: "user:abc", firstname: "Alice", email: "a@ex.com" }),
  });
  const users = permissions(user, "users", {
    read: action({ fields: "doc" }),
  });
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [users.grant("read", { on: ALL, fields: { firstname: true } })],
    ],
  });

  const result = await system
    .context({ subject: { id: "user:1" } })
    .check("users.read", "user:abc");
  assert(result.ok);
  assertEquals(result.doc, { firstname: "Alice" });
});

test("a grant without where never loads the document", async () => {
  let loads = 0;
  const user = entity("user", {
    load: () => {
      loads++;
      return { _id: "user:abc", roles: ["role:editor"] };
    },
  });
  const users = permissions(user, "users", { read: action() });
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("read", { on: ALL })]],
  });

  const result = await system
    .context({ subject: { id: "user:1" } })
    .check("users.read", "user:abc");
  assertEquals(result.ok, true);
  assertEquals(loads, 0);
});

test("a where on an array field denies when the required value is absent", async () => {
  const user = entity("user", {
    load: () => ({ _id: "user:abc", roles: ["role:viewer"] }),
  });
  const users = permissions(user, "users", { read: action() });
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [users.grant("read", { on: ALL, where: { roles: "role:editor" } })],
    ],
  });

  const result = await system
    .context({ subject: { id: "user:1" } })
    .check("users.read", "user:abc");
  assertEquals(result.ok, false);
});

test("a where on an array field accepts any of several values", async () => {
  const user = entity("user", {
    load: () => ({ _id: "user:abc", roles: ["role:editor"] }),
  });
  const users = permissions(user, "users", { read: action() });
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [
        users.grant("read", {
          on: ALL,
          where: { roles: { $in: ["role:admin", "role:editor"] } },
        }),
      ],
    ],
  });

  const result = await system
    .context({ subject: { id: "user:1" } })
    .check("users.read", "user:abc");
  assertEquals(result.ok, true);
});

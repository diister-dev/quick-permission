import { test } from "node:test";
import { ALL, action, createSystem, entity, permissions } from "../mod.ts";
import { assert, assertEquals } from "./+assert.ts";

test("capability query: loads no document", async () => {
  let fetches = 0;
  const role = entity("role", {
    load: (id) => {
      fetches++;
      if (id === "role:*") throw new Error(`Role not found: ${id}`);
      return { _id: id };
    },
  });
  const roles = permissions(role, "roles", {
    read: action({ fields: "doc" }),
  });
  const system = createSystem({
    permissions: [roles],
    providers: [() => [roles.grant("read", { on: ALL })]],
  });

  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals(await ctx.could("roles.read"), true);
  assertEquals(fetches, 0);
});

test("capability query: a where is exposed as the row filter", async () => {
  const role = entity("role", {
    load: () => ({ _id: "role:concrete", level: "admin" }),
  });
  const roles = permissions(role, "roles", { read: action() });
  const system = createSystem({
    permissions: [roles],
    providers: [
      () => [roles.grant("read", { on: ALL, where: { level: "admin" } })],
    ],
  });

  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals(await ctx.could("roles.read"), true);
  const scope = await ctx.scope("roles.read");
  assert(scope.ok);
  assertEquals(scope.query.filter, { level: "admin" });
  assertEquals(scope.query.stages, null);
});

test("capability query: a grant without constraints answers yes", async () => {
  const role = entity("role", {
    load: (): { _id: string } => {
      throw new Error("should not be called in capability mode");
    },
  });
  const roles = permissions(role, "roles", {
    update: action({ fields: "doc" }),
  });
  const system = createSystem({
    permissions: [roles],
    providers: [() => [roles.grant("update", { on: ALL })]],
  });

  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals(await ctx.could("roles.update"), true);
});

test("capability query: a condition that needs the document denies", async () => {
  const article = entity("article", {
    load: () => ({ _id: "a", authorId: "user:1" }),
    conditions: {
      ownerOnly: { owner: (doc) => doc.authorId },
    },
  });
  const articles = permissions(article, "articles", { update: action() });
  const system = createSystem({
    permissions: [articles],
    providers: [
      () => [articles.grant("update", { on: ALL, when: ["ownerOnly"] })],
    ],
  });

  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals(await ctx.could("articles.update"), false);
});

test("concrete check: loads the document and evaluates the where", async () => {
  let fetches = 0;
  const role = entity("role", {
    load: (id) => {
      fetches++;
      return { _id: id, level: "admin" };
    },
  });
  const roles = permissions(role, "roles", { read: action() });
  const system = createSystem({
    permissions: [roles],
    providers: [
      () => [roles.grant("read", { on: ALL, where: { level: "admin" } })],
    ],
  });

  const result = await system
    .context({ subject: { id: "user:1" } })
    .check("roles.read", "role:r1");
  assertEquals(result.ok, true);
  assertEquals(fetches, 1);
});

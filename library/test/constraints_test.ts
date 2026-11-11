import { test } from "node:test";
import {
  ALL,
  action,
  createSystem,
  entity,
  type Grant,
  type GrantRejection,
  permissions,
} from "../mod.ts";
import { assert, assertEquals } from "./+assert.ts";

type UserDoc = {
  readonly _id: string;
  readonly role: string;
  readonly orgId: string;
};

type RatedUserDoc = {
  readonly _id: string;
  readonly status: string;
  readonly role: string;
};

type StatusDoc = { readonly _id: string; readonly status: string };

function usersOf(load: (id: string) => UserDoc) {
  const user = entity("user", { load });
  return permissions(user, "users", { read: action() });
}

function lucasOrAdmin(id: string): UserDoc {
  return {
    _id: id,
    role: id === "user:lucas" ? "editor" : "admin",
    orgId: id === "user:lucas" ? "org:b" : "org:a",
  };
}

test("constraints: single matched grant exposes its condition as-is", async () => {
  const users = usersOf(lucasOrAdmin);
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [
        users.grant("read", { id: "g", on: ALL, where: { role: "editor" } }),
      ],
    ],
  });
  const ctx = system.context({ subject: { id: "s" } });
  const result = await ctx.check("users.read", "user:lucas");
  assert(result.ok);
  assertEquals(result.grants, ["g"]);
  const scope = await ctx.scope("users.read");
  assert(scope.ok);
  assertEquals(scope.query, { filter: { role: "editor" }, stages: null });
});

test("constraints: multiple matched grants become $or", async () => {
  const users = usersOf(lucasOrAdmin);
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [
        users.grant("read", { id: "g1", on: ALL, where: { role: "editor" } }),
        users.grant("read", { id: "g2", on: ALL, where: { orgId: "org:b" } }),
      ],
    ],
  });
  const ctx = system.context({ subject: { id: "s" } });
  const result = await ctx.check("users.read", "user:lucas");
  assert(result.ok);
  const scope = await ctx.scope("users.read");
  assert(scope.ok);
  assertEquals(scope.query, {
    filter: { $or: [{ role: "editor" }, { orgId: "org:b" }] },
    stages: null,
  });
});

test("constraints: a grant without condition collapses the union to all rows", async () => {
  const users = usersOf(lucasOrAdmin);
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [
        users.grant("read", {
          id: "scoped",
          on: ALL,
          where: { role: "editor" },
        }),
        users.grant("read", { id: "open", on: ALL }),
      ],
    ],
  });
  const ctx = system.context({ subject: { id: "s" } });
  const result = await ctx.check("users.read", "user:lucas");
  assert(result.ok);
  const scope = await ctx.scope("users.read");
  assert(scope.ok);
  assertEquals(scope.query, { filter: {}, stages: null });
});

test("constraints: a capability question returns the union without loading", async () => {
  let loads = 0;
  const users = usersOf((id) => {
    loads++;
    return { _id: id, role: "none", orgId: "none" };
  });
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [
        users.grant("read", {
          id: "g1",
          on: ALL,
          where: { _id: "user:lucas" },
        }),
        users.grant("read", { id: "g2", on: ALL, where: { orgId: "org:b" } }),
      ],
    ],
  });
  const ctx = system.context({ subject: { id: "s" } });
  const scope = await ctx.scope("users.read");
  assert(scope.ok);
  assertEquals(loads, 0);
  assertEquals(scope.query, {
    filter: { $or: [{ _id: "user:lucas" }, { orgId: "org:b" }] },
    stages: null,
  });
});

test("constraints: $ne / $in operators carried through", async () => {
  const user = entity("user", {
    load: (id): RatedUserDoc => ({
      _id: id,
      status: id === "user:lucas" ? "active" : "external",
      role: id === "user:lucas" ? "editor" : "viewer",
    }),
  });
  const users = permissions(user, "users", { read: action() });
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [
        users.grant("read", {
          id: "g",
          on: ALL,
          where: {
            status: { $ne: "external" },
            role: { $in: ["editor", "admin"] },
          },
        }),
      ],
    ],
  });
  const ctx = system.context({ subject: { id: "s" } });
  const ok = await ctx.check("users.read", "user:lucas");
  assert(ok.ok);
  const scope = await ctx.scope("users.read");
  assert(scope.ok);
  assertEquals(scope.query, {
    filter: {
      status: { $ne: "external" },
      role: { $in: ["editor", "admin"] },
    },
    stages: null,
  });
  const ko = await ctx.check("users.read", "user:other");
  assertEquals(ko.ok, false);
});

test("target: a grant on one instance becomes {_id: target[0]}", async () => {
  const user = entity("user", { load: (id): { _id: string } => ({ _id: id }) });
  const users = permissions(user, "users", { read: action() });
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("read", { id: "g", on: "user:lucas" })]],
  });
  const scope = await system
    .context({ subject: { id: "s" } })
    .scope("users.read");
  assert(scope.ok);
  assertEquals(scope.query, { filter: { _id: "user:lucas" }, stages: null });
});

test("target: combines with the grant condition via AND inside the same grant", async () => {
  const user = entity("user", {
    load: (id): StatusDoc => ({ _id: id, status: "active" }),
  });
  const users = permissions(user, "users", { read: action() });
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [
        users.grant("read", {
          id: "g",
          on: "user:lucas",
          where: { status: "active" },
        }),
      ],
    ],
  });
  const scope = await system
    .context({ subject: { id: "s" } })
    .scope("users.read");
  assert(scope.ok);
  assertEquals(scope.query, {
    filter: { $and: [{ status: "active" }, { _id: "user:lucas" }] },
    stages: null,
  });
});

test("target: a wildcard target emits no constraint", async () => {
  const user = entity("user", { load: (id): { _id: string } => ({ _id: id }) });
  const users = permissions(user, "users", { read: action() });
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("read", { id: "admin", on: ALL })]],
  });
  const scope = await system
    .context({ subject: { id: "s" } })
    .scope("users.read");
  assert(scope.ok);
  assertEquals(scope.query, { filter: {}, stages: null });
});

test("target: a child entity is constrained by its own segment", async () => {
  const exposition = entity("exposition", { refType: "expo" });
  const badge = exposition.child("badge", {});
  const badges = permissions(badge, "expo.badges", { read: action() });
  const system = createSystem({
    permissions: [badges],
    providers: [
      () => [badges.grant("read", { id: "g", on: ["expo:e1", "badge:b42"] })],
    ],
  });
  const scope = await system
    .context({ subject: { id: "s" } })
    .scope("expo.badges.read", "expo:e1");
  assert(scope.ok);
  assertEquals(scope.query, { filter: { _id: "badge:b42" }, stages: null });
});

test("constraints: conditions on the parent and the entity AND-merged within a grant", async () => {
  const exposition = entity("exposition", {
    load: (id): StatusDoc => ({ _id: id, status: "active" }),
  });
  const badge = exposition.child("badge", {
    load: (_expositionId, id): StatusDoc => ({ _id: id, status: "active" }),
  });
  const badges = permissions(badge, "expositions.badges", { read: action() });
  const system = createSystem({
    permissions: [badges],
    providers: [
      () => [
        badges.grant("read", {
          id: "g",
          on: ["exposition:e1", ALL],
          parents: { exposition: { _id: "exposition:e1" } },
          where: { status: "active" },
        }),
      ],
    ],
  });
  const scope = await system
    .context({ subject: { id: "s" } })
    .scope("expositions.badges.read", "exposition:e1");
  assert(scope.ok);
  assertEquals(scope.query, { filter: { status: "active" }, stages: null });
});

test("constraints: $where operator rejected by whitelist", async () => {
  const user = entity("user", { load: (): { _id: string } => ({ _id: "u" }) });
  const users = permissions(user, "users", { read: action() });
  const rejections: GrantRejection[] = [];
  const held: Grant = {
    id: "g",
    key: "users.read",
    on: ["user:*"],
    where: { $where: "function() { return true }" },
  };
  const system = createSystem({
    permissions: [users],
    providers: [() => [held]],
    hooks: { onGrantRejected: (event) => rejections.push(event) },
  });
  const result = await system
    .context({ subject: { id: "s" } })
    .check("users.read", "user:1");
  assertEquals(result.ok, false);
  assertEquals(rejections.length, 1);
  assert(rejections[0].reason.includes("$where"));
});

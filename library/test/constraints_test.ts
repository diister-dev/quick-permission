import { assertEquals } from "jsr:@std/assert";
import {
  createSystem,
  matchPath,
  permission,
  resource,
  target,
} from "../mod.ts";

const userOf = resource({
  id: "user",
  fetch: ({ target }) => ({
    _id: target[0] as string,
    role: target[0] === "user:lucas" ? "editor" : "admin",
    orgId: target[0] === "user:lucas" ? "org:b" : "org:a",
  }),
  dedupKey: ({ target }) => target[0] as string,
});

Deno.test("constraints: single matched grant → constraint exposed as-is", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [
      { id: "g", key: "users.read", target: ["user:*"], with: { user: { role: "editor" } } },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:lucas"],
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.constraints, { role: "editor" });
});

Deno.test("constraints: multiple matched grants → $or", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [
      { id: "g1", key: "users.read", target: ["user:*"], with: { user: { role: "editor" } } },
      { id: "g2", key: "users.read", target: ["user:*"], with: { user: { orgId: "org:b" } } },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:lucas"],
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.constraints, {
      $or: [{ role: "editor" }, { orgId: "org:b" }],
    });
  }
});

Deno.test("constraints: grant without spec collapses union to {} (any)", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [
      { id: "scoped", key: "users.read", target: ["user:*"], with: { user: { role: "editor" } } },
      { id: "open", key: "users.read", target: ["user:*"] },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:lucas"],
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.constraints, {});
});

Deno.test("constraints: capability mode returns union without fetching", async () => {
  let fetches = 0;
  const u = resource({
    id: "user",
    fetch: () => {
      fetches++;
      return { _id: "should-not-be-called" };
    },
    dedupKey: ({ target }) => target[0] as string,
  });
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        u.match(),
      ]),
    },
    providers: [() => [
      { id: "g1", key: "users.read", target: ["user:*"], with: { user: { _id: "user:lucas" } } },
      { id: "g2", key: "users.read", target: ["user:*"], with: { user: { orgId: "org:b" } } },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:*"],
  );
  assertEquals(r.ok, true);
  assertEquals(fetches, 0);
  if (r.ok) {
    assertEquals(r.constraints, {
      $or: [{ _id: "user:lucas" }, { orgId: "org:b" }],
    });
  }
});

Deno.test("constraints: $ne / $in operators carried through", async () => {
  const u = resource({
    id: "user",
    fetch: ({ target }) => ({
      _id: target[0] as string,
      status: target[0] === "user:lucas" ? "active" : "external",
      role: target[0] === "user:lucas" ? "editor" : "viewer",
    }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        u.match(),
      ]),
    },
    providers: [() => [
      {
        id: "g",
        key: "users.read",
        target: ["user:*"],
        with: {
          user: {
            status: { $ne: "external" },
            role: { $in: ["editor", "admin"] },
          },
        },
      },
    ]],
  });
  // Lucas: passes both ($ne external + role in editor/admin)
  const ok = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:lucas"],
  );
  assertEquals(ok.ok, true);
  if (ok.ok) {
    assertEquals(ok.constraints, {
      status: { $ne: "external" },
      role: { $in: ["editor", "admin"] },
    });
  }

  // Other user: fails
  const ko = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:other"],
  );
  assertEquals(ko.ok, false);
});

Deno.test("matchPath: translates target-only grant to {_id: target[0]}", async () => {
  const u = resource({
    id: "user",
    fetch: ({ target }) => ({ _id: target[0] as string }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        u.match(),
        matchPath(),
      ]),
    },
    providers: [() => [
      { id: "g", key: "users.read", target: ["user:lucas"] },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:*"],
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.constraints, { _id: "user:lucas" });
});

Deno.test("matchPath: combines with grant.with via AND inside the same grant", async () => {
  const u = resource({
    id: "user",
    fetch: ({ target }) => ({
      _id: target[0] as string,
      status: "active",
    }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        u.match(),
        matchPath(),
      ]),
    },
    providers: [() => [
      {
        id: "g",
        key: "users.read",
        target: ["user:lucas"],
        with: { user: { status: "active" } },
      },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:*"],
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.constraints, {
      $and: [{ status: "active" }, { _id: "user:lucas" }],
    });
  }
});

Deno.test("matchPath: wildcard target emits no constraint", async () => {
  const u = resource({
    id: "user",
    fetch: ({ target }) => ({ _id: target[0] as string }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        u.match(),
        matchPath(),
      ]),
    },
    providers: [() => [
      { id: "admin", key: "users.read", target: ["user:*"] },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:*"],
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.constraints, {});
});

Deno.test("matchPath: custom field + segment for path resources", async () => {
  const sys = createSystem({
    schema: {
      "expo.badges.read": permission({
        target: target.path("exposition", "badge"),
      }).rules([
        // For a sub-resource: target[1] = badgeId, _id of the badge sub-doc.
        matchPath({ segment: 1 }),
      ]),
    },
    providers: [() => [
      { id: "g", key: "expo.badges.read", target: ["expo:e1", "badge:b42"] },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "expo.badges.read",
    ["expo:e1", "badge:*"],
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.constraints, { _id: "badge:b42" });
});

Deno.test("constraints: multiple match rules AND-merged within a grant", async () => {
  const expoOf = resource({
    id: "exposition",
    fetch: ({ target }) => ({ _id: target[0] as string, status: "active" }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const badgeOf = resource({
    id: "badge",
    fetch: ({ target }) => ({ _id: target[1] as string, status: "active" }),
    dedupKey: ({ target }) => `${target[0]}::${target[1]}`,
  });
  const sys = createSystem({
    schema: {
      "expositions.badges.read": permission({
        target: target.path("exposition", "badge"),
      }).rules([
        expoOf.match(),
        badgeOf.match(),
      ]),
    },
    providers: [() => [
      {
        id: "g",
        key: "expositions.badges.read",
        target: ["exposition:e1", "badge:*"],
        with: {
          exposition: { _id: "exposition:e1" },
          badge: { status: "active" },
        },
      },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "expositions.badges.read",
    ["exposition:e1", "badge:*"],
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    // `expoOf` is auto-bound to segment 0 (id === "exposition" matches
    // target.path's first segment name). In cap-mode with a concrete
    // target[0]="exposition:e1", the engine fetches the exposition doc
    // and `match.exposition` evaluates the spec normally (without
    // emitting its constraint into the final pushdown — the check is
    // already resolved).
    // `badgeOf` is auto-bound to segment 1, but target[1]="badge:*" is
    // wildcard → legacy silent-pass + emit `{ status: "active" }`.
    assertEquals(r.constraints, { status: "active" });
  }
});

Deno.test("constraints: $where operator rejected by whitelist", async () => {
  const u = resource({
    id: "user",
    fetch: () => ({ _id: "u" }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        u.match(),
      ]),
    },
    providers: [() => [
      {
        id: "g",
        key: "users.read",
        target: ["user:*"],
        // deno-lint-ignore no-explicit-any
        with: { user: { $where: "function() { return true }" } as any },
      },
    ]],
  });
  let threw = false;
  try {
    await sys.context({ subject: { id: "s" } }).can("users.read", ["user:1"]);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

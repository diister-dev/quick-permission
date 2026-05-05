import { assertEquals } from "jsr:@std/assert";
import {
  createSystem,
  permission,
  resource,
  target,
} from "../mod.ts";

Deno.test("resource fetcher is invoked with subject + target + grant", async () => {
  const captured: { subject: string; target: readonly unknown[] }[] = [];
  const userOf = resource({
    id: "user",
    fetch: ({ subject, target }) => {
      captured.push({ subject: subject.id, target });
      return { _id: target[0] as string, name: "Alice" };
    },
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [
      () => [{ key: "users.read", target: ["user:abc"] }],
    ],
  });

  const result = await sys.context({ subject: { id: "user:caller" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, true);
  assertEquals(captured.length, 1);
  assertEquals(captured[0].subject, "user:caller");
  assertEquals(captured[0].target, ["user:abc"]);
});

Deno.test("match silent-pass when grant.with[id] is undefined", async () => {
  const userOf = resource({
    id: "user",
    fetch: ({ target }) => ({ _id: target[0], name: "Alice" }),
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [{ key: "users.read", target: ["user:*"] }]],
  });

  const result = await sys.context({ subject: { id: "user:1" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, true);
});

Deno.test("match denies when grant.with[id] mismatches the resource", async () => {
  const userOf = resource({
    id: "user",
    fetch: ({ target }) => ({ _id: target[0], status: "active" }),
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [
      () => [{
        key: "users.read",
        target: ["user:*"],
        with: { user: { status: "suspended" } },
      }],
    ],
  });

  const result = await sys.context({ subject: { id: "user:1" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, false);
});

Deno.test("filter without grant.filter returns the full resource as data", async () => {
  const userOf = resource({
    id: "user",
    fetch: () => ({ _id: "user:abc", firstname: "Alice", email: "a@ex.com" }),
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.filter(),
      ]),
    },
    providers: [() => [{ key: "users.read", target: ["user:*"] }]],
  });

  const result = await sys.context({ subject: { id: "user:1" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data, {
      _id: "user:abc",
      firstname: "Alice",
      email: "a@ex.com",
    });
  }
});

Deno.test("filter with grant.filter projects only allowed fields", async () => {
  const userOf = resource({
    id: "user",
    fetch: () => ({ _id: "user:abc", firstname: "Alice", email: "a@ex.com" }),
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.filter(),
      ]),
    },
    providers: [() => [{
      key: "users.read",
      target: ["user:*"],
      filter: { firstname: true },
    }]],
  });

  const result = await sys.context({ subject: { id: "user:1" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data, { firstname: "Alice" });
  }
});

Deno.test("includes lazy-active : not invoked when grant has no spec", async () => {
  let extractorCalls = 0;
  const userOf = resource({
    id: "user",
    fetch: () => ({ _id: "user:abc", roles: ["role:editor"] }),
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.includes("requiredRole", (u) => {
          extractorCalls++;
          return u.roles;
        }),
      ]),
    },
    providers: [() => [{ key: "users.read", target: ["user:*"] }]],
  });

  // Pas de `with.requiredRole` → la rule includes est skip → extractor non appelé
  const result = await sys.context({ subject: { id: "user:1" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, true);
  assertEquals(extractorCalls, 0);
});

Deno.test("includes denies when required role is absent from list", async () => {
  const userOf = resource({
    id: "user",
    fetch: () => ({ _id: "user:abc", roles: ["role:viewer"] }),
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.includes("requiredRole", (u) => u.roles),
      ]),
    },
    providers: [() => [{
      key: "users.read",
      target: ["user:*"],
      with: { requiredRole: "role:editor" },
    }]],
  });

  const result = await sys.context({ subject: { id: "user:1" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, false);
});

Deno.test("includes accepts an array of acceptable values (any-of)", async () => {
  const userOf = resource({
    id: "user",
    fetch: () => ({ _id: "user:abc", roles: ["role:editor"] }),
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.includes("requiredRole", (u) => u.roles),
      ]),
    },
    providers: [() => [{
      key: "users.read",
      target: ["user:*"],
      with: { requiredRole: ["role:admin", "role:editor"] },
    }]],
  });

  const result = await sys.context({ subject: { id: "user:1" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, true);
});

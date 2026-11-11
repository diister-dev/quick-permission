import { test } from "node:test";
import {
  ALL,
  action,
  bundle,
  createSystem,
  entity,
  type Grant,
  globalPermissions,
  permissions,
} from "../mod.ts";
import { assertEquals } from "./+assert.ts";

const user = entity("user", {
  load: (id) => ({ _id: id, name: "X" }),
});
const users = permissions(user, "users", { read: action() });

const exposition = entity("exposition", {
  load: (id) => ({ _id: id }),
});
const member = exposition.child("member", {
  load: (expoId, id) => ({ _id: id, expoId }),
});
const members = permissions(member, "expo.members", { read: action() });

test("one entity: a grant without a target does not match a concrete request", async () => {
  const grant: Grant = { id: "g1", key: "users.read" };
  const system = createSystem({
    permissions: [users],
    providers: [() => [grant]],
  });

  const result = await system
    .context({ subject: { id: "user:caller" } })
    .check("users.read", "user:abc");
  assertEquals(result.ok, false);
});

test("one entity: a grant without a target does not match a capability question", async () => {
  const grant: Grant = { id: "g1", key: "users.read" };
  const system = createSystem({
    permissions: [users],
    providers: [() => [grant]],
  });

  const allowed = await system
    .context({ subject: { id: "user:caller" } })
    .could("users.read");
  assertEquals(allowed, false);
});

test("one entity: a properly targeted grant keeps working", async () => {
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("read", { id: "g1", on: "user:abc" })]],
  });

  const result = await system
    .context({ subject: { id: "user:caller" } })
    .check("users.read", "user:abc");
  assertEquals(result.ok, true);
});

test("one entity: a wildcard grant matches a concrete request", async () => {
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("read", { id: "g1", on: ALL })]],
  });

  const result = await system
    .context({ subject: { id: "user:caller" } })
    .check("users.read", "user:abc");
  assertEquals(result.ok, true);
});

test("parent path: a grant without a target does not match", async () => {
  const grant: Grant = { id: "g1", key: "expo.members.read" };
  const system = createSystem({
    permissions: [members],
    providers: [() => [grant]],
  });

  const result = await system
    .context({ subject: { id: "user:caller" } })
    .check("expo.members.read", "exposition:e1", "member:m1");
  assertEquals(result.ok, false);
});

test("no target: a grant without a target matches", async () => {
  const creating = globalPermissions("users", { create: action() });
  const system = createSystem({
    permissions: [creating],
    providers: [() => [creating.grant("create", { id: "g1" })]],
  });

  const result = await system
    .context({ subject: { id: "user:caller" } })
    .check("users.create");
  assertEquals(result.ok, true);
});

test("expansion: a bundle grant without a target is dropped and expands to nothing", async () => {
  let expandCalls = 0;
  const managed = permissions(user, "users", {
    read: action(),
    manage: bundle([], {
      expand: (grant) => {
        expandCalls++;
        return [{ ...grant, key: "users.read" }];
      },
    }),
  });
  const grant: Grant = { id: "g1", key: "users.manage" };
  const system = createSystem({
    permissions: [managed],
    providers: [() => [grant]],
  });
  const bootCalls = expandCalls;

  const r1 = await system
    .context({ subject: { id: "user:caller" } })
    .check("users.manage", "user:abc");
  assertEquals(r1.ok, false);

  const r2 = await system
    .context({ subject: { id: "user:caller" } })
    .check("users.read", "user:abc");
  assertEquals(r2.ok, false);

  assertEquals(expandCalls, bootCalls);
});

test("expansion: a properly targeted bundle expands and its children inherit the target", async () => {
  let expandCalls = 0;
  const managed = permissions(user, "users", {
    read: action(),
    manage: bundle([], {
      expand: (grant) => {
        expandCalls++;
        return [{ ...grant, key: "users.read" }];
      },
    }),
  });
  const system = createSystem({
    permissions: [managed],
    providers: [() => [managed.grant("manage", { id: "g1", on: ALL })]],
  });

  const result = await system
    .context({ subject: { id: "user:caller" } })
    .check("users.read", "user:abc");
  assertEquals(result.ok, true);
  assertEquals(expandCalls >= 1, true);
});

test("expansion: a malformed grant is dropped while a valid sibling survives", async () => {
  const bad: Grant = { id: "bad", key: "users.read" };
  const system = createSystem({
    permissions: [users],
    providers: [
      () => [bad, users.grant("read", { id: "good", on: "user:abc" })],
    ],
  });

  const result = await system
    .context({ subject: { id: "user:caller" } })
    .check("users.read", "user:abc");
  assertEquals(result.ok, true);
});

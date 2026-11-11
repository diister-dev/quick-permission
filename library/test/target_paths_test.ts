import { test } from "node:test";
import {
  ALL,
  action,
  createSystem,
  entity,
  globalPermissions,
  permissions,
} from "../mod.ts";
import { assertEquals } from "./+assert.ts";

const exposition = entity("exposition", {
  load: (id) => ({ _id: id }),
});
const program = exposition.child("program", {
  load: (expoId, id) => ({ _id: id, expoId }),
});
const registration = program.child("registration", {
  load: (_expoId, programId, id) => ({ _id: id, programId }),
});
const registrations = permissions(registration, "registrations", {
  read: action(),
});

type RegistrationOn = readonly [string, string, string] | typeof ALL;

function makeSystem(grants: readonly { id: string; on: RegistrationOn }[]) {
  return createSystem({
    permissions: [registrations],
    providers: [
      () => grants.map((grant) => registrations.grant("read", grant)),
    ],
  });
}

test("path of 3 segments: an exact grant matches the exact request", async () => {
  const system = makeSystem([
    { id: "g1", on: ["exposition:e1", "program:p7", "registration:r1"] },
  ]);
  const result = await system
    .context({ subject: { id: "user:1" } })
    .check(
      "registrations.read",
      "exposition:e1",
      "program:p7",
      "registration:r1",
    );
  assertEquals(result.ok, true);
});

test("path of 3 segments: a wildcard on the last segment matches any registration", async () => {
  const system = makeSystem([
    { id: "g1", on: ["exposition:e1", "program:p7", ALL] },
  ]);
  const r1 = await system
    .context({ subject: { id: "user:1" } })
    .check(
      "registrations.read",
      "exposition:e1",
      "program:p7",
      "registration:r1",
    );
  const r2 = await system
    .context({ subject: { id: "user:1" } })
    .check(
      "registrations.read",
      "exposition:e1",
      "program:p7",
      "registration:r99",
    );
  assertEquals(r1.ok, true);
  assertEquals(r2.ok, true);
});

test("path of 3 segments: wildcards on the middle and last segments cover every registration of the exposition", async () => {
  const system = makeSystem([{ id: "g1", on: ["exposition:e1", ALL, ALL] }]);
  const r1 = await system
    .context({ subject: { id: "user:1" } })
    .check(
      "registrations.read",
      "exposition:e1",
      "program:p7",
      "registration:r1",
    );
  const r2 = await system
    .context({ subject: { id: "user:1" } })
    .check(
      "registrations.read",
      "exposition:e1",
      "program:p99",
      "registration:r42",
    );
  assertEquals(r1.ok, true);
  assertEquals(r2.ok, true);
});

test("path of 3 segments: another exposition does not match", async () => {
  const system = makeSystem([{ id: "g1", on: ["exposition:e1", ALL, ALL] }]);
  const result = await system
    .context({ subject: { id: "user:1" } })
    .check(
      "registrations.read",
      "exposition:e2",
      "program:p1",
      "registration:r1",
    );
  assertEquals(result.ok, false);
});

test("arity: a target too short is denied", async () => {
  const system = makeSystem([{ id: "g", on: ALL }]);
  const allowed = await system
    .context({ subject: { id: "user:1" } })
    .ask("registrations.read", ["exposition:e1", "program:p7"]);
  assertEquals(allowed, false);
});

test("arity: a target too long is denied", async () => {
  const system = makeSystem([{ id: "g", on: ALL }]);
  const allowed = await system
    .context({ subject: { id: "user:1" } })
    .ask("registrations.read", ["e:1", "p:1", "r:1", "extra"]);
  assertEquals(allowed, false);
});

test("one entity: the target has exactly one segment", async () => {
  const user = entity("user", { load: (id) => ({ _id: id }) });
  const users = permissions(user, "users", { read: action() });
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("read", { on: ALL })]],
  });
  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals((await ctx.check("users.read", "user:abc")).ok, true);
  assertEquals(await ctx.ask("users.read", ["user:abc", "extra"]), false);
});

test("no target: a key acting on nothing passes without a target", async () => {
  const users = globalPermissions("users", { create: action() });
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("create", {})]],
  });
  const result = await system
    .context({ subject: { id: "user:1" } })
    .check("users.create");
  assertEquals(result.ok, true);
});

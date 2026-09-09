import { test } from "node:test";
import { assertEquals } from "./+assert.ts";
import { createSystem, permission, resource, target } from "../mod.ts";

const expoOf = resource({
  id: "exposition",
  fetch: ({ target }) => ({ _id: target[0] }),
  dedupKey: ({ target }) => target[0] as string,
});
const programOf = resource({
  id: "program",
  fetch: ({ target }) => ({ _id: target[1], expoId: target[0] }),
  dedupKey: ({ target }) => `${target[0]}::${target[1]}`,
});
const regOf = resource({
  id: "registration",
  fetch: ({ target }) => ({ _id: target[2], programId: target[1] }),
  dedupKey: ({ target }) => `${target[0]}::${target[1]}::${target[2]}`,
});

function makeSystem(grants: { id: string; target: readonly unknown[] }[]) {
  return createSystem({
    schema: {
      "registrations.read": permission({
        target: target.path("exposition", "program", "registration"),
      }).rules([expoOf.match(), programOf.match(), regOf.match()]),
    },
    providers: [
      () =>
        grants.map((g) => ({
          ...g,
          key: "registrations.read" as const,
        })),
    ],
  });
}

test("path 3 segments : grant exact matche le request exact", async () => {
  const sys = makeSystem([
    { id: "g1", target: ["exposition:e1", "program:p7", "registration:r1"] },
  ]);
  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("registrations.read", [
      "exposition:e1",
      "program:p7",
      "registration:r1",
    ]);
  assertEquals(r.ok, true);
});

test("path 3 segments : wildcard sur le dernier segment matche n'importe quelle reg", async () => {
  const sys = makeSystem([
    { id: "g1", target: ["exposition:e1", "program:p7", "registration:*"] },
  ]);
  const r1 = await sys
    .context({ subject: { id: "user:1" } })
    .can("registrations.read", [
      "exposition:e1",
      "program:p7",
      "registration:r1",
    ]);
  const r2 = await sys
    .context({ subject: { id: "user:1" } })
    .can("registrations.read", [
      "exposition:e1",
      "program:p7",
      "registration:r99",
    ]);
  assertEquals(r1.ok, true);
  assertEquals(r2.ok, true);
});

test("path 3 segments : wildcard milieu+fin couvre toutes les regs de l'expo", async () => {
  const sys = makeSystem([
    { id: "g1", target: ["exposition:e1", "program:*", "registration:*"] },
  ]);
  const r1 = await sys
    .context({ subject: { id: "user:1" } })
    .can("registrations.read", [
      "exposition:e1",
      "program:p7",
      "registration:r1",
    ]);
  const r2 = await sys
    .context({ subject: { id: "user:1" } })
    .can("registrations.read", [
      "exposition:e1",
      "program:p99",
      "registration:r42",
    ]);
  assertEquals(r1.ok, true);
  assertEquals(r2.ok, true);
});

test("path 3 segments : exposition différente = pas de match", async () => {
  const sys = makeSystem([
    { id: "g1", target: ["exposition:e1", "program:*", "registration:*"] },
  ]);
  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("registrations.read", [
      "exposition:e2",
      "program:p1",
      "registration:r1",
    ]);
  assertEquals(r.ok, false);
});

test("validation arity : trop court = denied", async () => {
  const sys = makeSystem([{ id: "g", target: ["e:*", "p:*", "r:*"] }]);
  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("registrations.read", ["exposition:e1", "program:p7"]);
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.reasons[0].includes("arity"), true);
  }
});

test("validation arity : trop long = denied", async () => {
  const sys = makeSystem([{ id: "g", target: ["e:*", "p:*", "r:*"] }]);
  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("registrations.read", ["e:1", "p:1", "r:1", "extra"]);
  assertEquals(r.ok, false);
});

test("target.required : actual=1 segment", async () => {
  const userOf = resource({
    id: "user",
    fetch: ({ target }) => ({ _id: target[0] }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [{ key: "users.read", target: ["user:*"] }]],
  });
  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("users.read", ["user:abc"]);
  assertEquals(r.ok, true);

  const wrong = await sys
    .context({ subject: { id: "user:1" } })
    .can("users.read", ["user:abc", "extra"]);
  assertEquals(wrong.ok, false);
});

test("target.none : actual=0 segments, no target arg passes", async () => {
  const sys = createSystem({
    schema: {
      "users.create": permission({ target: target.none() }).rules([]),
    },
    providers: [() => [{ key: "users.create" }]],
  });
  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("users.create");
  assertEquals(r.ok, true);
});

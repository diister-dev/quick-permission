import { test } from "node:test";
import { assertEquals } from "./+assert.ts";
import { createSystem, permission, resource, target } from "../mod.ts";

test("dedup intra-grant : 2 rules sur la même resource = 1 fetch", async () => {
  let fetches = 0;
  const userOf = resource({
    id: "user",
    fetch: () => {
      fetches++;
      return { _id: "user:abc", roles: ["role:editor"] };
    },
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "users.update": permission({ target: target.required("user") }).rules([
        userOf.match(),
        userOf.filter(),
      ]),
    },
    providers: [() => [{ key: "users.update", target: ["user:*"] }]],
  });

  await sys
    .context({ subject: { id: "user:1" } })
    .can("users.update", ["user:abc"]);
  assertEquals(fetches, 1);
});

test("dedup inter-grant : 5 grants sur le même target = 1 fetch", async () => {
  let fetches = 0;
  const userOf = resource({
    id: "user",
    fetch: () => {
      fetches++;
      return { _id: "user:abc", roles: ["role:editor"] };
    },
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "users.update": permission({ target: target.required("user") }).rules([
        userOf.match(),
        userOf.filter(),
      ]),
    },
    providers: [
      () => [
        { id: "g1", key: "users.update", target: ["user:*"] },
        { id: "g2", key: "users.update", target: ["user:*"] },
        { id: "g3", key: "users.update", target: ["user:*"] },
        { id: "g4", key: "users.update", target: ["user:*"] },
        { id: "g5", key: "users.update", target: ["user:*"] },
      ],
    ],
  });

  const ctx = sys.context({ subject: { id: "user:1" } });
  await ctx.can("users.update", ["user:abc"]);
  assertEquals(fetches, 1);
  assertEquals(ctx.getFetchCounters(), { user: 1 });
});

test("dedup cross-permission : read puis update sur même target = 1 fetch", async () => {
  let fetches = 0;
  const userOf = resource({
    id: "user",
    fetch: () => {
      fetches++;
      return { _id: "user:abc" };
    },
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
        userOf.filter(),
      ]),
      "users.update": permission({ target: target.required("user") }).rules([
        userOf.match(),
        userOf.filter(),
      ]),
    },
    providers: [(_s, k) => [{ key: k, target: ["user:*"] }]],
  });

  const ctx = sys.context({ subject: { id: "user:1" } });
  await ctx.can("users.read", ["user:abc"]);
  await ctx.can("users.update", ["user:abc"]);
  assertEquals(fetches, 1);
});

test("dedup partiel sur target path : expo=1, program=1, registration=2", async () => {
  let expoFetches = 0;
  let programFetches = 0;
  let regFetches = 0;

  const expoOf = resource({
    id: "exposition",
    fetch: () => {
      expoFetches++;
      return { _id: "exposition:e1" };
    },
    dedupKey: ({ target }) => target[0] as string,
  });
  const programOf = resource({
    id: "program",
    fetch: () => {
      programFetches++;
      return { _id: "program:p7" };
    },
    dedupKey: ({ target }) => `${target[0]}::${target[1]}`,
  });
  const regOf = resource({
    id: "registration",
    fetch: () => {
      regFetches++;
      return { _id: "registration:??" };
    },
    dedupKey: ({ target }) => `${target[0]}::${target[1]}::${target[2]}`,
  });

  const sys = createSystem({
    schema: {
      "registrations.read": permission({
        target: target.path("exposition", "program", "registration"),
      }).rules([
        expoOf.match(),
        programOf.match(),
        regOf.match(),
        regOf.filter(),
      ]),
    },
    providers: [
      () => [
        {
          key: "registrations.read",
          target: ["exposition:*", "program:*", "registration:*"],
        },
      ],
    ],
  });

  const ctx = sys.context({ subject: { id: "user:1" } });
  await ctx.can("registrations.read", [
    "exposition:e1",
    "program:p7",
    "registration:r1",
  ]);
  await ctx.can("registrations.read", [
    "exposition:e1",
    "program:p7",
    "registration:r2",
  ]);

  assertEquals(expoFetches, 1);
  assertEquals(programFetches, 1);
  assertEquals(regFetches, 2);
});

test("activeWhen sur resource : skip fetch si aucun grant n'active la rule", async () => {
  let fetches = 0;
  const userOf = resource({
    id: "user",
    fetch: () => ({ _id: "user:abc", roles: ["role:viewer"] }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const userMembershipsOf = resource({
    id: "user-memberships",
    fetch: () => {
      fetches++;
      return [{ tenantId: "entreprise:A" }];
    },
    activeWhen: (grant) => grant.flags?.requiresEntreprise === true,
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "users.update": permission({ target: target.required("user") }).rules([
        userOf.match(),
        userMembershipsOf.includes("requiredEntreprise", (m) =>
          m.map((x) => x.tenantId),
        ),
      ]),
    },
    providers: [
      () => [
        // Grant sans flag → userMembershipsOf NE doit PAS être fetché
        { id: "g-admin", key: "users.update", target: ["user:*"] },
      ],
    ],
  });

  await sys
    .context({ subject: { id: "user:1" } })
    .can("users.update", ["user:abc"]);
  assertEquals(fetches, 0);
});

test("compteurs de fetches reset via clearCounters", async () => {
  const userOf = resource({
    id: "user",
    fetch: () => ({ _id: "user:abc" }),
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

  const ctx = sys.context({ subject: { id: "user:1" } });
  await ctx.can("users.read", ["user:abc"]);
  assertEquals(ctx.getFetchCounters(), { user: 1 });
  ctx.clearCounters();
  assertEquals(ctx.getFetchCounters(), {});
});

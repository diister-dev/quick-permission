import { test } from "node:test";
import {
  ALL,
  action,
  createSystem,
  defineRule,
  entity,
  permissions,
} from "../mod.ts";
import { assertEquals } from "./+assert.ts";

type UserDoc = { readonly _id: string; readonly roles?: readonly string[] };

test("dedup within a grant: two rules on the same document load it once", async () => {
  let fetches = 0;
  const user = entity<UserDoc>("user", {
    load: () => {
      fetches++;
      return { _id: "user:abc", roles: ["role:editor"] };
    },
  });
  const users = permissions(user, "users", {
    update: action({ fields: "doc" }),
  });
  const sys = createSystem({
    permissions: [users],
    providers: [() => [users.grant("update", { on: ALL })]],
  });

  await sys
    .context({ subject: { id: "user:1" } })
    .check("users.update", "user:abc");
  assertEquals(fetches, 1);
});

test("dedup across grants: 5 grants on the same target load it once", async () => {
  let fetches = 0;
  const user = entity<UserDoc>("user", {
    load: () => {
      fetches++;
      return { _id: "user:abc", roles: ["role:editor"] };
    },
  });
  const users = permissions(user, "users", {
    update: action({ fields: "doc" }),
  });
  const sys = createSystem({
    permissions: [users],
    providers: [
      () => [
        users.grant("update", { id: "g1", on: ALL }),
        users.grant("update", { id: "g2", on: ALL }),
        users.grant("update", { id: "g3", on: ALL }),
        users.grant("update", { id: "g4", on: ALL }),
        users.grant("update", { id: "g5", on: ALL }),
      ],
    ],
  });

  const ctx = sys.context({ subject: { id: "user:1" } });
  await ctx.check("users.update", "user:abc");
  assertEquals(fetches, 1);
  assertEquals(ctx.fetchCounters(), { user: 1 });
});

test("dedup across keys: read then update on the same target load it once", async () => {
  let fetches = 0;
  const user = entity<UserDoc>("user", {
    load: () => {
      fetches++;
      return { _id: "user:abc" };
    },
  });
  const users = permissions(user, "users", {
    read: action({ fields: "doc" }),
    update: action({ fields: "doc" }),
  });
  const sys = createSystem({
    permissions: [users],
    providers: [(_s, key) => [{ key, on: ["user:*"] }]],
  });

  const ctx = sys.context({ subject: { id: "user:1" } });
  await ctx.check("users.read", "user:abc");
  await ctx.check("users.update", "user:abc");
  assertEquals(fetches, 1);
});

test("partial dedup on a path: exposition=1, program=1, registration=2", async () => {
  let expoFetches = 0;
  let programFetches = 0;
  let regFetches = 0;

  const exposition = entity<{ readonly _id: string }>("exposition", {
    load: () => {
      expoFetches++;
      return { _id: "exposition:e1" };
    },
  });
  const program = exposition.child<{ readonly _id: string }>("program", {
    load: () => {
      programFetches++;
      return { _id: "program:p7" };
    },
  });
  const registration = program.child<{ readonly _id: string }>("registration", {
    load: () => {
      regFetches++;
      return { _id: "registration:??" };
    },
  });
  const registrations = permissions(registration, "registrations", {
    read: action({ fields: "doc" }),
  });

  const sys = createSystem({
    permissions: [registrations],
    providers: [
      () => [
        registrations.grant("read", {
          on: ALL,
          parents: {
            exposition: { _id: "exposition:e1" },
            program: { _id: "program:p7" },
          },
        }),
      ],
    ],
  });

  const ctx = sys.context({ subject: { id: "user:1" } });
  await ctx.check(
    "registrations.read",
    "exposition:e1",
    "program:p7",
    "registration:r1",
  );
  await ctx.check(
    "registrations.read",
    "exposition:e1",
    "program:p7",
    "registration:r2",
  );

  assertEquals(expoFetches, 1);
  assertEquals(programFetches, 1);
  assertEquals(regFetches, 2);
});

test("a document read only by a rule no grant switches on is never loaded", async () => {
  let fetches = 0;
  const user = entity<UserDoc>("user", {
    load: () => ({ _id: "user:abc", roles: ["role:viewer"] }),
  });
  const loadMemberships = async (): Promise<
    readonly { readonly tenantId: string }[]
  > => {
    fetches++;
    return [{ tenantId: "entreprise:A" }];
  };
  const requiresEntreprise = defineRule({
    name: "includes",
    when: "requiresEntreprise",
    async check() {
      const memberships = await loadMemberships();
      return memberships.some(
        (membership) => membership.tenantId === "entreprise:A",
      );
    },
  });
  const users = permissions(user, "users", {
    update: action({ rules: [requiresEntreprise] }),
  });

  const sys = createSystem({
    permissions: [users],
    providers: [() => [users.grant("update", { id: "g-admin", on: ALL })]],
  });

  await sys
    .context({ subject: { id: "user:1" } })
    .check("users.update", "user:abc");
  assertEquals(fetches, 0);
});

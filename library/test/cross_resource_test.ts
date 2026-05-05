import { assertEquals } from "jsr:@std/assert";
import {
  createSystem,
  defineRule,
  permission,
  resource,
  target,
} from "../mod.ts";

/**
 * Tests pour les rules multi-resources (cross-resource) — le cas où
 * `defineRule({ needs: [a, b] })` reçoit plusieurs needs et la check
 * croise leurs données.
 */

const teamMembersOf = resource({
  id: "team-members",
  fetch: ({ subject }) =>
    subject.id === "user:manager"
      ? ["user:teammate1", "user:teammate2"]
      : [],
  dedupKey: ({ subject }) => subject.id,
});

const userOf = resource({
  id: "user",
  fetch: ({ target }) => ({
    _id: target[0] as string,
    name: "Test",
  }),
  dedupKey: ({ target }) => target[0] as string,
});

Deno.test("cross-resource : multi-needs reçoit un tuple aligné de données", async () => {
  const requireTeammate = defineRule({
    kind: "require-teammate",
    needs: [userOf, teamMembersOf] as const,
    flag: "teamScope",
    check: ([user, members], _payload, ctx) => {
      if (!user) return false;
      const targetUserId = user._id;
      return members.includes(targetUserId) && targetUserId !== ctx.subject.id;
    },
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
        requireTeammate,
      ]),
    },
    providers: [() => [{
      key: "users.read",
      target: ["user:*"],
      flags: { teamScope: true },
    }]],
  });

  // Manager voit teammate
  const ok = await sys.context({ subject: { id: "user:manager" } }).can(
    "users.read",
    ["user:teammate1"],
  );
  assertEquals(ok.ok, true);

  // Manager ne se voit pas
  const self = await sys.context({ subject: { id: "user:manager" } }).can(
    "users.read",
    ["user:manager"],
  );
  assertEquals(self.ok, false);

  // Manager ne voit pas les non-teammates
  const stranger = await sys.context({ subject: { id: "user:manager" } }).can(
    "users.read",
    ["user:stranger"],
  );
  assertEquals(stranger.ok, false);
});

Deno.test("cross-resource : 2 needs fetched en parallèle, dédupliqués indépendamment", async () => {
  let userFetches = 0;
  let teamFetches = 0;

  const u = resource({
    id: "u",
    fetch: ({ target }) => {
      userFetches++;
      return { _id: target[0] };
    },
    dedupKey: ({ target }) => target[0] as string,
  });
  const t = resource({
    id: "t",
    fetch: ({ subject }) => {
      teamFetches++;
      return [`team-of:${subject.id}`];
    },
    dedupKey: ({ subject }) => subject.id,
  });

  const cross = defineRule({
    kind: "cross",
    needs: [u, t] as const,
    flag: "checkCross",
    check: ([_userObj, _team]) => true,
  });

  const sys = createSystem({
    schema: {
      "test.action": permission({ target: target.required("user") }).rules([
        u.match(),
        cross,
      ]),
    },
    providers: [() => [{
      key: "test.action",
      target: ["user:*"],
      flags: { checkCross: true },
    }]],
  });

  const ctx = sys.context({ subject: { id: "user:1" } });
  // 2 calls sur 2 users différents : userFetches devrait être 2, teamFetches 1 (subject identique)
  await ctx.can("test.action", ["user:a"]);
  await ctx.can("test.action", ["user:b"]);

  assertEquals(userFetches, 2);
  assertEquals(teamFetches, 1);
});

Deno.test("defineRule : descriptor expose `sources` quand needs.length > 1", () => {
  const r = defineRule({
    kind: "cross-test",
    needs: [userOf, teamMembersOf] as const,
    check: () => true,
  });
  assertEquals(r.descriptor.kind, "cross-test");
  assertEquals(r.descriptor.sources, ["user", "team-members"]);
  assertEquals(r.descriptor.source, undefined);
});

Deno.test("defineRule : descriptor expose `source` quand needs.length === 1", () => {
  const r = defineRule({
    kind: "single-test",
    needs: [userOf] as const,
    check: () => true,
  });
  assertEquals(r.descriptor.source, "user");
  assertEquals(r.descriptor.sources, undefined);
});

Deno.test("defineRule : descriptor expose `flag` si défini", () => {
  const r = defineRule({
    kind: "flagged-test",
    needs: [] as const,
    flag: "myFlag",
    check: () => true,
  });
  assertEquals(r.descriptor.flag, "myFlag");
});

Deno.test("defineRule : describe() merge dans le descriptor sans écraser les champs auto", () => {
  const r = defineRule({
    kind: "described-test",
    needs: [userOf] as const,
    flag: "f",
    describe: () => ({
      kind: "should-be-ignored", // tentative d'override
      source: "should-be-ignored",
      flag: "should-be-ignored",
      myMeta: "preserved",
    }),
    check: () => true,
  });
  assertEquals(r.descriptor.kind, "described-test");
  assertEquals(r.descriptor.source, "user");
  assertEquals(r.descriptor.flag, "f");
  assertEquals(r.descriptor.myMeta, "preserved");
});

Deno.test("defineRule : flag + activeWhen mutuellement exclusifs", () => {
  let threw = false;
  try {
    defineRule({
      kind: "invalid",
      needs: [] as const,
      flag: "x",
      activeWhen: () => true,
      check: () => true,
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

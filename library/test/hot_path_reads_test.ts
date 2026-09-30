import { test } from "node:test";
import { assertEquals } from "./+assert.ts";
import {
  createSystem,
  defineRule,
  type Grant,
  indirectResource,
  permission,
  resource,
  target,
} from "../mod.ts";

const subject = { id: "user:u1" };

const orgOf = resource({
  id: "org",
  fetch: ({ target }) => ({ _id: target[0], status: "active" }),
  dedupKey: ({ target }) => target[0] as string,
});

test("a match rule reads its resource only for a grant that carries a spec", async () => {
  const make = (grants: readonly Grant[]) =>
    createSystem({
      schema: {
        "orgs.read": permission({ target: target.required("org") }).rules([
          orgOf.match(),
        ]),
      },
      providers: [() => grants],
    });

  const open = make([{ key: "orgs.read", target: ["org:*"] }]).context({
    subject,
  });
  for (let i = 0; i < 10; i++) await open.can("orgs.read", [`org:${i}`]);
  assertEquals(open.getFetchCounters(), {});

  const scoped = make([
    {
      key: "orgs.read",
      target: ["org:*"],
      with: { org: { status: "active" } },
    },
  ]).context({ subject });
  for (let i = 0; i < 10; i++) await scoped.can("orgs.read", [`org:${i}`]);
  assertEquals(scoped.getFetchCounters(), { org: 10 });

  const mixed = make([
    { key: "orgs.read", target: ["org:*"] },
    {
      key: "orgs.read",
      target: ["org:*"],
      with: { org: { status: "active" } },
    },
  ]).context({ subject });
  await mixed.can("orgs.read", ["org:1"]);
  assertEquals(mixed.getFetchCounters(), { org: 1 });
});

test("another rule on the same resource still gets its data", async () => {
  const sys = createSystem({
    schema: {
      "orgs.read": permission({ target: target.required("org") }).rules([
        orgOf.match(),
        orgOf.requireTruthy(),
      ]),
    },
    providers: [() => [{ key: "orgs.read", target: ["org:*"] }]],
  });
  const ctx = sys.context({ subject });
  assertEquals((await ctx.can("orgs.read", ["org:1"])).ok, true);
  assertEquals(ctx.getFetchCounters(), { org: 1 });
});

test("an indirect is read only for a grant that constrains it", async () => {
  let joinReads = 0;
  const participantOf = resource({
    id: "participant",
    fetch: ({ target }) => ({ _id: target[0] }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const membershipsOf = indirectResource({
    id: "memberships",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    cardinality: "many",
    fetch: () => {
      joinReads++;
      return [{ organizationId: "org:acme" }];
    },
  });
  const make = (grant: Grant) =>
    createSystem({
      schema: {
        "participants.read": permission({
          target: target.required("participant"),
        }).rules([participantOf.match(), membershipsOf.match()]),
      },
      providers: [() => [grant]],
    }).context({ subject });

  const open = make({ key: "participants.read", target: ["participant:*"] });
  for (let i = 0; i < 5; i++) {
    assertEquals(
      (await open.can("participants.read", [`participant:${i}`])).ok,
      true,
    );
  }
  assertEquals(open.getFetchCounters(), {});
  assertEquals(joinReads, 0);

  const scoped = make({
    key: "participants.read",
    target: ["participant:*"],
    with: { memberships: { organizationId: "org:acme" } },
  });
  assertEquals(
    (await scoped.can("participants.read", ["participant:1"])).ok,
    true,
  );
  assertEquals(scoped.getFetchCounters(), { participant: 1 });
  assertEquals(joinReads, 1);
});

test("a read that nothing consults can no longer fail the check", async () => {
  const brokenOf = resource({
    id: "broken",
    fetch: () => {
      throw new Error("db down");
    },
  });
  const make = (grant: Grant) =>
    createSystem({
      schema: {
        "things.read": permission({ target: target.required("thing") }).rules([
          brokenOf.match(),
        ]),
      },
      providers: [() => [grant]],
    });
  assertEquals(
    (
      await make({ key: "things.read", target: ["thing:*"] }).can(
        subject,
        "things.read",
        ["thing:1"],
      )
    ).ok,
    true,
  );
  const scoped = await make({
    id: "g",
    key: "things.read",
    target: ["thing:*"],
    with: { broken: { a: 1 } },
  }).can(subject, "things.read", ["thing:1"]);
  assertEquals(scoped, {
    ok: false,
    reasons: ["[g] rule evaluation failed: db down"],
  });
});

test("defineRule accepts fetchWhen for custom rules", async () => {
  let reads = 0;
  const docOf = resource({
    id: "doc",
    fetch: () => {
      reads++;
      return { level: 3 };
    },
  });
  const minLevel = defineRule({
    kind: "min-level",
    needs: [docOf] as const,
    fetchWhen: (grant) => typeof grant.payload === "number",
    check: ([doc], payload) =>
      typeof payload !== "number" ||
      (doc as { level: number }).level >= payload,
  });
  const sys = createSystem({
    schema: {
      "docs.read": permission({ target: target.required("doc") }).rules([
        minLevel,
      ]),
    },
    providers: [
      (_s, _k, t) =>
        t?.[0] === "doc:strict"
          ? [{ key: "docs.read", target: ["doc:*"], payload: 5 }]
          : [{ key: "docs.read", target: ["doc:*"] }],
    ],
  });
  assertEquals((await sys.can(subject, "docs.read", ["doc:open"])).ok, true);
  assertEquals(reads, 0);
  assertEquals((await sys.can(subject, "docs.read", ["doc:strict"])).ok, false);
  assertEquals(reads, 1);
});

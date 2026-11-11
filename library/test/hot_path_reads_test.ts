import { test } from "node:test";
import {
  ALL,
  action,
  createSystem,
  defineRule,
  entity,
  type Grant,
  permissions,
} from "../mod.ts";
import { assertEquals } from "./+assert.ts";

const subject = { id: "user:u1" };

type OrgDoc = { readonly _id: string; readonly status: string };

function orgEntity(options: { readonly verifyExists?: boolean } = {}) {
  const org = entity<OrgDoc>("org", {
    load: (id) => ({ _id: id, status: "active" }),
    ...options,
  });
  return permissions(org, "orgs", { read: action() });
}

test("a match rule reads its document only for a grant that carries a condition", async () => {
  const orgs = orgEntity();
  const make = (grants: readonly Grant[]) =>
    createSystem({ permissions: [orgs], providers: [() => grants] });

  const open = make([orgs.grant("read", { on: ALL })]).context({ subject });
  for (let i = 0; i < 10; i++) await open.check("orgs.read", `org:${i}`);
  assertEquals(open.fetchCounters(), {});

  const scoped = make([
    orgs.grant("read", { on: ALL, where: { status: "active" } }),
  ]).context({ subject });
  for (let i = 0; i < 10; i++) await scoped.check("orgs.read", `org:${i}`);
  assertEquals(scoped.fetchCounters(), { org: 10 });

  const mixed = make([
    orgs.grant("read", { on: ALL }),
    orgs.grant("read", { on: ALL, where: { status: "active" } }),
  ]).context({ subject });
  await mixed.check("orgs.read", "org:1");
  assertEquals(mixed.fetchCounters(), { org: 1 });
});

test("another rule on the same document still gets its data", async () => {
  const orgs = orgEntity({ verifyExists: true });
  const sys = createSystem({
    permissions: [orgs],
    providers: [() => [orgs.grant("read", { on: ALL })]],
  });
  const ctx = sys.context({ subject });
  assertEquals((await ctx.check("orgs.read", "org:1")).ok, true);
  assertEquals(ctx.fetchCounters(), { org: 1 });
});

test("a relation is read only for a grant that constrains it", async () => {
  let joinReads = 0;
  const participant = entity<{ readonly _id: string }, "memberships">(
    "participant",
    {
      load: (id) => ({ _id: id }),
      relations: {
        memberships: {
          localField: "_id",
          foreignField: "participantId",
          load: () => {
            joinReads++;
            return [{ organizationId: "org:acme" }];
          },
        },
      },
    },
  );
  const participants = permissions(participant, "participants", {
    read: action(),
  });
  const make = (grant: Grant) =>
    createSystem({
      permissions: [participants],
      providers: [() => [grant]],
    }).context({ subject });

  const open = make(participants.grant("read", { on: ALL }));
  for (let i = 0; i < 5; i++) {
    assertEquals(
      (await open.check("participants.read", `participant:${i}`)).ok,
      true,
    );
  }
  assertEquals(open.fetchCounters(), {});
  assertEquals(joinReads, 0);

  const scoped = make(
    participants.grant("read", {
      on: ALL,
      related: { memberships: { organizationId: "org:acme" } },
    }),
  );
  assertEquals(
    (await scoped.check("participants.read", "participant:1")).ok,
    true,
  );
  assertEquals(scoped.fetchCounters(), { participant: 1 });
  assertEquals(joinReads, 1);
});

test("a read that nothing consults can no longer fail the check", async () => {
  const thing = entity<{ readonly a: number }>("thing", {
    load: () => {
      throw new Error("db down");
    },
  });
  const things = permissions(thing, "things", { read: action() });
  const make = (grant: Grant) =>
    createSystem({ permissions: [things], providers: [() => [grant]] });
  assertEquals(
    (
      await make(things.grant("read", { on: ALL }))
        .context({ subject })
        .check("things.read", "thing:1")
    ).ok,
    true,
  );
  const scoped = await make(
    things.grant("read", { id: "g", on: ALL, where: { a: 1 } }),
  )
    .context({ subject })
    .check("things.read", "thing:1");
  assertEquals(scoped, {
    ok: false,
    reasons: ["[g] rule evaluation failed: db down"],
  });
});

test("a custom rule reads its document only for a grant that needs it", async () => {
  let reads = 0;
  const doc = entity<{ readonly level: number }>("doc", {
    load: () => {
      reads++;
      return { level: 3 };
    },
  });
  const minLevel = defineRule({
    name: "min-level",
    perDocument: true,
    async check(context) {
      const payload = context.grant.payload;
      if (typeof payload !== "number") return true;
      const loaded = await context.doc();
      return (
        typeof loaded === "object" &&
        loaded !== null &&
        "level" in loaded &&
        typeof loaded.level === "number" &&
        loaded.level >= payload
      );
    },
  });
  const docs = permissions(doc, "docs", {
    read: action({ rules: [minLevel] }),
  });
  const sys = createSystem({
    permissions: [docs],
    providers: [
      (_s, _k, t) =>
        t?.[0] === "doc:strict"
          ? [docs.grant("read", { on: ALL, payload: 5 })]
          : [docs.grant("read", { on: ALL })],
    ],
  });
  assertEquals(
    (await sys.context({ subject }).check("docs.read", "doc:open")).ok,
    true,
  );
  assertEquals(reads, 0);
  assertEquals(
    (await sys.context({ subject }).check("docs.read", "doc:strict")).ok,
    false,
  );
  assertEquals(reads, 1);
});

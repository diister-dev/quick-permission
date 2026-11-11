import { test } from "node:test";
import { ALL, createSystem } from "../mod.ts";
import { assertEquals } from "./+assert.ts";
import { createFixture, type UserDoc } from "./+fixture.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

function expectType<T extends true>(): T | undefined {
  return undefined;
}

test("types: keys, targets, lists, documents and grants are checked by the compiler", () => {
  const fixture = createFixture();
  const system = createSystem({ permissions: fixture.all });
  const ctx = system.context({ subject: { id: "user:1" } });
  const { users, participants, platform, notes } = fixture.sets;

  const neverRun = async () => {
    await ctx.check("users.read", "user:1");
    await ctx.check("users.create");
    await ctx.check("users.update", "user:1", { input: {} });
    await ctx.check(
      "expositions.participants.read",
      "exposition:1",
      "participant:1",
    );
    await ctx.check("expositions.participants.create", "exposition:1");
    await ctx.check("platform.analytics.read");

    // @ts-expect-error unknown key
    await ctx.check("users.raed", "user:1");
    // @ts-expect-error a user key takes one id
    await ctx.check("users.read");
    // @ts-expect-error a user key takes one id
    await ctx.check("users.read", "user:1", "user:2");
    // @ts-expect-error a participant key takes two ids
    await ctx.check("expositions.participants.read", "participant:1");
    // @ts-expect-error a global key takes no id
    await ctx.check("platform.analytics.read", "x:1");
    const createUnder = "expositions.participants.create" as const;
    // @ts-expect-error creating under a parent takes the parent only
    await ctx.check(createUnder, "exposition:1", "participant:1");

    await ctx.could("expositions.participants.read");
    await ctx.could("expositions.participants.read", "exposition:1");
    // @ts-expect-error unknown key
    await ctx.could("expositions.participants.raed");

    await ctx.scope("users.list");
    await ctx.scope("expositions.participants.list", "exposition:1");
    await ctx.scope("users.delete");
    await ctx.scope("users.manage");
    await ctx.reach("users.update");
    // @ts-expect-error a key without a document has no scope
    await ctx.scope("users.create");
    // @ts-expect-error a key acting on the parent has no scope of its own
    await ctx.scope("expositions.participants.create", "exposition:1");
    // @ts-expect-error unknown key
    await ctx.reach("users.updat");
    // @ts-expect-error a child list needs its parent
    await ctx.scope("expositions.participants.list");

    const read = await ctx.check("users.read", "user:1");
    if (read.ok)
      expectType<Equal<typeof read.doc, Partial<UserDoc> | undefined>>();
    const scope = await ctx.scope("users.list");
    if (scope.ok) {
      const row = await scope.project({} as UserDoc);
      expectType<Equal<typeof row, Partial<UserDoc> | null>>();
      // @ts-expect-error a user scope projects users
      await scope.project({ _id: "x", authorId: "y", readers: [] });
    }

    users.grant("read", { on: "user:1", where: { tenant: "t1" } });
    users.grant("read", { on: ALL, where: { "address.city": "Lyon" } });
    users.grant("read", {
      on: ALL,
      fields: { _id: true, email: true },
      when: ["self"],
    });
    users.grant("create", {});
    users.grant("read", {
      on: ALL,
      related: { tenants: { status: "active" } },
    });
    participants.grant("read", { on: ["exposition:1", ALL] });
    platform.grant("analytics.read", {});
    notes.grant("read", { on: ALL, when: ["author", "reader"] });

    // @ts-expect-error unknown key of the set
    users.grant("raed", { on: ALL });
    // @ts-expect-error a targeted key needs a target
    users.grant("read", {});
    // @ts-expect-error a global key takes no target
    users.grant("create", { on: ALL });
    // @ts-expect-error not a field of the user document
    users.grant("read", { on: ALL, where: { tenat: "t1" } });
    // @ts-expect-error not a field of the user document
    users.grant("read", { on: ALL, fields: { emial: true } });
    // @ts-expect-error not a condition of the user entity
    users.grant("read", { on: ALL, when: ["author"] });
    // @ts-expect-error not a relation of the user entity
    users.grant("read", { on: ALL, related: { memberships: {} } });
    // @ts-expect-error a participant target has two segments
    participants.grant("read", { on: ["exposition:1"] });
    // @ts-expect-error a participant target is not a single id
    participants.grant("read", { on: "participant:1" });
  };

  assertEquals(typeof neverRun, "function");
  expectType<
    Equal<
      "users.read" extends (typeof system.keys)[number] ? true : false,
      true
    >
  >();
});

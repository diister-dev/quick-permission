import { test } from "node:test";
import { ALL, createSystem, type Grant, type GrantRejection } from "../mod.ts";
import { assert, assertEquals } from "./+assert.ts";
import { createFixture } from "./+fixture.ts";

function setup(grants: (fixture: ReturnType<typeof createFixture>) => Grant[]) {
  const fixture = createFixture();
  const rejections: GrantRejection[] = [];
  const held = grants(fixture);
  const system = createSystem({
    permissions: fixture.all,
    providers: [
      { name: "test", cacheKey: (subject) => subject.id, fetch: () => held },
    ],
    hooks: { onGrantRejected: (event) => rejections.push(event) },
  });
  const ctx = system.context({ subject: { id: "user:9" } });
  return { fixture, system, ctx, rejections };
}

test("check: a grant on one user reads that user and no other", async () => {
  const { ctx } = setup(({ sets }) => [
    sets.users.grant("read", { id: "g", on: "user:1" }),
  ]);
  const own = await ctx.check("users.read", "user:1");
  assert(own.ok);
  assertEquals(own.doc?.email, "a@x.fr");
  assertEquals(own.grants, ["g"]);
  assertEquals((await ctx.check("users.read", "user:2")).ok, false);
});

test("check: refuses a wildcard instead of answering a capability", async () => {
  const { ctx } = setup(({ sets }) => [sets.users.grant("read", { on: ALL })]);
  const result = await ctx.check("users.read", "user:*");
  assertEquals(result.ok, false);
  assertEquals(await ctx.could("users.read"), true);
});

test("could: pads the missing segments with wildcards", async () => {
  const { ctx } = setup(({ sets }) => [
    sets.participants.grant("read", { on: ["exposition:1", ALL] }),
  ]);
  assertEquals(await ctx.could("expositions.participants.read"), true);
  assertEquals(
    await ctx.could("expositions.participants.read", "exposition:1"),
    true,
  );
  assertEquals(
    await ctx.could("expositions.participants.read", "exposition:2"),
    false,
  );
});

test("scope: a list grant on one user restricts the rows to that user", async () => {
  const { ctx, fixture } = setup(({ sets }) => [
    sets.users.grant("list", { on: "user:1" }),
  ]);
  const scope = await ctx.scope("users.list");
  assert(scope.ok);
  assertEquals(scope.query.filter, { _id: "user:1" });
  assertEquals(scope.query.stages, null);
  const everyone = [...fixture.stores.users.values()];
  const visible = await scope.projectAll(everyone);
  assertEquals(
    visible.map((doc) => doc._id),
    ["user:1"],
  );
});

test("scope: an unrestricted grant says so explicitly", async () => {
  const { ctx } = setup(({ sets }) => [sets.users.grant("list", { on: ALL })]);
  const scope = await ctx.scope("users.list");
  assert(scope.ok);
  assertEquals(scope.query.filter, {});
  assertEquals(scope.query.stages, null);
});

test("scope: row filters of several grants are alternatives", async () => {
  const { ctx } = setup(({ sets }) => [
    sets.users.grant("list", { on: ALL, where: { tenant: "t1" } }),
    sets.users.grant("list", { on: "user:2" }),
  ]);
  const scope = await ctx.scope("users.list");
  assert(scope.ok);
  assertEquals(scope.query.filter, {
    $or: [{ tenant: "t1" }, { _id: "user:2" }],
  });
  assertEquals(scope.query.stages, null);
});

test("scope: a denied row is dropped, or replaced only on request", async () => {
  const { ctx, fixture } = setup(({ sets }) => [
    sets.users.grant("list", { on: ALL, where: { tenant: "t1" } }),
  ]);
  const scope = await ctx.scope("users.list");
  assert(scope.ok);
  const outsider = fixture.stores.users.get("user:2");
  assert(outsider);
  assertEquals(await scope.project(outsider), null);
  assertEquals(
    await scope.project(outsider, { denied: (doc) => ({ _id: doc._id }) }),
    { _id: "user:2" },
  );
});

test("scope: each row gets the fields of the grants that cover it", async () => {
  const { ctx, fixture } = setup(({ sets }) => [
    sets.users.grant("list", { on: ALL, where: { tenant: "t1" } }),
    sets.users.grant("list", {
      on: ALL,
      where: { tenant: "t2" },
      fields: { _id: true, firstname: true },
    }),
  ]);
  const scope = await ctx.scope("users.list");
  assert(scope.ok);
  const rows = await scope.projectAll([...fixture.stores.users.values()]);
  assertEquals(rows[0].notes, "vip");
  assertEquals(rows[1], { _id: "user:2", firstname: "Bob" });
});

test("scope: projecting a page reads nothing more from the store", async () => {
  const { ctx, fixture } = setup(({ sets }) => [
    sets.users.grant("list", { on: ALL }),
  ]);
  const scope = await ctx.scope("users.list");
  assert(scope.ok);
  fixture.loads.length = 0;
  await scope.projectAll([...fixture.stores.users.values()]);
  assertEquals(fixture.loads, []);
});

test("grant: a misspelled constraint is rejected, never ignored", async () => {
  const { ctx, rejections } = setup(() => [
    {
      id: "typo",
      key: "users.list",
      on: ["user:*"],
      parents: { usr: { tenant: "t1" } },
    },
  ]);
  assertEquals((await ctx.scope("users.list")).ok, false);
  assertEquals((await ctx.check("users.read", "user:2")).ok, false);
  assertEquals(rejections.length, 1);
  assertEquals(rejections[0].provider, "test");
  assertEquals(
    rejections[0].reason,
    'constraint "usr" is read by no rule of this key',
  );
});

test("grant: an undeclared condition is rejected", async () => {
  const { ctx, rejections } = setup(() => [
    { key: "users.update", on: ["user:*"], when: ["selfOny"] },
  ]);
  assertEquals((await ctx.check("users.update", "user:2")).ok, false);
  assertEquals(
    rejections[0].reason,
    'condition "selfOny" is declared by no rule of this key',
  );
});

test("grant: a target of the wrong entity is rejected", async () => {
  const { ctx, rejections } = setup(() => [
    { key: "users.read", on: ["exposition:1"] },
    { key: "users.read", on: ["user:1", "user:2"] },
    { key: "users.read" },
    { key: "users.raed", on: ["user:1"] },
  ]);
  assertEquals(await ctx.could("users.read"), false);
  assertEquals(
    rejections.map((event) => event.reason),
    [
      'target segment 0 is not a "user" reference',
      "target has 2 segments, the key takes 1",
      "target is missing",
      'unknown permission key "users.raed"',
    ],
  );
});

test("grant: restrictions a key cannot honour are rejected", async () => {
  const { rejections, ctx } = setup(() => [
    { key: "users.delete", on: ["user:*"], fields: { email: true } },
    { key: "users.delete", on: ["user:*"], input: { role: "x" } },
    { key: "users.read", on: ["user:*"], where: { $where: "1" } },
  ]);
  assertEquals(await ctx.could("users.delete"), false);
  assertEquals(await ctx.could("users.read"), false);
  assertEquals(rejections.length, 3);
});

test("grant: unknown top-level tags travel with the grant", async () => {
  const { ctx, system } = setup(({ sets }) => [
    sets.users.grant("read", {
      on: ALL,
      extra: { requiresCapability: "CAP.X" },
    }),
  ]);
  assertEquals(await ctx.could("users.read"), true);
  const [held] = await ctx.heldGrants();
  assertEquals(
    (held as Grant & { requiresCapability?: string }).requiresCapability,
    "CAP.X",
  );
  assertEquals(system.explain(held), null);
});

test("update: the body is reduced to the granted fields", async () => {
  const { ctx } = setup(({ sets }) => [
    sets.users.grant("update", {
      on: "user:1",
      fields: { firstname: true, lastname: true },
    }),
  ]);
  const result = await ctx.check("users.update", "user:1", {
    input: { firstname: "Zoe", email: "evil@x.fr" },
  });
  assert(result.ok);
  assertEquals(result.input, { firstname: "Zoe" });
});

test("create: the input constraint of the grant is enforced", async () => {
  const { ctx } = setup(({ sets }) => [
    sets.expositions.grant("create", {
      input: { entrepriseId: "entreprise:e1" },
    }),
  ]);
  assertEquals(
    (
      await ctx.check("expositions.create", {
        input: { entrepriseId: "entreprise:e1" },
      })
    ).ok,
    true,
  );
  assertEquals(
    (
      await ctx.check("expositions.create", {
        input: { entrepriseId: "entreprise:e2" },
      })
    ).ok,
    false,
  );
  assertEquals((await ctx.check("expositions.create")).ok, false);
});

test("conditions: self, owner, member and custom restrict a wide grant", async () => {
  const fixture = createFixture();
  const system = createSystem({
    permissions: fixture.all,
    providers: [
      () => [
        fixture.sets.users.grant("update", { on: ALL, when: ["self"] }),
        fixture.sets.notes.grant("update", { on: ALL, when: ["author"] }),
        fixture.sets.notes.grant("read", {
          on: ALL,
          when: ["reader", "short"],
        }),
      ],
    ],
  });
  const ada = system.context({ subject: { id: "user:1" } });
  const bob = system.context({ subject: { id: "user:2" } });
  assertEquals((await ada.check("users.update", "user:1")).ok, true);
  assertEquals((await ada.check("users.update", "user:2")).ok, false);
  assertEquals((await ada.check("notes.update", "note:n1")).ok, true);
  assertEquals((await bob.check("notes.update", "note:n1")).ok, false);
  assertEquals((await bob.check("notes.read", "note:n1")).ok, true);
  assertEquals((await ada.check("notes.read", "note:n1")).ok, false);
});

test("children: a document under another parent is not found", async () => {
  const { ctx } = setup(({ sets }) => [
    sets.devices.grant("approve", { on: ALL }),
    sets.participants.grant("read", { on: ALL, where: { status: "pending" } }),
  ]);
  assertEquals(
    (
      await ctx.check(
        "expositions.security.devices.approve",
        "exposition:1",
        "device:d1",
      )
    ).ok,
    true,
  );
  assertEquals(
    (
      await ctx.check(
        "expositions.security.devices.approve",
        "exposition:2",
        "device:d1",
      )
    ).ok,
    false,
  );
  assertEquals(
    (
      await ctx.check(
        "expositions.participants.read",
        "exposition:2",
        "participant:p3",
      )
    ).ok,
    true,
  );
  assertEquals(
    (
      await ctx.check(
        "expositions.participants.read",
        "exposition:1",
        "participant:p3",
      )
    ).ok,
    false,
  );
});

test("relations: a joined constraint filters lists and single reads alike", async () => {
  const { ctx, fixture } = setup(({ sets }) => [
    sets.participants.grant("list", {
      on: ["exposition:1", ALL],
      related: {
        memberships: {
          organizationId: "expo_organization:o1",
          status: "active",
        },
      },
      fields: { _id: true, email: true },
    }),
  ]);
  const scope = await ctx.scope(
    "expositions.participants.list",
    "exposition:1",
  );
  assert(scope.ok);
  assertEquals(scope.query.filter, {});
  assert(scope.query.stages);
  assertEquals(scope.query.stages.length, 2);
  const page = [...fixture.stores.participants.values()].filter(
    (doc) => doc.expositionId === "exposition:1",
  );
  assertEquals(await scope.projectAll(page), [
    { _id: "participant:p1", email: "p1@x.fr" },
  ]);
  assertEquals(
    (
      await ctx.check(
        "expositions.participants.read",
        "exposition:1",
        "participant:p2",
      )
    ).ok,
    false,
  );
});

test("parents: a grant may constrain the parent document", async () => {
  const { ctx } = setup(({ sets }) => [
    sets.participants.grant("read", {
      on: ALL,
      parents: { exposition: { entrepriseId: "entreprise:e1" } },
    }),
  ]);
  assertEquals(
    (
      await ctx.check(
        "expositions.participants.read",
        "exposition:1",
        "participant:p1",
      )
    ).ok,
    true,
  );
  assertEquals(
    (
      await ctx.check(
        "expositions.participants.read",
        "exposition:2",
        "participant:p3",
      )
    ).ok,
    false,
  );
});

test("ask: an untyped question from the outside never throws", async () => {
  const { ctx } = setup(({ sets }) => [sets.users.grant("read", { on: ALL })]);
  assertEquals(await ctx.ask("users.read", "user:1"), true);
  assertEquals(await ctx.ask("users.read", ["user:*"]), true);
  assertEquals(await ctx.ask("users.nope", ["user:1"]), false);
  assertEquals(await ctx.ask("users.read", ["a", "b"]), false);
});

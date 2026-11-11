import { test } from "node:test";
import { compileSpec } from "../mongo-query.ts";
import { ALL, createSystem, type GrantRejection } from "../next/mod.ts";
import type { Provider } from "../system.ts";
import type { Grant, Subject } from "../types.ts";
import { assert, assertEquals } from "./+assert.ts";
import { createFixture } from "./+next_fixture.ts";

type Session = Subject & {
  readonly roles?: readonly string[];
  readonly organizerOf?: readonly string[];
  readonly memberOf?: readonly { exposition: string; organization: string }[];
  readonly tenant?: string;
  readonly device?: { exposition: string };
};

function application() {
  const fixture = createFixture();
  const { sets } = fixture;
  const rejections: GrantRejection[] = [];
  const admin: { grants: readonly Grant[] } = { grants: [] };

  const providers: Provider[] = [
    {
      name: "self",
      keys: ["users.read", "users.update"],
      fetch: (subject) =>
        subject.id.startsWith("user:")
          ? [
              sets.users.grant("read", { id: "self:read", on: subject.id }),
              sets.users.grant("update", {
                id: "self:update",
                on: subject.id,
                fields: ["firstname", "lastname"],
              }),
            ]
          : [],
    },
    {
      name: "membersDirectory",
      keys: ["users.read"],
      cacheKey: (subject) => `directory::${subject.id}`,
      fetch: (subject) =>
        subject.id.startsWith("user:")
          ? [
              sets.users.grant("read", {
                id: "directory",
                on: ALL,
                fields: ["_id", "firstname", "lastname"],
              }),
            ]
          : [],
    },
    {
      name: "omnigrant",
      cacheKey: (subject) => `omnigrant::${subject.id}`,
      fetch: (subject) =>
        (subject as Session).roles?.includes("role:ADMIN") ? admin.grants : [],
    },
    {
      name: "tenantOwner",
      keys: ["users.list"],
      cacheKey: (subject) => `tenant::${subject.id}`,
      fetch: (subject) => {
        const tenant = (subject as Session).tenant;
        return tenant
          ? [
              sets.users.grant("list", {
                id: `tenant:${tenant}`,
                on: ALL,
                related: {
                  tenants: { entrepriseId: tenant, status: "active" },
                },
                fields: ["_id", "firstname", "lastname", "email"],
              }),
            ]
          : [];
      },
    },
    {
      name: "organizer",
      keys: ["expositions.manage"],
      targetType: "exposition",
      cacheKey: (subject) => `organizer::${subject.id}`,
      fetch: (subject) =>
        ((subject as Session).organizerOf ?? []).map((exposition) =>
          sets.expositions.grant("manage", {
            id: `organizer:${exposition}`,
            on: exposition,
          }),
        ),
    },
    {
      name: "orgMember",
      keys: ["expositions.participants.list"],
      targetType: "exposition",
      cacheKey: (subject) => `org-member::${subject.id}`,
      fetch: (subject) =>
        ((subject as Session).memberOf ?? []).map(
          ({ exposition, organization }) =>
            sets.participants.grant("list", {
              id: `member:${exposition}:${organization}`,
              on: [exposition, ALL],
              related: {
                memberships: { organizationId: organization, status: "active" },
              },
              fields: ["_id", "email", "status"],
              extra: { requiresCapability: "ORG_MEMBERSHIP" },
            }),
        ),
    },
    {
      name: "deviceSession",
      keys: ["expositions.security.devices.read"],
      fetch: (subject) => {
        const device = (subject as Session).device;
        return device
          ? [
              sets.devices.grant("read", {
                id: "device:self",
                on: [device.exposition, subject.id],
              }),
            ]
          : [];
      },
    },
  ];

  const system = createSystem({
    permissions: fixture.all,
    providers,
    hooks: { onGrantRejected: (event) => rejections.push(event) },
  });
  admin.grants = system.wildcardGrants("omnigrant");

  async function listUsers(session: Session) {
    const ctx = system.context({ subject: session });
    const scope = await ctx.scope("users.list");
    if (!scope.ok) return [];
    const everyone = [...fixture.stores.users.values()];
    const rows =
      scope.rows === "all"
        ? everyone
        : everyone.filter(compileSpec(scope.rows));
    return await scope.projectAll(rows);
  }

  async function listParticipants(session: Session, exposition: string) {
    const ctx = system.context({ subject: session });
    const scope = await ctx.scope("expositions.participants.list", exposition);
    if (!scope.ok) return { stages: undefined, items: [] };
    const inExposition = [...fixture.stores.participants.values()].filter(
      (doc) => doc.expositionId === exposition,
    );
    const rows =
      scope.rows === "all"
        ? inExposition
        : inExposition.filter(compileSpec(scope.rows));
    return { stages: scope.stages, items: await scope.projectAll(rows) };
  }

  return { fixture, system, rejections, listUsers, listParticipants };
}

test("scenario: a plain member resolves names but enumerates nothing", async () => {
  const app = application();
  const session: Session = { id: "user:2" };
  const ctx = app.system.context({ subject: session });

  assertEquals(await app.listUsers(session), []);
  assertEquals(await ctx.could("users.list"), false);

  const other = await ctx.check("users.read", "user:1");
  assert(other.ok);
  assertEquals(other.doc, { _id: "user:1", firstname: "Ada", lastname: "A" });

  const own = await ctx.check("users.read", "user:2");
  assert(own.ok);
  assertEquals(own.doc?.email, "b@x.fr");

  const patch = await ctx.check("users.update", "user:2", {
    input: { firstname: "Bobby", tenant: "t1" },
  });
  assert(patch.ok);
  assertEquals(patch.input, { firstname: "Bobby" });
  assertEquals(
    (await ctx.check("users.update", "user:1", { input: {} })).ok,
    false,
  );
  assertEquals((await ctx.check("users.delete", "user:2")).ok, false);
  assertEquals(app.rejections, []);
});

test("scenario: a tenant owner lists the active members of the tenant only", async () => {
  const app = application();
  const session: Session = { id: "user:1", tenant: "entreprise:e1" };
  const items = await app.listUsers(session);
  assertEquals(
    items.map((doc) => doc._id),
    ["user:1"],
  );
  const ctx = app.system.context({ subject: session });
  const stranger = await ctx.check("users.read", "user:2");
  assert(stranger.ok);
  assertEquals(stranger.doc, {
    _id: "user:2",
    firstname: "Bob",
    lastname: "B",
  });
});

test("scenario: an organizer runs one exposition and sees nothing of the next", async () => {
  const app = application();
  const session: Session = { id: "user:3", organizerOf: ["exposition:1"] };
  const ctx = app.system.context({ subject: session });

  const mine = await app.listParticipants(session, "exposition:1");
  assertEquals(mine.stages, undefined);
  assertEquals(
    mine.items.map((doc) => doc._id),
    ["participant:p1", "participant:p2"],
  );
  assertEquals(mine.items[0].badgeCode, "B1");
  assertEquals((await app.listParticipants(session, "exposition:2")).items, []);

  assertEquals(
    (
      await ctx.check(
        "expositions.security.devices.revoke",
        "exposition:1",
        "device:d1",
      )
    ).ok,
    true,
  );
  assertEquals(
    (
      await ctx.check(
        "expositions.security.devices.revoke",
        "exposition:2",
        "device:d1",
      )
    ).ok,
    false,
  );
  assertEquals(await ctx.could("expositions.update", "exposition:2"), false);
  assertEquals(await ctx.could("expositions.update", "exposition:1"), true);
});

test("scenario: an organisation member lists its organisation, even if the join is forgotten", async () => {
  const app = application();
  const session: Session = {
    id: "user:2",
    memberOf: [
      { exposition: "exposition:1", organization: "expo_organization:o1" },
    ],
  };
  const listed = await app.listParticipants(session, "exposition:1");
  assert(listed.stages, "the join must be offered to the database");
  assertEquals(listed.items, [
    { _id: "participant:p1", email: "p1@x.fr", status: "active" },
  ]);

  const ctx = app.system.context({ subject: session });
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
  assertEquals(
    (
      await ctx.check(
        "expositions.participants.update",
        "exposition:1",
        "participant:p1",
      )
    ).ok,
    false,
  );
});

test("scenario: an administrator holds the whole catalogue through one provider", async () => {
  const app = application();
  const session: Session = { id: "user:1", roles: ["role:ADMIN"] };
  const ctx = app.system.context({ subject: session });

  const users = await app.listUsers(session);
  assertEquals(users.length, 3);
  assertEquals(users[0].notes, "vip");
  for (const key of app.system.keys) {
    const entry = app.system.engine.schema(key);
    assert(entry);
    const wildcard =
      entry.target.kind === "none"
        ? undefined
        : entry.target.segments.map(() => "*");
    assertEquals(await ctx.ask(key, wildcard), true, key);
  }
  assertEquals(app.rejections, []);
});

test("scenario: a device session reads itself and cannot be widened", async () => {
  const app = application();
  const session: Session = {
    id: "device:d1",
    device: { exposition: "exposition:1" },
  };
  const ctx = app.system.context({ subject: session });
  assertEquals(
    (
      await ctx.check(
        "expositions.security.devices.read",
        "exposition:1",
        "device:d1",
      )
    ).ok,
    true,
  );
  assertEquals(await ctx.could("expositions.security.devices.approve"), false);
  assertEquals(await ctx.could("users.read"), false);
  assertEquals(app.rejections, []);
});

test("scenario: a provider that breaks only narrows what a subject may do", async () => {
  const fixture = createFixture();
  const errors: string[] = [];
  const system = createSystem({
    permissions: fixture.all,
    providers: [
      {
        name: "broken",
        fetch: () => {
          throw new Error("database down");
        },
      },
      {
        name: "self",
        fetch: (subject) => [
          fixture.sets.users.grant("read", { on: subject.id }),
        ],
      },
    ],
    hooks: { onError: (event) => errors.push(event.source) },
  });
  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals((await ctx.check("users.read", "user:1")).ok, true);
  const denied = await ctx.check("users.read", "user:2");
  assert(!denied.ok);
  assert(denied.reasons.some((reason) => reason.includes("database down")));
  assertEquals(errors.includes("provider"), true);
});

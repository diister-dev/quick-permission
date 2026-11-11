import { test } from "node:test";
import {
  ALL,
  action,
  bundle,
  createSystem,
  entity,
  external,
  type GrantRejection,
  list,
  permissions,
} from "../next/mod.ts";
import type { Grant } from "../types.ts";
import { assert, assertEquals, assertThrows } from "./+assert.ts";
import { createFixture } from "./+next_fixture.ts";

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
  return {
    fixture,
    system,
    rejections,
    ctx: system.context({ subject: { id: "user:9" } }),
  };
}

test("bundle: managing one exposition reaches its children and no other", async () => {
  const { ctx } = setup(({ sets }) => [
    sets.expositions.grant("manage", { on: "exposition:1" }),
  ]);
  assertEquals(
    (
      await ctx.check(
        "expositions.participants.update",
        "exposition:1",
        "participant:p1",
      )
    ).ok,
    true,
  );
  assertEquals(
    (
      await ctx.check(
        "expositions.participants.update",
        "exposition:2",
        "participant:p3",
      )
    ).ok,
    false,
  );
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
        "expositions.expo_organizations.roles.update",
        "exposition:1",
        "expo_organization:o1",
        "expo_organization_role:r1",
      )
    ).ok,
    true,
  );
  assertEquals(
    (
      await ctx.check("expositions.participants.create", "exposition:1", {
        input: { email: "new@x.fr" },
      })
    ).ok,
    true,
  );
  assertEquals(
    await ctx.could("expositions.participants.create", "exposition:2"),
    false,
  );
  assertEquals(
    (await ctx.check("expositions.create", { input: {} })).ok,
    false,
  );
});

test("bundle: a row constraint follows every key it expands to", async () => {
  const { ctx } = setup(({ sets }) => [
    sets.users.grant("manage", { on: ALL, where: { tenant: "t1" } }),
  ]);
  assertEquals((await ctx.check("users.delete", "user:1")).ok, true);
  assertEquals((await ctx.check("users.delete", "user:2")).ok, false);
  assertEquals((await ctx.check("consent.read", "user:3")).ok, true);
  assertEquals((await ctx.check("consent.read", "user:2")).ok, false);
  assertEquals((await ctx.check("users.notes.update", "user:2")).ok, false);
  assertEquals((await ctx.check("consent.withdraw", "user:1")).ok, false);
  assertEquals((await ctx.check("users.create")).ok, false);
});

test("bundle: a field list reaches the keys that project and no other", async () => {
  const { ctx, rejections } = setup(({ sets }) => [
    sets.users.grant("manage", { on: ALL, fields: ["_id", "firstname"] }),
  ]);
  const read = await ctx.check("users.read", "user:1");
  assert(read.ok);
  assertEquals(read.doc, { _id: "user:1", firstname: "Ada" });
  const update = await ctx.check("users.update", "user:1", {
    input: { firstname: "Zoe", email: "x" },
  });
  assert(update.ok);
  assertEquals(update.input, { firstname: "Zoe" });
  assertEquals((await ctx.check("users.delete", "user:1")).ok, true);
  assertEquals(rejections, []);
});

test("bundle: an included key that cannot honour a restriction is dropped", async () => {
  const { ctx, rejections } = setup(() => [
    {
      id: "scoped",
      key: "expositions.manage",
      target: ["exposition:1"],
      inputWith: { email: "ok@x.fr" },
    },
  ]);
  assertEquals(
    (
      await ctx.check("expositions.participants.create", "exposition:1", {
        input: { email: "ok@x.fr" },
      })
    ).ok,
    true,
  );
  assertEquals(
    (
      await ctx.check("expositions.participants.create", "exposition:1", {
        input: { email: "other@x.fr" },
      })
    ).ok,
    false,
  );
  assertEquals(
    (await ctx.check("expositions.update", "exposition:1", { input: {} })).ok,
    false,
  );
  const dropped = rejections.map(
    (event) => `${event.via} -> ${event.grant.key}`,
  );
  assert(dropped.includes("expositions.manage -> expositions.update"));
  assert(
    dropped.includes(
      "expositions.participants.manage -> expositions.participants.delete",
    ),
  );
});

test("bundle: a relation constraint does not leak onto child entities", async () => {
  const folder = entity("folder", {
    load: (id) => ({ _id: id }),
    relations: {
      shares: {
        localField: "_id",
        foreignField: "folderId",
        load: () => [{ team: "a" }],
      },
    },
  });
  const file = folder.child("file", { load: (_folderId, id) => ({ _id: id }) });
  const folders = permissions(folder, "folders", {
    read: action({ fields: "doc" }),
    manage: bundle(["read", "folders.files.read"]),
  });
  const files = permissions(file, "folders.files", { read: action() });
  const rejections: GrantRejection[] = [];
  const system = createSystem({
    permissions: [folders, files],
    providers: [
      () => [
        folders.grant("manage", {
          on: ALL,
          related: { shares: { team: "b" } },
        }),
      ],
    ],
    hooks: { onGrantRejected: (event) => rejections.push(event) },
  });
  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals((await ctx.check("folders.read", "folder:1")).ok, false);
  assertEquals(
    (await ctx.check("folders.files.read", "folder:1", "file:1")).ok,
    false,
  );
  assertEquals(rejections[0].grant.key, "folders.files.read");
  assertEquals(rejections[0].via, "folders.manage");
});

test("bundle: a provider declaring only the bundle is consulted for its keys", async () => {
  const fixture = createFixture();
  let calls = 0;
  const system = createSystem({
    permissions: fixture.all,
    providers: [
      {
        name: "organizer",
        keys: ["expositions.manage"],
        targetType: "exposition",
        fetch: () => {
          calls++;
          return [
            fixture.sets.expositions.grant("manage", { on: "exposition:1" }),
          ];
        },
      },
    ],
  });
  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals(
    (
      await ctx.check(
        "expositions.participants.delete",
        "exposition:1",
        "participant:p1",
      )
    ).ok,
    true,
  );
  assertEquals((await ctx.check("users.read", "user:1")).ok, false);
  assertEquals(calls, 1);
});

test("bundle: the escape hatch rewrites a target across unrelated entities", async () => {
  const fixture = createFixture();
  const entreprise = entity("entreprise", { load: (id) => ({ _id: id }) });
  const entreprises = permissions(entreprise, "entreprises", {
    read: action(),
    manage: bundle(["read"], {
      expand: (grant) =>
        grant.target?.[0] === "entreprise:e1"
          ? [{ ...grant, key: "expositions.manage", target: ["exposition:1"] }]
          : [],
    }),
  });
  const system = createSystem({
    permissions: [...fixture.all, entreprises],
    providers: [() => [entreprises.grant("manage", { on: "entreprise:e1" })]],
  });
  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals(
    (await ctx.check("expositions.update", "exposition:1")).ok,
    true,
  );
  assertEquals(
    (await ctx.check("expositions.update", "exposition:2")).ok,
    false,
  );
});

test("boot: an invalid schema names every mistake at once", () => {
  const parent = entity("parent", { load: (id) => ({ _id: id }) });
  const child = parent.child("child", { load: (_p, id) => ({ _id: id }) });
  const other = entity("other", { load: (id) => ({ _id: id }) });
  const error = assertThrows(() =>
    createSystem({
      permissions: [
        permissions(parent, "parents", {
          read: action(),
          manage: bundle(["read", "missing", "others.read", "parents.loop"]),
          loop: bundle(["manage"]),
          create: action({ on: "none" }),
        }),
        permissions(child, "children", {
          read: action(),
          manage: bundle(["read", "parents.read", "parents.create"]),
          list: list("manage"),
        }),
        permissions(other, "others", { read: action() }),
      ],
    }),
  );
  const message = error.message;
  for (const expected of [
    '"parents.manage" includes unknown key "missing"',
    '"parents.manage" includes "others.read", which is not under the same entities',
    '"children.manage" includes "parents.read", which acts on a wider scope',
    '"children.manage" includes "parents.create", which acts on a wider scope',
    '"children.list" lists through "children.manage", which is not an action',
    "bundle cycle: parents.manage -> parents.loop -> parents.manage",
  ]) {
    assert(message.includes(expected), `missing: ${expected}\n${message}`);
  }
});

test("boot: two sets cannot declare the same key", () => {
  const thing = entity("thing", { load: (id) => ({ _id: id }) });
  assertThrows(() =>
    createSystem({
      permissions: [
        permissions(thing, "things", { read: action() }),
        permissions(thing, "things", { read: action() }),
      ],
    }),
  );
});

test("include: a sibling name wins over a global key unless forced", async () => {
  const thing = entity("thing", { load: (id) => ({ _id: id }) });
  const things = permissions(thing, "things", {
    read: action(),
    local: bundle(["read"]),
    forced: bundle([external("read.all")]),
  });
  const reads = permissions(thing, "read", { all: action() });
  const system = createSystem({
    permissions: [things, reads],
    providers: [
      (subject) =>
        subject.id === "user:local"
          ? [things.grant("local", { on: ALL })]
          : [things.grant("forced", { on: ALL })],
    ],
  });
  const local = system.context({ subject: { id: "user:local" } });
  const forced = system.context({ subject: { id: "user:forced" } });
  assertEquals(await local.could("things.read"), true);
  assertEquals(await local.could("read.all"), false);
  assertEquals(await forced.could("read.all"), true);
  assertEquals(await forced.could("things.read"), false);
});

test("admin: wildcard grants cover the whole catalogue", async () => {
  const fixture = createFixture();
  const holder: { grants: readonly Grant[] } = { grants: [] };
  const system = createSystem({
    permissions: fixture.all,
    providers: [() => holder.grants],
  });
  holder.grants = system.wildcardGrants("omnigrant");
  const ctx = system.context({ subject: { id: "user:admin" } });
  for (const key of system.keys) {
    assertEquals(
      await ctx.ask(key, undefined),
      system.engine.schema(key)?.target.kind === "none",
    );
  }
  assertEquals(
    (
      await ctx.check(
        "expositions.expo_organizations.roles.update",
        "exposition:1",
        "expo_organization:o1",
        "expo_organization_role:r1",
      )
    ).ok,
    true,
  );
  assertEquals(holder.grants.length, system.keys.length);
});

test("expand: a bundle flattens to the keys it really confers", () => {
  const fixture = createFixture();
  const system = createSystem({ permissions: fixture.all });
  const flat = system.expand([
    fixture.sets.orgRoles.grant("manage", {
      on: ["exposition:1", "expo_organization:o1", ALL],
    }),
    { key: "users.read", target: ["nope:1"] },
  ]);
  assertEquals(
    flat.map((grant) => `${grant.key} ${(grant.target ?? []).join("/")}`),
    [
      "expositions.expo_organizations.roles.manage exposition:1/expo_organization:o1/expo_organization_role:*",
      "expositions.expo_organizations.roles.list exposition:1/expo_organization:o1/expo_organization_role:*",
      "expositions.expo_organizations.roles.update exposition:1/expo_organization:o1/expo_organization_role:*",
      "expositions.expo_organizations.roles.read exposition:1/expo_organization:o1/expo_organization_role:*",
    ],
  );
});

test("catalog: rule descriptors still describe what a grant may carry", () => {
  const fixture = createFixture();
  const system = createSystem({ permissions: fixture.all });
  const entry = system
    .catalog()
    .find((item) => item.key === "expositions.participants.list");
  assert(entry);
  assertEquals(entry.kind, "intermediate");
  assertEquals(entry.expandsTo, ["expositions.participants.read"]);
  assertEquals(
    entry.rules.map((rule) => rule.kind),
    ["match", "match", "match-path", "indirect-match", "filter"],
  );
  assertEquals(entry.target, {
    kind: "path",
    segments: [
      { name: "exposition", types: "exposition" },
      { name: "participant", types: "participant" },
    ],
  });
});

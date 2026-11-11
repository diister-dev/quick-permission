import { test } from "node:test";
import {
  ALL,
  action,
  bundle,
  createSystem,
  entity,
  type Grant,
  type GrantProvider,
  type Hooks,
  permissions,
} from "../mod.ts";
import { assert, assertEquals } from "./+assert.ts";

type ErrorEvent = Parameters<NonNullable<Hooks["onError"]>>[0];
type FetchEvent = Parameters<NonNullable<Hooks["onProviderFetch"]>>[0];

const subject = { id: "user:u1" };

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

type OrgDoc = Readonly<Record<string, unknown>>;

function orgSet(orgs: Readonly<Record<string, OrgDoc>>) {
  const org = entity<OrgDoc>("org", { load: (id) => orgs[id] ?? null });
  return permissions(org, "orgs", { read: action() });
}

type OrgSet = ReturnType<typeof orgSet>;

function orgSystem(
  orgs: Readonly<Record<string, OrgDoc>>,
  grants: (set: OrgSet) => readonly Grant[],
  hooks: Hooks = {},
) {
  const set = orgSet(orgs);
  const held = grants(set);
  return createSystem({ permissions: [set], providers: [() => held], hooks });
}

const post = entity("post", {});

const flow = permissions(post, "posts", {
  read: action(),
  manage: bundle([], {
    expand: (grant) => [
      { ...grant, id: `${grant.id}>read`, key: "posts.read" },
    ],
  }),
});

function flowSystem(providers: readonly GrantProvider[], hooks: Hooks = {}) {
  return createSystem({ permissions: [flow], providers, hooks });
}

test("a match rule without condition keeps no row filter and its grant id", async () => {
  const sys = orgSystem({ "org:1": { status: "active" } }, (orgs) => [
    orgs.grant("read", { id: "g1", on: ALL }),
  ]);
  const ctx = sys.context({ subject });
  assertEquals(await ctx.check("orgs.read", "org:1"), {
    ok: true,
    grants: ["g1"],
  });
  const scope = await ctx.scope("orgs.read");
  assert(scope.ok);
  assertEquals(scope.query, { filter: {}, stages: null });
  assertEquals(scope.grants, ["g1"]);
});

test("a match rule without condition passes even when the document is missing", async () => {
  const sys = orgSystem({}, (orgs) => [orgs.grant("read", { on: ALL })]);
  assertEquals(await sys.context({ subject }).check("orgs.read", "org:404"), {
    ok: true,
    grants: [],
  });
});

test("a conditioned grant and an open grant aggregate the same way", async () => {
  const sys = orgSystem(
    { "org:1": { status: "archived" }, "org:2": { status: "active" } },
    (orgs) => [
      orgs.grant("read", { id: "spec", on: ALL, where: { status: "active" } }),
      orgs.grant("read", { id: "open", on: ALL }),
    ],
  );
  const ctx = sys.context({ subject });
  assertEquals(await ctx.check("orgs.read", "org:1"), {
    ok: true,
    grants: ["open"],
  });
  assertEquals(await ctx.check("orgs.read", "org:2"), {
    ok: true,
    grants: ["spec", "open"],
  });
  const scope = await ctx.scope("orgs.read");
  assert(scope.ok);
  assertEquals(scope.query, { filter: {}, stages: null });
  assertEquals(scope.grants, ["spec", "open"]);
});

test("conditions: operator, mismatch and capability row filter", async () => {
  const sys = orgSystem(
    { "org:1": { tier: "gold" }, "org:2": { tier: "bronze" } },
    (orgs) => [
      orgs.grant("read", {
        id: "op",
        on: ALL,
        where: { tier: { $in: ["gold", "silver"] } },
      }),
    ],
  );
  const ctx = sys.context({ subject });
  assertEquals(await ctx.check("orgs.read", "org:1"), {
    ok: true,
    grants: ["op"],
  });
  assertEquals(await ctx.check("orgs.read", "org:2"), {
    ok: false,
    reasons: ["[op] match[org] mismatch"],
  });
  const scope = await ctx.scope("orgs.read");
  assert(scope.ok);
  assertEquals(scope.query, {
    filter: { tier: { $in: ["gold", "silver"] } },
    stages: null,
  });
  assertEquals(scope.grants, ["op"]);
});

test("a condition mutated in place between checks is evaluated with its new content", async () => {
  const spec: Record<string, unknown> = { tier: "gold" };
  const sys = orgSystem({ "org:1": { tier: "gold" } }, (orgs) => [
    orgs.grant("read", { on: ALL, where: spec }),
  ]);
  const check = async () =>
    (await sys.context({ subject }).check("orgs.read", "org:1")).ok;
  assertEquals(await check(), true);
  spec.tier = "bronze";
  assertEquals(await check(), false);
  spec.tier = { $where: "true" };
  assertEquals(await check(), false);
});

test("conditions that only differ by a non JSON value are never confused", async () => {
  const docs = { "org:1": { score: null } };
  const nanSpec = orgSystem(docs, (orgs) => [
    orgs.grant("read", { on: ALL, where: { score: Number.NaN } }),
  ]);
  const nullSpec = orgSystem(docs, (orgs) => [
    orgs.grant("read", { on: ALL, where: { score: null } }),
  ]);
  const ok = async (sys: typeof nanSpec, id: string) =>
    (await sys.context({ subject }).check("orgs.read", id)).ok;
  assertEquals(await ok(nullSpec, "org:1"), true);
  assertEquals(await ok(nanSpec, "org:1"), false);
  assertEquals(await ok(nullSpec, "org:1"), true);

  const regex = orgSystem(
    { "org:1": { name: "acme corp" }, "org:2": { name: "other" } },
    (orgs) => [
      orgs.grant("read", { on: ALL, where: { name: { $regex: /^acme/ } } }),
    ],
  );
  const empty = orgSystem({ "org:2": { name: "other" } }, (orgs) => [
    orgs.grant("read", { on: ALL, where: { name: {} } }),
  ]);
  assertEquals(await ok(regex, "org:1"), true);
  assertEquals(await ok(regex, "org:2"), false);
  assertEquals(await ok(empty, "org:2"), false);
  assertEquals(await ok(regex, "org:2"), false);
});

test("a relation condition without an entity condition still reads the document and the join", async () => {
  let sourceReads = 0;
  let joinReads = 0;
  const exposition = entity("exposition", {});
  const participant = exposition.child<{ readonly _id: string }, "memberships">(
    "participant",
    {
      load: (_expositionId, id) => {
        sourceReads++;
        return { _id: id };
      },
      relations: {
        memberships: {
          localField: "_id",
          foreignField: "participantId",
          load: (source) => {
            joinReads++;
            return source._id === "participant:in"
              ? [{ organizationId: "org:acme" }]
              : [];
          },
        },
      },
    },
  );
  const participants = permissions(participant, "participants", {
    read: action(),
  });
  const sys = createSystem({
    permissions: [participants],
    providers: [
      () => [
        participants.grant("read", {
          id: "g",
          on: ["exposition:X", ALL],
          related: { memberships: { organizationId: "org:acme" } },
        }),
      ],
    ],
  });
  const ctx = sys.context({ subject });
  assertEquals(
    (await ctx.check("participants.read", "exposition:X", "participant:in")).ok,
    true,
  );
  assertEquals(
    await ctx.check("participants.read", "exposition:X", "participant:out"),
    {
      ok: false,
      reasons: [
        "[g] related[memberships_of_participant] no joined row matches",
      ],
    },
  );
  assertEquals(sourceReads, 2);
  assertEquals(joinReads, 2);
});

test("a relation of an entity that loads nothing itself is never read", async () => {
  let joinReads = 0;
  const participant = entity<{ readonly _id: string }, "memberships">(
    "participant",
    {
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
  const sys = createSystem({
    permissions: [participants],
    providers: [
      () => [
        participants.grant("read", {
          id: "g",
          on: ALL,
          related: { memberships: { organizationId: "org:acme" } },
        }),
      ],
    ],
  });
  assertEquals(
    await sys.context({ subject }).check("participants.read", "participant:1"),
    {
      ok: false,
      reasons: [
        "[g] related[memberships_of_participant] no joined row matches",
      ],
    },
  );
  assertEquals(joinReads, 0);
});

test("grants keep the provider order even when a later provider answers first", async () => {
  const events: string[] = [];
  const sys = flowSystem(
    [
      {
        name: "slow",
        fetch: () => delay(15, [flow.grant("read", { id: "slow", on: ALL })]),
      },
      {
        name: "fast",
        fetch: () => [flow.grant("read", { id: "fast", on: ALL })],
      },
      {
        name: "mid",
        fetch: () => delay(5, [flow.grant("manage", { id: "mid", on: ALL })]),
      },
    ],
    { onProviderFetch: (event) => events.push(event.provider) },
  );
  assertEquals(await sys.context({ subject }).check("posts.read", "post:1"), {
    ok: true,
    grants: ["slow", "fast", "mid>read"],
  });
  assertEquals([...events].sort(), ["fast", "mid", "slow"]);
});

test("expansion follows breadth order across providers", async () => {
  const sys = flowSystem([
    () => [flow.grant("manage", { id: "a", on: ALL })],
    () => [flow.grant("read", { id: "b", on: ALL })],
  ]);
  assertEquals(await sys.context({ subject }).check("posts.read", "post:1"), {
    ok: true,
    grants: ["b", "a>read"],
  });
});

test("the last accepted grant wins the data, in provider order", async () => {
  type Doc = { readonly a: number; readonly b: number; readonly c: number };
  const doc = entity<Doc>("doc", { load: () => ({ a: 1, b: 2, c: 3 }) });
  const docs = permissions(doc, "docs", { read: action({ fields: "doc" }) });
  const sys = createSystem({
    permissions: [docs],
    providers: [
      () =>
        delay(10, [
          docs.grant("read", { id: "one", on: ALL, fields: { a: true } }),
        ]),
      () => [docs.grant("read", { id: "two", on: ALL, fields: { b: true } })],
    ],
  });
  assertEquals(await sys.context({ subject }).check("docs.read", "doc:1"), {
    ok: true,
    grants: ["one", "two"],
    doc: { a: 1, b: 2 },
  });
});

test("provider failures are reported in provider order and never fail a granted check", async () => {
  const errors: ErrorEvent[] = [];
  const failing = (name: string, ms: number): GrantProvider => ({
    name,
    fetch: () =>
      delay(ms, null).then(() => {
        throw new Error(`${name} down`);
      }),
  });
  const sys = flowSystem(
    [
      failing("first", 10),
      failing("second", 1),
      {
        name: "grants",
        keys: ["posts.read"],
        fetch: () => [flow.grant("read", { id: "ok", on: "post:1" })],
      },
    ],
    { onError: (event) => errors.push(event) },
  );
  assertEquals(await sys.context({ subject }).check("posts.read", "post:1"), {
    ok: true,
    grants: ["ok"],
  });
  assertEquals(await sys.context({ subject }).check("posts.read", "post:2"), {
    ok: false,
    reasons: [
      "no matching grant",
      "provider first failed: first down",
      "provider second failed: second down",
    ],
  });
  assertEquals(errors.length, 4);
  assertEquals(
    errors.every((event) => event.source === "provider"),
    true,
  );
});

test("a throwing cacheKey is a provider failure, not a rejection", async () => {
  const sys = flowSystem([
    {
      name: "broken",
      cacheKey: () => {
        throw new Error("no key");
      },
      fetch: () => [flow.grant("read", { on: ALL })],
    },
    () => [flow.grant("read", { id: "ok", on: ALL })],
  ]);
  assertEquals(await sys.context({ subject }).check("posts.read", "post:1"), {
    ok: true,
    grants: ["ok"],
  });
});

test("onProviderFetch reports a duration and the grant count", async () => {
  const events: FetchEvent[] = [];
  const sys = flowSystem(
    [
      {
        name: "p",
        fetch: () =>
          delay(5, [
            flow.grant("read", { on: ALL }),
            flow.grant("manage", { on: ALL }),
          ]),
      },
    ],
    { onProviderFetch: (event) => events.push(event) },
  );
  await sys.context({ subject }).check("posts.read", "post:1");
  assertEquals(events.length, 1);
  assertEquals(events[0].grantCount, 2);
  assertEquals(events[0].provider, "p");
  assertEquals(events[0].durationMs >= 4, true);
});

test("a context sees new grants as soon as a provider returns them", async () => {
  let granted = false;
  const live: Grant[] = [];
  const sys = flowSystem([
    () => (granted ? [flow.grant("manage", { id: "late", on: ALL })] : []),
    () => live,
    {
      cacheKey: (_s, _k, t) => String(t?.[0]),
      fetch: (_s, _k, t) =>
        t?.[0] === "post:3"
          ? [flow.grant("read", { id: "keyed", on: "post:3" })]
          : [],
    },
  ]);
  const ctx = sys.context({ subject });
  assertEquals((await ctx.check("posts.read", "post:1")).ok, false);
  granted = true;
  assertEquals(await ctx.check("posts.read", "post:1"), {
    ok: true,
    grants: ["late>read"],
  });
  live.push(flow.grant("read", { id: "pushed", on: ALL }));
  assertEquals(await ctx.check("posts.read", "post:1"), {
    ok: true,
    grants: ["pushed", "late>read"],
  });
  assertEquals(await ctx.check("posts.read", "post:3"), {
    ok: true,
    grants: ["pushed", "keyed", "late>read"],
  });
});

test("a cached provider result is expanded once per context and reused", async () => {
  let expansions = 0;
  const counted = permissions(post, "posts", {
    read: action(),
    manage: bundle([], {
      expand: (grant) => {
        expansions++;
        return [{ ...grant, key: "posts.read" }];
      },
    }),
  });
  const sys = createSystem({
    permissions: [counted],
    providers: [
      {
        cacheKey: () => "all",
        fetch: () => [counted.grant("manage", { id: "m", on: ALL })],
      },
    ],
  });
  const ctx = sys.context({ subject });
  const baseline = expansions;
  for (let i = 0; i < 5; i++) {
    assertEquals((await ctx.check("posts.read", `post:${i}`)).ok, true);
  }
  assertEquals(expansions - baseline <= 5, true);
});

test("a grant without target on a key that takes one is dropped before expansion", async () => {
  const sys = flowSystem([
    () => [
      { id: "untargeted", key: "posts.manage" },
      flow.grant("read", { id: "targeted", on: "post:1" }),
    ],
  ]);
  assertEquals(await sys.context({ subject }).check("posts.read", "post:1"), {
    ok: true,
    grants: ["targeted"],
  });
});

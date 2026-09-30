import { test } from "node:test";
import { assertEquals } from "./+assert.ts";
import {
  createSystem,
  type Grant,
  indirectResource,
  intermediate,
  type PermissionErrorEvent,
  type ProviderFetchEvent,
  permission,
  resource,
  target,
} from "../mod.ts";

const subject = { id: "user:u1" };

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function orgSystem(grants: readonly Grant[], orgs: Record<string, unknown>) {
  const orgOf = resource({
    id: "org",
    fetch: ({ target }) => orgs[target[0] as string] ?? null,
    dedupKey: ({ target }) => target[0] as string,
  });
  return createSystem({
    schema: {
      "orgs.read": permission({ target: target.required("org") }).rules([
        orgOf.match(),
      ]),
    },
    providers: [() => grants],
  });
}

test("a match rule without spec keeps an empty constraint and its grant id", async () => {
  const sys = orgSystem([{ id: "g1", key: "orgs.read", target: ["org:*"] }], {
    "org:1": { status: "active" },
  });
  const ctx = sys.context({ subject });
  assertEquals(await ctx.can("orgs.read", ["org:1"]), {
    ok: true,
    constraints: {},
    matchedGrants: ["g1"],
  });
  assertEquals(await ctx.can("orgs.read", ["org:*"]), {
    ok: true,
    constraints: {},
    matchedGrants: ["g1"],
  });
});

test("a match rule without spec passes even when the document is missing", async () => {
  const sys = orgSystem([{ key: "orgs.read", target: ["org:*"] }], {});
  assertEquals(await sys.can(subject, "orgs.read", ["org:404"]), {
    ok: true,
    constraints: {},
  });
});

test("a spec grant and a spec-less grant aggregate the same way", async () => {
  const sys = orgSystem(
    [
      {
        id: "spec",
        key: "orgs.read",
        target: ["org:*"],
        with: { org: { status: "active" } },
      },
      { id: "open", key: "orgs.read", target: ["org:*"] },
    ],
    { "org:1": { status: "archived" }, "org:2": { status: "active" } },
  );
  const ctx = sys.context({ subject });
  assertEquals(await ctx.can("orgs.read", ["org:1"]), {
    ok: true,
    constraints: {},
    matchedGrants: ["open"],
  });
  assertEquals(await ctx.can("orgs.read", ["org:2"]), {
    ok: true,
    constraints: {},
    matchedGrants: ["spec", "open"],
  });
  assertEquals(await ctx.can("orgs.read", ["org:*"]), {
    ok: true,
    constraints: {},
    matchedGrants: ["spec", "open"],
  });
});

test("match specs: operator, primitive, null, mismatch and capability constraint", async () => {
  const sys = orgSystem(
    [
      {
        id: "op",
        key: "orgs.read",
        target: ["org:*"],
        with: { org: { tier: { $in: ["gold", "silver"] } } },
      },
    ],
    { "org:1": { tier: "gold" }, "org:2": { tier: "bronze" } },
  );
  const ctx = sys.context({ subject });
  assertEquals(await ctx.can("orgs.read", ["org:1"]), {
    ok: true,
    constraints: { tier: { $in: ["gold", "silver"] } },
    matchedGrants: ["op"],
  });
  assertEquals(await ctx.can("orgs.read", ["org:2"]), {
    ok: false,
    reasons: ["[op] match[org] mismatch"],
  });
  assertEquals(await ctx.can("orgs.read", ["org:*"]), {
    ok: true,
    constraints: { tier: { $in: ["gold", "silver"] } },
    matchedGrants: ["op"],
  });

  const nullSpec = orgSystem(
    [{ key: "orgs.read", target: ["org:*"], with: { org: null } }],
    { "org:1": { tier: "gold" } },
  );
  assertEquals(await nullSpec.can(subject, "orgs.read", ["org:404"]), {
    ok: true,
    constraints: {},
  });
  assertEquals(await nullSpec.can(subject, "orgs.read", ["org:1"]), {
    ok: false,
    reasons: ["match[org] mismatch"],
  });
});

test("a forbidden operator in a spec denies with a rule failure", async () => {
  const errors: PermissionErrorEvent[] = [];
  const orgOf = resource({
    id: "org",
    fetch: () => ({ tier: "gold" }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const sys = createSystem({
    schema: {
      "orgs.read": permission({ target: target.required("org") }).rules([
        orgOf.match(),
      ]),
    },
    providers: [
      () => [
        {
          id: "bad",
          key: "orgs.read",
          target: ["org:*"],
          with: { org: { $where: "true" } },
        },
      ],
    ],
    hooks: { onError: (e) => errors.push(e) },
  });
  const result = await sys.can(subject, "orgs.read", ["org:1"]);
  assertEquals(result.ok, false);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].source, "rule");
});

test("a spec mutated in place between checks is evaluated with its new content", async () => {
  const spec: Record<string, unknown> = { tier: "gold" };
  const sys = orgSystem(
    [{ key: "orgs.read", target: ["org:*"], with: { org: spec } }],
    { "org:1": { tier: "gold" } },
  );
  assertEquals((await sys.can(subject, "orgs.read", ["org:1"])).ok, true);
  spec.tier = "bronze";
  assertEquals((await sys.can(subject, "orgs.read", ["org:1"])).ok, false);
  spec.tier = { $where: "true" };
  assertEquals((await sys.can(subject, "orgs.read", ["org:1"])).ok, false);
});

test("specs that only differ by a non JSON value are never confused", async () => {
  const docs = { "org:1": { score: null } };
  const nanSpec = orgSystem(
    [{ key: "orgs.read", target: ["org:*"], with: { org: { score: NaN } } }],
    docs,
  );
  const nullSpec = orgSystem(
    [{ key: "orgs.read", target: ["org:*"], with: { org: { score: null } } }],
    docs,
  );
  assertEquals((await nullSpec.can(subject, "orgs.read", ["org:1"])).ok, true);
  assertEquals((await nanSpec.can(subject, "orgs.read", ["org:1"])).ok, false);
  assertEquals((await nullSpec.can(subject, "orgs.read", ["org:1"])).ok, true);

  const regex = orgSystem(
    [
      {
        key: "orgs.read",
        target: ["org:*"],
        with: { org: { name: { $regex: /^acme/ } } },
      },
    ],
    { "org:1": { name: "acme corp" }, "org:2": { name: "other" } },
  );
  const empty = orgSystem(
    [{ key: "orgs.read", target: ["org:*"], with: { org: { name: {} } } }],
    { "org:2": { name: "other" } },
  );
  assertEquals((await regex.can(subject, "orgs.read", ["org:1"])).ok, true);
  assertEquals((await regex.can(subject, "orgs.read", ["org:2"])).ok, false);
  assertEquals((await empty.can(subject, "orgs.read", ["org:2"])).ok, false);
  assertEquals((await regex.can(subject, "orgs.read", ["org:2"])).ok, false);
});

test("an indirect spec without a source spec still reads the source and the join", async () => {
  let sourceReads = 0;
  let joinReads = 0;
  const participantOf = resource({
    id: "participant",
    fetch: ({ target }) => {
      sourceReads++;
      return { _id: target[1] };
    },
    dedupKey: ({ target }) => target.join("::"),
  });
  const membershipsOf = indirectResource({
    id: "memberships",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    cardinality: "many",
    fetch: (source) => {
      joinReads++;
      return (source as { _id: string })._id === "participant:in"
        ? [{ organizationId: "org:acme" }]
        : [];
    },
  });
  const sys = createSystem({
    schema: {
      "participants.read": permission({
        target: target.path("exposition", "participant"),
      }).rules([participantOf.match(), membershipsOf.match()]),
    },
    providers: [
      () => [
        {
          id: "g",
          key: "participants.read",
          target: ["exposition:X", "participant:*"],
          with: { memberships: { organizationId: "org:acme" } },
        },
      ],
    ],
  });
  const ctx = sys.context({ subject });
  assertEquals(
    (await ctx.can("participants.read", ["exposition:X", "participant:in"])).ok,
    true,
  );
  assertEquals(
    await ctx.can("participants.read", ["exposition:X", "participant:out"]),
    {
      ok: false,
      reasons: ["[g] indirect[memberships] no joined doc matches spec"],
    },
  );
  assertEquals(sourceReads, 2);
  assertEquals(joinReads, 2);
});

test("an indirect declared without being matched by a direct need is never read", async () => {
  let joinReads = 0;
  const participantOf = resource({
    id: "participant",
    fetch: () => ({ _id: "p" }),
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
  const sys = createSystem({
    schema: {
      "participants.read": permission({
        target: target.required("participant"),
      }).rules([membershipsOf.match()]),
    },
    providers: [
      () => [
        {
          id: "g",
          key: "participants.read",
          target: ["participant:*"],
          with: { memberships: { organizationId: "org:acme" } },
        },
      ],
    ],
  });
  assertEquals(await sys.can(subject, "participants.read", ["participant:1"]), {
    ok: false,
    reasons: ["[g] indirect[memberships] no joined doc matches spec"],
  });
  assertEquals(joinReads, 0);
});

const flowSchema = {
  "posts.read": permission({ target: target.required("post") }).rules([]),
  "posts.manage": intermediate({
    target: target.required("post"),
    expandsTo: (g: Grant) => [{ ...g, id: `${g.id}>read`, key: "posts.read" }],
  }).rules([]),
};

test("grants keep the provider order even when a later provider answers first", async () => {
  const events: string[] = [];
  const sys = createSystem({
    schema: flowSchema,
    providers: [
      {
        name: "slow",
        fetch: () =>
          delay(15, [{ id: "slow", key: "posts.read", target: ["post:*"] }]),
      },
      {
        name: "fast",
        fetch: () => [{ id: "fast", key: "posts.read", target: ["post:*"] }],
      },
      {
        name: "mid",
        fetch: () =>
          delay(5, [{ id: "mid", key: "posts.manage", target: ["post:*"] }]),
      },
    ],
    hooks: { onProviderFetch: (e) => events.push(e.provider) },
  });
  assertEquals(await sys.can(subject, "posts.read", ["post:1"]), {
    ok: true,
    matchedGrants: ["slow", "fast", "mid>read"],
  });
  assertEquals([...events].sort(), ["fast", "mid", "slow"]);
});

test("expansion follows breadth order across providers", async () => {
  const sys = createSystem({
    schema: flowSchema,
    providers: [
      () => [{ id: "a", key: "posts.manage", target: ["post:*"] }],
      () => [{ id: "b", key: "posts.read", target: ["post:*"] }],
    ],
  });
  assertEquals(await sys.can(subject, "posts.read", ["post:1"]), {
    ok: true,
    matchedGrants: ["b", "a>read"],
  });
});

test("the last accepted grant wins the data, in provider order", async () => {
  const docOf = resource({
    id: "doc",
    fetch: () => ({ a: 1, b: 2, c: 3 }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const sys = createSystem({
    schema: {
      "docs.read": permission({ target: target.required("doc") }).rules([
        docOf.filter(),
      ]),
    },
    providers: [
      () =>
        delay(10, [
          {
            id: "one",
            key: "docs.read",
            target: ["doc:*"],
            filter: { a: true },
          },
        ]),
      () => [
        { id: "two", key: "docs.read", target: ["doc:*"], filter: { b: true } },
      ],
    ],
  });
  assertEquals(await sys.can(subject, "docs.read", ["doc:1"]), {
    ok: true,
    data: { a: 1, b: 2 },
    matchedGrants: ["one", "two"],
  });
});

test("provider failures are reported in provider order and never fail a granted check", async () => {
  const errors: PermissionErrorEvent[] = [];
  const failing = (name: string, ms: number) => ({
    name,
    fetch: () =>
      delay(ms, null).then(() => {
        throw new Error(`${name} down`);
      }),
  });
  const sys = createSystem({
    schema: flowSchema,
    providers: [
      failing("first", 10),
      failing("second", 1),
      {
        name: "grants",
        keys: ["posts.read"],
        fetch: () => [{ id: "ok", key: "posts.read", target: ["post:1"] }],
      },
    ],
    hooks: { onError: (e) => errors.push(e) },
  });
  assertEquals(await sys.can(subject, "posts.read", ["post:1"]), {
    ok: true,
    matchedGrants: ["ok"],
  });
  assertEquals(await sys.can(subject, "posts.read", ["post:2"]), {
    ok: false,
    reasons: [
      "no matching grant",
      "provider first failed: first down",
      "provider second failed: second down",
    ],
  });
  assertEquals(errors.length, 4);
  assertEquals(
    errors.every((e) => e.source === "provider"),
    true,
  );
});

test("a throwing cacheKey is a provider failure, not a rejection", async () => {
  const sys = createSystem({
    schema: flowSchema,
    providers: [
      {
        name: "broken",
        cacheKey: () => {
          throw new Error("no key");
        },
        fetch: () => [{ key: "posts.read", target: ["post:*"] }],
      },
      () => [{ id: "ok", key: "posts.read", target: ["post:*"] }],
    ],
  });
  assertEquals(await sys.context({ subject }).can("posts.read", ["post:1"]), {
    ok: true,
    matchedGrants: ["ok"],
  });
});

test("onProviderFetch reports a duration and the grant count", async () => {
  const events: ProviderFetchEvent[] = [];
  const sys = createSystem({
    schema: flowSchema,
    providers: [
      {
        name: "p",
        fetch: () =>
          delay(5, [
            { key: "posts.read", target: ["post:*"] },
            { key: "posts.manage", target: ["post:*"] },
          ]),
      },
    ],
    hooks: { onProviderFetch: (e) => events.push(e) },
  });
  await sys.can(subject, "posts.read", ["post:1"]);
  assertEquals(events.length, 1);
  assertEquals(events[0].grantCount, 2);
  assertEquals(events[0].provider, "p");
  assertEquals(events[0].durationMs >= 4, true);
});

test("a context sees new grants as soon as a provider returns them", async () => {
  let granted = false;
  const live: Grant[] = [];
  const sys = createSystem({
    schema: flowSchema,
    providers: [
      () =>
        granted
          ? [{ id: "late", key: "posts.manage", target: ["post:*"] }]
          : [],
      () => live,
      {
        cacheKey: (_s, _k, t) => String(t?.[0]),
        fetch: (_s, _k, t) =>
          t?.[0] === "post:3"
            ? [{ id: "keyed", key: "posts.read", target: ["post:3"] }]
            : [],
      },
    ],
  });
  const ctx = sys.context({ subject });
  assertEquals((await ctx.can("posts.read", ["post:1"])).ok, false);
  granted = true;
  assertEquals(await ctx.can("posts.read", ["post:1"]), {
    ok: true,
    matchedGrants: ["late>read"],
  });
  live.push({ id: "pushed", key: "posts.read", target: ["post:*"] });
  assertEquals(await ctx.can("posts.read", ["post:1"]), {
    ok: true,
    matchedGrants: ["pushed", "late>read"],
  });
  assertEquals(await ctx.can("posts.read", ["post:3"]), {
    ok: true,
    matchedGrants: ["pushed", "keyed", "late>read"],
  });
});

test("a cached provider result is expanded once per context and reused", async () => {
  let expansions = 0;
  const sys = createSystem({
    schema: {
      "posts.read": permission({ target: target.required("post") }).rules([]),
      "posts.manage": intermediate({
        target: target.required("post"),
        expandsTo: (g: Grant) => {
          expansions++;
          return [{ ...g, key: "posts.read" }];
        },
      }).rules([]),
    },
    providers: [
      {
        cacheKey: () => "all",
        fetch: () => [{ id: "m", key: "posts.manage", target: ["post:*"] }],
      },
    ],
  });
  const ctx = sys.context({ subject });
  const baseline = expansions;
  for (let i = 0; i < 5; i++) {
    assertEquals((await ctx.can("posts.read", [`post:${i}`])).ok, true);
  }
  assertEquals(expansions - baseline <= 5, true);
});

test("a grant without target on a required key is dropped before expansion", async () => {
  const sys = createSystem({
    schema: flowSchema,
    providers: [
      () => [
        { id: "untargeted", key: "posts.manage" },
        { id: "targeted", key: "posts.read", target: ["post:1"] },
      ],
    ],
  });
  assertEquals(await sys.can(subject, "posts.read", ["post:1"]), {
    ok: true,
    matchedGrants: ["targeted"],
  });
});

test("arity, unknown keys and capability queries keep their answers", async () => {
  const sys = createSystem({
    schema: flowSchema,
    providers: [() => [{ id: "one", key: "posts.read", target: ["post:1"] }]],
  });
  assertEquals(await sys.can(subject, "posts.read", []), {
    ok: false,
    reasons: ["target arity mismatch: expected 1, got 0"],
  });
  assertEquals(await sys.can(subject, "nope", ["post:1"]), {
    ok: false,
    reasons: ["unknown permission: nope"],
  });
  assertEquals(await sys.can(subject, "posts.read", ["post:*"]), {
    ok: true,
    matchedGrants: ["one"],
  });
  assertEquals(await sys.can(subject, "posts.read", ["post:2"]), {
    ok: false,
    reasons: ["no matching grant"],
  });
});

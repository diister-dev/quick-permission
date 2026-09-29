import { test } from "node:test";
import { assert, assertEquals } from "./+assert.ts";
import {
  createSystem,
  type Grant,
  intermediate,
  isCapabilityQuery,
  isWildcardSegment,
  type PermissionErrorEvent,
  type ProviderFetchEvent,
  permission,
  refType,
  resource,
  target,
} from "../mod.ts";

const schema = {
  "posts.read": permission({ target: target.required("post") }).rules([]),
  "posts.update": permission({ target: target.required("post") }).rules([]),
  "posts.manage": intermediate({
    target: target.required("post"),
    expandsTo: (g: Grant) => [
      { ...g, key: "posts.read" },
      { ...g, key: "posts.update" },
    ],
  }).rules([]),
  "posts.admin": intermediate({
    target: target.required("post"),
    expandsTo: (g: Grant) => [{ ...g, key: "posts.manage" }],
  }).rules([]),
  "orgs.register": permission({ target: target.required("org") }).rules([]),
};

const subject = { id: "user:u1" };

test("a provider keyed on the intermediate it emits is consulted for the keys it expands to", async () => {
  const sys = createSystem({
    schema,
    providers: [
      {
        keys: ["posts.admin"],
        fetch: () => [{ key: "posts.admin", target: ["post:*"] }],
      },
    ],
  });
  assertEquals((await sys.can(subject, "posts.read", ["post:1"])).ok, true);
  assertEquals((await sys.can(subject, "posts.manage", ["post:1"])).ok, true);
  assertEquals((await sys.can(subject, "orgs.register", ["org:1"])).ok, false);
});

test("a provider is still skipped for keys it can never reach", async () => {
  let calls = 0;
  const sys = createSystem({
    schema,
    providers: [
      {
        keys: ["posts.manage"],
        fetch: () => {
          calls++;
          return [];
        },
      },
    ],
  });
  await sys.can(subject, "orgs.register", ["org:1"]);
  await sys.can(subject, "posts.admin", ["post:1"]);
  assertEquals(calls, 0);
});

test("a throwing provider counts as no grant, is reported once per context, and explains the deny", async () => {
  const errors: PermissionErrorEvent[] = [];
  const sys = createSystem({
    schema,
    hooks: { onError: (event) => errors.push(event) },
    providers: [
      {
        name: "memberships",
        keys: ["posts.*"],
        cacheKey: (s) => s.id,
        fetch: () => {
          throw new Error("db down");
        },
      },
    ],
  });
  const ctx = sys.context({ subject });
  const first = await ctx.can("posts.read", ["post:1"]);
  const second = await ctx.can("posts.update", ["post:1"]);
  assertEquals(first.ok, false);
  assert(
    !first.ok && first.reasons.includes("provider memberships failed: db down"),
  );
  assertEquals(second.ok, false);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].source, "provider");
  assert(
    errors[0].source === "provider" && errors[0].provider === "memberships",
  );
});

test("a throwing provider does not hide the grants of the others", async () => {
  const sys = createSystem({
    schema,
    providers: [
      () => {
        throw new Error("db down");
      },
      () => [{ key: "posts.read", target: ["post:1"] }],
    ],
  });
  assertEquals((await sys.can(subject, "posts.read", ["post:1"])).ok, true);
});

test("a throwing cacheKey is isolated like a throwing fetch", async () => {
  const sys = createSystem({
    schema,
    providers: [
      {
        cacheKey: () => {
          throw new Error("bad key");
        },
        fetch: () => [{ key: "posts.read", target: ["post:1"] }],
      },
    ],
  });
  const result = await sys.context({ subject }).can("posts.read", ["post:1"]);
  assertEquals(result.ok, false);
  assert(!result.ok && result.reasons.some((r) => r.includes("bad key")));
});

test("a throwing hook never changes the decision", async () => {
  const sys = createSystem({
    schema,
    hooks: {
      onProviderFetch: () => {
        throw new Error("telemetry down");
      },
      onError: () => {
        throw new Error("logger down");
      },
    },
    providers: [
      () => [{ key: "posts.read", target: ["post:1"] }],
      () => {
        throw new Error("db down");
      },
    ],
  });
  assertEquals((await sys.can(subject, "posts.read", ["post:1"])).ok, true);
});

test("two providers returning the same cacheKey keep their own grants", async () => {
  let calls = 0;
  const ctx = createSystem({
    schema,
    providers: [
      {
        cacheKey: () => "same",
        fetch: () => {
          calls++;
          return [{ key: "posts.read", target: ["post:1"] }];
        },
      },
      {
        cacheKey: () => "same",
        fetch: () => {
          calls++;
          return [{ key: "posts.read", target: ["post:2"] }];
        },
      },
    ],
  }).context({ subject });
  assertEquals((await ctx.can("posts.read", ["post:1"])).ok, true);
  assertEquals((await ctx.can("posts.read", ["post:2"])).ok, true);
  assertEquals(calls, 2);
});

test("an undefined cacheKey opts out of caching", async () => {
  let calls = 0;
  const ctx = createSystem({
    schema,
    providers: [
      {
        cacheKey: () => undefined,
        fetch: () => {
          calls++;
          return [];
        },
      },
    ],
  }).context({ subject });
  await ctx.can("posts.read", ["post:1"]);
  await ctx.can("posts.read", ["post:1"]);
  assertEquals(calls, 2);
});

test("targetType consults a provider only for one concrete id of that type", async () => {
  const seen: unknown[] = [];
  const sys = createSystem({
    schema,
    providers: [
      {
        targetType: "post",
        fetch: (_s, _k, t) => {
          seen.push(t?.[0]);
          return [];
        },
      },
    ],
  });
  await sys.can(subject, "posts.read", ["post:1"]);
  await sys.can(subject, "posts.read", ["post:*"]);
  await sys.can(subject, "posts.read", ["*"]);
  await sys.can(subject, "orgs.register", ["org:1"]);
  assertEquals(seen, ["post:1"]);
});

test("targetType accepts several types", async () => {
  let calls = 0;
  const sys = createSystem({
    schema,
    providers: [
      {
        targetType: ["post", "org"],
        fetch: () => {
          calls++;
          return [];
        },
      },
    ],
  });
  await sys.can(subject, "posts.read", ["post:1"]);
  await sys.can(subject, "orgs.register", ["org:1"]);
  assertEquals(calls, 2);
});

test("onProviderFetch reports real fetches with the provider name, never cache hits", async () => {
  const events: ProviderFetchEvent[] = [];
  const ctx = createSystem({
    schema,
    hooks: { onProviderFetch: (event) => events.push(event) },
    providers: [
      {
        name: "roles",
        cacheKey: (s) => s.id,
        fetch: () => [{ key: "posts.read", target: ["post:1"] }],
      },
      () => [],
    ],
  }).context({ subject });
  await ctx.can("posts.read", ["post:1"]);
  await ctx.can("posts.read", ["post:1"]);
  assertEquals(
    events.map((e) => [e.provider, e.grantCount]),
    [
      ["roles", 1],
      ["provider#1", 0],
      ["provider#1", 0],
    ],
  );
  assert(events.every((e) => e.durationMs >= 0));
});

test("a throwing resource rejects only the grant that needed it", async () => {
  const errors: PermissionErrorEvent[] = [];
  const brokenPost = resource({
    id: "post",
    fetch: () => {
      throw new Error("post store down");
    },
  });
  const sys = createSystem({
    schema: {
      "posts.read": permission({ target: target.required("post") }).rules([
        brokenPost.match(),
      ]),
    },
    hooks: { onError: (event) => errors.push(event) },
    providers: [
      () => [
        {
          id: "scoped",
          key: "posts.read",
          target: ["post:1"],
          with: { post: { status: "public" } },
        },
      ],
    ],
  });
  const result = await sys.can(subject, "posts.read", ["post:1"]);
  assertEquals(result.ok, false);
  assert(
    !result.ok &&
      result.reasons.includes(
        "[scoped] rule evaluation failed: post store down",
      ),
  );
  assertEquals(errors.length, 1);
  assert(errors[0].source === "rule" && errors[0].grantId === "scoped");
});

test("a rejected grant never widens the projected fields of an accepted one", async () => {
  const postOf = resource({
    id: "post",
    fetch: () => ({
      _id: "post:1",
      title: "Hello",
      secret: "s3cr3t",
      status: "draft",
    }),
  });
  const sys = createSystem({
    schema: {
      "posts.read": permission({ target: target.required("post") }).rules([
        postOf.filter(),
        postOf.match(),
      ]),
    },
    providers: [
      (): Grant[] => [
        {
          id: "public-only",
          key: "posts.read",
          target: ["post:1"],
          filter: { secret: true },
          with: { post: { status: "public" } },
        },
        {
          id: "title",
          key: "posts.read",
          target: ["post:1"],
          filter: { _id: true, title: true },
        },
      ],
    ],
  });
  const result = await sys.can(subject, "posts.read", ["post:1"]);
  assertEquals(result.ok, true);
  assert(result.ok);
  assertEquals(result.data, { _id: "post:1", title: "Hello" });
});

test("wildcard helpers and refType describe target segments", () => {
  assertEquals(isWildcardSegment("*"), true);
  assertEquals(isWildcardSegment("post:*"), true);
  assertEquals(isWildcardSegment("post:1"), false);
  assertEquals(isCapabilityQuery(["post:1", "comment:*"]), true);
  assertEquals(isCapabilityQuery(["post:1"]), false);
  assertEquals(isCapabilityQuery(undefined), false);
  assertEquals(refType("post:1"), "post");
  assertEquals(refType("post"), undefined);
  assertEquals(refType(":1"), undefined);
  assertEquals(refType(42), undefined);
});

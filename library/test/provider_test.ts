import { test } from "node:test";
import {
  ALL,
  action,
  bundle,
  createSystem,
  entity,
  type GrantProvider,
  type Hooks,
  permissions,
} from "../mod.ts";
import { assert, assertEquals } from "./+assert.ts";

type ErrorEvent = Parameters<NonNullable<Hooks["onError"]>>[0];
type FetchEvent = Parameters<NonNullable<Hooks["onProviderFetch"]>>[0];

type PostDoc = {
  readonly _id: string;
  readonly title: string;
  readonly secret: string;
  readonly status: string;
};

const post = entity("post", {});
const org = entity("org", {});

const posts = permissions(post, "posts", {
  read: action(),
  update: action(),
  manage: bundle(["read", "update"]),
  admin: bundle(["manage"]),
});
const orgs = permissions(org, "orgs", { register: action() });

const subject = { id: "user:u1" };

function systemWith(providers: readonly GrantProvider[], hooks: Hooks = {}) {
  return createSystem({ permissions: [posts, orgs], providers, hooks });
}

test("a provider keyed on the bundle it emits is consulted for the keys it includes", async () => {
  const sys = systemWith([
    { keys: ["posts.admin"], fetch: () => [posts.grant("admin", { on: ALL })] },
  ]);
  const ctx = () => sys.context({ subject });
  assertEquals((await ctx().check("posts.read", "post:1")).ok, true);
  assertEquals((await ctx().check("posts.manage", "post:1")).ok, true);
  assertEquals((await ctx().check("orgs.register", "org:1")).ok, false);
});

test("a provider is still skipped for keys it can never reach", async () => {
  let calls = 0;
  const sys = systemWith([
    {
      keys: ["posts.manage"],
      fetch: () => {
        calls++;
        return [];
      },
    },
  ]);
  await sys.context({ subject }).check("orgs.register", "org:1");
  await sys.context({ subject }).check("posts.admin", "post:1");
  assertEquals(calls, 0);
});

test("a throwing provider counts as no grant, is reported once per context, and explains the deny", async () => {
  const errors: ErrorEvent[] = [];
  const sys = systemWith(
    [
      {
        name: "memberships",
        keys: ["posts.*"],
        cacheKey: (s) => s.id,
        fetch: () => {
          throw new Error("db down");
        },
      },
    ],
    { onError: (event) => errors.push(event) },
  );
  const ctx = sys.context({ subject });
  const first = await ctx.check("posts.read", "post:1");
  const second = await ctx.check("posts.update", "post:1");
  assert(!first.ok);
  assert(first.reasons.includes("provider memberships failed: db down"));
  assertEquals(second.ok, false);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].source, "provider");
  assert(
    errors[0].source === "provider" && errors[0].provider === "memberships",
  );
});

test("a throwing provider does not hide the grants of the others", async () => {
  const sys = systemWith([
    () => {
      throw new Error("db down");
    },
    () => [posts.grant("read", { on: "post:1" })],
  ]);
  assertEquals(
    (await sys.context({ subject }).check("posts.read", "post:1")).ok,
    true,
  );
});

test("a throwing cacheKey is isolated like a throwing fetch", async () => {
  const sys = systemWith([
    {
      cacheKey: () => {
        throw new Error("bad key");
      },
      fetch: () => [posts.grant("read", { on: "post:1" })],
    },
  ]);
  const result = await sys.context({ subject }).check("posts.read", "post:1");
  assert(!result.ok);
  assert(result.reasons.some((reason) => reason.includes("bad key")));
});

test("a throwing hook never changes the decision", async () => {
  const sys = systemWith(
    [
      () => [posts.grant("read", { on: "post:1" })],
      () => {
        throw new Error("db down");
      },
    ],
    {
      onProviderFetch: () => {
        throw new Error("telemetry down");
      },
      onError: () => {
        throw new Error("logger down");
      },
    },
  );
  assertEquals(
    (await sys.context({ subject }).check("posts.read", "post:1")).ok,
    true,
  );
});

test("two providers returning the same cacheKey keep their own grants", async () => {
  let calls = 0;
  const ctx = systemWith([
    {
      cacheKey: () => "same",
      fetch: () => {
        calls++;
        return [posts.grant("read", { on: "post:1" })];
      },
    },
    {
      cacheKey: () => "same",
      fetch: () => {
        calls++;
        return [posts.grant("read", { on: "post:2" })];
      },
    },
  ]).context({ subject });
  assertEquals((await ctx.check("posts.read", "post:1")).ok, true);
  assertEquals((await ctx.check("posts.read", "post:2")).ok, true);
  assertEquals(calls, 2);
});

test("an undefined cacheKey opts out of caching", async () => {
  let calls = 0;
  const ctx = systemWith([
    {
      cacheKey: () => undefined,
      fetch: () => {
        calls++;
        return [];
      },
    },
  ]).context({ subject });
  await ctx.check("posts.read", "post:1");
  await ctx.check("posts.read", "post:1");
  assertEquals(calls, 2);
});

test("targetType consults a provider only for one concrete id of that type", async () => {
  const seen: unknown[] = [];
  const sys = systemWith([
    {
      targetType: "post",
      fetch: (_s, _k, t) => {
        seen.push(t?.[0]);
        return [];
      },
    },
  ]);
  await sys.context({ subject }).check("posts.read", "post:1");
  await sys.context({ subject }).could("posts.read");
  await sys.context({ subject }).could("posts.read", "*");
  await sys.context({ subject }).check("orgs.register", "org:1");
  assertEquals(seen, ["post:1"]);
});

test("targetType accepts several types", async () => {
  let calls = 0;
  const sys = systemWith([
    {
      targetType: ["post", "org"],
      fetch: () => {
        calls++;
        return [];
      },
    },
  ]);
  await sys.context({ subject }).check("posts.read", "post:1");
  await sys.context({ subject }).check("orgs.register", "org:1");
  assertEquals(calls, 2);
});

test("onProviderFetch reports real fetches with the provider name, never cache hits", async () => {
  const events: FetchEvent[] = [];
  const ctx = systemWith(
    [
      {
        name: "roles",
        cacheKey: (s) => s.id,
        fetch: () => [posts.grant("read", { on: "post:1" })],
      },
      () => [],
    ],
    { onProviderFetch: (event) => events.push(event) },
  ).context({ subject });
  await ctx.check("posts.read", "post:1");
  await ctx.check("posts.read", "post:1");
  assertEquals(
    events.map((event) => [event.provider, event.grantCount]),
    [
      ["roles", 1],
      ["provider#1", 0],
      ["provider#1", 0],
    ],
  );
  assert(events.every((event) => event.durationMs >= 0));
});

test("a throwing load rejects only the grant that needed it", async () => {
  const errors: ErrorEvent[] = [];
  const brokenPost = entity<PostDoc>("post", {
    load: () => {
      throw new Error("post store down");
    },
  });
  const brokenPosts = permissions(brokenPost, "posts", { read: action() });
  const sys = createSystem({
    permissions: [brokenPosts],
    hooks: { onError: (event) => errors.push(event) },
    providers: [
      () => [
        brokenPosts.grant("read", {
          id: "scoped",
          on: "post:1",
          where: { status: "public" },
        }),
      ],
    ],
  });
  const result = await sys.context({ subject }).check("posts.read", "post:1");
  assert(!result.ok);
  assert(
    result.reasons.includes("[scoped] rule evaluation failed: post store down"),
  );
  assertEquals(errors.length, 1);
  assert(errors[0].source === "rule" && errors[0].grantId === "scoped");
});

test("a rejected grant never widens the projected fields of an accepted one", async () => {
  const storedPost = entity<PostDoc>("post", {
    load: () => ({
      _id: "post:1",
      title: "Hello",
      secret: "s3cr3t",
      status: "draft",
    }),
  });
  const storedPosts = permissions(storedPost, "posts", {
    read: action({ fields: "doc" }),
  });
  const sys = createSystem({
    permissions: [storedPosts],
    providers: [
      () => [
        storedPosts.grant("read", {
          id: "public-only",
          on: "post:1",
          fields: { secret: true },
          where: { status: "public" },
        }),
        storedPosts.grant("read", {
          id: "title",
          on: "post:1",
          fields: { _id: true, title: true },
        }),
      ],
    ],
  });
  const result = await sys.context({ subject }).check("posts.read", "post:1");
  assert(result.ok);
  assertEquals(result.doc, { _id: "post:1", title: "Hello" });
});

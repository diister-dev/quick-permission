import { test } from "node:test";
import { assertEquals, assertRejects } from "./+assert.ts";
import {
  createSystem,
  type Grant,
  intermediate,
  permission,
  type Provider,
  target,
} from "../mod.ts";

const subject = { id: "user:u1" };

const schema = {
  "posts.read": permission({ target: target.required("post") }).rules([]),
  "posts.manage": intermediate({
    target: target.required("post"),
    expandsTo: (g: Grant) => [{ ...g, key: "posts.read" }],
  }).rules([]),
};

test("providers are consulted together, not one after another", async () => {
  let inFlight = 0;
  let peak = 0;
  const slow = (id: string): Provider => ({
    name: id,
    fetch: async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return [{ id, key: "posts.read", target: ["post:*"] }];
    },
  });
  const sys = createSystem({
    schema,
    providers: [slow("a"), slow("b"), slow("c"), slow("d")],
  });
  assertEquals(await sys.can(subject, "posts.read", ["post:1"]), {
    ok: true,
    matchedGrants: ["a", "b", "c", "d"],
  });
  assertEquals(peak, 4);
});

test("a provider skipped by key or target type is never called", async () => {
  const calls: string[] = [];
  const sys = createSystem({
    schema,
    providers: [
      {
        name: "other-keys",
        keys: ["orgs.*"],
        fetch: () => {
          calls.push("other-keys");
          return [];
        },
      },
      {
        name: "orgs-only",
        targetType: "org",
        fetch: () => {
          calls.push("orgs-only");
          return [];
        },
      },
      () => {
        calls.push("all");
        return [{ key: "posts.read", target: ["post:*"] }];
      },
    ],
  });
  assertEquals((await sys.can(subject, "posts.read", ["post:1"])).ok, true);
  assertEquals(calls, ["all"]);
});

test("a throwing key matcher still rejects the check", async () => {
  const sys = createSystem({
    schema,
    providers: [
      {
        matches: () => {
          throw new Error("matcher broke");
        },
        fetch: () => [],
      },
    ],
  });
  await assertRejects(() => sys.can(subject, "posts.read", ["post:1"]));
});

test("a cached provider result is expanded once per context", async () => {
  let expansions = 0;
  let fetches = 0;
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
        fetch: () => {
          fetches++;
          return [{ id: "m", key: "posts.manage", target: ["post:*"] }];
        },
      },
    ],
  });
  const ctx = sys.context({ subject });
  const baseline = expansions;
  for (let i = 0; i < 20; i++) {
    assertEquals((await ctx.can("posts.read", [`post:${i}`])).ok, true);
    assertEquals((await ctx.can("posts.manage", [`post:${i}`])).ok, true);
  }
  assertEquals(fetches, 1);
  assertEquals(expansions - baseline, 1);

  const other = sys.context({ subject });
  await other.can("posts.read", ["post:1"]);
  assertEquals(fetches, 2);
  assertEquals(expansions - baseline, 2);
});

test("a cached array that grows in place is expanded again", async () => {
  const grants: Grant[] = [
    { id: "first", key: "posts.read", target: ["post:1"] },
  ];
  const sys = createSystem({
    schema,
    providers: [{ cacheKey: () => "all", fetch: () => grants }],
  });
  const ctx = sys.context({ subject });
  assertEquals((await ctx.can("posts.read", ["post:2"])).ok, false);
  grants.push({ id: "second", key: "posts.manage", target: ["post:2"] });
  assertEquals(await ctx.can("posts.read", ["post:2"]), {
    ok: true,
    matchedGrants: ["second"],
  });
  grants[0] = { id: "replaced", key: "posts.read", target: ["post:2"] };
  assertEquals(await ctx.can("posts.read", ["post:2"]), {
    ok: true,
    matchedGrants: ["replaced", "second"],
  });
});

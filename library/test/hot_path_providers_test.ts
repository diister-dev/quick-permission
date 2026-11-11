import { test } from "node:test";
import {
  ALL,
  action,
  bundle,
  createSystem,
  entity,
  type GrantProvider,
  permissions,
} from "../mod.ts";
import { assertEquals, assertRejects } from "./+assert.ts";

const subject = { id: "user:u1" };

const post = entity("post", {});

const posts = permissions(post, "posts", {
  read: action(),
  manage: bundle(["read"]),
});

test("providers are consulted together, not one after another", async () => {
  let inFlight = 0;
  let peak = 0;
  const slow = (id: string): GrantProvider => ({
    name: id,
    fetch: async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return [posts.grant("read", { id, on: ALL })];
    },
  });
  const sys = createSystem({
    permissions: [posts],
    providers: [slow("a"), slow("b"), slow("c"), slow("d")],
  });
  assertEquals(await sys.context({ subject }).check("posts.read", "post:1"), {
    ok: true,
    grants: ["a", "b", "c", "d"],
  });
  assertEquals(peak, 4);
});

test("a provider skipped by key or target type is never called", async () => {
  const calls: string[] = [];
  const sys = createSystem({
    permissions: [posts],
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
        return [posts.grant("read", { on: ALL })];
      },
    ],
  });
  assertEquals(
    (await sys.context({ subject }).check("posts.read", "post:1")).ok,
    true,
  );
  assertEquals(calls, ["all"]);
});

test("a throwing key matcher still rejects the check", async () => {
  const sys = createSystem({
    permissions: [posts],
    providers: [
      {
        matches: () => {
          throw new Error("matcher broke");
        },
        fetch: () => [],
      },
    ],
  });
  await assertRejects(() =>
    sys.context({ subject }).check("posts.read", "post:1"),
  );
});

test("a cached provider result is expanded once per context", async () => {
  let expansions = 0;
  let fetches = 0;
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
        fetch: () => {
          fetches++;
          return [counted.grant("manage", { id: "m", on: ALL })];
        },
      },
    ],
  });
  const ctx = sys.context({ subject });
  const baseline = expansions;
  for (let i = 0; i < 20; i++) {
    assertEquals((await ctx.check("posts.read", `post:${i}`)).ok, true);
    assertEquals((await ctx.check("posts.manage", `post:${i}`)).ok, true);
  }
  assertEquals(fetches, 1);
  assertEquals(expansions - baseline, 1);

  const other = sys.context({ subject });
  await other.check("posts.read", "post:1");
  assertEquals(fetches, 2);
  assertEquals(expansions - baseline, 2);
});

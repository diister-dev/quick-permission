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

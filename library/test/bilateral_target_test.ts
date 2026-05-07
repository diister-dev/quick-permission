/**
 * Bilateral target enforcement.
 *
 * `target.required` and `target.path` require the grant to carry a target,
 * not just the request. Grants without `target` are dropped before they
 * reach `targetMatches` or `expandsTo`. `target.optional` and `target.none`
 * keep their existing "match-all on undefined target" semantics.
 */
import { assertEquals } from "jsr:@std/assert";
import {
  createSystem,
  intermediate,
  permission,
  resource,
  target,
} from "../mod.ts";

const userOf = resource({
  id: "user",
  fetch: ({ target }) => ({ _id: target[0], name: "X" }),
  dedupKey: ({ target }) => target[0] as string,
});

const expoOf = resource({
  id: "exposition",
  fetch: ({ target }) => ({ _id: target[0] }),
  dedupKey: ({ target }) => target[0] as string,
});

const memberOf = resource({
  id: "member",
  fetch: ({ target }) => ({ _id: target[1], expoId: target[0] }),
  dedupKey: ({ target }) => `${target[0]}::${target[1]}`,
});

// ─── target.required: target-less grant must NOT match ──────────────────

Deno.test("target.required: target-less grant does NOT match concrete request", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    // Grant with no target — malformed for a `target.required` schema.
    providers: [() => [{ id: "g1", key: "users.read" }]],
  });

  const result = await sys.context({ subject: { id: "user:caller" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, false);
});

Deno.test("target.required: target-less grant does NOT match wildcard request", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [{ id: "g1", key: "users.read" }]],
  });

  const result = await sys.context({ subject: { id: "user:caller" } }).can(
    "users.read",
    ["user:*"],
  );
  assertEquals(result.ok, false);
});

Deno.test("target.required: properly-targeted grant continues to work", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [{ id: "g1", key: "users.read", target: ["user:abc"] }]],
  });

  const result = await sys.context({ subject: { id: "user:caller" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, true);
});

Deno.test("target.required: wildcard-targeted grant matches concrete request", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [{ id: "g1", key: "users.read", target: ["user:*"] }]],
  });

  const result = await sys.context({ subject: { id: "user:caller" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, true);
});

// ─── target.path: same enforcement ──────────────────────────────────────

Deno.test("target.path: target-less grant does NOT match", async () => {
  const sys = createSystem({
    schema: {
      "expo.members.read": permission({
        target: target.path("exposition", "member"),
      }).rules([expoOf.match(), memberOf.match()]),
    },
    providers: [() => [{ id: "g1", key: "expo.members.read" }]],
  });

  const result = await sys.context({ subject: { id: "user:caller" } }).can(
    "expo.members.read",
    ["exposition:e1", "member:m1"],
  );
  assertEquals(result.ok, false);
});

// ─── target.optional: legacy match-all-on-undefined preserved ──────────

Deno.test("target.optional: target-less grant STILL matches (legacy behavior)", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.optional("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [{ id: "g1", key: "users.read" }]],
  });

  const result = await sys.context({ subject: { id: "user:caller" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, true);
});

// ─── target.none: target-less grant always matches (unchanged) ─────────

Deno.test("target.none: target-less grant matches", async () => {
  const sys = createSystem({
    schema: {
      "users.create": permission({ target: target.none() }).rules([]),
    },
    providers: [() => [{ id: "g1", key: "users.create" }]],
  });

  const result = await sys.context({ subject: { id: "user:caller" } }).can(
    "users.create",
  );
  assertEquals(result.ok, true);
});

// ─── Expansion stops at malformed parent grants ─────────────────────────

Deno.test("expansion: target-less grant on target.required intermediate is dropped, children NOT produced", async () => {
  let expandsToCalls = 0;
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
      "users.manage": intermediate({
        target: target.required("user"),
        expandsTo: (grant) => {
          expandsToCalls++;
          return [{ ...grant, key: "users.read" }];
        },
      }).rules([userOf.match()]),
    },
    // Malformed: target.required intermediate with no target.
    providers: [() => [{ id: "g1", key: "users.manage" }]],
  });

  // `createSystem` invokes `expandsTo` once at boot to walk the schema
  // graph. Capture that baseline; runtime calls on malformed grants must
  // stay at zero.
  const bootCalls = expandsToCalls;

  // Direct check on the malformed key: dropped.
  const r1 = await sys.context({ subject: { id: "user:caller" } }).can(
    "users.manage",
    ["user:abc"],
  );
  assertEquals(r1.ok, false);

  // Check on the child key: would only succeed if expansion ran.
  const r2 = await sys.context({ subject: { id: "user:caller" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(r2.ok, false);

  // Runtime expandsTo invocations on the malformed grant: zero.
  assertEquals(expandsToCalls, bootCalls);
});

Deno.test("expansion: properly-targeted parent expands and children inherit target", async () => {
  let expandsToCalls = 0;
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
      "users.manage": intermediate({
        target: target.required("user"),
        expandsTo: (grant) => {
          expandsToCalls++;
          // Safe: with bilateral enforcement, we can trust grant.target.
          return [{ ...grant, key: "users.read" }];
        },
      }).rules([userOf.match()]),
    },
    providers: [() => [
      { id: "g1", key: "users.manage", target: ["user:*"] },
    ]],
  });

  const result = await sys.context({ subject: { id: "user:caller" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, true);
  assertEquals(expandsToCalls >= 1, true);
});

// ─── Mixed grants: malformed dropped, valid kept ───────────────────────

Deno.test("expansion: malformed grant dropped while sibling valid grants survive", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [
      { id: "bad", key: "users.read" },                       // dropped
      { id: "good", key: "users.read", target: ["user:abc"] }, // kept
    ]],
  });

  const result = await sys.context({ subject: { id: "user:caller" } }).can(
    "users.read",
    ["user:abc"],
  );
  assertEquals(result.ok, true);
});

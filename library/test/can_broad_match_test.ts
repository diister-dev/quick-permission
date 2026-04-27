/**
 * Tests for canBroadMatch and capabilities — wildcard-tolerant capability checks
 * that skip rules requiring a fetched resource (WithRule, FilterRule).
 */
import {
  createPermissionSystem,
  directProvider,
  permission,
  WithRule,
  FilterRule,
  type PermissionSchemas,
  type Subject,
} from "../mod.ts";

const alice: Subject = { id: "alice" };
const bob: Subject = { id: "bob" };

function assert(condition: boolean, message: string = "") {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// Resource fetcher that would fail on a wildcard segment if called.
async function getBadge([_expoId, badgeId]: readonly [string, string]) {
  if (badgeId === "*" || badgeId.includes("*")) {
    throw new Error("fetcher must not be called with a wildcard target");
  }
  return { _id: badgeId, ownerId: "alice", visible: true };
}

const schemas = {
  "expositions.badges.read": permission(getBadge, [
    WithRule(),
    FilterRule(),
  ]),
  "expositions.badges.generate": permission(getBadge, [
    WithRule(),
  ]),
  "expositions.read": permission<readonly [string]>(),
} satisfies PermissionSchemas;

const system = createPermissionSystem({
  schemas,
  sources: [
    directProvider([
      // Alice has badge.read on any badge in expo:1
      { subject: alice, key: "expositions.badges.read", target: ["expo:1", "badge:*"] },
      // Alice can read expo:1
      { subject: alice, key: "expositions.read", target: ["expo:1"] },
      // Bob has nothing
    ]),
  ],
});

Deno.test("canBroadMatch - matches a wildcard target without fetching the resource", async () => {
  // The fetcher would throw on a "*" segment — broad match must skip it.
  const r = await system.canBroadMatch(alice, "expositions.badges.read", ["expo:1", "*"]);
  assert(r.ok === true, "broad match accepts wildcard target");
});

Deno.test("canBroadMatch - returns false when no perm matches", async () => {
  const r = await system.canBroadMatch(bob, "expositions.badges.read", ["expo:1", "*"]);
  assert(r.ok === false, "bob has nothing");
});

Deno.test("canBroadMatch - returns code 'unknown_key' for invalid key", async () => {
  const r = await system.canBroadMatch(alice, "no.such.permission" as any);
  assert(r.ok === false);
  if (r.ok === false) {
    assert(r.code === "unknown_key", `expected unknown_key, got ${r.code}`);
  }
});

Deno.test("canBroadMatch - skips WithRule too (no resource constraint check)", async () => {
  // Even if WithRule would normally check resource attributes, broad match skips it.
  const restrictiveSystem = createPermissionSystem({
    schemas,
    sources: [
      directProvider([
        {
          subject: alice,
          key: "expositions.badges.generate",
          target: ["expo:1", "badge:*"],
          with: { ownerId: "someone-else" }, // would fail in a normal can()
        },
      ]),
    ],
  });

  const r = await restrictiveSystem.canBroadMatch(alice, "expositions.badges.generate", ["expo:1", "*"]);
  assert(r.ok === true, "with-constraint is skipped in broad match");
});

Deno.test("canBroadMatch - typed key autocomplete still works (no `as any` needed)", async () => {
  // This is essentially a type-check; if it compiles, the overload is right.
  const r = await system.canBroadMatch(alice, "expositions.badges.read", ["expo:1", "*"]);
  assert(r.ok === true);
});

// ─── capabilities ─────────────────────────────────────────────────────────────

Deno.test("capabilities - returns one entry per schema key by default", async () => {
  const caps = await system.capabilities(alice, ["expo:1", "*"]);
  assert(typeof caps["expositions.badges.read"] === "boolean", "key present");
  assert(typeof caps["expositions.badges.generate"] === "boolean", "key present");
  assert(typeof caps["expositions.read"] === "boolean", "key present");
});

Deno.test("capabilities - reflects which keys are granted (alice has badge.read only)", async () => {
  const caps = await system.capabilities(alice, ["expo:1", "*"]);
  assert(caps["expositions.badges.read"] === true);
  assert(caps["expositions.badges.generate"] === false);
});

Deno.test("capabilities - filters to a subset of keys via opts", async () => {
  const caps = await system.capabilities(alice, ["expo:1", "*"], {
    keys: ["expositions.badges.read", "expositions.badges.generate"],
  });
  assert(Object.keys(caps).length === 2);
  assert(caps["expositions.badges.read"] === true);
  assert(caps["expositions.badges.generate"] === false);
});

Deno.test("capabilities - exposed on context() with shared cache", async () => {
  const ctx = system.context({ subject: alice });
  const caps = await ctx.capabilities(["expo:1", "*"]);
  assert(caps["expositions.badges.read"] === true);
});

Deno.test("capabilities - bob (no perms) gets all-false", async () => {
  const caps = await system.capabilities(bob, ["expo:1", "*"]);
  assert(Object.values(caps).every((v) => v === false), "bob has no capabilities");
});

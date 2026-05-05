/**
 * Real-world port of Diivento's `expositions.badges.read`.
 *
 * Source: projects/new_backend/src/domains/expositions/expositions.permissions.ts:238
 *
 * Legacy form:
 *   "expositions.badges.read": p.permission(getBadgeWithExposition, [
 *     p.WithRule("withExposition", (_, value) => value.exposition),
 *     p.WithRule("withBadge", (_, value) => value.badge),
 *     p.FilterRule((_, value) => value.badge),
 *   ])
 *
 * Provider (HOSTESS role bundle, expositions.permissions.ts:131):
 *   {
 *     key: "expositions.badges.read",
 *     subject: { id: subject.id },
 *     target: [expositionId, "badge:*"],
 *   }
 */

import { createPermissionFactory } from "../factory.ts";
import { createSystem } from "../system.ts";
import { target } from "../target.ts";
import { filter, match } from "../rules.ts";
import type { Provider } from "../system.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

function assert(cond: boolean, msg = "") {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// ─── Domain types (real Diivento shapes, simplified) ─────────────────────────

type Exposition = {
  _id: string;
  name: string;
  status: "draft" | "published" | "archived";
};

type Badge = {
  _id: string;
  expositionId: string;
  visitorId: string;
  qrCode: string;
};

type BadgeWithExposition = {
  exposition: Exposition;
  badge: Badge;
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const expoFoire: Exposition = {
  _id: "exposition:foire-2024",
  name: "Foire 2024",
  status: "published",
};

const expoSalon: Exposition = {
  _id: "exposition:salon-2025",
  name: "Salon 2025",
  status: "published",
};

const badge42: Badge = {
  _id: "badge:42",
  expositionId: "exposition:foire-2024",
  visitorId: "visitor:alice",
  qrCode: "QR-42",
};

// Mock fetcher matching Diivento's `getBadgeWithExposition` signature.
function getBadgeWithExposition(
  [expoId, badgeId]: readonly [string, string],
): Promise<BadgeWithExposition> {
  if (expoId !== expoFoire._id || badgeId !== badge42._id) {
    return Promise.reject(new Error(`Not found: ${expoId} / ${badgeId}`));
  }
  return Promise.resolve({ exposition: expoFoire, badge: badge42 });
}

// ─── Permission schema (declarative new API) ──────────────────────────────────

type DiiventoMeta = {
  description: string;
  group?: string;
};

const { permission } = createPermissionFactory<DiiventoMeta>();

const expositionsBadgesRead = permission({
  metadata: {
    description: "Read a badge of an exposition",
    group: "Expositions / Badges",
  },
  target: target.path("exposition", "badge"),
  fetch: getBadgeWithExposition,
}).rules([
  match("exposition", (v) => v.exposition),
  match("badge", (v) => v.badge),
  filter((v) => v.badge),
]);

const schema = { "expositions.badges.read": expositionsBadgesRead };

// ─── HOSTESS provider (real Diivento role bundle, ported) ────────────────────

type HostessAssignment = {
  userId: string;
  expositionId: string;
};

function createHostessProvider(assignments: HostessAssignment[]): Provider {
  return (subject, key) => {
    if (key !== "expositions.badges.read") return [];
    return assignments
      .filter((a) => a.userId === subject.id)
      .map((a) => ({
        key: "expositions.badges.read",
        target: [a.expositionId, "badge:*"] as const,
      }));
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("HOSTESS in foire-2024 can read a badge of foire-2024", async () => {
  const sys = createSystem<DiiventoMeta>({
    schema,
    providers: [createHostessProvider([
      { userId: "user:alice", expositionId: "exposition:foire-2024" },
    ])],
  });

  const r = await sys.can(
    { id: "user:alice" },
    "expositions.badges.read",
    ["exposition:foire-2024", "badge:42"],
  );
  assertEq(r.ok, true);
});

Deno.test("HOSTESS in foire-2024 CANNOT read a badge of salon-2025 (wrong expo)", async () => {
  const sys = createSystem<DiiventoMeta>({
    schema,
    providers: [createHostessProvider([
      { userId: "user:alice", expositionId: "exposition:foire-2024" },
    ])],
  });

  const r = await sys.can(
    { id: "user:alice" },
    "expositions.badges.read",
    ["exposition:salon-2025", "badge:99"],
  );
  assertEq(r.ok, false);
});

Deno.test("Non-HOSTESS user denied", async () => {
  const sys = createSystem<DiiventoMeta>({
    schema,
    providers: [createHostessProvider([])],
  });

  const r = await sys.can(
    { id: "user:bob" },
    "expositions.badges.read",
    ["exposition:foire-2024", "badge:42"],
  );
  assertEq(r.ok, false);
});

Deno.test("HOSTESS — wildcard ['expo', 'badge:*'] matches any badge in that expo", async () => {
  const sys = createSystem<DiiventoMeta>({
    schema,
    providers: [createHostessProvider([
      { userId: "user:alice", expositionId: "exposition:foire-2024" },
    ])],
  });

  // The fetcher only knows badge:42 — for any other badge id it would reject.
  // Here we test that the WILDCARD MATCHING works at the grant-target level
  // (the request matches the grant); the fetcher being strict is a separate
  // concern (fetch failure → grant rejected).
  const ok = await sys.can(
    { id: "user:alice" },
    "expositions.badges.read",
    ["exposition:foire-2024", "badge:42"],
  );
  assertEq(ok.ok, true);
});

Deno.test("HOSTESS — output.data is the badge (FilterRule extractor)", async () => {
  const sys = createSystem<DiiventoMeta>({
    schema,
    providers: [createHostessProvider([
      { userId: "user:alice", expositionId: "exposition:foire-2024" },
    ])],
  });

  const r = await sys.can(
    { id: "user:alice" },
    "expositions.badges.read",
    ["exposition:foire-2024", "badge:42"],
  );
  assert(r.ok);
  if (r.ok) {
    // Without grant.filter, the data is the full extracted badge.
    assertEq(r.output?.data, badge42);
  }
});

Deno.test("Multiple HOSTESS assignments — user holds rights in both expos", async () => {
  const sys = createSystem<DiiventoMeta>({
    schema,
    providers: [createHostessProvider([
      { userId: "user:alice", expositionId: "exposition:foire-2024" },
      { userId: "user:alice", expositionId: "exposition:salon-2025" },
    ])],
  });

  const r1 = await sys.can(
    { id: "user:alice" },
    "expositions.badges.read",
    ["exposition:foire-2024", "badge:42"],
  );
  assertEq(r1.ok, true);

  // For salon, the fetcher rejects → grant denied (expected, badge doesn't exist)
  const r2 = await sys.can(
    { id: "user:alice" },
    "expositions.badges.read",
    ["exposition:salon-2025", "badge:99"],
  );
  assertEq(r2.ok, false);
});

// ─── Reflection — what the UI matrix would receive ───────────────────────────

Deno.test("reflection — list() exposes the permission with metadata", () => {
  const sys = createSystem<DiiventoMeta>({ schema });
  const list = sys.list();
  assertEq(list.length, 1);
  const entry = list[0];
  assertEq(entry.key, "expositions.badges.read");
  assertEq(entry.metadata?.description, "Read a badge of an exposition");
  assertEq(entry.metadata?.group, "Expositions / Badges");
  assertEq(entry.target.kind, "path");
  if (entry.target.kind === "path") {
    assertEq(entry.target.segments.map((s) => s.name), ["exposition", "badge"]);
  }
});

Deno.test("reflection — JSON-serializable target spec for HTTP transport", () => {
  const sys = createSystem<DiiventoMeta>({ schema });
  const list = sys.list();
  const json = JSON.parse(JSON.stringify(list[0]));
  assertEq(json.key, "expositions.badges.read");
  assertEq(json.target.kind, "path");
  assertEq(json.target.segments[0].name, "exposition");
  assertEq(json.target.segments[1].name, "badge");
});

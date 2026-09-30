/**
 * Tests for the cap-mode fetch-when-concrete behaviour with auto-binding
 * via `resource.id === segment.name` convention.
 *
 * Without this, a rule like `expositionInfoOf.match()` in a listing of
 * participants would silent-pass and emit a `{ entreprise: tenantId }`
 * constraint applied to the participant collection — wrong. With the
 * auto-binding, the engine fetches the exposition doc (concrete segment
 * 0), evaluates the spec against it, and denies the grant if the
 * exposition doesn't belong to the user's tenant.
 *
 * Auto-binding by convention : `resource.id === segment.name`. No opt-in
 * required — just respect the naming.
 */

import { test } from "node:test";
import { assertEquals } from "./+assert.ts";
import { createSystem, permission, resource, target } from "../mod.ts";

interface ExpoDoc {
  readonly _id: string;
  readonly entreprise: string;
}

const EXPOS: Record<string, ExpoDoc> = {
  "exposition:beta-owned": {
    _id: "exposition:beta-owned",
    entreprise: "entreprise:beta",
  },
  "exposition:globex-owned": {
    _id: "exposition:globex-owned",
    entreprise: "entreprise:globex",
  },
};

test("cap-mode auto-fetch — concrete segment matching resource.id is fetched + evaluated", async () => {
  let fetchCount = 0;
  const expoOf = resource({
    id: "exposition", // ← matches `target.path("exposition", ...)` segment 0
    fetch: ({ target }) => {
      fetchCount += 1;
      return EXPOS[target[0] as string] ?? null;
    },
    dedupKey: ({ target }) => target[0] as string,
  });

  // 2-seg permission : target[0]=expo (concrete), target[1]=participant (wildcard in cap mode)
  const sys = createSystem({
    schema: {
      "participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([expoOf.match()]),
    },
    providers: [
      () => [
        {
          id: "g-entreprise-beta",
          key: "participants.list",
          target: ["exposition:*", "participant:*"],
          with: { exposition: { entreprise: "entreprise:beta" } },
        },
      ],
    ],
  });

  // Listing participants of an expo OWNED by Beta → grant valid.
  const r1 = await sys
    .context({ subject: { id: "user:lucas" } })
    .can("participants.list", ["exposition:beta-owned", "participant:*"]);
  assertEquals(r1.ok, true, "Beta's expo should pass");
  assertEquals(
    fetchCount > 0,
    true,
    "expoOf should have been fetched in cap mode",
  );
  // Constraint NOT emitted FROM the rule itself — the engine still
  // pushes `{}` (any-wins) because there ARE match rules, preserving
  // the listWithPermission semantic.
  if (r1.ok) {
    assertEquals(r1.constraints, {});
  }

  // Listing participants of an expo NOT owned by Beta → grant denied.
  const r2 = await sys
    .context({ subject: { id: "user:lucas" } })
    .can("participants.list", ["exposition:globex-owned", "participant:*"]);
  assertEquals(
    r2.ok,
    false,
    "Globex's expo should deny — Beta admin not authorized",
  );
});

test("cap-mode auto-fetch — full wildcard target keeps legacy silent-pass", async () => {
  let fetchCount = 0;
  const expoOf = resource({
    id: "exposition",
    fetch: ({ target }) => {
      fetchCount += 1;
      return EXPOS[target[0] as string] ?? null;
    },
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([expoOf.match()]),
    },
    providers: [
      () => [
        {
          id: "g",
          key: "participants.list",
          target: ["exposition:*", "participant:*"],
          with: { exposition: { entreprise: "entreprise:beta" } },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:lucas" } })
    .can("participants.list", ["exposition:*", "participant:*"]);
  assertEquals(r.ok, true);
  assertEquals(fetchCount, 0, "no fetch when target[0] is also wildcard");
  // Legacy : constraint emitted from `with.exposition` spec.
  if (r.ok) {
    assertEquals(r.constraints, { entreprise: "entreprise:beta" });
  }
});

test("cap-mode auto-fetch — 3-seg perm with mixed concrete/wildcard fetches each independently", async () => {
  interface OrgDoc {
    readonly _id: string;
    readonly kind: string;
  }
  const ORGS: Record<string, OrgDoc> = {
    "org:exhibitor-1": { _id: "org:exhibitor-1", kind: "exhibitor" },
    "org:sponsor-1": { _id: "org:sponsor-1", kind: "sponsor" },
  };
  let expoFetchCount = 0;
  let orgFetchCount = 0;
  let roleFetchCount = 0;

  const expoOf = resource({
    id: "exposition",
    fetch: ({ target }) => {
      expoFetchCount += 1;
      return EXPOS[target[0] as string] ?? null;
    },
    dedupKey: ({ target }) => target[0] as string,
  });
  const orgOf = resource({
    id: "org",
    fetch: ({ target }) => {
      orgFetchCount += 1;
      return ORGS[target[1] as string] ?? null;
    },
    dedupKey: ({ target }) => `${target[0]}::${target[1]}`,
  });
  const roleOf = resource({
    id: "role",
    fetch: () => {
      roleFetchCount += 1;
      return null;
    },
    dedupKey: ({ target }) => `${target[0]}::${target[1]}::${target[2]}`,
  });

  const sys = createSystem({
    schema: {
      "expo.orgs.roles.read": permission({
        target: target.path("exposition", "org", "role"),
      }).rules([expoOf.match(), orgOf.match(), roleOf.match()]),
    },
    providers: [
      () => [
        {
          id: "g",
          key: "expo.orgs.roles.read",
          target: ["exposition:*", "org:*", "role:*"],
          with: {
            exposition: { entreprise: "entreprise:beta" },
            org: { kind: "exhibitor" },
          },
        },
      ],
    ],
  });

  // target = [concret, concret, wildcard]
  const r = await sys
    .context({ subject: { id: "user:lucas" } })
    .can("expo.orgs.roles.read", [
      "exposition:beta-owned",
      "org:exhibitor-1",
      "role:*",
    ]);
  assertEquals(r.ok, true);
  assertEquals(expoFetchCount, 1, "expo fetched (seg 0 concrete)");
  assertEquals(orgFetchCount, 1, "org fetched (seg 1 concrete)");
  assertEquals(roleFetchCount, 0, "role NOT fetched (seg 2 wildcard)");
});

test("cap-mode auto-fetch — denies when one resource fails its check", async () => {
  interface OrgDoc {
    readonly _id: string;
    readonly kind: string;
  }
  const ORGS: Record<string, OrgDoc> = {
    "org:sponsor-1": { _id: "org:sponsor-1", kind: "sponsor" },
  };

  const expoOf = resource({
    id: "exposition",
    fetch: ({ target }) => EXPOS[target[0] as string] ?? null,
    dedupKey: ({ target }) => target[0] as string,
  });
  const orgOf = resource({
    id: "org",
    fetch: ({ target }) => ORGS[target[1] as string] ?? null,
    dedupKey: ({ target }) => `${target[0]}::${target[1]}`,
  });

  const sys = createSystem({
    schema: {
      "expo.orgs.read": permission({
        target: target.path("exposition", "org"),
      }).rules([expoOf.match(), orgOf.match()]),
    },
    providers: [
      () => [
        {
          id: "g",
          key: "expo.orgs.read",
          target: ["exposition:*", "org:*"],
          with: {
            exposition: { entreprise: "entreprise:beta" },
            org: { kind: "exhibitor" },
          },
        },
      ],
    ],
  });

  // expo MATCHES (entreprise: beta) but org is sponsor (not exhibitor)
  // → grant denied.
  const r = await sys
    .context({ subject: { id: "user:lucas" } })
    .can("expo.orgs.read", ["exposition:beta-owned", "org:sponsor-1"]);
  assertEquals(r.ok, false);
});

test("cap-mode auto-fetch — resource.id with no matching segment → legacy silent-pass", async () => {
  // Backward-compat check : a resource whose id matches NO segment of
  // the permission's target keeps its legacy cap-mode behaviour
  // (silent-pass + constraint emit).
  let fetchCount = 0;
  const auxOf = resource({
    id: "auxiliary", // ← does NOT match the segment of target.required("user")
    fetch: () => {
      fetchCount += 1;
      return { _id: "stub" };
    },
    dedupKey: () => "stub",
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        auxOf.match(),
      ]),
    },
    providers: [
      () => [
        {
          id: "g",
          key: "users.read",
          target: ["user:*"],
          with: { auxiliary: { role: "admin" } },
        },
      ],
    ],
  });

  // Wildcard target → cap-mode. auxOf.id="auxiliary" doesn't match the
  // segment name "user" → no auto-fetch. The rule silent-passes + emits
  // the spec as constraint (legacy behaviour).
  const r = await sys
    .context({ subject: { id: "user:lucas" } })
    .can("users.read", ["user:*"]);
  assertEquals(r.ok, true);
  assertEquals(
    fetchCount,
    0,
    "no fetch — id matches no segment, legacy preserved",
  );
  if (r.ok) {
    assertEquals(r.constraints, { role: "admin" });
  }
});

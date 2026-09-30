/**
 * Edge cases for the `indirectResource` orchestrator + cap-mode
 * interactions. These tests cover scenarios that the happy-path suite
 * misses and that lead to real-world subtle bugs.
 *
 * Notable cases :
 *  - A grant REJECTED by a rule (e.g. wrong tenant detected via
 *    cap-mode auto-fetch) must NOT contribute to indirect "any-wins"
 *    semantics. Otherwise the indirect filter is silently disabled and
 *    the user sees everything.
 *  - A grant truly "open" (rules all pass, no indirect reference) DOES
 *    trigger any-wins — the legitimate cross-grant OR semantic.
 *  - All grants rejected → CanResult.ok = false (sanity).
 *  - Cap-mode auto-fetch + indirect resource together must cooperate
 *    correctly when a single permission has both.
 *  - Chained indirect resources keep emitting the intermediate `$lookup`
 *    when a sibling grant is rejected.
 */

import { test } from "node:test";
import { assertEquals } from "./+assert.ts";
import {
  createSystem,
  indirectResource,
  permission,
  resource,
  target,
} from "../mod.ts";

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

const participantOf = resource({
  id: "participant",
  // Not auto-fetched in cap mode (segment 1 is wildcard in these tests).
  fetch: () => ({ _id: "stub" }),
  dedupKey: ({ target }) => target.join("::"),
});

const expoOf = resource({
  id: "exposition", // auto-bound to segment 0
  fetch: ({ target }) => EXPOS[target[0] as string] ?? null,
  dedupKey: ({ target }) => target[0] as string,
});

const membershipsOf = indirectResource({
  id: "memberships_of_participant",
  from: participantOf,
  on: { localField: "_id", foreignField: "participantId" },
  to: { _type: "org_membership" },
  cardinality: "many",
});

// ─── Successful-only grants for indirect filter — regression guard

test("edge: grant rejected by cap-mode rule does NOT disable indirect filter", async () => {
  // Two providers emit grants for the same permission. One has a
  // with-clause on an auxiliary resource (exposition) — rejected via
  // cap-mode auto-fetch when the doc doesn't match. The other carries
  // an indirect condition. The indirect filter must remain active —
  // the rejected sibling must not trigger any-wins.
  const sys = createSystem({
    schema: {
      "expo.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([expoOf.match(), participantOf.match(), membershipsOf.match()]),
    },
    providers: [
      () => [
        // Auxiliary-resource grant : wants ALL participants of expos
        // belonging to a specific tenant — rejected when the request's
        // expo doesn't match (cap-mode auto-fetch evaluates the with).
        {
          id: "g-aux-rejected",
          key: "expo.participants.list",
          target: ["exposition:*", "participant:*"],
          with: { exposition: { entreprise: "entreprise:beta" } },
        },
        // Indirect-scoped grant : restrict to participants of a specific
        // organization.
        {
          id: "g-indirect",
          key: "expo.participants.list",
          target: ["exposition:*", "participant:*"],
          with: {
            memberships_of_participant: {
              organizationId: "expo_organization:beta-on-globex-expo",
              status: "active",
            },
          },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("expo.participants.list", [
      "exposition:globex-owned",
      "participant:*",
    ]);

  assertEquals(r.ok, true, "the indirect grant alone is sufficient");
  if (!r.ok || !r.stages) throw new Error("expected stages");

  // The indirect filter must remain in the pipeline. The rejected
  // sibling grant must NOT have triggered any-wins.
  const lastMatch = r.stages[r.stages.length - 1] as
    | {
        $match?: {
          _memberships_of_participant?: {
            $elemMatch?: Record<string, unknown>;
          };
        };
      }
    | undefined;
  assertEquals(
    lastMatch?.$match?._memberships_of_participant?.$elemMatch?.organizationId,
    "expo_organization:beta-on-globex-expo",
  );
  assertEquals(r.matchedGrants, ["g-indirect"]);
});

test("edge: grant truly open (rules all pass, no indirect ref) DOES trigger any-wins", async () => {
  // Inverse scenario : the auxiliary-resource grant PASSES (the expo
  // matches the with-clause) AND has no indirect reference. Legitimate
  // any-wins : a global admin can see everything despite a sibling
  // grant with a narrower indirect scope.
  const sys = createSystem({
    schema: {
      "expo.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([expoOf.match(), participantOf.match(), membershipsOf.match()]),
    },
    providers: [
      () => [
        {
          id: "g-manage-entreprise",
          key: "expo.participants.list",
          target: ["exposition:*", "participant:*"],
          with: { exposition: { entreprise: "entreprise:beta" } },
        },
        {
          id: "g-org-membership",
          key: "expo.participants.list",
          target: ["exposition:*", "participant:*"],
          with: {
            memberships_of_participant: {
              organizationId: "expo_organization:beta",
              status: "active",
            },
          },
        },
      ],
    ],
  });

  const r = await sys.context({ subject: { id: "user:1" } }).can(
    "expo.participants.list",
    ["exposition:beta-owned", "participant:*"], // ← Beta's own expo
  );

  assertEquals(r.ok, true);
  // BOTH grants pass. The entreprise-manage grant doesn't reference
  // the indirect → any-wins kicks in → no indirect filter applied
  // → user sees everything.
  assertEquals("stages" in r, false, "any-wins should disable stages");
  assertEquals(r.ok ? r.matchedGrants?.length : null, 2, "both grants matched");
});

test("edge: all grants rejected → CanResult.ok = false", async () => {
  // Sanity : if every grant fails its rules, the can() returns ok:false.
  const sys = createSystem({
    schema: {
      "expo.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([expoOf.match(), participantOf.match()]),
    },
    providers: [
      () => [
        {
          id: "g-wrong-entreprise",
          key: "expo.participants.list",
          target: ["exposition:*", "participant:*"],
          with: { exposition: { entreprise: "entreprise:beta" } },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("expo.participants.list", [
      "exposition:globex-owned",
      "participant:*",
    ]);

  assertEquals(r.ok, false);
});

test("edge: indirect + auto-fetch in same perm — both work together", async () => {
  // The expo grant has BOTH a with on the auxiliary resource (exposition)
  // AND an indirect ref. The indirect filter should be applied, and the
  // auxiliary check should also be evaluated correctly.
  const sys = createSystem({
    schema: {
      "expo.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([expoOf.match(), participantOf.match(), membershipsOf.match()]),
    },
    providers: [
      () => [
        {
          id: "g-combo",
          key: "expo.participants.list",
          target: ["exposition:*", "participant:*"],
          with: {
            // expo check must pass (Beta owns this expo)
            exposition: { entreprise: "entreprise:beta" },
            // AND filter by indirect
            memberships_of_participant: {
              organizationId: "expo_organization:beta",
              status: "active",
            },
          },
        },
      ],
    ],
  });

  // Beta-owned expo → expoOf.match passes → grant successful.
  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("expo.participants.list", ["exposition:beta-owned", "participant:*"]);

  assertEquals(r.ok, true);
  if (!r.ok || !r.stages) throw new Error("expected stages");

  // The indirect filter is applied (only one grant, with indirect ref).
  const lastMatch = r.stages[r.stages.length - 1] as
    | {
        $match?: {
          _memberships_of_participant?: {
            $elemMatch?: Record<string, unknown>;
          };
        };
      }
    | undefined;
  assertEquals(
    lastMatch?.$match?._memberships_of_participant?.$elemMatch?.organizationId,
    "expo_organization:beta",
  );

  // Same grant on Globex's expo → expoOf rejects → no successful grants
  // → no stages, ok:false.
  const r2 = await sys
    .context({ subject: { id: "user:1" } })
    .can("expo.participants.list", [
      "exposition:globex-owned",
      "participant:*",
    ]);
  assertEquals(r2.ok, false);
});

test("edge: chained indirect — intermediate lookup auto-included even on rejected sibling", async () => {
  // Regression guard : if a chained indirect is referenced by a successful
  // grant, the intermediate $lookup must still be emitted, even when
  // there's a sibling rejected grant that does NOT reference any indirect.
  const userOfParticipant = indirectResource({
    id: "user_of_participant",
    from: participantOf,
    on: {
      localField: "personRef.userId",
      foreignField: "_id",
      foreignCollection: "users",
    },
    cardinality: "one",
  });
  const entrepriseMembersOfUser = indirectResource({
    id: "entreprise_members_of_user",
    from: userOfParticipant,
    on: {
      localField: "_id",
      foreignField: "userId",
      foreignCollection: "entreprise_members",
    },
    cardinality: "many",
  });

  const sys = createSystem({
    schema: {
      "expo.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([
        expoOf.match(),
        userOfParticipant.match(),
        entrepriseMembersOfUser.match(),
      ]),
    },
    providers: [
      () => [
        // Rejected grant : wrong entreprise on a Globex expo.
        {
          id: "g-rejected",
          key: "expo.participants.list",
          target: ["exposition:*", "participant:*"],
          with: { exposition: { entreprise: "entreprise:beta" } },
        },
        // Successful grant : indirect chain.
        {
          id: "g-chained-indirect",
          key: "expo.participants.list",
          target: ["exposition:*", "participant:*"],
          with: {
            entreprise_members_of_user: {
              tenantId: "entreprise:beta",
              status: "active",
            },
          },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("expo.participants.list", [
      "exposition:globex-owned",
      "participant:*",
    ]);

  assertEquals(r.ok, true);
  if (!r.ok || !r.stages) throw new Error("expected stages");
  // Intermediate lookup must be in the pipeline.
  const lookupIds = r.stages
    .filter((s) => "$lookup" in s)
    .map((s) => (s as { $lookup: { as: string } }).$lookup.as);
  assertEquals(lookupIds.includes("_user_of_participant"), true);
  assertEquals(lookupIds.includes("_entreprise_members_of_user"), true);
});

import { test } from "node:test";
import {
  ALL,
  action,
  createSystem,
  entity,
  type Grant,
  list,
  permissions,
} from "../mod.ts";
import { assert, assertEquals } from "./+assert.ts";

type ExpoDoc = { readonly _id: string; readonly entreprise: string };
type Row = Readonly<Record<string, unknown>>;

const EXPOS: Readonly<Record<string, ExpoDoc>> = {
  "exposition:beta-owned": {
    _id: "exposition:beta-owned",
    entreprise: "entreprise:beta",
  },
  "exposition:globex-owned": {
    _id: "exposition:globex-owned",
    entreprise: "entreprise:globex",
  },
};

const MEMBERSHIPS: readonly Row[] = [
  {
    _id: "org_membership:m1",
    _type: "org_membership",
    participantId: "participant:p1",
    organizationId: "expo_organization:beta",
    status: "active",
  },
];

const USERS: readonly Row[] = [{ _id: "user:lucas" }];

const ENTREPRISE_MEMBERS: readonly Row[] = [
  {
    _id: "em:1",
    userId: "user:lucas",
    tenantId: "entreprise:beta",
    status: "active",
  },
];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldOf(doc: unknown, path: string): unknown {
  let current: unknown = doc;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function joined(
  rows: readonly Row[],
  doc: unknown,
  localField: string,
  foreignField: string,
): readonly Row[] {
  const local = fieldOf(doc, localField);
  return rows.filter(
    (row) => local !== undefined && fieldOf(row, foreignField) === local,
  );
}

const exposition = entity("exposition", {
  load: (id): ExpoDoc | null => EXPOS[id] ?? null,
});

const participant = exposition.child("participant", {
  load: () => ({ _id: "stub" }),
  relations: {
    memberships: {
      localField: "_id",
      foreignField: "participantId",
      only: { _type: "org_membership" },
      load: (doc) => joined(MEMBERSHIPS, doc, "_id", "participantId"),
    },
  },
});

const participants = permissions(participant, "expo.participants", {
  read: action({ fields: "doc" }),
  list: list("read"),
});

const MEMBERSHIPS_LOOKUP = {
  $lookup: {
    from: "<self>",
    localField: "_id",
    foreignField: "participantId",
    pipeline: [{ $match: { _type: "org_membership" } }],
    as: "_memberships_of_participant",
  },
};

function contextFor(grants: readonly Grant[]) {
  return createSystem({
    permissions: [participants],
    providers: [() => grants],
  }).context({ subject: { id: "user:1" } });
}

test("edge: grant rejected by a parent condition does NOT disable the relation filter", async () => {
  const ctx = contextFor([
    participants.grant("list", {
      id: "g-aux-rejected",
      on: ALL,
      parents: { exposition: { entreprise: "entreprise:beta" } },
    }),
    participants.grant("list", {
      id: "g-indirect",
      on: ALL,
      related: {
        memberships: {
          organizationId: "expo_organization:beta-on-globex-expo",
          status: "active",
        },
      },
    }),
  ]);

  const scope = await ctx.scope(
    "expo.participants.list",
    "exposition:globex-owned",
  );

  assert(scope.ok, "the related grant alone is sufficient");
  assertEquals(scope.query.filter, {});
  assertEquals(scope.query.stages, [
    MEMBERSHIPS_LOOKUP,
    {
      $match: {
        _memberships_of_participant: {
          $elemMatch: {
            _type: "org_membership",
            organizationId: "expo_organization:beta-on-globex-expo",
            status: "active",
          },
        },
      },
    },
  ]);
  assertEquals(scope.grants, ["g-indirect"]);
});

test("edge: grant truly open (rules all pass, no relation condition) DOES trigger any-wins", async () => {
  const ctx = contextFor([
    participants.grant("list", {
      id: "g-manage-entreprise",
      on: ALL,
      parents: { exposition: { entreprise: "entreprise:beta" } },
    }),
    participants.grant("list", {
      id: "g-org-membership",
      on: ALL,
      related: {
        memberships: {
          organizationId: "expo_organization:beta",
          status: "active",
        },
      },
    }),
  ]);

  const scope = await ctx.scope(
    "expo.participants.list",
    "exposition:beta-owned",
  );

  assert(scope.ok);
  assertEquals(
    scope.query,
    { filter: {}, stages: null },
    "any-wins should disable stages",
  );
  assertEquals(scope.grants.length, 2, "both grants matched");
});

test("edge: all grants rejected gives ok false", async () => {
  const ctx = contextFor([
    participants.grant("list", {
      id: "g-wrong-entreprise",
      on: ALL,
      parents: { exposition: { entreprise: "entreprise:beta" } },
    }),
  ]);

  const scope = await ctx.scope(
    "expo.participants.list",
    "exposition:globex-owned",
  );

  assertEquals(scope.ok, false);
});

test("edge: relation and parent condition in the same grant both work together", async () => {
  const grants = [
    participants.grant("list", {
      id: "g-combo",
      on: ALL,
      parents: { exposition: { entreprise: "entreprise:beta" } },
      related: {
        memberships: {
          organizationId: "expo_organization:beta",
          status: "active",
        },
      },
    }),
  ];

  const scope = await contextFor(grants).scope(
    "expo.participants.list",
    "exposition:beta-owned",
  );

  assert(scope.ok);
  assertEquals(scope.query.filter, {});
  assertEquals(scope.query.stages, [
    MEMBERSHIPS_LOOKUP,
    {
      $match: {
        _memberships_of_participant: {
          $elemMatch: {
            _type: "org_membership",
            organizationId: "expo_organization:beta",
            status: "active",
          },
        },
      },
    },
  ]);

  const other = await contextFor(grants).scope(
    "expo.participants.list",
    "exposition:globex-owned",
  );
  assertEquals(other.ok, false);
});

test("edge: chained relation, the intermediate lookup is emitted even beside a rejected sibling", async () => {
  const chainedParticipant = exposition.child("participant", {
    load: () => ({ _id: "stub" }),
    relations: {
      user: {
        id: "user_of_participant",
        localField: "personRef.userId",
        foreignField: "_id",
        foreignCollection: "users",
        load: (doc) => joined(USERS, doc, "personRef.userId", "_id"),
      },
      entreprise_members: {
        id: "entreprise_members_of_user",
        via: "user",
        localField: "_id",
        foreignField: "userId",
        foreignCollection: "entreprise_members",
        load: (doc) =>
          joined(USERS, doc, "personRef.userId", "_id").flatMap((user) =>
            joined(ENTREPRISE_MEMBERS, user, "_id", "userId"),
          ),
      },
    },
  });
  const chained = permissions(chainedParticipant, "expo.participants", {
    read: action({ fields: "doc" }),
    list: list("read"),
  });

  const scope = await createSystem({
    permissions: [chained],
    providers: [
      () => [
        chained.grant("list", {
          id: "g-rejected",
          on: ALL,
          parents: { exposition: { entreprise: "entreprise:beta" } },
        }),
        chained.grant("list", {
          id: "g-chained-indirect",
          on: ALL,
          related: {
            entreprise_members: {
              tenantId: "entreprise:beta",
              status: "active",
            },
          },
        }),
      ],
    ],
  })
    .context({ subject: { id: "user:1" } })
    .scope("expo.participants.list", "exposition:globex-owned");

  assert(scope.ok);
  assertEquals(scope.grants, ["g-chained-indirect"]);
  assertEquals(scope.query.filter, {});
  assertEquals(scope.query.stages, [
    {
      $lookup: {
        from: "users",
        localField: "personRef.userId",
        foreignField: "_id",
        as: "_user_of_participant",
      },
    },
    {
      $lookup: {
        from: "entreprise_members",
        let: {
          src: { $arrayElemAt: ["$_user_of_participant._id", 0] },
        },
        pipeline: [{ $match: { $expr: { $eq: ["$userId", "$$src"] } } }],
        as: "_entreprise_members_of_user",
      },
    },
    {
      $match: {
        _entreprise_members_of_user: {
          $elemMatch: { tenantId: "entreprise:beta", status: "active" },
        },
      },
    },
  ]);
});

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

type Row = Readonly<Record<string, unknown>>;

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

function elemMatchOf(
  stage: unknown,
  alias: string,
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(stage) || !isRecord(stage.$match)) return undefined;
  const match = stage.$match[alias];
  if (!isRecord(match) || !isRecord(match.$elemMatch)) return undefined;
  return match.$elemMatch;
}

const MEMBERSHIPS: readonly Row[] = [
  {
    _id: "org_membership:m1",
    _type: "org_membership",
    participantId: "participant:p1",
    organizationId: "expo_organization:acme",
    status: "active",
  },
];

const USERS: readonly Row[] = [
  { _id: "user:lucas", entreprise: "entreprise:acme" },
];

const ENTREPRISE_MEMBERS: readonly Row[] = [
  {
    _id: "em:1",
    userId: "user:lucas",
    tenantId: "entreprise:acme",
    status: "active",
  },
];

function participantsWithMemberships() {
  const exposition = entity("exposition", {});
  const participant = exposition.child("participant", {
    load: (_exposition, id) => ({ _id: id }),
    relations: {
      memberships: {
        localField: "_id",
        foreignField: "participantId",
        only: { _type: "org_membership" },
        load: (doc) => joined(MEMBERSHIPS, doc, "_id", "participantId"),
      },
    },
  });
  return permissions(participant, "expositions.participants", {
    read: action({ fields: "doc" }),
    list: list("read"),
  });
}

function participantsWithUser() {
  const exposition = entity("exposition", {});
  const participant = exposition.child("participant", {
    relations: {
      user: {
        localField: "personRef.userId",
        foreignField: "_id",
        foreignCollection: "users",
        load: (doc) => joined(USERS, doc, "personRef.userId", "_id"),
      },
    },
  });
  return permissions(participant, "expositions.participants", {
    read: action({ fields: "doc" }),
    list: list("read"),
  });
}

function participantsWithEntrepriseMembers() {
  const exposition = entity("exposition", {});
  const participant = exposition.child("participant", {
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
  return permissions(participant, "expositions.participants", {
    read: action({ fields: "doc" }),
    list: list("read"),
  });
}

function contextFor(
  set: ReturnType<typeof participantsWithMemberships>,
  grants: readonly Grant[],
) {
  return createSystem({
    permissions: [set],
    providers: [() => grants],
  }).context({ subject: { id: "user:lucas" } });
}

test("relation: case A, self-lookup, single grant", async () => {
  const set = participantsWithMemberships();
  const ctx = contextFor(set, [
    set.grant("list", {
      id: "g-acme",
      on: ["exposition:X", ALL],
      related: {
        memberships: {
          organizationId: "expo_organization:acme",
          status: "active",
        },
      },
    }),
  ]);

  const scope = await ctx.scope(
    "expositions.participants.list",
    "exposition:X",
  );

  assert(scope.ok);
  assertEquals(scope.query.filter, {});
  assertEquals(scope.query.stages, [
    {
      $lookup: {
        from: "<self>",
        localField: "_id",
        foreignField: "participantId",
        pipeline: [{ $match: { _type: "org_membership" } }],
        as: "_memberships_of_participant",
      },
    },
    {
      $match: {
        _memberships_of_participant: {
          $elemMatch: {
            _type: "org_membership",
            organizationId: "expo_organization:acme",
            status: "active",
          },
        },
      },
    },
  ]);
});

test("relation: case A, self-lookup, two grants give a cross-grant $or", async () => {
  const set = participantsWithMemberships();
  const ctx = contextFor(set, [
    set.grant("list", {
      id: "g-acme",
      on: ["exposition:X", ALL],
      related: { memberships: { organizationId: "expo_organization:acme" } },
    }),
    set.grant("list", {
      id: "g-globex",
      on: ["exposition:X", ALL],
      related: { memberships: { organizationId: "expo_organization:globex" } },
    }),
  ]);

  const scope = await ctx.scope(
    "expositions.participants.list",
    "exposition:X",
  );

  assert(scope.ok);
  assertEquals(scope.query.stages, [
    {
      $lookup: {
        from: "<self>",
        localField: "_id",
        foreignField: "participantId",
        pipeline: [{ $match: { _type: "org_membership" } }],
        as: "_memberships_of_participant",
      },
    },
    {
      $match: {
        $or: [
          {
            _memberships_of_participant: {
              $elemMatch: {
                _type: "org_membership",
                organizationId: "expo_organization:acme",
              },
            },
          },
          {
            _memberships_of_participant: {
              $elemMatch: {
                _type: "org_membership",
                organizationId: "expo_organization:globex",
              },
            },
          },
        ],
      },
    },
  ]);
});

test("relation: case D, cross-collection lookup (foreignCollection)", async () => {
  const set = participantsWithUser();
  const ctx = createSystem({
    permissions: [set],
    providers: [
      () => [
        set.grant("list", {
          id: "g",
          on: ["exposition:X", ALL],
          related: { user: { entreprise: "entreprise:acme" } },
        }),
      ],
    ],
  }).context({ subject: { id: "user:lucas" } });

  const scope = await ctx.scope(
    "expositions.participants.list",
    "exposition:X",
  );

  assert(scope.ok);
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
      $match: {
        _user_of_participant: {
          $elemMatch: { entreprise: "entreprise:acme" },
        },
      },
    },
  ]);
});

test("relation: case B, two-level chain joins the intermediate relation first", async () => {
  const set = participantsWithEntrepriseMembers();
  const ctx = createSystem({
    permissions: [set],
    providers: [
      () => [
        set.grant("list", {
          id: "g",
          on: ["exposition:X", ALL],
          related: {
            entreprise_members: {
              tenantId: "entreprise:acme",
              status: "active",
            },
          },
        }),
      ],
    ],
  }).context({ subject: { id: "user:lucas" } });

  const scope = await ctx.scope(
    "expositions.participants.list",
    "exposition:X",
  );

  assert(scope.ok);
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
        pipeline: [
          {
            $match: { $expr: { $eq: ["$userId", "$$src"] } },
          },
        ],
        as: "_entreprise_members_of_user",
      },
    },
    {
      $match: {
        _entreprise_members_of_user: {
          $elemMatch: { tenantId: "entreprise:acme", status: "active" },
        },
      },
    },
  ]);
});

test("relation: no relation used gives a plain filter and no stages", async () => {
  const user = entity("user", {
    load: (id) => ({ _id: id, role: "admin" }),
  });
  const users = permissions(user, "users", {
    read: action({ fields: "doc" }),
    list: list("read"),
  });
  const ctx = createSystem({
    permissions: [users],
    providers: [
      () => [
        users.grant("list", { id: "g", on: ALL, where: { role: "admin" } }),
      ],
    ],
  }).context({ subject: { id: "s" } });

  assertEquals((await ctx.check("users.read", "user:lucas")).ok, true);
  const scope = await ctx.scope("users.list");
  assert(scope.ok);
  assertEquals(scope.query, { filter: { role: "admin" }, stages: null });
});

test("relation: declared but referenced by no grant gives no stages", async () => {
  const set = participantsWithMemberships();
  const ctx = contextFor(set, [
    set.grant("list", { id: "g-open", on: ["exposition:X", ALL] }),
  ]);

  const scope = await ctx.scope(
    "expositions.participants.list",
    "exposition:X",
  );

  assert(scope.ok);
  assertEquals(scope.query, { filter: {}, stages: null });
});

test("relation: any-wins, an open grant beside a related grant gives no stages", async () => {
  const set = participantsWithMemberships();
  const ctx = contextFor(set, [
    set.grant("list", {
      id: "g-member",
      on: ["exposition:X", ALL],
      related: { memberships: { organizationId: "expo_organization:acme" } },
    }),
    set.grant("list", { id: "g-admin", on: ["exposition:X", ALL] }),
  ]);

  const scope = await ctx.scope(
    "expositions.participants.list",
    "exposition:X",
  );

  assert(scope.ok);
  assertEquals(scope.query, { filter: {}, stages: null });
});

test("relation: the declared static part is forced into the $elemMatch even when the grant omits it", async () => {
  const set = participantsWithMemberships();
  const ctx = contextFor(set, [
    set.grant("list", {
      id: "g",
      on: ["exposition:X", ALL],
      related: { memberships: { organizationId: "expo_organization:acme" } },
    }),
  ]);

  const scope = await ctx.scope(
    "expositions.participants.list",
    "exposition:X",
  );

  assert(scope.ok);
  assertEquals(
    elemMatchOf(scope.query.stages?.at(-1), "_memberships_of_participant")
      ?._type,
    "org_membership",
  );
});

test("relation: a wildcard parent is refused by scope", async () => {
  const set = participantsWithMemberships();
  const ctx = contextFor(set, [
    set.grant("list", { id: "g-open", on: ["exposition:X", ALL] }),
  ]);

  const scope = await ctx.scope(
    "expositions.participants.list",
    "exposition:*",
  );

  assertEquals(scope.ok, false);
});

test("relation: a relation condition decides a concrete check from the loaded rows", async () => {
  const set = participantsWithMemberships();
  const ctx = contextFor(set, [
    set.grant("read", {
      id: "g-acme",
      on: ["exposition:X", ALL],
      related: { memberships: { organizationId: "expo_organization:acme" } },
    }),
  ]);

  const member = await ctx.check(
    "expositions.participants.read",
    "exposition:X",
    "participant:p1",
  );
  assertEquals(member.ok, true);

  const stranger = await ctx.check(
    "expositions.participants.read",
    "exposition:X",
    "participant:p2",
  );
  assertEquals(stranger.ok, false);
  if (!stranger.ok) {
    assert(
      stranger.reasons.some((reason) =>
        reason.includes(
          "related[memberships_of_participant] no joined row matches",
        ),
      ),
      stranger.reasons.join("\n"),
    );
  }
});

import process from "node:process";
import { test } from "node:test";
import { type Collection, type Document, MongoClient } from "mongodb";
import {
  ALL,
  action,
  createSystem,
  entity,
  type Grant,
  type GrantRejection,
  list,
  type MongoStage,
  permissions,
} from "../mod.ts";
import { assert, assertEquals, assertThrows } from "./+assert.ts";

const MONGO_URL =
  process.env.MONGO_URL ?? "mongodb://localhost:27017/?directConnection=true";
const DB_NAME = "qp_e2e_indirect_resource";

type Row = { readonly _id: string; readonly [field: string]: unknown };

type TestEnv = {
  readonly client: MongoClient;
  readonly collName: string;
};

async function withMongo(run: (env: TestEnv) => Promise<void>): Promise<void> {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const collName = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await run({ client, collName });
  } finally {
    try {
      await client.db(DB_NAME).dropCollection(collName);
    } catch {}
    await client.close();
  }
}

async function dropQuietly(client: MongoClient, name: string): Promise<void> {
  try {
    await client.db(DB_NAME).dropCollection(name);
  } catch {}
}

function collectionOf(client: MongoClient, name: string): Collection<Row> {
  return client.db(DB_NAME).collection<Row>(name);
}

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

function substituteSelf(value: unknown, collName: string): unknown {
  if (value === "<self>") return collName;
  if (Array.isArray(value)) {
    return value.map((item) => substituteSelf(item, collName));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        substituteSelf(item, collName),
      ]),
    );
  }
  return value;
}

async function runPipeline(
  client: MongoClient,
  collName: string,
  stages: readonly MongoStage[],
): Promise<string[]> {
  const resolved: Document[] = [
    { $match: { _type: "participant" } },
    ...stages.map((stage) =>
      Object.fromEntries(
        Object.entries(stage).map(([key, value]) => [
          key,
          substituteSelf(value, collName),
        ]),
      ),
    ),
  ];
  const docs = await collectionOf(client, collName)
    .aggregate<Row>(resolved)
    .toArray();
  return docs.map((doc) => doc._id).sort();
}

function membershipsSet(coll?: Collection<Row>) {
  const exposition = entity("exposition", {});
  const participant = exposition.child("participant", {
    load: async (_exposition, id) =>
      coll ? await coll.findOne({ _id: id }) : null,
    relations: {
      memberships: {
        localField: "_id",
        foreignField: "participantId",
        only: { _type: "org_membership" },
        load: async (doc) =>
          coll
            ? await coll
                .find({ _type: "org_membership", participantId: doc._id })
                .toArray()
            : [],
      },
    },
  });
  return permissions(participant, "participants", {
    read: action({ fields: "doc" }),
    list: list("read"),
  });
}

function scopeOf(
  set: ReturnType<typeof membershipsSet>,
  grants: readonly Grant[],
) {
  return createSystem({ permissions: [set], providers: [() => grants] })
    .context({ subject: { id: "user:lucas" } })
    .scope("participants.list", "exposition:X");
}

test("e2e case A: self-lookup returns the participants that are members of Acme", async () => {
  await withMongo(async ({ client, collName }) => {
    const coll = collectionOf(client, collName);
    await coll.insertMany([
      { _id: "participant:p1", _type: "participant", name: "Alice" },
      { _id: "participant:p2", _type: "participant", name: "Bob" },
      { _id: "participant:p3", _type: "participant", name: "Carol" },
      {
        _id: "org_membership:m1",
        _type: "org_membership",
        participantId: "participant:p1",
        organizationId: "expo_organization:acme",
        status: "active",
      },
      {
        _id: "org_membership:m2",
        _type: "org_membership",
        participantId: "participant:p2",
        organizationId: "expo_organization:globex",
        status: "active",
      },
      {
        _id: "org_membership:m3",
        _type: "org_membership",
        participantId: "participant:p3",
        organizationId: "expo_organization:acme",
        status: "removed",
      },
    ]);

    const set = membershipsSet(coll);
    const scope = await scopeOf(set, [
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

    assert(scope.ok);
    assert(scope.query.stages, "expected stages");
    const ids = await runPipeline(client, collName, scope.query.stages);
    assertEquals(ids, ["participant:p1"]);
  });
});

test("e2e case A: cross-grant fusion (two organisations) returns the participants of both", async () => {
  await withMongo(async ({ client, collName }) => {
    const coll = collectionOf(client, collName);
    await coll.insertMany([
      { _id: "participant:p1", _type: "participant" },
      { _id: "participant:p2", _type: "participant" },
      { _id: "participant:p3", _type: "participant" },
      { _id: "participant:p4", _type: "participant" },
      {
        _id: "om:m1",
        _type: "org_membership",
        participantId: "participant:p1",
        organizationId: "expo_organization:acme",
        status: "active",
      },
      {
        _id: "om:m2",
        _type: "org_membership",
        participantId: "participant:p2",
        organizationId: "expo_organization:globex",
        status: "active",
      },
      {
        _id: "om:m3",
        _type: "org_membership",
        participantId: "participant:p3",
        organizationId: "expo_organization:acme",
        status: "active",
      },
      {
        _id: "om:m4",
        _type: "org_membership",
        participantId: "participant:p4",
        organizationId: "expo_organization:initech",
        status: "active",
      },
    ]);

    const set = membershipsSet(coll);
    const scope = await scopeOf(set, [
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
      set.grant("list", {
        id: "g-globex",
        on: ["exposition:X", ALL],
        related: {
          memberships: {
            organizationId: "expo_organization:globex",
            status: "active",
          },
        },
      }),
    ]);

    assert(scope.ok);
    assert(scope.query.stages, "expected stages");
    const ids = await runPipeline(client, collName, scope.query.stages);
    assertEquals(ids, ["participant:p1", "participant:p2", "participant:p3"]);
  });
});

test("e2e case D: cross-collection lookup into a global users collection", async () => {
  await withMongo(async ({ client, collName }) => {
    const usersColl = `${collName}_users`;
    try {
      const coll = collectionOf(client, collName);
      const users = collectionOf(client, usersColl);
      await coll.insertMany([
        {
          _id: "participant:p1",
          _type: "participant",
          personRef: { userId: "user:lucas" },
        },
        {
          _id: "participant:p2",
          _type: "participant",
          personRef: { userId: "user:bob" },
        },
        {
          _id: "participant:p3",
          _type: "participant",
          personRef: { userId: "user:carol" },
        },
      ]);
      await users.insertMany([
        { _id: "user:lucas", entreprise: "entreprise:acme" },
        { _id: "user:bob", entreprise: "entreprise:globex" },
        { _id: "user:carol", entreprise: "entreprise:acme" },
      ]);

      const exposition = entity("exposition", {});
      const participant = exposition.child("participant", {
        load: (_exposition, id) => coll.findOne({ _id: id }),
        relations: {
          user: {
            localField: "personRef.userId",
            foreignField: "_id",
            foreignCollection: usersColl,
            load: (doc) =>
              users
                .find({ _id: String(fieldOf(doc, "personRef.userId")) })
                .toArray(),
          },
        },
      });
      const set = permissions(participant, "participants", {
        read: action({ fields: "doc" }),
        list: list("read"),
      });
      const scope = await createSystem({
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
      })
        .context({ subject: { id: "user:lucas" } })
        .scope("participants.list", "exposition:X");

      assert(scope.ok);
      assert(scope.query.stages, "expected stages");
      const ids = await runPipeline(client, collName, scope.query.stages);
      assertEquals(ids, ["participant:p1", "participant:p3"]);
    } finally {
      await dropQuietly(client, usersColl);
    }
  });
});

test("e2e case B: chain participant -> user -> entreprise_member", async () => {
  await withMongo(async ({ client, collName }) => {
    const usersColl = `${collName}_users`;
    const membersColl = `${collName}_members`;
    try {
      const coll = collectionOf(client, collName);
      const users = collectionOf(client, usersColl);
      const members = collectionOf(client, membersColl);
      await coll.insertMany([
        {
          _id: "participant:p1",
          _type: "participant",
          personRef: { userId: "user:lucas" },
        },
        {
          _id: "participant:p2",
          _type: "participant",
          personRef: { userId: "user:bob" },
        },
        {
          _id: "participant:p3",
          _type: "participant",
          personRef: { userId: "user:carol" },
        },
      ]);
      await users.insertMany([
        { _id: "user:lucas" },
        { _id: "user:bob" },
        { _id: "user:carol" },
      ]);
      await members.insertMany([
        {
          _id: "em:1",
          userId: "user:lucas",
          tenantId: "entreprise:acme",
          status: "active",
        },
        {
          _id: "em:2",
          userId: "user:carol",
          tenantId: "entreprise:acme",
          status: "active",
        },
        {
          _id: "em:3",
          userId: "user:bob",
          tenantId: "entreprise:globex",
          status: "active",
        },
        {
          _id: "em:4",
          userId: "user:carol",
          tenantId: "entreprise:acme",
          status: "removed",
        },
      ]);

      const userOf = (doc: unknown) =>
        users.find({ _id: String(fieldOf(doc, "personRef.userId")) }).toArray();
      const exposition = entity("exposition", {});
      const participant = exposition.child("participant", {
        load: (_exposition, id) => coll.findOne({ _id: id }),
        relations: {
          user: {
            id: "user_of_participant",
            localField: "personRef.userId",
            foreignField: "_id",
            foreignCollection: usersColl,
            load: userOf,
          },
          entreprise_members: {
            id: "entreprise_members_of_user",
            via: "user",
            localField: "_id",
            foreignField: "userId",
            foreignCollection: membersColl,
            load: async (doc) => {
              const ids = (await userOf(doc)).map((user) => user._id);
              return members.find({ userId: { $in: ids } }).toArray();
            },
          },
        },
      });
      const set = permissions(participant, "participants", {
        read: action({ fields: "doc" }),
        list: list("read"),
      });
      const scope = await createSystem({
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
      })
        .context({ subject: { id: "user:lucas" } })
        .scope("participants.list", "exposition:X");

      assert(scope.ok);
      assertEquals(scope.query.stages, [
        {
          $lookup: {
            from: usersColl,
            localField: "personRef.userId",
            foreignField: "_id",
            as: "_user_of_participant",
          },
        },
        {
          $lookup: {
            from: membersColl,
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
              $elemMatch: { tenantId: "entreprise:acme", status: "active" },
            },
          },
        },
      ]);
      assert(scope.query.stages, "expected stages");
      const ids = await runPipeline(client, collName, scope.query.stages);
      assertEquals(ids, ["participant:p1", "participant:p3"]);
    } finally {
      await dropQuietly(client, usersColl);
      await dropQuietly(client, membersColl);
    }
  });
});

test("e2e exact list filter: an entity condition of one grant and a relation condition of another do not combine", async () => {
  await withMongo(async ({ client, collName }) => {
    const coll = collectionOf(client, collName);
    const participant = (id: string, tier: string): Row => ({
      _id: `participant:${id}`,
      _type: "participant",
      tier,
    });
    const membership = (id: string, organization: string): Row => ({
      _id: `om:${id}`,
      _type: "org_membership",
      participantId: `participant:${id}`,
      organizationId: `expo_organization:${organization}`,
    });
    await coll.insertMany([
      participant("gold-acme", "gold"),
      participant("silver-globex", "silver"),
      participant("gold-globex", "gold"),
      participant("silver-acme", "silver"),
      participant("bronze-acme", "bronze"),
      membership("gold-acme", "acme"),
      membership("silver-globex", "globex"),
      membership("gold-globex", "globex"),
      membership("silver-acme", "acme"),
      membership("bronze-acme", "acme"),
    ]);

    const set = membershipsSet(coll);
    const scope = await scopeOf(set, [
      set.grant("list", {
        id: "g-a",
        on: ["exposition:X", ALL],
        where: { tier: "gold" },
        related: { memberships: { organizationId: "expo_organization:acme" } },
      }),
      set.grant("list", {
        id: "g-b",
        on: ["exposition:X", ALL],
        where: { tier: "silver" },
        related: {
          memberships: { organizationId: "expo_organization:globex" },
        },
      }),
    ]);

    assert(scope.ok);
    assertEquals(scope.query.filter, {
      $or: [{ tier: "gold" }, { tier: "silver" }],
    });
    assertEquals(scope.query.stages, [
      { $match: { $or: [{ tier: "gold" }, { tier: "silver" }] } },
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
              $and: [
                { tier: "gold" },
                {
                  _memberships_of_participant: {
                    $elemMatch: {
                      _type: "org_membership",
                      organizationId: "expo_organization:acme",
                    },
                  },
                },
              ],
            },
            {
              $and: [
                { tier: "silver" },
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
          ],
        },
      },
    ]);
    assert(scope.query.stages, "expected stages");
    const ids = await runPipeline(client, collName, scope.query.stages);
    assertEquals(ids, ["participant:gold-acme", "participant:silver-globex"]);

    const everyone = await coll.find({ _type: "participant" }).toArray();
    const projected = await scope.projectAll(everyone);
    assertEquals(projected.map((doc) => doc._id).sort(), [
      "participant:gold-acme",
      "participant:silver-globex",
    ]);
  });
});

test("e2e security: a grant that pushes $where into a relation condition is rejected", async () => {
  const rejections: GrantRejection[] = [];
  const set = membershipsSet();
  assertThrows(
    () =>
      set.grant("list", {
        id: "g-evil",
        on: ["exposition:X", ALL],
        related: { memberships: { $where: "function() { return true; }" } },
      }),
    Error,
    "$where",
  );
  const stored: Grant = {
    id: "g-evil",
    key: "participants.list",
    on: ["exposition:X", "participant:*"],
    related: { memberships: { $where: "function() { return true; }" } },
  };
  const scope = await createSystem({
    permissions: [set],
    providers: [() => [stored]],
    hooks: { onGrantRejected: (event) => rejections.push(event) },
  })
    .context({ subject: { id: "user:lucas" } })
    .scope("participants.list", "exposition:X");

  assertEquals(scope.ok, false);
  assert(!scope.ok);
  assertEquals("query" in scope, false);
  assert(scope.reasons.includes("no matching grant"), scope.reasons.join("\n"));
  assertEquals(
    rejections.map((rejection) => rejection.grant.id),
    ["g-evil"],
  );
  assert(
    rejections.every((rejection) => rejection.reason.includes("$where")),
    rejections.map((rejection) => rejection.reason).join("\n"),
  );
});

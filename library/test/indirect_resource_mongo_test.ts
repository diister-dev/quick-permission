/**
 * Tests e2e — exécution réelle des pipelines générés par `indirectResource`
 * contre une instance MongoDB locale.
 *
 * Ces tests valident que :
 *  1. Les `$lookup` + `$match` produits par `buildAggregationStages`
 *     sont syntaxiquement valides côté Mongo
 *  2. Les opérateurs `$let` + `$expr` + `$arrayElemAt` du cas chaîné
 *     s'évaluent correctement
 *  3. Le filtrage en DB ramène bien le set attendu
 *
 * Setup : Mongo local, base éphémère par test (cleanup en tear-down).
 * Requiert un Mongo running sur localhost:27017.
 */

import { test } from "node:test";
import process from "node:process";
import { assertEquals, assertRejects } from "./+assert.ts";
import { MongoClient } from "mongodb";
import {
  createSystem,
  indirectResource,
  permission,
  resource,
  target,
} from "../mod.ts";

const MONGO_URL =
  process.env.MONGO_URL ?? "mongodb://localhost:27017/?directConnection=true";
const DB_NAME = "qp_e2e_indirect_resource";

// ─── Helpers ──────────────────────────────────────────────────────────

interface TestEnv {
  client: MongoClient;
  collName: string; // collection courante (auto-générée par test)
  cleanup: () => Promise<void>;
}

async function withMongo(test: (env: TestEnv) => Promise<void>): Promise<void> {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const collName = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cleanup = async () => {
    try {
      await client.db(DB_NAME).dropCollection(collName);
    } catch {
      // ignore — collection might already be gone
    }
    await client.close();
  };
  try {
    await test({ client, collName, cleanup });
  } finally {
    await cleanup();
  }
}

/**
 * Exécute le pipeline généré par la lib, en substituant le placeholder
 * `<self>` (utilisé pour les self-lookups) par le nom de la collection.
 */
async function runPipeline(
  client: MongoClient,
  collName: string,
  stages: readonly Record<string, unknown>[],
): Promise<unknown[]> {
  // Substitute <self> placeholder for self-lookups.
  const resolved = stages.map((s) => substituteSelf(s, collName));
  return await client
    .db(DB_NAME)
    .collection(collName)
    .aggregate(resolved as never[])
    .toArray();
}

function substituteSelf(value: unknown, collName: string): unknown {
  if (value === "<self>") return collName;
  if (Array.isArray(value))
    return value.map((v) => substituteSelf(v, collName));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = substituteSelf(v, collName);
    return out;
  }
  return value;
}

// Shared participantOf — fetch never called in capability mode (target wildcard).
const participantOf = resource({
  id: "participant",
  fetch: () => ({ _id: "stub" }),
  dedupKey: ({ target }) => target.join("::"),
});

// ─── Cas A — self-lookup org_membership ───────────────────────────────

test("e2e cas A — self-lookup ramène les participants membres de l'org Acme", async () => {
  await withMongo(async ({ client, collName }) => {
    const coll = client.db(DB_NAME).collection(collName);

    // Seed: 3 participants + leurs memberships (some in Acme, some not).
    await coll.insertMany([
      { _id: "participant:p1", _type: "participant", name: "Alice" },
      { _id: "participant:p2", _type: "participant", name: "Bob" },
      { _id: "participant:p3", _type: "participant", name: "Carol" },
      // p1 → Acme
      {
        _id: "org_membership:m1",
        _type: "org_membership",
        participantId: "participant:p1",
        organizationId: "expo_organization:acme",
        status: "active",
      },
      // p2 → Globex (pas Acme)
      {
        _id: "org_membership:m2",
        _type: "org_membership",
        participantId: "participant:p2",
        organizationId: "expo_organization:globex",
        status: "active",
      },
      // p3 → Acme mais membership REMOVED
      {
        _id: "org_membership:m3",
        _type: "org_membership",
        participantId: "participant:p3",
        organizationId: "expo_organization:acme",
        status: "removed",
      },
    ] as never[]);

    const membershipsOf = indirectResource({
      id: "memberships_of_participant",
      from: participantOf,
      on: { localField: "_id", foreignField: "participantId" },
      to: { _type: "org_membership" },
      cardinality: "many",
    });

    const sys = createSystem({
      schema: {
        "participants.list": permission({
          target: target.path("exposition", "participant"),
        }).rules([membershipsOf.match()]),
      },
      providers: [
        () => [
          {
            id: "g-acme",
            key: "participants.list",
            target: ["exposition:X", "participant:*"],
            with: {
              memberships_of_participant: {
                organizationId: "expo_organization:acme",
                status: "active",
              },
            },
          },
        ],
      ],
    });

    const r = await sys
      .context({ subject: { id: "user:lucas" } })
      .can("participants.list", ["exposition:X", "participant:*"]);

    assertEquals(r.ok, true);
    if (!r.ok || !r.stages) throw new Error("expected stages");

    // Le baseFilter est vide {} → on précise via un $match initial qu'on
    // ne veut que les `participant` (sinon l'agg lit aussi les memberships).
    const stagesScoped = [
      { $match: { _type: "participant" } },
      ...r.stages.slice(1), // skip the empty $match emitted by the lib
    ];

    const docs = await runPipeline(client, collName, stagesScoped);

    // Seul p1 doit être ramené : membre actif d'Acme.
    assertEquals(docs.length, 1);
    assertEquals((docs[0] as { _id: string })._id, "participant:p1");
  });
});

test("e2e cas A — cross-grant fusion (deux orgs) ramène les participants des deux", async () => {
  await withMongo(async ({ client, collName }) => {
    const coll = client.db(DB_NAME).collection(collName);

    await coll.insertMany([
      { _id: "participant:p1", _type: "participant" },
      { _id: "participant:p2", _type: "participant" },
      { _id: "participant:p3", _type: "participant" },
      { _id: "participant:p4", _type: "participant" },
      // p1, p3 → Acme ; p2 → Globex ; p4 → Initech (hors scope)
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
    ] as never[]);

    const membershipsOf = indirectResource({
      id: "memberships_of_participant",
      from: participantOf,
      on: { localField: "_id", foreignField: "participantId" },
      to: { _type: "org_membership" },
      cardinality: "many",
    });

    const sys = createSystem({
      schema: {
        "participants.list": permission({
          target: target.path("exposition", "participant"),
        }).rules([membershipsOf.match()]),
      },
      providers: [
        () => [
          {
            id: "g-acme",
            key: "participants.list",
            target: ["exposition:X", "participant:*"],
            with: {
              memberships_of_participant: {
                organizationId: "expo_organization:acme",
                status: "active",
              },
            },
          },
          {
            id: "g-globex",
            key: "participants.list",
            target: ["exposition:X", "participant:*"],
            with: {
              memberships_of_participant: {
                organizationId: "expo_organization:globex",
                status: "active",
              },
            },
          },
        ],
      ],
    });

    const r = await sys
      .context({ subject: { id: "user:lucas" } })
      .can("participants.list", ["exposition:X", "participant:*"]);
    if (!r.ok || !r.stages) throw new Error("expected stages");

    const stagesScoped = [
      { $match: { _type: "participant" } },
      ...r.stages.slice(1),
    ];
    const docs = await runPipeline(client, collName, stagesScoped);

    // p1, p2, p3 (Acme + Globex actifs) ; p4 exclu (Initech).
    const ids = docs.map((d) => (d as { _id: string })._id).sort();
    assertEquals(ids, ["participant:p1", "participant:p2", "participant:p3"]);
  });
});

// ─── Cas D — cross-collection ─────────────────────────────────────────

test("e2e cas D — cross-collection lookup vers `users` global", async () => {
  await withMongo(async ({ client, collName }) => {
    const usersColl = `${collName}_users`;
    const participantsColl = collName;

    try {
      await client
        .db(DB_NAME)
        .collection(participantsColl)
        .insertMany([
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
        ] as never[]);
      await client
        .db(DB_NAME)
        .collection(usersColl)
        .insertMany([
          { _id: "user:lucas", entreprise: "entreprise:acme" },
          { _id: "user:bob", entreprise: "entreprise:globex" },
          { _id: "user:carol", entreprise: "entreprise:acme" },
        ] as never[]);

      const userOfParticipant = indirectResource({
        id: "user_of_participant",
        from: participantOf,
        on: {
          localField: "personRef.userId",
          foreignField: "_id",
          foreignCollection: usersColl,
        },
        cardinality: "one",
      });

      const sys = createSystem({
        schema: {
          "participants.list": permission({
            target: target.path("exposition", "participant"),
          }).rules([userOfParticipant.match()]),
        },
        providers: [
          () => [
            {
              id: "g",
              key: "participants.list",
              target: ["exposition:X", "participant:*"],
              with: { user_of_participant: { entreprise: "entreprise:acme" } },
            },
          ],
        ],
      });

      const r = await sys
        .context({ subject: { id: "user:lucas" } })
        .can("participants.list", ["exposition:X", "participant:*"]);
      if (!r.ok || !r.stages) throw new Error("expected stages");

      const stagesScoped = [
        { $match: { _type: "participant" } },
        ...r.stages.slice(1),
      ];
      const docs = await runPipeline(client, participantsColl, stagesScoped);

      const ids = docs.map((d) => (d as { _id: string })._id).sort();
      // p1 (Lucas, Acme) + p3 (Carol, Acme) ; p2 (Bob, Globex) exclu.
      assertEquals(ids, ["participant:p1", "participant:p3"]);
    } finally {
      try {
        await client.db(DB_NAME).dropCollection(usersColl);
      } catch {
        /* noop */
      }
    }
  });
});

// ─── Cas B — chaîne 2 niveaux ─────────────────────────────────────────

test("e2e cas B — chaîne participant → user → entreprise_member", async () => {
  await withMongo(async ({ client, collName }) => {
    const usersColl = `${collName}_users`;
    const membersColl = `${collName}_members`;

    try {
      await client
        .db(DB_NAME)
        .collection(collName)
        .insertMany([
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
        ] as never[]);
      await client
        .db(DB_NAME)
        .collection(usersColl)
        .insertMany([
          { _id: "user:lucas" },
          { _id: "user:bob" },
          { _id: "user:carol" },
        ] as never[]);
      await client
        .db(DB_NAME)
        .collection(membersColl)
        .insertMany([
          // Lucas → Acme (active)
          {
            _id: "em:1",
            userId: "user:lucas",
            tenantId: "entreprise:acme",
            status: "active",
          },
          // Carol → Acme (active aussi)
          {
            _id: "em:2",
            userId: "user:carol",
            tenantId: "entreprise:acme",
            status: "active",
          },
          // Bob → Globex (active, donc hors scope Acme)
          {
            _id: "em:3",
            userId: "user:bob",
            tenantId: "entreprise:globex",
            status: "active",
          },
          // Carol → Acme mais removed (doublon avec em:2)
          {
            _id: "em:4",
            userId: "user:carol",
            tenantId: "entreprise:acme",
            status: "removed",
          },
        ] as never[]);

      const userOfParticipant = indirectResource({
        id: "user_of_participant",
        from: participantOf,
        on: {
          localField: "personRef.userId",
          foreignField: "_id",
          foreignCollection: usersColl,
        },
        cardinality: "one",
      });
      const entrepriseMembersOfUser = indirectResource({
        id: "entreprise_members_of_user",
        from: userOfParticipant,
        on: {
          localField: "_id",
          foreignField: "userId",
          foreignCollection: membersColl,
        },
        cardinality: "many",
      });

      const sys = createSystem({
        schema: {
          "participants.list": permission({
            target: target.path("exposition", "participant"),
          }).rules([
            userOfParticipant.match(),
            entrepriseMembersOfUser.match(),
          ]),
        },
        providers: [
          () => [
            {
              id: "g",
              key: "participants.list",
              target: ["exposition:X", "participant:*"],
              with: {
                entreprise_members_of_user: {
                  tenantId: "entreprise:acme",
                  status: "active",
                },
              },
            },
          ],
        ],
      });

      const r = await sys
        .context({ subject: { id: "user:lucas" } })
        .can("participants.list", ["exposition:X", "participant:*"]);
      if (!r.ok || !r.stages) throw new Error("expected stages");

      const stagesScoped = [
        { $match: { _type: "participant" } },
        ...r.stages.slice(1),
      ];
      const docs = await runPipeline(client, collName, stagesScoped);

      // p1 (Lucas → Acme actif) + p3 (Carol → Acme actif) ; p2 (Bob → Globex) exclu.
      const ids = docs.map((d) => (d as { _id: string })._id).sort();
      assertEquals(ids, ["participant:p1", "participant:p3"]);
    } finally {
      for (const c of [usersColl, membersColl]) {
        try {
          await client.db(DB_NAME).dropCollection(c);
        } catch {
          /* noop */
        }
      }
    }
  });
});

// ─── Sécurité — validateSpec sur les specs indirect ───────────────────

test("e2e sécurité — un grant qui pousse $where dans le with indirect est rejeté", async () => {
  const membershipsOf = indirectResource({
    id: "memberships_of_participant",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    to: { _type: "org_membership" },
    cardinality: "many",
  });

  const sys = createSystem({
    schema: {
      "participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([membershipsOf.match()]),
    },
    providers: [
      () => [
        {
          id: "g-evil",
          key: "participants.list",
          target: ["exposition:X", "participant:*"],
          // $where = arbitrary JS execution server-side. MUST be rejected.
          with: {
            memberships_of_participant: {
              $where: "function() { return true; }",
            },
          },
        },
      ],
    ],
  });

  await assertRejects(
    () =>
      sys
        .context({ subject: { id: "user:lucas" } })
        .can("participants.list", ["exposition:X", "participant:*"]),
    Error,
    "$where",
  );
});

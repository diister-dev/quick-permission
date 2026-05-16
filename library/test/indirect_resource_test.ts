/**
 * Tests pour le concept `indirectResource` — génération de pipeline
 * d'aggregation MongoDB pour les contraintes basées sur des jointures.
 *
 * Couverture :
 *   - Cas A : self-lookup one-to-many (org_membership)
 *   - Cas D : cross-collection (participant → users globaux)
 *   - Cas B : chaîne 2 niveaux (participant → user → entreprise_member)
 *   - Cross-grant fusion : 2 grants sur la même indirect resource → $or
 *   - Backward compat : aucun indirect → pas de `stages` dans CanResult
 *   - Pas de grant matché → pas d'évaluation des indirects
 *   - Sécurité : `to._type` injecté même si le grant l'oublie
 */

import { assertEquals } from "jsr:@std/assert";
import {
  createSystem,
  indirectResource,
  permission,
  resource,
  target,
} from "../mod.ts";

// ─── Setup : ressources partagées ─────────────────────────────────────

const participantOf = resource({
  id: "participant",
  // Fetch jamais appelé en mode capability (wildcard target) — il est
  // safe de retourner une stub car les tests ci-dessous font tous des
  // checks en cap-mode.
  fetch: () => ({ _id: "stub" }),
  dedupKey: ({ target }) => target.join("::"),
});

// ─── Cas A — self-lookup org_membership ───────────────────────────────

Deno.test("indirect: cas A — self-lookup, single grant", async () => {
  const membershipsOf = indirectResource({
    id: "memberships_of_participant",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    to: { _type: "org_membership" },
    cardinality: "many",
  });

  const sys = createSystem({
    schema: {
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([
        membershipsOf.match(),
      ]),
    },
    providers: [() => [
      {
        id: "g-acme",
        key: "expositions.participants.list",
        target: ["exposition:X", "participant:*"],
        with: {
          memberships_of_participant: {
            organizationId: "expo_organization:acme",
            status: "active",
          },
        },
      },
    ]],
  });

  const r = await sys.context({ subject: { id: "user:lucas" } }).can(
    "expositions.participants.list",
    ["exposition:X", "participant:*"],
  );

  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.stages, [
    { $match: {} },
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

Deno.test("indirect: cas A — self-lookup, deux grants → $or cross-grant", async () => {
  const membershipsOf = indirectResource({
    id: "memberships_of_participant",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    to: { _type: "org_membership" },
    cardinality: "many",
  });

  const sys = createSystem({
    schema: {
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([
        membershipsOf.match(),
      ]),
    },
    providers: [() => [
      {
        id: "g-acme",
        key: "expositions.participants.list",
        target: ["exposition:X", "participant:*"],
        with: {
          memberships_of_participant: {
            organizationId: "expo_organization:acme",
          },
        },
      },
      {
        id: "g-globex",
        key: "expositions.participants.list",
        target: ["exposition:X", "participant:*"],
        with: {
          memberships_of_participant: {
            organizationId: "expo_organization:globex",
          },
        },
      },
    ]],
  });

  const r = await sys.context({ subject: { id: "user:lucas" } }).can(
    "expositions.participants.list",
    ["exposition:X", "participant:*"],
  );

  assertEquals(r.ok, true);
  if (!r.ok) return;
  // Le $match final doit OR-iser les 2 conditions par grant.
  assertEquals(r.stages?.[2], {
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
  });
});

// ─── Cas D — cross-collection ─────────────────────────────────────────

Deno.test("indirect: cas D — cross-collection lookup (foreignCollection)", async () => {
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

  const sys = createSystem({
    schema: {
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([
        userOfParticipant.match(),
      ]),
    },
    providers: [() => [
      {
        id: "g",
        key: "expositions.participants.list",
        target: ["exposition:X", "participant:*"],
        with: { user_of_participant: { entreprise: "entreprise:acme" } },
      },
    ]],
  });

  const r = await sys.context({ subject: { id: "user:lucas" } }).can(
    "expositions.participants.list",
    ["exposition:X", "participant:*"],
  );

  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.stages, [
    { $match: {} },
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

// ─── Cas B — chaîne 2 niveaux ─────────────────────────────────────────

Deno.test("indirect: cas B — chaîne 2 niveaux, intermédiaire auto-inclus", async () => {
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
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([
        // L'intermédiaire est déclaré mais aucun grant ne pousse de
        // condition dessus — il doit quand même apparaître dans le
        // pipeline parce que la leaf en dépend.
        userOfParticipant.match(),
        entrepriseMembersOfUser.match(),
      ]),
    },
    providers: [() => [
      {
        id: "g",
        key: "expositions.participants.list",
        target: ["exposition:X", "participant:*"],
        with: {
          entreprise_members_of_user: {
            tenantId: "entreprise:acme",
            status: "active",
          },
        },
      },
    ]],
  });

  const r = await sys.context({ subject: { id: "user:lucas" } }).can(
    "expositions.participants.list",
    ["exposition:X", "participant:*"],
  );

  assertEquals(r.ok, true);
  if (!r.ok) return;
  // 3 stages : $match initial + 2 $lookup (intermédiaire puis leaf) +
  // $match final sur la leaf uniquement.
  assertEquals(r.stages?.length, 4);
  // Lookup 1 = intermédiaire (depuis participantOf, non chaîné)
  assertEquals(r.stages?.[1], {
    $lookup: {
      from: "users",
      localField: "personRef.userId",
      foreignField: "_id",
      as: "_user_of_participant",
    },
  });
  // Lookup 2 = chaîné, utilise $let + $expr pour déréf l'alias parent
  assertEquals(r.stages?.[2], {
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
  });
  // $match final uniquement sur la leaf
  assertEquals(r.stages?.[3], {
    $match: {
      _entreprise_members_of_user: {
        $elemMatch: { tenantId: "entreprise:acme", status: "active" },
      },
    },
  });
});

// ─── Backward compat ──────────────────────────────────────────────────

Deno.test("indirect: aucune indirect resource utilisée → pas de stages dans CanResult", async () => {
  const userOf = resource({
    id: "user",
    fetch: ({ target }) => ({ _id: target[0], role: "admin" }),
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [
      {
        id: "g",
        key: "users.read",
        target: ["user:*"],
        with: { user: { role: "admin" } },
      },
    ]],
  });

  const r = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:lucas"],
  );

  assertEquals(r.ok, true);
  if (!r.ok) return;
  // Mode classique find-style : on a des `constraints`, pas de `stages`.
  assertEquals(r.constraints, { role: "admin" });
  assertEquals("stages" in r, false);
});

Deno.test("indirect: déclarée mais pas référencée par les grants → pas de stages", async () => {
  // L'indirect resource est passée à match() dans la perm, mais aucun
  // grant n'a de `with[id]` la concernant → pas besoin de générer un
  // pipeline pour rien.
  const membershipsOf = indirectResource({
    id: "memberships_of_participant",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    to: { _type: "org_membership" },
    cardinality: "many",
  });

  const sys = createSystem({
    schema: {
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([
        membershipsOf.match(),
      ]),
    },
    providers: [() => [
      {
        id: "g-open",
        key: "expositions.participants.list",
        target: ["exposition:X", "participant:*"],
        // Pas de `with` → personne ne réfère à l'indirect resource.
      },
    ]],
  });

  const r = await sys.context({ subject: { id: "user:lucas" } }).can(
    "expositions.participants.list",
    ["exposition:X", "participant:*"],
  );

  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals("stages" in r, false);
});

// ─── Sécurité ─────────────────────────────────────────────────────────

Deno.test("indirect: any-wins — grant open + grant indirect → mode find (pas de stages)", async () => {
  // Sémantique critique : un admin global (grant sans condition indirect)
  // doit voir TOUT, même si un autre grant impose un scope via indirect.
  // Symétrique à `aggregateConstraints` qui traite `undefined` comme
  // "any wins" pour les constraints find-style.
  const membershipsOf = indirectResource({
    id: "memberships_of_participant",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    to: { _type: "org_membership" },
    cardinality: "many",
  });

  const sys = createSystem({
    schema: {
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([membershipsOf.match()]),
    },
    providers: [() => [
      // Grant 1 : scope via indirect (membre d'Acme)
      {
        id: "g-member",
        key: "expositions.participants.list",
        target: ["exposition:X", "participant:*"],
        with: {
          memberships_of_participant: { organizationId: "expo_organization:acme" },
        },
      },
      // Grant 2 : open (admin global ORGANIZER, voit tout)
      {
        id: "g-admin",
        key: "expositions.participants.list",
        target: ["exposition:X", "participant:*"],
        // Pas de `with` → pas de condition indirect.
      },
    ]],
  });

  const r = await sys.context({ subject: { id: "user:lucas" } }).can(
    "expositions.participants.list",
    ["exposition:X", "participant:*"],
  );

  assertEquals(r.ok, true);
  if (!r.ok) return;
  // Mode find prévaut : pas de stages (l'admin "any-wins" gagne).
  assertEquals("stages" in r, false);
});

Deno.test("indirect: `to._type` est forcé dans le $elemMatch même si le grant l'omet", async () => {
  // Un grant pourrait essayer de matcher un autre `_type` que celui
  // déclaré dans la resource indirecte — la lib doit l'injecter.
  const membershipsOf = indirectResource({
    id: "memberships_of_participant",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    to: { _type: "org_membership" },
    cardinality: "many",
  });

  const sys = createSystem({
    schema: {
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([membershipsOf.match()]),
    },
    providers: [() => [
      {
        id: "g",
        key: "expositions.participants.list",
        target: ["exposition:X", "participant:*"],
        with: {
          memberships_of_participant: { organizationId: "expo_organization:acme" },
        },
      },
    ]],
  });

  const r = await sys.context({ subject: { id: "user:lucas" } }).can(
    "expositions.participants.list",
    ["exposition:X", "participant:*"],
  );

  assertEquals(r.ok, true);
  if (!r.ok) return;
  // Le $elemMatch final contient bien _type, injecté par la lib.
  const lastMatch = r.stages?.[r.stages.length - 1] as
    | { $match: { _memberships_of_participant: { $elemMatch: Record<string, unknown> } } }
    | undefined;
  assertEquals(
    lastMatch?.$match?._memberships_of_participant?.$elemMatch?._type,
    "org_membership",
  );
});

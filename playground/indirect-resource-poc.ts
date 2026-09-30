/**
 * POC — `indirectResource` concept for quick-permission.
 *
 * Goal: allow a permission rule to express "this list scope depends on a
 * JOIN to another collection" (e.g. participants whose org_membership
 * matches my orgs). The lib generates the corresponding MongoDB
 * aggregation pipeline ($lookup + $match), so the constraint pushes down
 * to the DB instead of being computed in-app.
 *
 * This file is standalone: it does not import from `../library/` (the
 * orchestrator is mocked just enough to validate the API on 3 cases:
 * A = self-lookup, D = cross-collection, B = chained 2-level).
 *
 * Run: `deno run playground/indirect-resource-poc.ts`
 */

// ─── Types (simplified mirrors of the real library types) ─────────────

type AggregationStage = Record<string, unknown>;
type MongoFilter = Record<string, unknown>;

interface ResourceLike {
  readonly id: string;
  /** Marker so we know it's a base (direct) resource vs an indirect one. */
  readonly kind: "direct" | "indirect";
}

interface DirectResource extends ResourceLike {
  readonly kind: "direct";
}

interface IndirectResource extends ResourceLike {
  readonly kind: "indirect";
  readonly from: ResourceLike;
  readonly on: {
    readonly localField: string;
    readonly foreignField: string;
    /** Absent = self-lookup (same collection). Present = $lookup `from`. */
    readonly foreignCollection?: string;
  };
  /** Static type/identity discriminator applied to the joined docs. */
  readonly to?: { readonly _type?: string };
  readonly cardinality: "one" | "many";
}

interface Grant {
  readonly id?: string;
  readonly key: string;
  readonly target?: readonly unknown[];
  readonly with?: Readonly<Record<string, MongoFilter>>;
}

// ─── Factories ────────────────────────────────────────────────────────

function directResource(id: string): DirectResource {
  return { id, kind: "direct" };
}

function indirectResource(spec: {
  id: string;
  from: ResourceLike;
  on: IndirectResource["on"];
  to?: IndirectResource["to"];
  cardinality: IndirectResource["cardinality"];
}): IndirectResource {
  return { ...spec, kind: "indirect" };
}

// ─── Orchestrator: grants → aggregation stages ────────────────────────

/**
 * Build the aggregation pipeline that scopes a `find` according to the
 * collected grants. Mirrors what `system.can()` would produce on top of
 * `aggregateConstraints()` once integrated.
 *
 * Algorithm:
 *   1. Resolve the set of indirect resources actually referenced by
 *      grants (transitively through `from`).
 *   2. Emit one $lookup per indirect resource, in dependency order
 *      (deeper chain first → shallower last → root participant). Dedup
 *      by `id`.
 *   3. For each indirect resource referenced by a grant's `with`, emit
 *      a $match condition; OR-ize cross-grant matches on the same
 *      indirect resource.
 *   4. Combine all $match conditions in a single final $match (AND
 *      across indirect resources, OR within an indirect resource).
 */
function buildAggregationStages(
  baseFilter: MongoFilter,
  grants: readonly Grant[],
  declaredIndirect: readonly IndirectResource[],
): AggregationStage[] {
  // Index indirect resources by id for O(1) lookup.
  const indirectById = new Map<string, IndirectResource>();
  for (const ir of declaredIndirect) indirectById.set(ir.id, ir);

  // 1. Collect referenced indirect resources from grants' `with`.
  const referenced = new Set<string>();
  for (const g of grants) {
    if (!g.with) continue;
    for (const id of Object.keys(g.with)) {
      if (indirectById.has(id)) referenced.add(id);
    }
  }
  if (referenced.size === 0) {
    // Fast path: no indirect → plain $match.
    return [{ $match: baseFilter }];
  }

  // 2. Walk dependencies: every referenced indirect pulls in its `from`
  //    if it's also an indirect (chain support, case B).
  const required = new Set<string>(referenced);
  for (const id of referenced) {
    walkDeps(indirectById.get(id)!, required, indirectById);
  }

  // 3. Topological order: a chain `userOfPart → entreprise_of_user`
  //    needs `userOfPart` lookup BEFORE `entreprise_of_user`. We emit
  //    in dep-first order (deepest first leaf to root).
  const ordered = topoSort([...required].map((id) => indirectById.get(id)!));

  // 4. Build pipeline stages.
  const stages: AggregationStage[] = [{ $match: baseFilter }];
  for (const ir of ordered) {
    stages.push(buildLookupStage(ir));
  }

  // 5. Build final $match: OR-ize cross-grant conditions per indirect,
  //    then AND across indirect resources (intra-grant if both present).
  const matchClauses: MongoFilter[] = [];
  for (const irId of referenced) {
    const ir = indirectById.get(irId)!;
    const perGrantSpecs: MongoFilter[] = [];
    for (const g of grants) {
      const spec = g.with?.[irId];
      if (!spec) continue;
      perGrantSpecs.push(spec);
    }
    if (perGrantSpecs.length === 0) continue;

    const path = lookupAlias(ir);
    const elemMatches = perGrantSpecs.map((spec) => ({
      [path]: { $elemMatch: { ...staticTypeFilter(ir), ...spec } },
    }));
    matchClauses.push(
      elemMatches.length === 1 ? elemMatches[0] : { $or: elemMatches },
    );
  }
  if (matchClauses.length > 0) {
    stages.push({
      $match: matchClauses.length === 1 ? matchClauses[0] : { $and: matchClauses },
    });
  }

  return stages;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function walkDeps(
  ir: IndirectResource,
  acc: Set<string>,
  byId: Map<string, IndirectResource>,
): void {
  if (ir.from.kind === "indirect") {
    const parent = byId.get(ir.from.id);
    if (parent && !acc.has(parent.id)) {
      acc.add(parent.id);
      walkDeps(parent, acc, byId);
    }
  }
}

function topoSort(items: IndirectResource[]): IndirectResource[] {
  // Direct topo: an item must come AFTER its parent (parent's lookup
  // produces the alias the child reads from).
  const sorted: IndirectResource[] = [];
  const remaining = new Set(items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i] as const));

  while (remaining.size > 0) {
    let progressed = false;
    for (const id of [...remaining]) {
      const ir = byId.get(id)!;
      const parentId = ir.from.kind === "indirect" ? ir.from.id : null;
      const parentInSet = parentId !== null && remaining.has(parentId);
      if (!parentInSet) {
        sorted.push(ir);
        remaining.delete(id);
        progressed = true;
      }
    }
    if (!progressed) throw new Error("Cycle detected in indirect resources");
  }
  return sorted;
}

function lookupAlias(ir: IndirectResource): string {
  return `_${ir.id}`;
}

function staticTypeFilter(ir: IndirectResource): MongoFilter {
  return ir.to?._type ? { _type: ir.to._type } : {};
}

function buildLookupStage(ir: IndirectResource): AggregationStage {
  const isChained = ir.from.kind === "indirect";
  const fromCollection = ir.on.foreignCollection ?? "<self>";
  const alias = lookupAlias(ir);

  if (!isChained) {
    // Simple $lookup from base resource fields.
    const subPipeline = ir.to?._type
      ? [{ $match: { _type: ir.to._type } }]
      : undefined;
    return {
      $lookup: {
        from: fromCollection,
        localField: ir.on.localField,
        foreignField: ir.on.foreignField,
        ...(subPipeline && { pipeline: subPipeline }),
        as: alias,
      },
    };
  }

  // Chained: source field is inside a previous lookup alias.
  const parentAlias = lookupAlias(ir.from as IndirectResource);
  // For cardinality:"one" parents we still use array access — Mongo
  // pipelines can dereference with $arrayElemAt.
  return {
    $lookup: {
      from: fromCollection,
      let: { src: { $arrayElemAt: [`$${parentAlias}.${ir.on.localField}`, 0] } },
      pipeline: [
        {
          $match: {
            $expr: { $eq: [`$${ir.on.foreignField}`, "$$src"] },
            ...(ir.to?._type && { _type: ir.to._type }),
          },
        },
      ],
      as: alias,
    },
  };
}

// ─── SPEC A — self-lookup one-to-many (org_membership) ────────────────

function specA(): void {
  console.log("═══ Case A — self-lookup org_membership ═══");

  const participantOf = directResource("participant");

  const membershipsOfParticipant = indirectResource({
    id: "memberships_of_participant",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    to: { _type: "org_membership" },
    cardinality: "many",
  });

  // Two grants: user is member of org Acme AND org Globex (cross-grant fusion).
  const grants: Grant[] = [
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
    {
      id: "g-globex",
      key: "expositions.participants.list",
      target: ["exposition:X", "participant:*"],
      with: {
        memberships_of_participant: {
          organizationId: "expo_organization:globex",
          status: "active",
        },
      },
    },
  ];

  const baseFilter = { _type: "participant", expositionId: "exposition:X" };

  const stages = buildAggregationStages(
    baseFilter,
    grants,
    [membershipsOfParticipant],
  );

  const expected: AggregationStage[] = [
    { $match: { _type: "participant", expositionId: "exposition:X" } },
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
                status: "active",
              },
            },
          },
          {
            _memberships_of_participant: {
              $elemMatch: {
                _type: "org_membership",
                organizationId: "expo_organization:globex",
                status: "active",
              },
            },
          },
        ],
      },
    },
  ];

  printAndAssert("A", stages, expected);
}

// ─── SPEC D — cross-collection lookup (participant → user) ────────────

function specD(): void {
  console.log("═══ Case D — cross-collection lookup ═══");

  const participantOf = directResource("participant");

  // The joined collection is the global `users` collection (not the
  // expo sub-collection). cardinality:"one" because a participant has
  // exactly one user.
  const userOfParticipant = indirectResource({
    id: "user_of_participant",
    from: participantOf,
    on: {
      localField: "personRef.userId",
      foreignField: "_id",
      foreignCollection: "users",
    },
    cardinality: "one",
    // `users` is not multi-collection — no _type discriminator needed.
  });

  // Filter: participants whose linked user belongs to entreprise Acme.
  const grants: Grant[] = [
    {
      id: "g-entreprise-acme",
      key: "expositions.participants.list",
      target: ["exposition:X", "participant:*"],
      with: {
        user_of_participant: { entreprise: "entreprise:acme" },
      },
    },
  ];

  const baseFilter = { _type: "participant", expositionId: "exposition:X" };

  const stages = buildAggregationStages(
    baseFilter,
    grants,
    [userOfParticipant],
  );

  const expected: AggregationStage[] = [
    { $match: { _type: "participant", expositionId: "exposition:X" } },
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
  ];

  printAndAssert("D", stages, expected);
}

// ─── SPEC B — chained 2-level (participant → user → entreprise_member) ─

function specB(): void {
  console.log("═══ Case B — chained 2-level ═══");

  const participantOf = directResource("participant");

  // Level 1 — participant → user (cross-collection)
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

  // Level 2 — user → entreprise_member (chained via `from`)
  const entrepriseMembersOfUser = indirectResource({
    id: "entreprise_members_of_user",
    from: userOfParticipant,
    on: {
      localField: "_id",         // user._id
      foreignField: "userId",
      foreignCollection: "entreprise_members",
    },
    cardinality: "many",
  });

  // Grant references the CHAINED indirect; the lib must auto-include
  // the intermediate lookup (user_of_participant) in the pipeline even
  // though no grant `with` references it directly.
  const grants: Grant[] = [
    {
      id: "g-entreprise-acme",
      key: "expositions.participants.list",
      target: ["exposition:X", "participant:*"],
      with: {
        entreprise_members_of_user: {
          tenantId: "entreprise:acme",
          status: "active",
        },
      },
    },
  ];

  const baseFilter = { _type: "participant", expositionId: "exposition:X" };

  const stages = buildAggregationStages(
    baseFilter,
    grants,
    [userOfParticipant, entrepriseMembersOfUser],
  );

  const expected: AggregationStage[] = [
    { $match: { _type: "participant", expositionId: "exposition:X" } },
    // Intermediate lookup auto-included
    {
      $lookup: {
        from: "users",
        localField: "personRef.userId",
        foreignField: "_id",
        as: "_user_of_participant",
      },
    },
    // Chained lookup uses the parent alias via $let + $expr
    {
      $lookup: {
        from: "entreprise_members",
        let: { src: { $arrayElemAt: ["$_user_of_participant._id", 0] } },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$userId", "$$src"] },
            },
          },
        ],
        as: "_entreprise_members_of_user",
      },
    },
    // Match only on the leaf (no condition on the intermediate)
    {
      $match: {
        _entreprise_members_of_user: {
          $elemMatch: { tenantId: "entreprise:acme", status: "active" },
        },
      },
    },
  ];

  printAndAssert("B", stages, expected);
}

// ─── Spec runner / assert helpers ─────────────────────────────────────

function printAndAssert(
  label: string,
  actual: unknown,
  expected: unknown,
): void {
  const ok = deepEqual(actual, expected);
  console.log(`  ${ok ? "✓ PASS" : "✗ FAIL"} — case ${label}`);
  console.log("  --- actual ---");
  console.log(JSON.stringify(actual, null, 2));
  if (!ok) {
    console.log("  --- expected ---");
    console.log(JSON.stringify(expected, null, 2));
    throw new Error(`Case ${label} failed`);
  }
  console.log();
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    );
  }
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────

if (import.meta.main) {
  specA();
  specD();
  specB();
  console.log("All specs passed.");
}

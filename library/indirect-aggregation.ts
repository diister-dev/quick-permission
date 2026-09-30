/**
 * Orchestrateur : transforme une liste de grants + ressources indirectes
 * déclarées en un pipeline d'aggregation MongoDB qui pushe les
 * contraintes de jointure en DB.
 *
 * Algorithme :
 *  1. Identifier les indirect resources réellement référencées par les
 *     `with` keys des grants.
 *  2. Transitivement pull les indirect resources parentes (chaînage).
 *  3. Trier topologiquement (parent avant enfant) pour que les `$lookup`
 *     enfants puissent référencer l'alias produit par leur parent.
 *  4. Émettre un `$lookup` par indirect resource (dédup par `id`).
 *  5. Émettre un `$match` final OR-isé cross-grant par indirect resource,
 *     AND-é entre indirect resources distinctes.
 */

import type { Grant } from "./types.ts";
import type { IndirectResource } from "./indirect-resource.ts";
import { validateSpec } from "./mongo-query.ts";

export type AggregationStage = Record<string, unknown>;
export type MongoFilter = Record<string, unknown>;

/**
 * Construit le pipeline complet à partir du `baseFilter` (les contraintes
 * find-style classiques agrégées par `aggregateConstraints`) et de la
 * liste des grants matchés.
 *
 * Retourne :
 *  - `null` quand aucune indirect resource ne contribue effectivement
 *    de filtre — soit aucun grant ne les référence, soit la sémantique
 *    "any wins" s'applique (au moins un grant ne référence pas
 *    l'indirect → le set complet est admissible). Dans ce cas le
 *    consommateur retombe sur le mode find classique avec `constraints`.
 *  - Un array de stages sinon (mode aggregation pipeline).
 *
 * La sémantique "any wins" est essentielle pour la composition
 * cross-grant : un admin global avec un grant "open" sur la même perm
 * doit court-circuiter le filtre que d'autres grants tenteraient
 * d'imposer via une indirect resource — exactement comme
 * `aggregateConstraints` traite `undefined` comme "any wins" pour les
 * constraints find-style.
 */
export function buildAggregationStages(
  baseFilter: MongoFilter,
  grants: readonly Grant[],
  declaredIndirect: readonly IndirectResource[],
): AggregationStage[] | null {
  const indirectById = new Map<string, IndirectResource>();
  for (const ir of declaredIndirect) indirectById.set(ir.id, ir);

  // Indirects référencées par AU MOINS un grant.
  const referenced = new Set<string>();
  for (const g of grants) {
    if (!g.with) continue;
    for (const id of Object.keys(g.with)) {
      if (indirectById.has(id)) referenced.add(id);
    }
  }

  if (referenced.size === 0) return null;

  // Sémantique "any wins" : une indirect ne contribue de filtre que si
  // TOUS les grants matchés portent une condition pour elle. Sinon le
  // grant sans condition ouvre la porte au set complet → on n'a pas le
  // droit de filtrer sur cette indirect.
  const effective = new Set<string>();
  for (const id of referenced) {
    if (grants.every((g) => g.with?.[id] !== undefined)) {
      effective.add(id);
    }
  }

  if (effective.size === 0) return null;

  // Pull in chained parents (transitivement) pour les indirects effectives.
  const required = new Set<string>(effective);
  for (const id of effective) {
    walkDeps(indirectById.get(id)!, required, indirectById);
  }

  // Topological order: parent before child.
  const ordered = topoSort([...required].map((id) => indirectById.get(id)!));

  const stages: AggregationStage[] = [{ $match: baseFilter }];
  for (const ir of ordered) {
    stages.push(buildLookupStage(ir));
  }

  // Per-indirect cross-grant OR; cross-indirect AND.
  const matchClauses: MongoFilter[] = [];
  for (const irId of effective) {
    const ir = indirectById.get(irId)!;
    const perGrantSpecs: MongoFilter[] = [];
    for (const g of grants) {
      const spec = g.with?.[irId] as MongoFilter | undefined;
      if (!spec) continue;
      // Security: same whitelist as `match` rule for direct resources —
      // grants may come from untrusted providers, the spec ends up
      // pushed to Mongo as-is. Reject dangerous operators ($where,
      // $expr, $function, etc.) before they reach the DB.
      validateSpec(spec);
      perGrantSpecs.push(spec);
    }
    // `effective` guarantees all grants have a spec, so perGrantSpecs is
    // non-empty here.

    const path = lookupAlias(ir);
    const elemMatches: MongoFilter[] = perGrantSpecs.map((spec) => ({
      [path]: { $elemMatch: { ...staticTypeFilter(ir), ...spec } },
    }));
    matchClauses.push(
      elemMatches.length === 1 ? elemMatches[0] : { $or: elemMatches },
    );
  }

  if (matchClauses.length > 0) {
    stages.push({
      $match:
        matchClauses.length === 1 ? matchClauses[0] : { $and: matchClauses },
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
    if (!progressed) {
      throw new Error("Cycle detected in indirect resource chain");
    }
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
  // `<self>` est un placeholder neutre — le consommateur (mongodbee
  // adapter) substitue le nom de la collection courante côté driver.
  const fromCollection = ir.on.foreignCollection ?? "<self>";
  const alias = lookupAlias(ir);

  if (!isChained) {
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

  // Chained: lookup uses $let + $expr to dereference the parent alias.
  const parentAlias = lookupAlias(ir.from as IndirectResource);
  return {
    $lookup: {
      from: fromCollection,
      let: {
        src: { $arrayElemAt: [`$${parentAlias}.${ir.on.localField}`, 0] },
      },
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

/**
 * `indirectResource` — déclaration d'une ressource atteignable via une
 * jointure (DB-pushdown via aggregation pipeline). Pendant de `resource()`
 * pour les cas où la donnée filtrante vit dans une autre collection (ou
 * dans la même via un foreign field).
 *
 * Cas d'usage typique :
 *  - lister les `participant` qui ont une `org_membership` matching org=X
 *  - lister les `participant` dont l'`user` lié appartient à entreprise=Y
 *  - chaîner sur plusieurs niveaux (`participant → user → entreprise_member`)
 *
 * La méthode `.match()` retourne une `Rule` sentinelle (kind="indirect-match")
 * que l'orchestrateur de `system.ts` détecte pour générer le pipeline
 * d'aggregation correspondant — voir `indirect-aggregation.ts`.
 *
 * À la différence des ressources directes :
 *  - Pas de `fetch` ni de `dedupKey` : aucune donnée chargée à l'évaluation
 *  - Pas de rule `filter`/`include`/`require*` — uniquement `match` pour
 *    contribuer une contrainte au pipeline généré.
 */

import { defineRule } from "./rules.ts";
import type { Rule } from "./types.ts";

/**
 * Identité de jointure entre une ressource source et la cible jointe.
 *
 * - `localField` : nom du champ sur le doc source.
 * - `foreignField` : nom du champ sur le doc cible.
 * - `foreignCollection` : si absent, jointure dans la même collection
 *   (self-lookup) — utile pour les multi-collections mongodbee où le
 *   discriminator de type vit dans un champ `_type`. Si présent,
 *   jointure vers une collection externe (équivalent `externalLookup`).
 */
export interface IndirectResourceJoin {
  readonly localField: string;
  readonly foreignField: string;
  readonly foreignCollection?: string;
}

/**
 * Ressource indirecte. Identifie une cible joignable et expose des rules
 * pour contribuer aux contraintes du pipeline généré.
 *
 * - `from` accepte une `Resource` directe (l'objet retourné par
 *   `resource({...})`, sans champ `kind` — on le marque "direct" par
 *   défaut) OU une autre `IndirectResource` (qui a `kind: "indirect"`)
 *   pour chaîner sur plusieurs niveaux.
 * - `to._type` discrimine le type cible quand la jointure vise une
 *   collection multi-types (mongodbee). **Barrière de sécurité** : un
 *   grant ne peut pas adresser un autre `_type` via le `with`.
 * - `cardinality` indique si on attend N résultats (`many`) ou 1
 *   (`one`) — utilisé pour optimiser le pipeline généré ($unwind potentiel).
 */
export interface IndirectResource {
  readonly id: string;
  /** Marker discriminant les ressources directes des indirectes. */
  readonly kind: "indirect";
  /** Normalisé au factory à partir du `from` du spec (Resource → direct). */
  readonly from: { readonly id: string; readonly kind: "direct" | "indirect" };
  readonly on: IndirectResourceJoin;
  readonly to?: { readonly _type?: string };
  readonly cardinality: "one" | "many";
  /**
   * Crée une rule qui déclare l'utilisation de cette resource indirecte
   * dans la permission. La rule ne contribue PAS aux `constraints`
   * classiques — elle est détectée par `system.ts` (via `descriptor.kind`)
   * qui collecte les indirect resources actives et génère le pipeline
   * via `buildAggregationStages`.
   *
   * Le filtrage effectif vient du `grant.with[id]` poussé par le provider.
   */
  match(): Rule;
}

interface IndirectResourceSpec {
  readonly id: string;
  /**
   * `Resource` (sans champ `kind`) ou `IndirectResource` (avec
   * `kind: "indirect"`). Le factory normalise en stockant un
   * `{ id, kind }` minimal pour la résolution du graphe.
   */
  readonly from: { readonly id: string; readonly kind?: "direct" | "indirect" };
  readonly on: IndirectResourceJoin;
  readonly to?: { readonly _type?: string };
  readonly cardinality: "one" | "many";
}

/**
 * Sentinelle dans `Rule.descriptor` pour qu'`system.ts` reconnaisse
 * cette rule comme "indirect" et collecte la resource correspondante.
 *
 * Le champ est typé `unknown` côté `RuleDescriptor` parce que
 * `[extra: string]: unknown` est la signature catch-all des descriptors —
 * on cast à l'extraction.
 */
export const INDIRECT_RULE_KIND = "indirect-match";

export function indirectResource(spec: IndirectResourceSpec): IndirectResource {
  // Normalize `from`: a `Resource` (from `resource({...})`) has no `kind`
  // field; we treat it as "direct". An `IndirectResource` has
  // `kind: "indirect"` set by this very factory. Walking the chain in
  // the orchestrator reads `from.kind` to know whether to descend.
  const fromNormalized = {
    id: spec.from.id,
    kind: spec.from.kind === "indirect" ? ("indirect" as const) : ("direct" as const),
  };
  const impl: IndirectResource = {
    id: spec.id,
    kind: "indirect",
    from: fromNormalized,
    on: spec.on,
    to: spec.to,
    cardinality: spec.cardinality,
    match() {
      return defineRule({
        kind: INDIRECT_RULE_KIND,
        needs: [],
        describe: () => ({ indirectResource: impl }),
        // Always pass — the contribution happens out-of-band via
        // descriptor introspection in system.ts.
        check: () => ({ ok: true }),
      });
    },
  };
  return impl;
}

/**
 * Extraction utilitaire pour `system.ts` : récupère la `IndirectResource`
 * portée par une rule sentinelle, ou `null` si la rule n'en est pas une.
 */
export function extractIndirectResource(rule: Rule): IndirectResource | null {
  if (rule.descriptor.kind !== INDIRECT_RULE_KIND) return null;
  const ref = rule.descriptor.indirectResource;
  if (!ref || typeof ref !== "object") return null;
  return ref as IndirectResource;
}

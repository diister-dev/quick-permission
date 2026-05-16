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
import { evaluateSpec, validateSpec } from "./mongo-query.ts";
import type { FetchCtx, Rule } from "./types.ts";

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
   * Fetcher opt-in pour le mode concrete (per-doc check). Quand défini,
   * la rule `match()` évalue effectivement la condition en mode concrete
   * (au lieu d'être une sentinelle no-op). Reçoit la valeur de la source
   * (déjà fetchée par l'engine) et retourne le tableau de docs joints.
   *
   * Toujours retourner un array, même pour `cardinality: "one"` — la
   * sémantique du match utilise `$elemMatch`-like (au moins un match).
   *
   * Si absent, l'indirect reste sentinelle (legacy) : ne contribue qu'au
   * pipeline en cap-mode.
   */
  readonly fetcher?: (sourceDoc: unknown, ctx: FetchCtx) => readonly unknown[] | Promise<readonly unknown[]>;
  /** Calcule la cache key pour un target (cf. `Resource.cacheKeyForTarget`). */
  cacheKeyForTarget(target: readonly unknown[]): string;
  /**
   * Crée une rule qui déclare l'utilisation de cette resource indirecte
   * dans la permission.
   *
   * - En cap-mode : sentinelle, détectée par `system.ts` qui collecte
   *   l'indirect pour générer le pipeline (cf. `buildAggregationStages`).
   * - En concrete-mode + `fetcher` défini : fetche les docs joints et
   *   évalue `grant.with[id]` contre eux (au moins un doc match).
   *   Sans `fetcher`, sentinelle aussi (no-op).
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
  readonly fetch?: (sourceDoc: unknown, ctx: FetchCtx) => readonly unknown[] | Promise<readonly unknown[]>;
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
    fetcher: spec.fetch,
    cacheKeyForTarget(target: readonly unknown[]): string {
      // Mirror of Resource.cacheKeyForTarget — the indirect's cache key
      // is target-derived (typically by source dedup). Useful for
      // `CanContext.preseed()` when the caller wants to inject joined
      // docs already returned by a pipeline aggregation.
      return `${spec.id}::${JSON.stringify(target)}`;
    },
    match() {
      return defineRule({
        kind: INDIRECT_RULE_KIND,
        needs: [],
        describe: () => ({ indirectResource: impl }),
        check: (_data, _payload, ctx) => {
          // Cap-mode : sentinelle. `system.ts` reads the descriptor and
          // emits the pipeline via `buildAggregationStages`. The rule
          // itself contributes nothing.
          if (ctx.capability) return { ok: true };

          // Concrete mode without fetcher : sentinelle aussi (legacy).
          if (!impl.fetcher) return { ok: true };

          // Concrete mode with fetcher : evaluate `grant.with[id]` spec
          // against the joined docs. The engine already populated the
          // joined docs in the context cache (see system.ts) — we just
          // read them from `_indirectFetched` (an opaque per-rule pass).
          // If no spec is set, the rule passes (the grant trusts the
          // indirect resource without further check).
          const spec = ctx.grant.with?.[impl.id];
          if (spec === undefined) return { ok: true };
          if (typeof spec === "object" && spec !== null) validateSpec(spec);

          const joined = (ctx as FetchCtx & { _indirectFetched?: Map<string, readonly unknown[]> })
            ._indirectFetched?.get(impl.id) ?? [];
          const passes = joined.some((d) => evaluateSpec(spec as Record<string, unknown>, d));
          return passes
            ? { ok: true }
            : { ok: false, reason: `indirect[${impl.id}] no joined doc matches spec` };
        },
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

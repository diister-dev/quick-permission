/**
 * Cross-grant aggregation primitives.
 *
 * The orchestrator runs each matching grant's rules independently, then folds
 * the per-grant outputs through these functions to produce a single CanResult.
 *
 * Two axes:
 *   - constraints: AND intra-grant, OR cross-grant. Used for DB pushdown
 *     (`output.constraints` becomes a Mongo expression for `find()`).
 *   - filter spec: union cross-grant ("most permissive grant wins"). A grant
 *     with no filter exposes all fields and short-circuits the union.
 */

/**
 * Intra-grant: AND-merge constraint contributions from multiple match rules
 * within the same grant.
 *
 *  - 0 contributions → undefined (no match rule fired in this grant)
 *  - All `{}` (= "any") → `{}` (no restriction)
 *  - 1 concrete entry → that entry
 *  - N concrete entries → `{ $and: [...] }`
 */
export function combineGrantConstraints(
  parts: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  if (parts.length === 0) return undefined;
  const nonEmpty = parts.filter((p) => Object.keys(p).length > 0);
  if (nonEmpty.length === 0) return {};
  if (nonEmpty.length === 1) return nonEmpty[0];
  return { $and: [...nonEmpty] };
}

/**
 * Cross-grant: OR-merge per-grant constraints with "any wins" semantics.
 *
 *  - 0 entries → undefined (no match rule active anywhere)
 *  - any `undefined` entry → undefined (a grant without constraint trumps;
 *    pushdown stays unrestricted)
 *  - any `{}` entry → `{}` ("any" — grants exist but impose no restriction)
 *  - 1 entry → that entry as-is
 *  - N entries → `{ $or: [...] }`
 */
export function aggregateConstraints(
  entries: ReadonlyArray<Record<string, unknown> | undefined>,
): Record<string, unknown> | undefined {
  if (entries.length === 0) return undefined;
  if (entries.some((e) => e === undefined)) return undefined;
  const concrete = entries as ReadonlyArray<Record<string, unknown>>;
  if (concrete.some((e) => Object.keys(e).length === 0)) return {};
  if (concrete.length === 1) return concrete[0];
  return { $or: [...concrete] };
}

/**
 * Project a source object through a field whitelist.
 * Non-object sources pass through unchanged.
 */
export function projectFields(
  source: unknown,
  fields: Record<string, boolean>,
): unknown {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return source;
  }
  const out: Record<string, unknown> = {};
  const src = source as Record<string, unknown>;
  for (const [k, v] of Object.entries(fields)) {
    if (v === true && k in src) out[k] = src[k];
  }
  return out;
}

/**
 * Cross-grant filter union state.
 *
 *  - `undefined` : no filter rule has fired (initial state)
 *  - `null`      : at least one grant exposed all fields (union saturates;
 *                  any further contributions are ignored)
 *  - `Record`    : union of allowed fields across grants so far
 */
export type FilterUnion = Record<string, boolean> | null | undefined;

/**
 * Merge a filter contribution into the running union.
 * `null` contribution means "this grant has no filter" (all fields allowed)
 * and saturates the union. Once saturated, stays saturated.
 */
export function mergeFilterSpec(
  current: FilterUnion,
  contribution: Record<string, boolean> | null,
): FilterUnion {
  if (current === null) return null;
  if (contribution === null) return null;
  return { ...(current ?? {}), ...contribution };
}

/**
 * Resolve final `data` from the filter union state and a reference source.
 *
 *  - union is `null`    → reference source as-is (most permissive grant won)
 *  - union is `Record`  → project the source through the union
 *  - union is `undefined` → fall back (no filter rule fired anywhere)
 */
export function resolveFilteredData(
  union: FilterUnion,
  referenceSource: unknown,
  fallback: unknown,
): unknown {
  if (union === null) return referenceSource;
  if (union !== undefined && referenceSource !== undefined) {
    return projectFields(referenceSource, union);
  }
  return fallback;
}

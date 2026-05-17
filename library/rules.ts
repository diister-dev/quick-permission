/**
 * `defineRule` — primitive unique de fabrication de rule.
 *
 * Toutes les rules de la lib (match, filter, includes, requireXxx) sont du
 * sucre par-dessus cette fonction. Les devs en aval l'utilisent aussi pour
 * écrire leurs rules métier réutilisables (cf. RFC §"Le rôle des devs").
 */

import type {
  FetchCtx,
  Grant,
  Resource,
  ResourcesData,
  Rule,
  RuleResult,
} from "./types.ts";
import { evaluateSpec, validateSpec } from "./mongo-query.ts";

export type DefineRuleOpts<
  RS extends readonly Resource<unknown>[],
  P,
> = {
  /** Identifiant de famille de rule (matrix UI). */
  readonly kind: string;
  /**
   * Resources à fetcher avant le check. L'ordre détermine l'ordre du tuple
   * passé à `check`. Tableau vide = rule pure (ex: requireSelf).
   */
  readonly needs?: RS;
  /**
   * Sucre opt-in : la rule est active ssi `grant.flags?.[flag] === true`.
   * Mutuellement exclusif avec `activeWhen`.
   */
  readonly flag?: string;
  /**
   * Escape hatch d'activation. Si retourne false, la rule est skip et ses
   * needs ne sont pas fetchées.
   */
  readonly activeWhen?: (grant: Grant) => boolean;
  /**
   * Métadonnées additionnelles fusionnées dans le `descriptor` (matrix UI).
   * Ne doit pas inclure les champs gérés automatiquement (kind/source/sources/flag).
   */
  readonly describe?: () => Readonly<Record<string, unknown>>;
  /**
   * Logique d'évaluation. `data` est un tuple aligné sur `needs`. `payload`
   * est un alias de `ctx.grant.payload` casté au type générique P.
   * Retourne soit un boolean (true = ok, false = deny avec raison auto),
   * soit un RuleResult complet pour propager `data` ou un message custom.
   */
  readonly check: (
    data: ResourcesData<RS>,
    payload: P,
    ctx: FetchCtx,
  ) => boolean | RuleResult;
};

/**
 * Fabrique une rule à partir d'une définition déclarative.
 */
export function defineRule<
  const RS extends readonly Resource<unknown>[],
  P = unknown,
>(opts: DefineRuleOpts<RS, P>): Rule {
  if (opts.flag !== undefined && opts.activeWhen !== undefined) {
    throw new Error(
      `defineRule(${opts.kind}): cannot specify both 'flag' and 'activeWhen'`,
    );
  }

  const needs = (opts.needs ?? []) as readonly Resource<unknown>[];
  const flag = opts.flag;
  const activeWhen = flag !== undefined
    ? (grant: Grant) => grant.flags?.[flag] === true
    : opts.activeWhen;

  const descriptor: Record<string, unknown> = { kind: opts.kind };
  if (needs.length === 1) descriptor.source = needs[0].id;
  if (needs.length > 1) descriptor.sources = needs.map((n) => n.id);
  if (flag !== undefined) descriptor.flag = flag;
  if (opts.describe) {
    const extra = opts.describe();
    for (const [k, v] of Object.entries(extra)) {
      // Les champs auto ne peuvent pas être écrasés.
      if (
        k === "kind" || k === "source" || k === "sources" || k === "flag"
      ) {
        continue;
      }
      descriptor[k] = v;
    }
  }

  return {
    descriptor: descriptor as Rule["descriptor"],
    needs,
    activeWhen,
    check: (data, ctx) => {
      const payload = ctx.grant.payload as P;
      const result = opts.check(data as ResourcesData<RS>, payload, ctx);
      if (typeof result === "boolean") {
        return result
          ? { ok: true }
          : { ok: false, reason: `${opts.kind} denied` };
      }
      return result;
    },
  };
}

/**
 * Rule pure (pas de needs) : compare un segment du target à `subject.id`.
 * Opt-in via flag.
 *
 * @example
 *   "users.update": permission({...}).rules([
 *     userOf.match(),
 *     requireSelf({ flag: "selfOnly" }),
 *   ]),
 *
 *   // Grant d'admin (no flag) → silent pass
 *   { key: "users.update", target: ["user:*"] }
 *   // Grant self-only (flag activé) → check target[0] === subject.id
 *   { key: "users.update", target: ["user:*"], flags: { selfOnly: true } }
 */
/**
 * Translates a grant's `target[segment]` to a Mongo `{[field]: value}`
 * constraint, exposed via the rule's `constraint` for cross-grant OR
 * aggregation and DB pushdown. Wildcard segments (`*` or `xxx:*`) emit
 * no constraint (= no restriction).
 *
 * Common case for resources stored in MongoDB by `_id`:
 *
 *   matchPath()                          // {_id: target[0]}
 *   matchPath({ field: "userId" })       // {userId: target[0]}
 *   matchPath({ segment: 1 })            // {_id: target[1]}  (e.g., target.path)
 */
export function matchPath(opts: {
  readonly field?: string;
  readonly segment?: number;
} = {}): Rule {
  const field = opts.field ?? "_id";
  const segment = opts.segment ?? 0;
  return defineRule({
    kind: "match-path",
    needs: [] as const,
    describe: () => ({ field, segment }),
    check: (_data, _payload, ctx) => {
      const target = ctx.grant.target;
      if (!target || !Array.isArray(target)) return { ok: true };
      const value = target[segment];
      if (typeof value !== "string") return { ok: true };
      if (value === "*" || value.endsWith("*")) return { ok: true };
      return { ok: true, constraint: { [field]: value } };
    },
  });
}

/**
 * Validates `ctx.input` against `grant.inputWith` (Mongo spec). Distinct
 * slot from `grant.with` so payload-shaped specs don't collide with
 * resource-shaped specs in the same grant.
 *
 * Per-grant:
 *  - no `inputWith`     → ok (unconditional grant)
 *  - `inputWith` + input → `evaluateSpec(inputWith, input)`
 *  - `inputWith` + no input → deny (cannot verify)
 *
 * Cross-grant OR aggregation: a single unconditional grant lets every check
 * through (broadest wins); a UI capability check with no input only passes
 * if at least one unconditional grant exists.
 *
 * @example
 *   "invitations.create": permission({
 *     target: target.path("exposition", "expo_organization"),
 *   }).rules([inputMatch()])
 *
 *   { key: "invitations.create",
 *     target: [expoId, orgId],
 *     inputWith: { flowId: "flow:abc" } }
 *
 *   await ctx.can("invitations.create", [expoId, orgId], { input: body })
 */
export function inputMatch(): Rule {
  return defineRule({
    kind: "input-match",
    needs: [] as const,
    check: (_data, _payload, ctx) => {
      const spec = ctx.grant.inputWith;
      if (spec === undefined || Object.keys(spec).length === 0) {
        return { ok: true };
      }
      if (ctx.input === undefined) {
        return { ok: false, reason: "input-match: input required" };
      }
      validateSpec(spec);
      return evaluateSpec(spec as Record<string, unknown>, ctx.input)
        ? { ok: true }
        : { ok: false, reason: "input-match: mismatch" };
    },
  });
}

export function requireSelf(opts: {
  readonly flag: string;
  readonly segment?: number;
}): Rule {
  const segment = opts.segment ?? 0;
  return defineRule({
    kind: "require-self",
    needs: [] as const,
    flag: opts.flag,
    describe: () => ({ segment }),
    check: (_data, _payload, ctx) =>
      ctx.target[segment] === ctx.subject.id
        ? { ok: true }
        : {
          ok: false,
          reason: `target[${segment}] is not self (flag: ${opts.flag})`,
        },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers internes (utilisés par les méthodes resource dans resource.ts)
// ─────────────────────────────────────────────────────────────────────────

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    )
  );
}

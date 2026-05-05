/**
 * `Resource` : source de donnée fetchable, dédupliquée par contexte.
 *
 * Une Resource est conçue pour être déclarée une fois dans son domaine
 * (`userOf`, `expositionInfoOf`, etc.) et réutilisée entre permissions.
 * Le moteur dédup les fetches au sein d'un context via `(id, dedupKey)`.
 *
 * Les méthodes `match`/`filter`/`includes`/`require*` sont du sucre :
 * elles produisent des Rule via `defineRule`, avec la resource comme need.
 *
 * ─── Capability-mode contract ────────────────────────────────────────────
 * A request target containing a wildcard (`"*"` or `"xxx:*"`) is a capability
 * query — "can the subject act on ANY resource of this shape?". The engine
 * skips resource fetches in this mode (no concrete resource to fetch). Each
 * rule must declare what it does when its data is unavailable:
 *
 *   match           : silent-pass (cannot verify spec against absent data),
 *                     but exposes the spec as a constraint for DB pushdown.
 *   filter          : silent-pass — no projection happens; `output.data`
 *                     stays undefined.
 *   includes        : deny — membership cannot be checked without the resource.
 *   requireTruthy   : deny — no value to test for truthiness.
 *   requireOwner    : deny — no owner field to compare.
 *   requireMembership: deny — no membership list to scan.
 *   requireCustom   : deny — predicate cannot run without `data`.
 *
 * Pure rules (no `needs`) like `matchPath` and `requireSelf` are unaffected:
 * they read `ctx.target` / `ctx.subject` only.
 */

import type {
  FetchCtx,
  Grant,
  Resource,
  Rule,
} from "./types.ts";
import { deepEqual, defineRule } from "./rules.ts";
import { evaluateSpec, validateSpec } from "./mongo-query.ts";

class ResourceImpl<T> implements Resource<T> {
  constructor(
    public readonly id: string,
    public readonly fetcher: (ctx: FetchCtx) => T | Promise<T>,
    public readonly activator?: (grant: Grant) => boolean,
    public readonly dedupKey?: (ctx: FetchCtx) => string,
  ) {}

  isActiveFor(grant: Grant): boolean {
    return this.activator ? this.activator(grant) : true;
  }

  computeDedupKey(ctx: FetchCtx): string {
    if (this.dedupKey) return `${this.id}::${this.dedupKey(ctx)}`;
    // Default safe : hash de tous les inputs (subject + target + grant.with).
    // Jamais de fausse dedup, mais peut être sous-optimal — d'où l'incitation
    // à fournir un dedupKey explicite quand on connaît les params pertinents.
    return `${this.id}::${ctx.subject.id}::${
      JSON.stringify(ctx.target)
    }::${JSON.stringify(ctx.grant.with ?? {})}`;
  }

  // ─── Méthodes de sucre — toutes produites via defineRule ─────────────

  match(extractor?: (data: T) => unknown): Rule {
    const id = this.id;
    const project = extractor ?? ((d: T) => d);
    return defineRule({
      kind: "match",
      needs: [this] as const,
      check: ([data], _payload, ctx) => {
        const spec = ctx.grant.with?.[id];
        if (spec === undefined) return { ok: true };

        if (typeof spec === "object" && spec !== null) {
          validateSpec(spec);
        }

        if (ctx.capability) {
          if (typeof spec === "object" && spec !== null && !Array.isArray(spec)) {
            return { ok: true, constraint: spec as Record<string, unknown> };
          }
          return { ok: true };
        }

        const actual = project(data as T);
        if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
          return deepEqual(spec, actual)
            ? { ok: true }
            : { ok: false, reason: `match[${id}] mismatch` };
        }
        const passes = evaluateSpec(spec as Record<string, unknown>, actual);
        if (!passes) {
          return { ok: false, reason: `match[${id}] mismatch` };
        }
        return { ok: true, constraint: spec as Record<string, unknown> };
      },
    });
  }

  filter(extractor?: (data: T) => unknown): Rule {
    const project = extractor ?? ((d: T) => d);
    return defineRule({
      kind: "filter",
      needs: [this] as const,
      check: ([data], _payload, ctx) => {
        if (ctx.capability) return { ok: true };
        const sub = project(data as T);
        const filter = ctx.grant.filter;
        // No filter on this grant → expose `null` spec so the system can
        // collapse the cross-grant union to "all fields".
        if (
          !filter || sub === null || typeof sub !== "object" ||
          Array.isArray(sub)
        ) {
          return { ok: true, data: sub, filter: { source: sub, spec: null } };
        }
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(filter)) {
          if (v === true && k in (sub as Record<string, unknown>)) {
            out[k] = (sub as Record<string, unknown>)[k];
          }
        }
        return {
          ok: true,
          data: out,
          filter: { source: sub, spec: filter },
        };
      },
    });
  }

  includes(
    grantField: string,
    extractor: (data: T) => readonly unknown[],
  ): Rule {
    return defineRule({
      kind: "includes",
      needs: [this] as const,
      // Lazy : skip si pas de spec dans le grant.
      activeWhen: (grant) => grant.with?.[grantField] !== undefined,
      describe: () => ({ grantField }),
      check: ([data], _payload, ctx) => {
        // Capability : ressource non fetchée, on ne peut pas vérifier
        // l'inclusion concrète → deny.
        if (ctx.capability) {
          return {
            ok: false,
            reason: `includes[${grantField}] cannot be verified in capability query`,
          };
        }
        const required = ctx.grant.with![grantField];
        const list = extractor(data as T);
        if (Array.isArray(required)) {
          return required.some((r) => list.includes(r))
            ? { ok: true }
            : {
              ok: false,
              reason: `includes[${grantField}] none of ${
                JSON.stringify(required)
              } present`,
            };
        }
        return list.includes(required)
          ? { ok: true }
          : {
            ok: false,
            reason: `includes[${grantField}] ${String(required)} absent`,
          };
      },
    });
  }

  requireTruthy(): Rule {
    const id = this.id;
    return defineRule({
      kind: "require-truthy",
      needs: [this] as const,
      check: ([data], _payload, ctx) => {
        if (ctx.capability) {
          return {
            ok: false,
            reason: `require-truthy[${id}] cannot be verified in capability query`,
          };
        }
        return data
          ? { ok: true }
          : { ok: false, reason: `require-truthy[${id}] is falsy` };
      },
    });
  }

  requireOwner(
    getter: (data: T) => string | undefined,
    opts: { readonly flag: string },
  ): Rule {
    const id = this.id;
    return defineRule({
      kind: "require-owner",
      needs: [this] as const,
      flag: opts.flag,
      check: ([data], _payload, ctx) => {
        if (ctx.capability) {
          return {
            ok: false,
            reason: `require-owner[${id}] cannot be verified in capability query`,
          };
        }
        return getter(data as T) === ctx.subject.id
          ? { ok: true }
          : {
            ok: false,
            reason: `not owner of ${id} (flag: ${opts.flag})`,
          };
      },
    });
  }

  requireMembership(
    getter: (data: T) => readonly string[],
    opts: { readonly flag: string },
  ): Rule {
    const id = this.id;
    return defineRule({
      kind: "require-membership",
      needs: [this] as const,
      flag: opts.flag,
      check: ([data], _payload, ctx) => {
        if (ctx.capability) {
          return {
            ok: false,
            reason: `require-membership[${id}] cannot be verified in capability query`,
          };
        }
        const list = getter(data as T);
        return list.includes(ctx.subject.id)
          ? { ok: true }
          : {
            ok: false,
            reason: `subject not member of ${id} (flag: ${opts.flag})`,
          };
      },
    });
  }

  requireCustom(
    predicate: (data: T, ctx: FetchCtx) => boolean,
    opts: {
      readonly flag: string;
      readonly descriptor?: Readonly<Record<string, unknown>>;
    },
  ): Rule {
    const id = this.id;
    return defineRule({
      kind: "require-custom",
      needs: [this] as const,
      flag: opts.flag,
      describe: opts.descriptor ? () => opts.descriptor! : undefined,
      check: ([data], _payload, ctx) => {
        if (ctx.capability) {
          return {
            ok: false,
            reason: `require-custom[${id}] cannot be verified in capability query`,
          };
        }
        return predicate(data as T, ctx)
          ? { ok: true }
          : {
            ok: false,
            reason: `require-custom[${id}] denied (flag: ${opts.flag})`,
          };
      },
    });
  }
}

/**
 * Crée une Resource. À utiliser une fois par entité de domaine, partagée
 * entre toutes les permissions qui la consomment.
 *
 * @example
 *   const userOf = resource({
 *     id: "user",
 *     fetch: ({ target }) => usersRepo.findById(target[0] as string),
 *     dedupKey: ({ target }) => target[0] as string,
 *   });
 */
export function resource<T>(opts: {
  readonly id: string;
  readonly fetch: (ctx: FetchCtx) => T | Promise<T>;
  readonly activeWhen?: (grant: Grant) => boolean;
  readonly dedupKey?: (ctx: FetchCtx) => string;
}): Resource<T> {
  return new ResourceImpl<T>(
    opts.id,
    opts.fetch,
    opts.activeWhen,
    opts.dedupKey,
  );
}

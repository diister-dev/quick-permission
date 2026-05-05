/**
 * Builder de permission pour resource-pipe.
 *
 * API en deux étapes (`permission(opts).rules([])`), même justification que
 * `library/permission.ts` (cf. RFC declarative §"Décision two-call").
 *
 * Différence majeure vs l'API declarative actuelle : pas de slot `fetch` au
 * niveau permission. Les fetches sont déclarés au niveau des `Resource`s
 * que les rules consomment via `needs`.
 */

import type { AnyTarget, Grant, Permission, Rule } from "./types.ts";

export type PermissionConfig<TMeta> = {
  readonly metadata?: TMeta;
  readonly target: AnyTarget;
};

export type PermissionBuilder<TMeta> = {
  rules(rules: readonly Rule[]): Permission<TMeta>;
};

/**
 * Déclare une permission "feuille" (vérifiable directement via `can()`).
 *
 * @example
 *   "users.read": permission({
 *     metadata: { description: "Lire un user" },
 *     target: target.required("user"),
 *   }).rules([
 *     userOf.match(),
 *     userOf.filter(),
 *   ]),
 */
export function permission<TMeta = unknown>(
  config: PermissionConfig<TMeta>,
): PermissionBuilder<TMeta> {
  return {
    rules(rules) {
      return {
        metadata: config.metadata,
        target: config.target,
        rules,
      };
    },
  };
}

export type IntermediateConfig<TMeta> = {
  readonly metadata?: TMeta;
  readonly target: AnyTarget;
  /** Expand un grant sur cette intermediate en N grants sur les enfants. */
  readonly expandsTo: (grant: Grant) => readonly Grant[];
};

export type IntermediateBuilder<TMeta> = {
  /** Optionnellement attacher des rules au niveau intermediate. */
  rules(rules: readonly Rule[]): Permission<TMeta>;
};

/**
 * Déclare une permission "intermediate" (macro qui s'expand en grants
 * enfants au moment du check).
 *
 * @example
 *   "users.manage": intermediate({
 *     target: target.required("user"),
 *     expandsTo: (grant) => [
 *       { ...grant, key: "users.read" },
 *       { ...grant, key: "users.update" },
 *       { ...grant, key: "users.delete" },
 *     ],
 *   }).rules([]),
 */
export function intermediate<TMeta = unknown>(
  config: IntermediateConfig<TMeta>,
): IntermediateBuilder<TMeta> {
  return {
    rules(rules) {
      return {
        metadata: config.metadata,
        target: config.target,
        rules,
        expandsTo: config.expandsTo,
      };
    },
  };
}

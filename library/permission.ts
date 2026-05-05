import type { AnyTarget, SegmentNames, TargetArgs } from "./types.ts";
import type { Rule } from "./rules.ts";
import type { PayloadSpec } from "./payload.ts";

export type Permission<TMeta, T extends AnyTarget, R, P> = {
  readonly kind: "permission";
  readonly metadata?: TMeta;
  readonly target: T;
  readonly fetch?: (args: TargetArgs<T>) => Promise<R>;
  readonly rules: readonly Rule<SegmentNames<T>, R, P>[];
  readonly payload?: PayloadSpec<P>;
};

export type PermissionConfig<TMeta, T extends AnyTarget, R, P> = {
  metadata?: TMeta;
  target: T;
  fetch?: (args: TargetArgs<T>) => Promise<R>;
  payload?: PayloadSpec<P>;
};

export type PermissionBuilder<TMeta, T extends AnyTarget, R, P> = {
  rules: (
    rules: readonly Rule<SegmentNames<T>, R, P>[],
  ) => Permission<TMeta, T, R, P>;
};

export function permission<
  TMeta,
  T extends AnyTarget,
  R = unknown,
  P = unknown,
>(
  config: PermissionConfig<TMeta, T, R, P>,
): PermissionBuilder<TMeta, T, R, P> {
  return {
    rules: (rules) => ({
      kind: "permission",
      metadata: config.metadata,
      target: config.target,
      fetch: config.fetch,
      rules,
      payload: config.payload,
    }),
  };
}

/**
 * Grant state passed to an intermediate's `expandsTo`. Mirrors the runtime
 * grant shape — providers and intermediate expansions both produce these.
 */
export type GrantState = {
  id?: string;
  key: string;
  target?: unknown;
  with?: Record<string, unknown>;
  filter?: Record<string, boolean | unknown>;
  payload?: Record<string, unknown>;
  startDate?: Date;
  endDate?: Date;
  ips?: readonly string[];
};

/**
 * A flat-key permission that, when matched as a grant, expands into other
 * permissions declared explicitly via `expandsTo`. The intermediate itself
 * also behaves as a leaf permission (it can be checked directly with its own
 * fetch/rules/target).
 */
export type Intermediate<TMeta, T extends AnyTarget, R, P> = {
  readonly kind: "intermediate";
  readonly metadata?: TMeta;
  readonly target: T;
  readonly fetch?: (args: TargetArgs<T>) => Promise<R>;
  readonly rules: readonly Rule<SegmentNames<T>, R, P>[];
  readonly payload?: PayloadSpec<P>;
  readonly expandsTo: (grant: GrantState) => readonly GrantState[];
};

export type IntermediateConfig<TMeta, T extends AnyTarget, R, P> = {
  metadata?: TMeta;
  target: T;
  fetch?: (args: TargetArgs<T>) => Promise<R>;
  payload?: PayloadSpec<P>;
  expandsTo: (grant: GrantState) => readonly GrantState[];
};

export type IntermediateBuilder<TMeta, T extends AnyTarget, R, P> = {
  rules: (
    rules: readonly Rule<SegmentNames<T>, R, P>[],
  ) => Intermediate<TMeta, T, R, P>;
};

export function intermediate<
  TMeta,
  T extends AnyTarget,
  R = unknown,
  P = unknown,
>(
  config: IntermediateConfig<TMeta, T, R, P>,
): IntermediateBuilder<TMeta, T, R, P> {
  return {
    rules: (rules) => ({
      kind: "intermediate",
      metadata: config.metadata,
      target: config.target,
      fetch: config.fetch,
      rules,
      payload: config.payload,
      expandsTo: config.expandsTo,
    }),
  };
}

// Type-erased shapes for runtime traversal.
export type AnyPermission = {
  readonly kind: "permission";
  // deno-lint-ignore no-explicit-any
  readonly metadata?: any;
  readonly target: AnyTarget;
  // deno-lint-ignore no-explicit-any
  readonly fetch?: (...args: any[]) => Promise<any>;
  // deno-lint-ignore no-explicit-any
  readonly rules: readonly any[];
  // deno-lint-ignore no-explicit-any
  readonly payload?: any;
};

export type AnyIntermediate = {
  readonly kind: "intermediate";
  // deno-lint-ignore no-explicit-any
  readonly metadata?: any;
  readonly target: AnyTarget;
  // deno-lint-ignore no-explicit-any
  readonly fetch?: (...args: any[]) => Promise<any>;
  // deno-lint-ignore no-explicit-any
  readonly rules: readonly any[];
  // deno-lint-ignore no-explicit-any
  readonly payload?: any;
  readonly expandsTo: (grant: GrantState) => readonly GrantState[];
};

export type SchemaEntry = AnyPermission | AnyIntermediate;
export type IntermediateChild = SchemaEntry; // back-compat alias

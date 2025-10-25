/**
 * Core types for the permission system
 */

/**
 * A subject represents an entity requesting permission (user, service, etc.)
 */
export type Subject = {
  id: string;
  [key: string]: unknown;
}

/**
 * A permission defines access rules without context (leaf node)
 */
export type Permission<C = undefined, TRules extends readonly PermissionRule<any, any>[] = readonly []> = {
  type: "permission";
  fetchTarget?: (id: C) => Promise<any>;
  rules: TRules;
}

/**
 * An intermediate permission can expand into multiple other permissions
 */
export type IntermediatePermission<C = undefined, TRules extends readonly PermissionRule<any, any>[] = readonly []> = {
  type: "intermediate";
  provide: (ctx: PermissionStateBase) => Array<PermissionStateBase>;
  fetchTarget?: (id: C) => Promise<any>;
  rules: TRules;
}

/**
 * Either a permission or intermediate permission
 */
export type PermissionDefinition<C, TRules extends PermissionRule<any, any, any>[]> =
  | Permission<C, TRules>
  | IntermediatePermission<C, TRules>;

/**
 * Extract the context type from a permission definition
 */
export type ExtractContext<P> = P extends PermissionDefinition<infer C, any> ? C : never;

/**
 * Schema of all permissions in the system
 */
export type PermissionSchemas = {
  [key: string]: PermissionDefinition<any, PermissionRule<any, any, any>[]>;
}

/**
 * A permission with associated metadata
 */
export type PermissionStateBase = {
  id?: string;
  subject: Subject;
  key: string;
  target?: unknown;
  [key: string]: unknown;
}

type ReservedKeys = "subject" | "key" | "target";

/**
 * Rule state shape
 */
export type RuleState = Omit<Record<string, unknown>, ReservedKeys>;

/**
 * Rule request shape
 */
export type RuleRequest = Omit<Record<string, unknown>, ReservedKeys>;

// Permission rule
// - Permission State (optional)
// - Permission Request Context (optional)
// - Output value (optional)
type RuleResult<TOutput> = {
  ok: false,
  reason: string
} | {
  ok: true,
  output?: TOutput
};

export type PermissionRule<
  TState extends RuleState = RuleState,
  TRequest extends RuleRequest = RuleRequest,
  TOutput extends Record<string, unknown> = Record<string, unknown>
> = {
  name: string;
  check: (
    // Permission state provided by sources
    state: PermissionStateBase & Partial<TState>,
    // Request context
    request: {
      subject: Subject;
      key: string;
      target?: any;
    } & TRequest,
    ctx: {
      permission: PermissionDefinition<any, any>,
      output: any; // Current accumulated output
    }
  ) => RuleResult<TOutput> | Promise<RuleResult<TOutput>>;
  default: () => TRequest;
}

/**
 * Permission provider interface - sources of permissions
 */
export type PermissionProvider = {
  provide: (
    subject: Subject,
    key: string,
    target?: any
  ) => PermissionStateBase[] | Promise<PermissionStateBase[]>;
}

/**
 * Merge all rule request contexts into one type
 */
export type MergeRequestContexts<TRules extends readonly PermissionRule<any, any>[]> =
  TRules extends readonly [infer First, ...infer Rest]
    ? First extends PermissionRule<any, infer R1>
      ? Rest extends readonly PermissionRule<any, any>[]
        ? R1 & MergeRequestContexts<Rest>
        : R1
      : never
    : {};

/**
 * Configuration for permission system
 */
export type PermissionSystemConfig<
  S extends PermissionSchemas,
  TRules extends readonly PermissionRule<any, any>[]
> = {
  schemas: S;
  sources: PermissionProvider[];
  rules?: TRules;
  maxIntermediateDepth?: number;
}

/**
 * Extract output type from an PermissionRule
 */
export type ExtractRuleOutput<R> = R extends PermissionRule<any, any, infer TOutput> ? TOutput : never;

/**
 * Merge all rule outputs into one type
 */
export type MergeRuleOutputs<TRules extends readonly PermissionRule<any, any, any>[]> =
  TRules extends readonly [infer First, ...infer Rest]
    ? First extends PermissionRule<any, any, infer Out1>
      ? Rest extends readonly PermissionRule<any, any, any>[]
        ? Out1 & MergeRuleOutputs<Rest>
        : Out1
      : never
    : {};

/**
 * Extract output type from a permission based on its rules
 */
export type ExtractPermissionOutput<P> =
  P extends Permission<any, infer TRules>
    ? TRules extends readonly PermissionRule<any, any, any>[]
      ? MergeRuleOutputs<TRules>
      : {}
    : P extends IntermediatePermission<any, infer TRules>
      ? TRules extends readonly PermissionRule<any, any, any>[]
        ? MergeRuleOutputs<TRules>
        : {}
      : {};

/**
 * Result of a permission check
 */
export type PermissionResult<TOutput = any> = {
  ok: false,
  reasons: string[];
} | {
  ok: true;
  output?: TOutput;
}

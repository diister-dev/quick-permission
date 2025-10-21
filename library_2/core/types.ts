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
export type Permission<C = undefined, TRules extends readonly OutputRule<any, any>[] = readonly OutputRule<any, any>[]> = {
  type: "permission";
  fetchTarget?: (id: C) => Promise<any>;
  rules?: TRules;
}

/**
 * An intermediate permission can expand into multiple other permissions
 */
export type IntermediatePermission<C = undefined, TRules extends readonly OutputRule<any, any>[] = readonly OutputRule<any, any>[]> = {
  type: "intermediate";
  provide: (ctx: { subject: Subject, target: C }) => Array<{
    subject: Subject,
    key: string,
    target?: any
  }>;
  fetchTarget?: (id: C) => Promise<any>;
  rules?: TRules;
}

/**
 * Either a permission or intermediate permission
 */
export type PermissionDefinition<C = undefined> = Permission<C> | IntermediatePermission<C>;

/**
 * Extract the context type from a permission definition
 */
export type ExtractContext<P> = P extends PermissionDefinition<infer C> ? C : never;

/**
 * Schema of all permissions in the system
 */
export type PermissionSchemas = {
  [key: string]: PermissionDefinition<any>;
}

/**
 * A permission with associated metadata
 */
export type PermissionWithMetadata = {
  subject: Subject;
  key: string;
  target?: unknown;
  [key: string]: unknown;
}

/**
 * Rule state shape
 */
export type RuleState = Record<string, unknown>;

/**
 * Rule request shape
 */
export type RuleRequest = Record<string, unknown>;

/**
 * A permission rule validates a permission based on state and request context
 */
export type PermissionRule<
  TState extends RuleState = RuleState,
  TRequest extends RuleRequest = RuleRequest
> = {
  name: string;
  check: (
    state: PermissionWithMetadata & Partial<TState>,
    ctx: TRequest & {
      subject: Subject;
      key: string;
      target?: any;
    },
    permission: PermissionDefinition<any>
  ) => boolean | Promise<boolean>;
  default: () => TRequest;
}

/**
 * An output rule that generates output data (doesn't validate, just transforms)
 */
export type OutputRule<
  TState extends RuleState = RuleState,
  TOutput = any
> = {
  name: string;
  output: (params: {
    state: PermissionWithMetadata & Partial<TState>;
    ctx: any;
    resource?: any;
    currentOutput: any;
  }) => TOutput | Promise<TOutput>;
  defaultState?: () => Partial<TState>;
}

/**
 * Permission provider interface - sources of permissions
 */
export type PermissionProvider = {
  provide: (
    subject: Subject,
    key: string,
    target?: any
  ) => Promise<PermissionWithMetadata[]>;
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
 * Extract output type from an OutputRule
 */
export type ExtractRuleOutput<R> = R extends OutputRule<any, infer TOutput> ? TOutput : never;

/**
 * Merge all rule outputs into one type
 */
export type MergeRuleOutputs<TRules extends readonly OutputRule<any, any>[]> =
  TRules extends readonly [infer First, ...infer Rest]
    ? First extends OutputRule<any, infer Out1>
      ? Rest extends readonly OutputRule<any, any>[]
        ? Out1 & MergeRuleOutputs<Rest>
        : Out1
      : never
    : {};

/**
 * Extract output type from a permission based on its rules
 */
export type ExtractPermissionOutput<P> =
  P extends Permission<any, infer TRules>
    ? TRules extends readonly OutputRule<any, any>[]
      ? MergeRuleOutputs<TRules>
      : never
    : P extends IntermediatePermission<any, infer TRules>
      ? TRules extends readonly OutputRule<any, any>[]
        ? MergeRuleOutputs<TRules>
        : never
      : never;

/**
 * Result of a permission check
 */
export type PermissionResult<TOutput = any> = {
  ok: boolean;
  output?: TOutput;
}

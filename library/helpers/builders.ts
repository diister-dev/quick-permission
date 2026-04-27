import type { Permission, IntermediatePermission, Subject, PermissionRule, PermissionStateBase } from "../core/types.ts";

/**
 * Creates a permission (leaf node in permission tree)
 *
 * @param fetchTarget Optional fetchTarget function when permission has a context
 * @param rules Optional array of output rules
 * @returns A permission definition
 *
 * @example
 * permission() // No context, no rules
 * permission(getArticle) // With ArticleId context
 * permission(getArticle, [FilterRule()]) // With context and filter rule
 */

// Overload 1: No arguments — permission without target type. C defaults to undefined,
//             but can be set explicitly: `permission<readonly [string]>()`.
export function permission<const C = undefined>(): Permission<C, []>;

// Overload 2: Only fetchTarget — target type inferred from the fetcher
export function permission<const C>(
  fetchTarget: (id: C) => Promise<any>
): Permission<C, readonly []>;

// Overload 3: fetchTarget + rules
export function permission<const C, const TRules extends readonly PermissionRule<any, any, any>[]>(
  fetchTarget: (id: C) => Promise<any>,
  rules: TRules
): Permission<C, TRules>;

// Implementation
export function permission<const C = undefined, const TRules extends readonly PermissionRule<any, any, any>[] = readonly []>(
  fetchTarget?: (id: C) => Promise<any>,
  rules?: TRules
): Permission<C, TRules> {
  return {
    type: "permission",
    fetchTarget,
    rules: (rules ?? []) as TRules,
  } as Permission<C, TRules>;
}

/**
 * Creates an intermediate permission that can expand into other permissions
 *
 * @param provide Function that returns child permissions
 * @param fetchTarget Optional fetchTarget function when permission has a context
 * @param rules Optional array of output rules
 * @returns An intermediate permission definition
 *
 * @example
 * intermediate((ctx) => [
 *   { ...ctx, key: "article.read" },
 *   { ...ctx, key: "article.update" }
 * ], getArticle)
 */

// Overload 1: Only provide
export function intermediate<const C>(
  provide: (ctx: PermissionStateBase & { target: C }) => Array<{
    subject: Subject,
    key: string,
    target?: any
  }>
): IntermediatePermission<C, []>;

// Overload 2: provide + fetchTarget
export function intermediate<C>(
  provide: (ctx: PermissionStateBase & { target: C }) => Array<{
    subject: Subject,
    key: string,
    target?: any
  }>,
  fetchTarget: (id: C) => Promise<any>
): IntermediatePermission<C, readonly []>;

// Overload 3: provide + fetchTarget + rules
export function intermediate<const C, const TRules extends readonly PermissionRule<any, any, any>[]>(
  provide: (ctx: PermissionStateBase & { target: C }) => Array<{
    subject: Subject,
    key: string,
    target?: any
  }>,
  fetchTarget: (id: C) => Promise<any>,
  rules: TRules
): IntermediatePermission<C, TRules>;

// Implementation
export function intermediate<C = undefined, TRules extends readonly PermissionRule<any, any, any>[] = readonly []>(
  provide: (ctx: PermissionStateBase & { target: C }) => Array<{
    subject: Subject,
    key: string,
    target?: any
  }>,
  fetchTarget?: (id: C) => Promise<any>,
  rules?: TRules
): IntermediatePermission<C, TRules> {
  return {
    type: "intermediate",
    provide,
    fetchTarget,
    rules: (rules ?? []) as TRules,
  } as IntermediatePermission<C, TRules>;
}

import type { Permission, IntermediatePermission, Subject, OutputRule } from "../core/types.ts";

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

// Overload 1: No arguments
export function permission(): Permission<undefined, readonly []>;

// Overload 2: Only fetchTarget
export function permission<C>(
  fetchTarget: (id: C) => Promise<any>
): Permission<C, readonly []>;

// Overload 3: fetchTarget + rules
export function permission<C, TRules extends readonly OutputRule<any, any>[]>(
  fetchTarget: (id: C) => Promise<any>,
  rules: TRules
): Permission<C, TRules>;

// Implementation
export function permission<C = undefined, TRules extends readonly OutputRule<any, any>[] = readonly []>(
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
export function intermediate<C>(
  provide: (ctx: { subject: Subject, target: C }) => Array<{
    subject: Subject,
    key: string,
    target?: any
  }>
): IntermediatePermission<C, readonly []>;

// Overload 2: provide + fetchTarget
export function intermediate<C>(
  provide: (ctx: { subject: Subject, target: C }) => Array<{
    subject: Subject,
    key: string,
    target?: any
  }>,
  fetchTarget: (id: C) => Promise<any>
): IntermediatePermission<C, readonly []>;

// Overload 3: provide + fetchTarget + rules
export function intermediate<C, TRules extends readonly OutputRule<any, any>[]>(
  provide: (ctx: { subject: Subject, target: C }) => Array<{
    subject: Subject,
    key: string,
    target?: any
  }>,
  fetchTarget: (id: C) => Promise<any>,
  rules: TRules
): IntermediatePermission<C, TRules>;

// Implementation
export function intermediate<C = undefined, TRules extends readonly OutputRule<any, any>[] = readonly []>(
  provide: (ctx: { subject: Subject, target: C }) => Array<{
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

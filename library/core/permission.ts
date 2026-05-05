import type {
  PermissionSchemas,
  PermissionRule,
  PermissionSystemConfig,
  MergeRequestContexts,
  PermissionResult,
  DynamicPermissionResult,
  Subject,
  PermissionStateBase,
  Permission,
  IntermediatePermission,
  ExtractPermissionOutput,
  ContextArgs,
  TargetPath,
  CheckMode,
} from "./types.ts";
import { matchPath, overlapPath } from "./matching.ts";
import { mergeOutputs } from "./merging.ts";

/**
 * Creates a permission system with validation capabilities
 */
export function createPermissionSystem<
  PS extends PermissionSchemas,
  TRules extends readonly PermissionRule<any, any>[]
>(
  config: PermissionSystemConfig<PS, TRules>
): {
  can<K extends keyof PS>(
    subject: Subject,
    key: K,
    ...args: ContextArgs<PS[K]>
  ): Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>>;
  /**
   * Check a permission whose key is only known at runtime (e.g. coming from an
   * HTTP body). Returns a discriminated result with a `code` for the
   * "unknown_key" case so callers can differentiate config errors from denials.
   */
  canDynamic(
    subject: Subject,
    key: string,
    target?: TargetPath,
  ): Promise<DynamicPermissionResult>;
  /**
   * "Broad match" check: returns ok if the subject has at least one matching
   * permission, ignoring rules that need a fetched resource (WithRule,
   * FilterRule). Useful for capability queries where the target may contain
   * wildcard segments (e.g. `["expo:1", "*"]` to ask "any badge in expo:1").
   */
  canBroadMatch<K extends keyof PS>(
    subject: Subject,
    key: K,
    target?: TargetPath,
  ): Promise<DynamicPermissionResult>;
  canBroadMatch(
    subject: Subject,
    key: string,
    target?: TargetPath,
  ): Promise<DynamicPermissionResult>;
  /**
   * Returns a `{ key: boolean }` map of which permissions the subject can
   * exercise on the given target. Each entry uses broad-match semantics
   * (resource-fetching rules are skipped).
   *
   * @param opts.keys Restrict the check to a subset of schema keys. Defaults
   *                  to every key in the schema.
   */
  capabilities(
    subject: Subject,
    target?: TargetPath,
    opts?: { keys?: readonly string[] },
  ): Promise<Record<string, boolean>>;
  collectPermissions<K extends keyof PS>(
    query: {
      subject: Subject;
      key: K;
    } & (PS[K] extends Permission<infer C, any> | IntermediatePermission<infer C, any>
      ? C extends undefined
        ? { target?: never }
        : { target: C }
      : { target?: never }),
    options?: {
      includeAllKeys?: boolean;
    }
  ): Promise<PermissionStateBase[]>;
  withContext(context: Partial<MergeRequestContexts<TRules>> & { subject: Subject }): {
    can<K extends keyof PS>(
      key: K,
      ...args: ContextArgs<PS[K]>
    ): Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>>;
    canDynamic(key: string, target?: TargetPath): Promise<DynamicPermissionResult>;
    canBroadMatch<K extends keyof PS>(key: K, target?: TargetPath): Promise<DynamicPermissionResult>;
    canBroadMatch(key: string, target?: TargetPath): Promise<DynamicPermissionResult>;
    capabilities(
      target?: TargetPath,
      opts?: { keys?: readonly string[] },
    ): Promise<Record<string, boolean>>;
    collectPermissions<K extends keyof PS>(
      query: {
        key: K;
      } & (PS[K] extends Permission<infer C, any> | IntermediatePermission<infer C, any>
        ? C extends undefined
          ? { target?: never }
          : { target: C }
        : { target?: never }),
      options?: {
        includeAllKeys?: boolean;
      }
    ): Promise<PermissionStateBase[]>;
  };
  context(ctx: Partial<MergeRequestContexts<TRules>> & { subject: Subject; [key: string]: any }): {
    can<K extends keyof PS>(
      key: K,
      ...args: ContextArgs<PS[K]>
    ): Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>>;
    canDynamic(key: string, target?: TargetPath): Promise<DynamicPermissionResult>;
    canBroadMatch<K extends keyof PS>(key: K, target?: TargetPath): Promise<DynamicPermissionResult>;
    canBroadMatch(key: string, target?: TargetPath): Promise<DynamicPermissionResult>;
    capabilities(
      target?: TargetPath,
      opts?: { keys?: readonly string[] },
    ): Promise<Record<string, boolean>>;
    collectPermissions<K extends keyof PS>(
      query: {
        key: K;
      } & (PS[K] extends Permission<infer C, any> | IntermediatePermission<infer C, any>
        ? C extends undefined
          ? { target?: never }
          : { target: C }
        : { target?: never }),
      options?: {
        includeAllKeys?: boolean;
      }
    ): Promise<PermissionStateBase[]>;
  };
} {
  const {
    schemas,
    sources,
    rules = [],
    onProviderError,
    onBeforeCheck,
    onCheck,
  } = config;

  const maxIntermediateDepth = 10;

  /**
   * Generate default context from all rules
   */
  async function defaultContext(): Promise<Partial<MergeRequestContexts<TRules>>> {
    const context: Partial<MergeRequestContexts<TRules>> = {};
    for (const rule of rules) {
      Object.assign(context, await rule.default());
    }
    return context;
  }

  /**
   * Resolve intermediate permissions recursively
   */
  function resolveIntermediates(
    permissions: PermissionStateBase[],
    depth: number = 0
  ): PermissionStateBase[] {
    if (depth >= maxIntermediateDepth) {
      // Max depth reached, stop resolving
      return permissions;
    }

    const resolved: PermissionStateBase[] = [];
    const toResolve: PermissionStateBase[] = [];

    // Separate intermediate from non-intermediate permissions
    for (const perm of permissions) {
      const schema = schemas[perm.key];

      if (schema?.type === "intermediate") {
        toResolve.push(perm);
        // Also keep the intermediate permission itself (it can be checked directly)
        resolved.push(perm);
      } else {
        resolved.push(perm);
      }
    }

    // Resolve all intermediate permissions
    for (const perm of toResolve) {
      const schema = schemas[perm.key] as IntermediatePermission<any, any>;

      try {
        const expanded = schema.provide(perm);
        resolved.push(...resolveIntermediates(expanded, depth + 1));
      } catch (_error) {
        // If provide() fails, skip this intermediate
        continue;
      }
    }

    return resolved;
  }

  /**
   * Collect all resolved permissions for a given key
   */
  async function collectPermissionsForKey(
    query: {
      subject: Subject;
      key: string;
      target?: any;
      context: any;
    },
    options?: {
      includeAllKeys?: boolean;
      resourceCache?: Map<string, any>;
    }
  ): Promise<PermissionStateBase[]> {
    const cache = options?.resourceCache || new Map<string, any>();

    // 1. Collect permissions from all providers
    const providerResults = await Promise.all(
      sources.map(async (source, index) => {
        try {
          const cacheKey = source.cacheKey ?
            `${index}::${source.cacheKey(query.subject, query.key, query.target)}`
            : `${index}::${JSON.stringify(query.subject)}`;
          if (cache.has(cacheKey)) {
            return cache.get(cacheKey);
          }
          const result = await source.provide(query.subject, query.key, query.target);
          cache.set(cacheKey, result);
          return result;
        } catch (error) {
          // If provider fails, call error handler and return empty array
          onProviderError?.(error, index);
          return [];
        }
      })
    );

    const allPermissions = providerResults.flat();

    // 2. Resolve intermediate permissions recursively
    const resolvedPermissions = resolveIntermediates(allPermissions);

    // 3. Filter permissions that match the requested key (unless includeAllKeys is true)
    if (options?.includeAllKeys) {
      return resolvedPermissions;
    }
    return resolvedPermissions.filter(perm => perm.key === query.key);
  }

  /**
   * Run the underlying check (no callbacks).
   * Pulled out of `checkPermission` so we can wrap the public entry point with
   * `onBeforeCheck` / `onCheck` instrumentation in one place.
   */
  async function runCheck(
    subject: Subject,
    key: string,
    target: any,
    context: any,
    resourceCache: Map<string, any> | undefined,
    broadMatch: boolean,
  ): Promise<PermissionResult> {
    // Create a cache map if not provided
    const permission = schemas[key];
    const cache = resourceCache || new Map<string, any>();

    // Create cached fetchTarget function
    const cachedFetchTarget = async (id: any): Promise<any> => {
      if (!permission.fetchTarget) {
        return undefined;
      }

      // Cache key is just the target (not key+target) since same resource can be used by multiple permissions
      const cacheKey = JSON.stringify(id);

      // Check cache first
      if (cache.has(cacheKey)) {
        // console.log(`  [Cache HIT: ${cacheKey}]`);
        return cache.get(cacheKey);
      }

      // Fetch and cache
      try {
        const resource = await permission.fetchTarget(id);
        cache.set(cacheKey, resource);
        return resource;
      } catch (_error) {
        // Cache the error as undefined
        cache.set(cacheKey, undefined);
        return undefined;
      }
    };

    // Collect all matching permissions
    const matchingPermissions = await collectPermissionsForKey(
      { subject, key, target, context },
      { resourceCache: cache }
    );

    // 4. Accumulator for valid permissions
    const validPermissions: PermissionStateBase[] = [];

    // 5. Check each matching permission (collect all valid ones)
    const failureReasons: string[] = [];
    let accumulatedOutput: any = {};
    for (const perm of matchingPermissions) {
      // Check if target matches.
      // - perm.target === undefined: permission applies to any target.
      // - target === undefined: request has no target, only matches perms with no target.
      // - In broad-match mode, the request target may itself carry wildcards;
      //   we use overlapPath (symmetric "could match") instead of matchPath.
      if (perm.target !== undefined) {
        if (target === undefined) {
          continue; // Permission targets something specific; request has no target.
        }
        const permTarget = (Array.isArray(perm.target)
          ? perm.target
          : [perm.target]) as TargetPath;
        const reqTarget = (Array.isArray(target) ? target : [target]) as TargetPath;
        const matches = broadMatch
          ? overlapPath(reqTarget, permTarget)
          : matchPath(reqTarget, permTarget);
        if (!matches) continue;
      }

      // Apply global validation rules
      let allRulesPassed = true;
      const allRules = [
        ...rules,
        ...(schemas[key]?.rules || []),
      ]

      for (const rule of allRules) {
        // Broad-match: skip rules that require a fetched resource (e.g. WithRule,
        // FilterRule). The remaining rules (TimeRule, IpRule, custom flags) still
        // gate the result, so a denied broad match is still a denial.
        if (broadMatch && rule.needsResource) continue;

        const ruleContext = {
          ...context,
          subject,
          key,
          target,
        };

        const result = await rule.check(perm, ruleContext, {
          permission: {
            ...schemas[key],
            fetchTarget: cachedFetchTarget,
          },
          output: {}
        });

        if (!result.ok) {
          allRulesPassed = false;
          failureReasons.push(`Rule "${rule.name}" failed: ${result.reason}`);
          break; // One rule failed, skip this permission
        }

        // Merge rule output into accumulated output
        if (result.output) {
          accumulatedOutput = mergeOutputs(accumulatedOutput, result.output);
        }
      }

      if (allRulesPassed) {
        // Valid permission, add to accumulator
        validPermissions.push(perm);
      }
    }

    // If no valid permissions found
    if (validPermissions.length === 0) {
      return {
        ok: false,
        reasons: [
          ...failureReasons,
          ...(failureReasons.length === 0
            ? [`No valid permissions found for key "${key}".`]
            : []
          ),
        ],
      };
    }

    // Return success with accumulated output
    return {
      ok: true,
      output: Object.keys(accumulatedOutput).length > 0 ? accumulatedOutput : undefined,
    };
  }

  /**
   * Public check entry point. Generates a `checkId`, fires `onBeforeCheck`
   * (with short-circuit support), runs the underlying check, then fires
   * `onCheck` with the resolved outcome and duration.
   */
  async function checkPermission(
    subject: Subject,
    key: string,
    target: any,
    context: any,
    resourceCache?: Map<string, any>,
    broadMatch: boolean = false,
    mode: CheckMode = "can",
  ): Promise<PermissionResult> {
    const checkId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const startTime = performance.now();

    let shortCircuited = false;
    let result: PermissionResult;

    if (onBeforeCheck) {
      const before = await onBeforeCheck({
        checkId,
        mode,
        subject,
        key,
        target,
      });
      if (before && "skip" in before && before.skip) {
        shortCircuited = true;
        result = before.skip as PermissionResult;
      } else {
        result = await runCheck(subject, key, target, context, resourceCache, broadMatch);
      }
    } else {
      result = await runCheck(subject, key, target, context, resourceCache, broadMatch);
    }

    if (onCheck) {
      await onCheck({
        checkId,
        mode,
        subject,
        key,
        target,
        ok: result.ok,
        durationMs: performance.now() - startTime,
        reasons: result.ok ? undefined : (result as { reasons: string[] }).reasons,
        output: result.ok ? (result as { output?: unknown }).output : undefined,
        shortCircuited,
      });
    }

    return result;
  }

  /**
   * Check if subject can perform action
   *
   * @example
   * permSystem.can(user, "article.read", ["article:1"])
   */
  async function can<K extends keyof PS>(
    subject: Subject,
    key: K,
    ...args: ContextArgs<PS[K]>
  ): Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>> {
    const target = args[0];
    const mergedContext = await defaultContext();

    return checkPermission(
      subject,
      key as string,
      target,
      mergedContext,
    ) as Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>>;
  }

  /**
   * Internal helper for dynamic-key checks.
   * Validates the key against the schema before checking — unknown keys return
   * a discriminated result (`code: "unknown_key"`) instead of a generic denial.
   */
  async function canDynamicInternal(
    subject: Subject,
    key: string,
    target: TargetPath | undefined,
    mergedContext: any,
    resourceCache?: Map<string, any>,
    broadMatch: boolean = false,
  ): Promise<DynamicPermissionResult> {
    if (!(key in schemas)) {
      return {
        ok: false,
        reasons: [`Unknown permission key: "${key}"`],
        code: "unknown_key",
      };
    }
    const mode: CheckMode = broadMatch ? "canBroadMatch" : "canDynamic";
    return await checkPermission(subject, key, target, mergedContext, resourceCache, broadMatch, mode) as DynamicPermissionResult;
  }

  /**
   * Check a permission whose key is known only at runtime (e.g. from a request
   * body). Returns a {@link DynamicPermissionResult} so callers can distinguish
   * "no such permission key" from "permission denied".
   *
   * @example
   * const r = await permSystem.canDynamic(user, body.permission, body.target);
   * if (!r.ok && r.code === "unknown_key") return c.json({ error: "Unknown permission" }, 400);
   * if (!r.ok) return c.json({ error: "Forbidden" }, 403);
   */
  async function canDynamic(
    subject: Subject,
    key: string,
    target?: TargetPath,
  ): Promise<DynamicPermissionResult> {
    const mergedContext = await defaultContext();
    return canDynamicInternal(subject, key, target, mergedContext);
  }

  /**
   * Broad-match check: does the subject have at least one matching permission,
   * ignoring rules that need a fetched resource? Use when the target may carry
   * wildcard segments — e.g. "do I have any badge access in this expo?".
   */
  async function canBroadMatch(
    subject: Subject,
    key: string,
    target?: TargetPath,
  ): Promise<DynamicPermissionResult> {
    const mergedContext = await defaultContext();
    return canDynamicInternal(subject, key, target, mergedContext, undefined, true);
  }

  /**
   * Compute a `{ key: boolean }` map of which permissions the subject can
   * exercise (broad-match semantics) on the given target.
   */
  async function capabilities(
    subject: Subject,
    target?: TargetPath,
    opts?: { keys?: readonly string[] },
  ): Promise<Record<string, boolean>> {
    const keys = opts?.keys ?? Object.keys(schemas);
    const mergedContext = await defaultContext();
    const resourceCache = new Map<string, any>();
    const entries = await Promise.all(
      keys.map(async (k) => {
        const r = await canDynamicInternal(subject, k, target, mergedContext, resourceCache, true);
        return [k, r.ok] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  /**
   * Collect all permissions for debugging purposes
   *
   * @example
   * // Collect permissions for a specific key
   * const permissions = await permSystem.collectPermissions({
   *   subject: user,
   *   key: "article.read",
   *   target: "article:1"
   * })
   * console.log(permissions) // [{ key: "article.read", target: "article:1", ... }]
   *
   * // Collect all permissions regardless of key
   * const allPermissions = await permSystem.collectPermissions(
   *   { subject: user, key: "article.read" },
   *   { includeAllKeys: true }
   * )
   * console.log(allPermissions) // [{ key: "article.read", ... }, { key: "article.write", ... }, ...]
   */
  async function collectPermissions<K extends keyof PS>(
    query: {
      subject: Subject;
      key: K;
    } & (PS[K] extends Permission<infer C, any> | IntermediatePermission<infer C, any>
      ? C extends undefined
        ? { target?: never }
        : { target: C }
      : { target?: never }),
    options?: {
      includeAllKeys?: boolean;
    }
  ): Promise<PermissionStateBase[]> {
    const mergedContext = await defaultContext();

    return collectPermissionsForKey(
      {
        subject: query.subject,
        key: query.key as string,
        target: query.target,
        context: mergedContext,
      },
      options
    );
  }

  /**
   * Create a checker with custom context
   */
  function withContext(
    context: Partial<MergeRequestContexts<TRules>> & { subject: Subject }
  ): any {
    return {
      async can<K extends keyof PS>(
        key: K,
        ...args: ContextArgs<PS[K]>
      ): Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>> {
        const target = args[0];

        return checkPermission(
          context.subject,
          key as string,
          target,
          { ...await defaultContext(), ...context },
        ) as Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>>;
      },
      async canDynamic(key: string, target?: TargetPath): Promise<DynamicPermissionResult> {
        return canDynamicInternal(
          context.subject,
          key,
          target,
          { ...await defaultContext(), ...context },
        );
      },
      async canBroadMatch(key: string, target?: TargetPath): Promise<DynamicPermissionResult> {
        return canDynamicInternal(
          context.subject,
          key,
          target,
          { ...await defaultContext(), ...context },
          undefined,
          true,
        );
      },
      async capabilities(
        target?: TargetPath,
        opts?: { keys?: readonly string[] },
      ): Promise<Record<string, boolean>> {
        const keys = opts?.keys ?? Object.keys(schemas);
        const mergedContext = { ...await defaultContext(), ...context };
        const resourceCache = new Map<string, any>();
        const entries = await Promise.all(
          keys.map(async (k) => {
            const r = await canDynamicInternal(
              context.subject,
              k,
              target,
              mergedContext,
              resourceCache,
              true,
            );
            return [k, r.ok] as const;
          }),
        );
        return Object.fromEntries(entries);
      },
      async collectPermissions(
        query: { key: string; target?: unknown },
        options?: { includeAllKeys?: boolean }
      ): Promise<PermissionStateBase[]> {
        return collectPermissionsForKey(
          {
            subject: context.subject,
            key: query.key,
            target: query.target,
            context: { ...await defaultContext(), ...context },
          },
          options
        );
      }
    };
  }

  /**
   * Create a permission checker with a specific context and shared cache
   *
   * @example
   * const checker = permSystem.context({ subject: user, checkDate: new Date() });
   * await checker.can("article.read", "article:1");  // Fetch
   * await checker.can("article.update", "article:1"); // Cache HIT (same cache across calls)
   */
  function context(ctx: Partial<MergeRequestContexts<TRules>> & { subject: Subject; [key: string]: any }) {
    // Create a shared cache for this context
    const cache = new Map<string, any>();

    return {
      async can<K extends keyof PS>(
        key: K,
        ...args: ContextArgs<PS[K]>
      ): Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>> {
        const target = args[0];
        const mergedContext = {
          ...await defaultContext(),
          ...ctx,
        };

        // Use the shared cache from this context
        return checkPermission(
          ctx.subject,
          key as string,
          target,
          mergedContext,
          cache  // Pass the shared cache
        ) as Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>>;
      },
      async canDynamic(key: string, target?: TargetPath): Promise<DynamicPermissionResult> {
        const mergedContext = { ...await defaultContext(), ...ctx };
        return canDynamicInternal(ctx.subject, key, target, mergedContext, cache);
      },
      async canBroadMatch(key: string, target?: TargetPath): Promise<DynamicPermissionResult> {
        const mergedContext = { ...await defaultContext(), ...ctx };
        return canDynamicInternal(ctx.subject, key, target, mergedContext, cache, true);
      },
      async capabilities(
        target?: TargetPath,
        opts?: { keys?: readonly string[] },
      ): Promise<Record<string, boolean>> {
        const keys = opts?.keys ?? Object.keys(schemas);
        const mergedContext = { ...await defaultContext(), ...ctx };
        const entries = await Promise.all(
          keys.map(async (k) => {
            const r = await canDynamicInternal(ctx.subject, k, target, mergedContext, cache, true);
            return [k, r.ok] as const;
          }),
        );
        return Object.fromEntries(entries);
      },
      async collectPermissions<K extends keyof PS>(
        query: {
          key: K;
        } & (PS[K] extends Permission<infer C, any> | IntermediatePermission<infer C, any>
          ? C extends undefined
            ? { target?: never }
            : { target: C }
          : { target?: never }),
        options?: {
          includeAllKeys?: boolean;
        }
      ): Promise<PermissionStateBase[]> {
        const mergedContext = {
          ...await defaultContext(),
          ...ctx,
        };

        return collectPermissionsForKey(
          {
            subject: ctx.subject,
            key: query.key as string,
            target: query.target,
            context: mergedContext,
          },
          {
            ...options,
            resourceCache: cache,
          }
        );
      }
    };
  }

  return {
    can,
    canDynamic,
    canBroadMatch,
    capabilities,
    collectPermissions,
    withContext,
    context,
  };
}

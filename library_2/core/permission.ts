import type {
  PermissionSchemas,
  PermissionProvider,
  PermissionRule,
  PermissionSystemConfig,
  MergeRequestContexts,
  PermissionResult,
  Subject,
  PermissionWithMetadata,
  Permission,
  IntermediatePermission,
  ExtractPermissionOutput,
} from "./types.ts";
import { matchPath } from "./matching.ts";
import { mergeOutputs } from "./merging.ts";

/**
 * Creates a permission system with validation capabilities
 */
export function createPermissionSystem<
  PS extends PermissionSchemas,
  TRules extends readonly PermissionRule<any, any>[]
>(
  config: PermissionSystemConfig<PS, TRules>
) {
  const {
    schemas,
    sources,
    rules = [],
    maxIntermediateDepth = 10
  } = config;

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
  async function resolveIntermediates(
    permissions: PermissionWithMetadata[],
    depth: number = 0
  ): Promise<PermissionWithMetadata[]> {
    if (depth >= maxIntermediateDepth) {
      // Max depth reached, stop resolving
      return permissions;
    }

    const resolved: PermissionWithMetadata[] = [];
    const toResolve: PermissionWithMetadata[] = [];

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
      const schema = schemas[perm.key] as IntermediatePermission<any>;

      try {
        const expanded = schema.provide({
          subject: perm.subject,
          target: perm.target,
        });

        // Add metadata from parent permission to children
        const withMetadata = expanded.map(exp => ({
          ...perm, // Keep parent metadata
          ...exp,  // Override with child data
        }));

        resolved.push(...withMetadata);
      } catch (_error) {
        // If provide() fails, skip this intermediate
        continue;
      }
    }

    // Recursively resolve any new intermediates
    if (toResolve.length > 0) {
      return resolveIntermediates(resolved, depth + 1);
    }

    return resolved;
  }

  /**
   * Check if a permission is granted
   */
  async function checkPermission(
    subject: Subject,
    key: string,
    target: any,
    context: any,
  ): Promise<PermissionResult> {
    // 1. Collect permissions from all providers
    const providerResults = await Promise.all(
      sources.map(source => source.provide(subject, key, target))
    );

    const allPermissions = providerResults.flat();

    // 2. Resolve intermediate permissions recursively
    const resolvedPermissions = await resolveIntermediates(allPermissions);

    // 3. Filter permissions that match the requested key
    const matchingPermissions = resolvedPermissions.filter(perm => perm.key === key);

    // 4. Accumulator for valid permissions
    const validPermissions: PermissionWithMetadata[] = [];

    // 5. Check each matching permission (collect all valid ones)
    for (const perm of matchingPermissions) {
      // Check if target matches (if specified)
      if (perm.target !== undefined && target !== undefined) {
        if (!matchPath(target, perm.target)) {
          continue; // Target doesn't match, try next permission
        }
      }

      // Apply global validation rules
      let allRulesPassed = true;

      for (const rule of rules) {
        const ruleContext = {
          ...context,
          subject,
          key,
          target,
        };

        const passed = await rule.check(perm, ruleContext, schemas[key]);

        if (!passed) {
          allRulesPassed = false;
          break; // One rule failed, skip this permission
        }
      }

      if (allRulesPassed) {
        // Valid permission, add to accumulator
        validPermissions.push(perm);
      }
    }

    // If no valid permissions found
    if (validPermissions.length === 0) {
      return { ok: false };
    }

    // 6. Fetch resource once if needed
    const permission = schemas[key];
    let resource = undefined;

    if (permission.fetchTarget && target !== undefined) {
      try {
        resource = await permission.fetchTarget(target);
      } catch (_error) {
        // If fetch fails, permission denied
        return { ok: false };
      }
    }

    // 7. Accumulate outputs from all valid permissions
    let accumulatedOutput: any = {};

    for (const perm of validPermissions) {
      if (permission.rules) {
        for (const outputRule of permission.rules) {
          const ruleContext = {
            ...context,
            subject,
            key,
            target,
          };

          const ruleOutput = await outputRule.output({
            state: perm,
            ctx: ruleContext,
            resource,
            currentOutput: accumulatedOutput,
          });

          // Merge this output with accumulated output
          accumulatedOutput = mergeOutputs(accumulatedOutput, ruleOutput);
        }
      }
    }

    // Return success with accumulated output
    return {
      ok: true,
      output: Object.keys(accumulatedOutput).length > 0 ? accumulatedOutput : undefined,
    };
  }

  /**
   * Check if subject can perform action
   */
  async function can<K extends keyof PS>(
    subject: Subject,
    key: K,
    ...args: PS[K] extends Permission<infer C, any> | IntermediatePermission<infer C, any>
      ? C extends undefined
        ? []
        : [C]
      : []
  ): Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>> {
    return checkPermission(
      subject,
      key as string,
      args[0],
      await defaultContext(),
    ) as Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>>;
  }

  /**
   * Create a checker with custom context
   */
  function withContext(context: Partial<MergeRequestContexts<TRules>>) {
    return {
      async can<K extends keyof PS>(
        subject: Subject,
        key: K,
        ...args: PS[K] extends Permission<infer C, any> | IntermediatePermission<infer C, any>
          ? C extends undefined
            ? []
            : [C]
          : []
      ): Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>> {
        return checkPermission(
          subject,
          key as string,
          args[0],
          { ...await defaultContext(), ...context },
        ) as Promise<PermissionResult<ExtractPermissionOutput<PS[K]>>>;
      }
    };
  }

  return {
    can,
    withContext,
  };
}

import type { PermissionRule } from "../core/types.ts";

/**
 * Rule that validates resource constraints
 *
 * Fetches the target resource and checks if it matches the 'with' constraints
 *
 * @example
 * WithRule()
 * // State: { with: { owner: "user:1", public: true } }
 * // Will fetch the resource and check if resource.owner === "user:1" && resource.public === true
 */
export function WithRule<
  K extends string = "with"
>(
  withKey: K = "with" as K,
  conditionObj?: (target: any, resource: any) => any
): PermissionRule<
  { [withKey]?: Record<string, any> }
> {
  return {
    name: "with",
    check: async (state, request, ctx) => {
      if (!state[withKey]) return {
        ok: true
      }; // No 'with' condition, allow

      // If we have a target and the permission has a resolver, fetch the resource
      if (request.target !== undefined && ctx.permission.fetchTarget) {
        try {
          const resource = await ctx.permission.fetchTarget(request.target);
          const working = conditionObj
            ? conditionObj(request.target, resource)
            : resource;

          // Check if resource matches all constraints in 'with'
          for (const [key, value] of Object.entries(state[withKey])) {
            if (working?.[key] !== value) {
              return {
                ok: false,
                reason: `Resource constraint '${key}' does not match`,
              }
            }
          }
        } catch (_error) {
          // If fetchTarget fails, consider the permission denied
          return {
            ok: false,
            reason: "Failed to fetch target resource",
          };
        }
      }

      return {
        ok: true
      };
    },
    default: () => ({})
  };
}

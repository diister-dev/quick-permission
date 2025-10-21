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
export function WithRule(): PermissionRule<
  { with?: Record<string, any> }
> {
  return {
    name: "with",
    check: async (state, ctx, permission) => {
      if (!state.with) return true; // No 'with' condition, allow

      // If we have a target and the permission has a resolver, fetch the resource
      if (ctx.target !== undefined && permission.fetchTarget) {
        try {
          const resource = await permission.fetchTarget(ctx.target);

          // Check if resource matches all constraints in 'with'
          for (const [key, value] of Object.entries(state.with)) {
            if (resource?.[key] !== value) {
              return false;
            }
          }
        } catch (_error) {
          // If fetchTarget fails, consider the permission denied
          return false;
        }
      }

      return true;
    },
    default: () => ({}),
  };
}

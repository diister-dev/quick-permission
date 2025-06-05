/**
 * Core Rule Module
 *
 * This module provides the foundation for creating permission rules in the Quick Permission
 * system. Rules are the basic building blocks that determine whether a permission is granted
 * based on the state and request data.
 *
 * Rules in Quick Permission:
 * - Evaluate request data against permission state
 * - Return one of four validation result types ("granted", "rejected", "neutral", "blocked")
 * - Are composable using logical operators
 * - Use schemas to enforce type safety
 * - Return one of four validation result types
 */
import { ValidationResultType } from "../types/common.ts";
import type { Rule } from "../types/rule.ts";
import type {
  Schema,
  SchemasRequests,
  SchemasStates,
} from "../types/schema.ts";

/**
 * Creates a typed permission rule with the specified schemas and validation logic.
 *
 * This function makes it easy to create properly typed rules while ensuring that
 * the check function receives correctly typed state and request parameters based
 * on the schemas provided.
 * * ## Rule Return Values
 *
 * When implementing the check function, the return value has specific meanings:
 * - `"granted"`: Explicitly grants permission
 * - `"rejected"`: Explicitly denies permission (short-circuits validation)
 * - `"neutral"`: No opinion (the rule doesn't apply to this request) * - `"blocked"`: High-priority denial that overrides other results
 *
 * ## Example Usage
 *
 * ```typescript
 * import { rule } from "@diister/quick-permission";
 * import { target } from "@diister/quick-permission/schemas/target";
 * import { owner } from "@diister/quick-permission/schemas/owner";
 *
 * // Create a custom rule
 * const customRule = rule(
 *   "customRule",
 *   [target(), owner()],
 *   (state, request) => {
 *     // Both state and request are properly typed based on the schemas
 *     if (request.from === request.owner && state.target.includes(request.target)) {
 *       return "granted"; // Explicitly allow
 *     }
 *
 *     if (isBlacklisted(request.from)) {
 *       return "rejected"; // Explicitly deny
 *     }
 *
 *     return "neutral"; // No opinion
 *   }
 * );
 * ```
 *
 * @param name The name of the rule for identification in errors
 * @param schemas The schemas that define the state and request structure
 * @param checkFn The function that implements the rule's validation logic
 * @returns A rule object with proper typing based on the schemas
 */
export function rule<
  const S extends Schema<any, any>[],
>(
  name: string,
  schemas: S,
  checkFn: (
    state: SchemasStates<S>,
    request: SchemasRequests<S>,
  ) => ValidationResultType,
): Rule<S> {
  return {
    name,
    schemas: schemas as S,
    check: checkFn,
  };
}

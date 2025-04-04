import type { Rule } from "../types/rule.ts";
import type {
  Schema,
  SchemasRequests,
  SchemasStates,
} from "../types/schema.ts";

/**
 * Helper function to create rules with automatic type inference
 *
 * @param name The name of the rule
 * @param schemas The schemas used by this rule
 * @param checkFn The function that implements the rule's logic
 * @returns A rule object with proper typing
 */
export function rule<
  const S extends Schema<any, any>[],
>(
  name: string,
  schemas: S,
  checkFn: (
    state: SchemasStates<S>,
    request: SchemasRequests<S>,
  ) => boolean | undefined,
): Rule<S> {
  return {
    name,
    schemas: schemas as S, // No need for unknown cast with proper typing
    check: checkFn,
  };
}

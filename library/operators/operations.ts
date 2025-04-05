/**
 * Permission Rule Operators
 *
 * This module provides logical operators for combining permission rules to create
 * complex validation logic. The operators follow standard boolean logic patterns
 * while respecting the tri-state nature of permission rules (true, false, undefined).
 */
import { rule } from "../core/rule.ts";
import { ExtractSchemasFromRules } from "../types/common.ts";
import type { Rule } from "../types/rule.ts";
import type { Schema } from "../types/schema.ts";

/**
 * Merges multiple rules into a single rule.
 *
 * This operator combines rules where:
 * - If any rule returns false, the result is false (short-circuit)
 * - If any rule returns true, the result is true
 * - Otherwise, the result is undefined
 *
 * This is useful for collecting multiple rules that contribute to a permission
 * without requiring all of them to explicitly allow.
 *
 * @param rules Array of rules to merge
 * @returns A single rule that combines the behavior of all input rules
 */
export function merge<const R extends Rule<any>[]>(
  rules: R,
): Rule<ExtractSchemasFromRules<R>> {
  // Merge schemas from all rules
  const schemas = mergeSchemas(rules);

  return rule(
    "merge",
    schemas,
    (state, request) => {
      let valid = undefined;
      for (const rule of rules) {
        const result = rule.check(state, request);
        if (result === false) return false;
        if (result === true) valid = true;
      }
      return valid ? true : undefined;
    },
  );
}

/**
 * Combines rules with AND logic.
 *
 * This operator requires that all rules return true for the result to be true:
 * - If any rule returns false, the result is false (short-circuit)
 * - If all rules return true, the result is true
 * - If any rule returns undefined and none return false, the result is undefined
 *
 * @param rules Array of rules to combine with AND logic
 * @returns A single rule that applies AND logic to all input rules
 */
export function and<const R extends Rule<any>[]>(
  rules: R,
): Rule<ExtractSchemasFromRules<R>> {
  // Merge schemas from all rules
  const schemas = mergeSchemas(rules);

  return rule(
    "and",
    schemas,
    (state, request) => {
      let allTrue = true;
      for (const rule of rules) {
        const result = rule.check(state, request);
        if (result === false) return false;
        if (result === undefined) allTrue = false;
      }
      return allTrue ? true : undefined;
    },
  );
}

/**
 * Combines rules with OR logic.
 *
 * This operator requires that at least one rule return true for the result to be true:
 * - If any rule returns true, the result is true (short-circuit success)
 * - Otherwise, the result is undefined
 *
 * Note: OR does not return false because undefined is treated as "no opinion",
 * and the absence of any positive opinion is not a denial.
 *
 * @param rules Array of rules to combine with OR logic
 * @returns A single rule that applies OR logic to all input rules
 */
export function or<const R extends Rule<any>[]>(
  rules: R,
): Rule<ExtractSchemasFromRules<R>> {
  // Merge schemas from all rules
  const schemas = mergeSchemas(rules);

  return rule(
    "or",
    schemas,
    (state, request) => {
      for (const rule of rules) {
        const result = rule.check(state, request);
        if (result === true) return true;
      }
      return undefined;
    },
  );
}

/**
 * Inverts the result of a rule.
 *
 * This operator applies NOT logic to a rule's result:
 * - If the rule returns true, the result is false
 * - If the rule returns false, the result is true
 * - If the rule returns undefined, the result is undefined
 *
 * @param inputRule Rule to invert
 * @returns A rule that returns the logical inverse of the input rule
 */
export function not<const R extends Rule<any>>(
  inputRule: R,
): Rule<ExtractSchemasFromRules<[R]>> {
  return rule(
    "not",
    inputRule.schemas,
    (state, request) => {
      const result = inputRule.check(state, request);
      if (result === true) return false;
      if (result === false) return true;
      return undefined;
    },
  );
}

/**
 * Merges schemas from multiple rules, avoiding duplications (by name)
 *
 * @param rules Array of rules whose schemas should be merged
 * @returns Array of unique schemas from all rules
 */
function mergeSchemas<const R extends Rule<any>[]>(
  rules: R,
): ExtractSchemasFromRules<R> {
  const schemas: Schema<any, any>[] = [];

  // Collect all unique schemas
  for (const rule of rules) {
    for (const schema of rule.schemas) {
      // Add only if a schema with the same name doesn't already exist
      const exists = schemas.some((s) => s.name === schema.name);
      if (!exists) {
        schemas.push(schema);
      }
    }
  }

  return schemas as ExtractSchemasFromRules<R>;
}

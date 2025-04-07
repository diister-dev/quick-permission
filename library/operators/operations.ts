/**
 * Permission Rule Operators
 *
 * This module provides logical operators for combining permission rules to create
 * complex validation logic. The operators follow standard logic patterns
 * while respecting the validation result types ("granted", "rejected", "neutral", "blocked").
 */
import { rule } from "../core/rule.ts";
import {
  ExtractSchemasFromRules,
  VALIDATION_RESULT,
  ValidationResultType,
} from "../types/common.ts";
import type { Rule } from "../types/rule.ts";
import type { Schema } from "../types/schema.ts";

/**
 * Merges multiple rules into a single rule.
 *
 * This operator combines rules where:
 * - If any rule returns "rejected" or "blocked", the result follows that (short-circuit)
 * - If any rule returns "granted", the result is "granted"
 * - Otherwise, the result is "neutral"
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
      let valid: ValidationResultType = VALIDATION_RESULT.NEUTRAL;
      for (const rule of rules) {
        const result = rule.check(state, request);
        if (result === VALIDATION_RESULT.REJECTED) {
          return VALIDATION_RESULT.REJECTED;
        }
        if (result === VALIDATION_RESULT.BLOCKED) {
          return VALIDATION_RESULT.BLOCKED;
        }
        if (result === VALIDATION_RESULT.GRANTED) {
          valid = VALIDATION_RESULT.GRANTED;
        }
      }
      return valid;
    },
  );
}

/**
 * Combines rules with AND logic.
 *
 * This operator requires that all rules return "granted" for the result to be "granted":
 * - If any rule returns "rejected" or "blocked", the result follows that (short-circuit)
 * - If all rules return "granted", the result is "granted"
 * - If any rule returns "neutral" and none return "rejected" or "blocked", the result is "neutral"
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
      let allGranted = true;
      for (const rule of rules) {
        const result = rule.check(state, request);
        if (result === VALIDATION_RESULT.REJECTED) {
          return VALIDATION_RESULT.REJECTED;
        }
        if (result === VALIDATION_RESULT.BLOCKED) {
          return VALIDATION_RESULT.BLOCKED;
        }
        if (result === VALIDATION_RESULT.NEUTRAL) allGranted = false;
      }
      return allGranted ? VALIDATION_RESULT.GRANTED : VALIDATION_RESULT.NEUTRAL;
    },
  );
}

/**
 * Combines rules with OR logic.
 *
 * This operator requires that at least one rule return "granted" for the result to be "granted":
 * - If any rule returns "granted", the result is "granted" (short-circuit success)
 * - Otherwise, the result is "neutral"
 *
 * Note: OR does not return "rejected" because "neutral" is treated as "no opinion",
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
        if (result === VALIDATION_RESULT.GRANTED) {
          return VALIDATION_RESULT.GRANTED;
        }
      }
      return VALIDATION_RESULT.NEUTRAL;
    },
  );
}

/**
 * Inverts the result of a rule.
 *
 * This operator applies NOT logic to a rule's result:
 * - If the rule returns "granted", the result is "rejected"
 * - If the rule returns "rejected", the result is "granted"
 * - If the rule returns "neutral", the result is "neutral"
 * - If the rule returns "blocked", the result is "granted"
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
      if (result === VALIDATION_RESULT.GRANTED) {
        return VALIDATION_RESULT.REJECTED;
      }
      if (
        result === VALIDATION_RESULT.REJECTED ||
        result === VALIDATION_RESULT.BLOCKED
      ) return VALIDATION_RESULT.GRANTED;
      return VALIDATION_RESULT.NEUTRAL;
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

/**
 * Validation logic for the permission system
 * @module validation
 */
import type {
  PermissionHierarchy,
  PermissionKey,
  PermissionRequests,
  PermissionStateSet,
  ValidationError,
  ValidationResult,
} from "../types/common.ts";
import { createDefaultStateSet, satisfiedBy } from "./hierarchy.ts";

/**
 * Validates schema and rules for a specific permission
 * @param schemas Schemas to validate
 * @param rules Rules to check
 * @param state Current state for validation
 * @param request Request to validate
 * @param permKey Key of the permission being validated
 * @returns Validation result with errors if any
 */
function allow(
  schemas: any[],
  rules: any[],
  state: any,
  request: any,
  permKey: string,
) {
  const errors: ValidationError[] = [];

  // Validate schemas
  for (const schema of schemas) {
    try {
      if (schema.state && !schema.state(state)) {
        errors.push({
          type: "schema",
          name: schema.name || "unnamed",
          permissionKey: permKey,
          message: `Invalid state for schema ${schema.name}`,
        });
      }
      if (schema.request && !schema.request(request)) {
        errors.push({
          type: "schema",
          name: schema.name || "unnamed",
          permissionKey: permKey,
          message: `Invalid request for schema ${schema.name}`,
        });
      }
    } catch (error) {
      errors.push({
        type: "schema",
        name: schema.name || "unnamed",
        permissionKey: permKey,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // If schema validation failed, no need to check rules
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  let anyExplicitAllow = undefined;

  // Validate rules
  for (const rule of rules) {
    try {
      const result = rule.check(state, request);
      if (result === false) {
        errors.push({
          type: "rule",
          name: rule.name || "unnamed",
          permissionKey: permKey,
          message: `Rule not satisfied: ${rule.name || "unnamed"}`,
        });
        return { valid: false, errors };
      }
      if (result === true) anyExplicitAllow = true;
    } catch (error) {
      errors.push({
        type: "rule",
        name: rule.name || "unnamed",
        permissionKey: permKey,
        message: error instanceof Error ? error.message : String(error),
      });
      return { valid: false, errors };
    }
  }

  return { valid: anyExplicitAllow, errors };
}

/**
 * Merges validation results using logical operations (AND/OR)
 * @param results Array of validation results to merge
 * @param mode Logical operation to use for merging ('and' or 'or')
 * @returns Merged validation result
 */
function mergeValidationResults(
  results: { valid?: boolean; errors: ValidationError[] }[],
  mode: "and" | "or" = "and",
): { valid?: boolean; errors: ValidationError[] } {
  let merged: boolean | undefined = undefined;
  const allErrors: ValidationError[] = [];

  for (const result of results) {
    // Collect all errors
    allErrors.push(...result.errors);

    // Merge valid flags
    if (result.valid !== undefined) {
      if (merged === undefined) {
        merged = result.valid;
      } else {
        if (mode === "or") {
          merged = merged || result.valid;
        } else {
          merged = merged && result.valid;
        }
      }
    }
  }

  return { valid: merged, errors: allErrors };
}

/**
 * Validates a permission request against a set of permission states
 * @param hierarchy Permission hierarchy
 * @param states Array of permission state sets
 * @param key Permission key to validate
 * @param request Request to validate
 * @returns Validation result with detailed feedback
 */
export function validate<
  H extends PermissionHierarchy<any>,
  S extends PermissionStateSet<H>[],
  K extends PermissionKey<H>,
  R extends PermissionRequests<H, K>,
>(hierarchy: H, states: S, key: K, request: R): ValidationResult {
  const satisfier = satisfiedBy(hierarchy, key);
  const stateResults: { valid?: boolean; errors: ValidationError[] }[] = [];

  // Generate default states once
  const defaultStates = createDefaultStateSet(hierarchy);

  // Process each state configuration
  for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
    const originalState = states[stateIndex];
    const chainResults: { valid?: boolean; errors: ValidationError[] }[] = [];

    // Process each permission in the chain
    for (const permKey of satisfier) {
      const permission = hierarchy.flat[permKey];

      // Get the permission state, falling back to defaults if not present
      const permissionState = {
        ...defaultStates[permKey] ?? {},
        ...originalState[permKey] ?? {},
      };

      if (!permissionState) {
        chainResults.push({ valid: undefined, errors: [] });
        continue;
      }

      // Get validation result for this permission with this state
      const result = allow(
        permission.schemas,
        permission.rules,
        permissionState,
        request,
        permKey,
      );

      // Add state index to errors
      const errorsWithStateIndex = result.errors.map((error) => ({
        ...error,
        stateIndex,
      }));

      chainResults.push({ valid: result.valid, errors: errorsWithStateIndex });
    }

    // Merge results in the permission chain (AND logic)
    const chainResult = mergeValidationResults(chainResults, "and");
    stateResults.push(chainResult);
  }

  // Merge results from different states (OR logic)
  const finalResult = mergeValidationResults(stateResults, "or");

  return {
    valid: finalResult.valid ?? false,
    reasons: finalResult.valid ? [] : finalResult.errors,
  };
}

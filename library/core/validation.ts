/**
 * Validation logic for the permission system
 * @module validation
 */
import {
  FlatPermissionStateArray,
  PermissionHierarchy,
  PermissionKey,
  PermissionRequests,
  PermissionStates,
  PermissionStateSet,
  PermissionStateTuple,
  VALIDATION_RESULT,
  ValidationError,
  ValidationResult,
  ValidationResultType,
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
          message: `Invalid state for schema ${schema.name}`,
        });
      }
      if (schema.request && !schema.request(request)) {
        errors.push({
          type: "schema",
          name: schema.name || "unnamed",
          message: `Invalid request for schema ${schema.name}`,
        });
      }
    } catch (error) {
      errors.push({
        type: "schema",
        name: schema.name || "unnamed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // If schema validation failed, no need to check rules
  if (errors.length > 0) {
    return { valid: VALIDATION_RESULT.REJECTED, errors };
  }

  let resultType: ValidationResultType = VALIDATION_RESULT.NEUTRAL;

  // Validate rules
  for (const rule of rules) {
    try {
      const result = rule.check(state, request);
      // For backward compatibility: convert boolean results to ValidationResultType
      let ruleResult: ValidationResultType;
      if (result === false) ruleResult = VALIDATION_RESULT.REJECTED;
      else if (result === true) ruleResult = VALIDATION_RESULT.GRANTED;
      else if (result === undefined) ruleResult = VALIDATION_RESULT.NEUTRAL;
      else ruleResult = result; // Already using the new enum type

      // "BLOCKED" has highest priority and immediately ends validation
      if (ruleResult === VALIDATION_RESULT.BLOCKED) {
        errors.push({
          type: "rule",
          name: rule.name || "unnamed",
          message: `Access blocked: ${rule.name || "unnamed"}`,
        });
        return { valid: VALIDATION_RESULT.BLOCKED, errors };
      }

      // "REJECTED" has second priority
      if (ruleResult === VALIDATION_RESULT.REJECTED) {
        errors.push({
          type: "rule",
          name: rule.name || "unnamed",
          message: `Rule not satisfied: ${rule.name || "unnamed"}`,
        });
        return { valid: VALIDATION_RESULT.REJECTED, errors };
      }

      // Only update to GRANTED if we don't already have a more decisive result
      if (
        ruleResult === VALIDATION_RESULT.GRANTED &&
        resultType === VALIDATION_RESULT.NEUTRAL
      ) {
        resultType = VALIDATION_RESULT.GRANTED;
      }
    } catch (error) {
      const errorExist = errors.find(
        (e) => e.type === "rule" && e.name === rule.name,
      );
      errors.push({
        type: "rule",
        name: rule.name || "unnamed",
        message: error instanceof Error ? error.message : String(error),
      });
      return { valid: VALIDATION_RESULT.REJECTED, errors };
    }
  }

  return { valid: resultType, errors };
}

/**
 * Merges validation results using logical operations (AND/OR)
 * @param results Array of validation results to merge
 * @param mode Logical operation to use for merging ('and' or 'or')
 * @returns Merged validation result
 */
function mergeValidationResults(
  results: { valid?: ValidationResultType; errors: ValidationError[] }[],
  mode: "and" | "or" = "or",
): { valid?: ValidationResultType; errors: ValidationError[] } {
  let merged: ValidationResultType | undefined = undefined;
  const allErrors: ValidationError[] = [];

  for (const result of results) {
    // Collect all errors
    for (const error of result.errors) {
      // Check if the error already exists in the merged errors
      const existingError = allErrors.find(
        (e) => e.type === error.type && e.name === error.name,
      );
      if (!existingError) {
        allErrors.push(error);
      }
    }

    // Merge valid flags
    if (result.valid !== undefined) {
      if (merged === undefined) {
        merged = result.valid;
      } else {
        // "BLOCKED" has highest priority
        if (
          result.valid === VALIDATION_RESULT.BLOCKED ||
          merged === VALIDATION_RESULT.BLOCKED
        ) {
          merged = VALIDATION_RESULT.BLOCKED;
          continue;
        }

        if (mode === "or") {
          // OR logic with new result types
          if (
            merged === VALIDATION_RESULT.GRANTED ||
            result.valid === VALIDATION_RESULT.GRANTED
          ) {
            merged = VALIDATION_RESULT.GRANTED;
          } else if (
            merged === VALIDATION_RESULT.REJECTED &&
            result.valid === VALIDATION_RESULT.REJECTED
          ) {
            merged = VALIDATION_RESULT.REJECTED;
          } else {
            merged = result.valid; // Keep right side for NEUTRAL
          }
        } else {
          // AND logic with new result types
          if (
            merged === VALIDATION_RESULT.NEUTRAL ||
            result.valid === VALIDATION_RESULT.NEUTRAL
          ) {
            merged = VALIDATION_RESULT.NEUTRAL;
          } else if (
            merged === VALIDATION_RESULT.REJECTED ||
            result.valid === VALIDATION_RESULT.REJECTED
          ) {
            merged = VALIDATION_RESULT.REJECTED;
          } else {
            merged = VALIDATION_RESULT.GRANTED; // Both are GRANTED
          }
        }
      }
    }
  }

  return { valid: merged, errors: allErrors };
}

/**
 * Validates a permission request against a set of permission states
 * @param hierarchy Permission hierarchy
 * @param states Array of permission state sets, which can now contain arrays of states for each permission
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
  const permission = hierarchy.flat[key];
  if (!permission) {
    throw new Error(`Permission "${key}" not found in hierarchy`);
  }

  const satisfier = satisfiedBy(hierarchy, key);
  const stateResults: {
    valid?: ValidationResultType;
    errors: ValidationError[];
  }[] = [];

  // Generate default states once
  const defaultStates = createDefaultStateSet(hierarchy);

  // Process each state configuration
  for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
    const originalState = states[stateIndex];
    const chainResults: {
      valid?: ValidationResultType;
      errors: ValidationError[];
    }[] = [];

    // Process each permission in the chain
    for (const permKey of satisfier) {
      let permissionStateEntries = originalState[permKey];

      // New: Handle both single state object and array of state objects
      if (permissionStateEntries === undefined) {
        // No state defined at all, use default
        const defaultState = {
          ...defaultStates[key],
          ...defaultStates[permKey],
        };
        // Use type assertion to ensure compatibility with expected types
        permissionStateEntries = defaultState !== undefined
          ? [defaultState as PermissionStates<H, typeof permKey>]
          : undefined;
      } else if (!Array.isArray(permissionStateEntries)) {
        // Single state object - convert to array for unified processing
        permissionStateEntries = [permissionStateEntries];
      }

      // If there's no state even after considering defaults, skip validation
      if (!permissionStateEntries) {
        chainResults.push({ valid: VALIDATION_RESULT.NEUTRAL, errors: [] });
        continue;
      }

      // New: Process each state entry for this permission
      const permStateResults: {
        valid?: ValidationResultType;
        errors: ValidationError[];
      }[] = [];

      for (const permissionState of permissionStateEntries) {
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

        permStateResults.push({
          valid: result.valid,
          errors: errorsWithStateIndex,
        });
      }

      // Merge results for all states of this permission with OR logic
      const permResult = mergeValidationResults(permStateResults);
      chainResults.push(permResult);
    }

    // Merge results in the permission chain (OR logic)
    const chainResult = mergeValidationResults(chainResults);
    stateResults.push(chainResult);
  }

  // Merge results from different states (OR logic)
  const finalResult = mergeValidationResults(stateResults);

  // Convert ValidationResultType to boolean for compatibility
  const isValid = finalResult.valid === VALIDATION_RESULT.GRANTED;

  // Check if any of the results was REJECTED or BLOCKED
  const isExplicitlyRejected =
    finalResult.valid === VALIDATION_RESULT.REJECTED ||
    finalResult.valid === VALIDATION_RESULT.BLOCKED;

  return {
    valid: isValid,
    reasons: isExplicitlyRejected ? finalResult.errors : [],
    resultType: finalResult.valid, // Expose the detailed result type
  };
}

/**
 * Converts a flat array of permission state tuples to a standard permission state set
 * This allows using the tuple format for storage while keeping the internal validation logic unchanged
 *
 * @param flatStates Array of [permission key, state] tuples
 * @returns A standard permission state set object
 */
export function convertFlatStatesToObject<H>(
  flatStates: FlatPermissionStateArray<H>,
): PermissionStateSet<H> {
  const result: PermissionStateSet<H> = {};

  for (const [key, state] of flatStates) {
    // If we already have an entry for this key
    if (result[key]) {
      // If it's already an array, add the new state to it
      if (Array.isArray(result[key])) {
        (result[key] as any[]).push(state);
      } else {
        // Otherwise convert the existing single state to an array with the new state
        result[key] = [result[key], state] as any;
      }
    } else {
      // First state for this key
      result[key] = state;
    }
  }

  return result;
}

/**
 * Validates a permission request using a flat array of permission states
 * This is an alternative to the standard validate function that accepts a more database-friendly format
 *
 * @param hierarchy Permission hierarchy
 * @param flatStates Array of [permission key, state] tuples
 * @param key Permission key to validate
 * @param request Request to validate
 * @returns Validation result
 */
export function validateWithFlatStates<
  H extends PermissionHierarchy<any>,
  K extends PermissionKey<H>,
  R extends PermissionRequests<H, K>,
>(
  hierarchy: H,
  flatStates: FlatPermissionStateArray<H>[],
  key: K,
  request: R,
): ValidationResult {
  // Convert flat states to standard object format
  const objectStates = flatStates.map((stateArray) =>
    convertFlatStatesToObject<H>(stateArray)
  );

  // Use the standard validation function
  return validate(hierarchy, objectStates, key, request);
}

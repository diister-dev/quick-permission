/**
 * Rule Type Definitions
 *
 * This module defines the structure of permission rules, which are the core validation
 * components that determine if a permission is granted based on state and request data.
 */
import { Schema, SchemasRequests, SchemasStates } from "./schema.ts";
import { VALIDATION_RESULT, ValidationResultType } from "../types/common.ts";

/**
 * Represents a permission rule that validates requests against state
 *
 * A rule consists of:
 * - A name for identification in errors and debugging
 * - An array of schemas that define the structure of state and request
 * - A check function that performs the validation logic
 *
 * The check function can return:
 * - `GRANTED`: Permission is explicitly granted
 * - `REJECTED`: Permission is denied (normal deny)
 * - `BLOCKED`: Permission is denied with high priority (e.g., ban, override)
 * - `NEUTRAL`: No opinion (neutral)
 * - For backward compatibility: `true` (GRANTED), `false` (REJECTED), `undefined` (NEUTRAL)
 *
 * @template S The array of schemas used by this rule
 */
export type Rule<
  S extends Schema<any, any>[] = any,
> = {
  /** Identifier for the rule, used in error messages and debugging */
  name: string;
  /** Schemas that define the structure of state and request */
  schemas: S;
  /**
   * Function that validates a request against state
   * Returns a ValidationResultType or a legacy boolean/undefined value
   */
  check: (
    state: SchemasStates<S>,
    request: SchemasRequests<S>,
  ) => ValidationResultType;
};

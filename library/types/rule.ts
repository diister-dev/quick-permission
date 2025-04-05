/**
 * Rule Type Definitions
 *
 * This module defines the structure of permission rules, which are the core validation
 * components that determine if a permission is granted based on state and request data.
 */
import { Schema, SchemasRequests, SchemasStates } from "./schema.ts";

/**
 * Represents a permission rule that validates requests against state
 *
 * A rule consists of:
 * - A name for identification in errors and debugging
 * - An array of schemas that define the structure of state and request
 * - A check function that performs the validation logic
 *
 * The check function can return:
 * - `true`: Permission is explicitly granted
 * - `false`: Permission is explicitly denied (short-circuits further validation)
 * - `undefined`: No opinion (neutral)
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
   * Returns true (allow), false (deny), or undefined (no opinion)
   */
  check: (
    state: SchemasStates<S>,
    request: SchemasRequests<S>,
  ) => boolean | undefined;
};

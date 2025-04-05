/**
 * Schema Type Definitions
 *
 * This module defines the structure of permission schemas, which provide type safety
 * and validation for permission states and requests in the Quick Permission system.
 *
 * Schemas ensure that rules receive properly structured data and can perform
 * validation of state and request objects.
 */

/**
 * Represents a schema that defines and validates state and request structures
 *
 * A schema consists of:
 * - A name for identification
 * - Optional type guards for state and request validation
 * - An optional function to generate default state
 *
 * @template State The type of state this schema defines
 * @template Request The type of request this schema defines
 */
export type Schema<
  State extends object,
  Request extends object,
> = {
  /** Identifier for the schema, used in error messages and deduplication */
  name: string;
  /** Type guard function that validates state structure */
  state?: (obj: unknown) => obj is State;
  /** Type guard function that validates request structure */
  request?: (obj: unknown) => obj is Request;
  /** Function that generates a default state when none is provided */
  defaultState?: () => State;
};

/**
 * Utility type that merges the State types from an array of schemas
 *
 * This creates a combined state type that includes all properties
 * from each schema's State type.
 *
 * @template T Array of schemas
 */
export type SchemasStates<T> = T extends [infer A, ...infer B]
  ? B extends []
    ? A extends Schema<infer State, any>
      ? State extends undefined ? never : State
    : never
  : A extends Schema<infer State, any>
    ? (State extends undefined ? never : State) & SchemasStates<B>
  : never
  : never;

/**
 * Utility type that merges the Request types from an array of schemas
 *
 * This creates a combined request type that includes all properties
 * from each schema's Request type.
 *
 * @template T Array of schemas
 */
export type SchemasRequests<T> = T extends [infer A, ...infer B]
  ? B extends [] ? A extends Schema<any, infer Request> ? Request : never
  : A extends Schema<any, infer Request> ? Request & SchemasRequests<B>
  : never
  : never;

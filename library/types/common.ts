/**
 * Common Type Definitions
 *
 * This module defines the core type structure for the Quick Permission system,
 * including hierarchies, permissions, and validation results.
 */
import { Rule } from "./rule.ts";
import { Schema, SchemasRequests, SchemasStates } from "./schema.ts";

type TODO = any; // TODO: Replace with actual type

/**
 * Constants defining the possible outcomes of a validation operation
 * - NEUTRAL: The rule has no opinion (was undefined)
 * - GRANTED: The rule explicitly allows the permission (was true)
 * - REJECTED: The rule denies the permission for normal reasons (was false)
 * - BLOCKED: The rule denies the permission with high priority (override)
 */
export const VALIDATION_RESULT = {
  NEUTRAL: "neutral" as const,
  GRANTED: "granted" as const,
  REJECTED: "rejected" as const,
  BLOCKED: "blocked" as const,
};

/**
 * The type of result returned by a rule validation
 */
export type ValidationResultType =
  typeof VALIDATION_RESULT[keyof typeof VALIDATION_RESULT];

/**
 * Represents a processed permission hierarchy with additional metadata
 *
 * @template H The raw hierarchy type
 */
export type PermissionHierarchy<H extends Hierarchy> = {
  type: "hierarchy";
  hierarchy: H;
  flat: TODO;
  keys: TODO;
};

/**
 * Defines the structure of a permission hierarchy
 *
 * A hierarchy is a nested structure of permissions that can be organized
 * in a tree structure with parent-child relationships.
 */
export type Hierarchy = {
  [key: string]:
    | Hierarchy
    | Permission<
      Schema<any, any>[] | undefined,
      Rule<any>[] | undefined,
      Hierarchy | undefined
    >
    | undefined;
};

/**
 * Defines a permission node within a hierarchy
 *
 * Each permission can have schemas, rules, and child permissions.
 *
 * @template S Array of schemas for this permission
 * @template R Array of rules for this permission
 * @template C Child hierarchy for nested permissions
 */
export type Permission<
  S extends Schema<any, any>[] | undefined,
  R extends Rule<any>[] | undefined,
  C extends Hierarchy | undefined,
> = {
  type: "permission";
  schemas: PermissionSchemas<S, R>; // Schemas derived from rules
  rules: R;
  children: C;
  defaultState?: object; // Default state for the permission
};

/**
 * Combines explicit schemas with those extracted from rules
 *
 * @template S Explicit schemas
 * @template R Rules that may contain additional schemas
 */
export type PermissionSchemas<S, R> = S extends Schema<any, any>[]
  ? R extends Rule<any>[] ? [...S, ...ExtractSchemasFromRules<R>]
  : S
  : R extends Rule<any>[] ? ExtractSchemasFromRules<R>
  : never;

/**
 * Utility type to extract all unique schemas from rules
 *
 * @template R Array of rules
 */
export type ExtractSchemasFromRules<R extends Rule<any>[]> = R extends
  [infer First, ...infer Rest]
  ? First extends Rule<infer S>
    ? S extends Schema<any, any>[]
      ? Rest extends Rule<any>[] ? [...S, ...ExtractSchemasFromRules<Rest>]
      : S
    : []
  : []
  : [];

/**
 * Flattens a hierarchy into a structure with paths and values
 *
 * @template H The hierarchy type
 * @template K The prefix for paths
 * @template Depth The depth limit for recursion
 */
type ComputeHierarchy<
  H,
  K extends string = "",
  Depth extends string = "0123456789", // Prevent infinite recursion
> = H extends Hierarchy ? {
    [key in keyof H]: key extends string
      ? H[key] extends Permission<infer S, infer R, infer C> ?
          | { path: `${K}${key}`; value: H[key] }
          | (C extends Hierarchy ? ComputeHierarchy<C, `${K}${key}.`>
            : never)
      : H[key] extends infer E
        ? E extends Hierarchy
          ? Depth extends `${infer H}${infer R}`
            ? ComputeHierarchy<E, `${K}${key}.`, R>
          : never
        : never
      : never
      : never;
  }[keyof H]
  : never;

/**
 * Flattens a hierarchy into a structure with paths and values
 * @template H The hierarchy type
 */
export type FlatHierarchy<H> = H extends Hierarchy ? {
    [key in ComputeHierarchy<H>["path"]]: ComputeHierarchy<H> extends infer F
      ? F extends { path: key; value: infer V } ? V : never
      : never;
  }
  : never;

/**
 * Represents a specific permission element within a hierarchy
 *
 * @template H The hierarchy type
 * @template K The key of the permission
 */
export type PermissionElement<H, K extends PermissionKey<H>> = H extends
  PermissionHierarchy<infer H>
  ? ComputeHierarchy<H> extends infer F
    ? F extends { path: K; value: infer V } ? F
    : never
  : never
  : never;

/**
 * Represents the states associated with a permission
 *
 * @template H The hierarchy type
 * @template K The key of the permission
 */
export type PermissionStates<H, K extends PermissionKey<H>> =
  PermissionElement<H, K> extends infer E
    ? E extends { value: Permission<infer S, infer R, any> }
      ? SchemasStates<PermissionSchemas<S, R>>
    : never
    : never;

/**
 * Represents the requests associated with a permission
 *
 * @template H The hierarchy type
 * @template K The key of the permission
 */
export type PermissionRequests<H, K extends PermissionKey<H>> =
  PermissionElement<H, K> extends infer E
    ? E extends { value: Permission<infer S, infer R, any> }
      ? R extends Rule<infer S>[] ? SchemasRequests<PermissionSchemas<S, R>>
      : never
    : never
    : never;

/**
 * Represents the key of a permission within a hierarchy
 *
 * @template P The permission hierarchy
 */
export type PermissionKey<P> = P extends PermissionHierarchy<infer H>
  ? ComputeHierarchy<H>["path"]
  : never;

/**
 * Represents a permission state set for a hierarchy
 *
 * Maps permission keys to their states or arrays of states
 *
 * @template H The permission hierarchy
 */
export type PermissionStateSet<H> = {
  [K in PermissionKey<H>]?: PermissionStates<H, K> | PermissionStates<H, K>[];
};

/**
 * Represents a flat permission state entry using a tuple format
 * This format is easier to store in databases as it avoids nested objects
 *
 * @template H The permission hierarchy
 */
export type PermissionStateTuple<H> = [
  PermissionKey<H>,
  PermissionStates<H, PermissionKey<H>>,
];

/**
 * Represents a flat array of permission state entries
 * This is an alternative to PermissionStateSet that uses tuples instead of an object
 *
 * @template H The permission hierarchy
 */
export type FlatPermissionStateArray<H> = PermissionStateTuple<H>[];

/**
 * Describes an error that occurred during permission validation
 */
export type ValidationError = {
  /** The type of component that caused the error */
  type: "schema" | "rule";
  /** The name of the rule or schema */
  name: string;
  /** Human-readable error message */
  message: string;
  /** Index of the state where the error occurred (for multiple states) */
  stateIndex?: number;
};

/**
 * Result of a permission validation operation
 */
export type ValidationResult = {
  /** Whether the permission is granted */
  valid: boolean;
  /** List of errors if validation failed */
  reasons: ValidationError[];
  /** The detailed validation result type (for internal use) */
  resultType?: ValidationResultType;
};

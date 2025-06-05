/**
 * Quick Permission - Operators Module
 * * This module exports logical operators for combining permission rules to create
 * complex validation logic. These operators follow standard boolean logic patterns
 * while respecting the four-state nature of permission rules ("granted", "rejected", "neutral", "blocked").
 *
 * ## Available Operators
 * * - **and**: Combines multiple rules with AND logic, requiring all rules to grant permission
 * - **or**: Combines multiple rules with OR logic, requiring at least one rule to grant permission
 * - **not**: Inverts the result of a rule
 * - **merge**: Combines multiple rule sets into a single rule set
 *
 * ## Example Usage
 *
 * ```typescript
 * import { permission } from "@diister/quick-permission";
 * import { allowTarget } from "@diister/quick-permission/rules/allowTarget";
 * import { allowOwner } from "@diister/quick-permission/rules/allowOwner";
 * import { and, or, not } from "@diister/quick-permission/operators";
 *
 * // Create a permission with complex rule logic
 * const editPermission = permission({
 *   rules: [
 *     // User must either be the owner OR have explicit target permission AND not be blacklisted
 *     or([
 *       allowOwner(),
 *       and([
 *         allowTarget(),
 *         not(isBlacklisted())
 *       ])
 *     ])
 *   ]
 * });
 * ```
 *
 * @module operators
 */

export { and, merge, not, or } from "./operations.ts";

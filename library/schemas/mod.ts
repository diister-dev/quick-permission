/**
 * Quick Permission - Schemas Module
 *
 * This module exports schema definitions that describe the structure and validation
 * of permission states and requests. Schemas provide type safety and validation for
 * permission rules, ensuring they receive properly structured data.
 *
 * ## Available Schemas
 *
 * - **owner**: Provides ownership context for permission validation
 * - **target**: Defines target patterns for permission checks
 * - **time**: Provides time-based constraints for permissions
 *
 * ## Schema Functions
 *
 * Each schema provides:
 * - Type definitions for state and request data
 * - Validation logic for the schema's data
 * - Default state generation for minimal required structure
 *
 * ## Example Usage
 *
 * ```typescript
 * import { rule } from "@diister/quick-permission";
 * import { owner } from "@diister/quick-permission/schemas/owner";
 * import { target } from "@diister/quick-permission/schemas/target";
 *
 * // Create a custom rule using schemas
 * const customRule = rule(
 *   "customRule",
 *   [owner(), target()],
 *   (state, request) => {
 *     // Access typed state and request data
 *     if (request.from === state.owner && state.target.includes(request.target)) {
 *       return true;
 *     }
 *     return undefined;
 *   }
 * );
 * ```
 *
 * @module schemas
 */

export { owner } from "./owner/owner.ts";
export { target } from "./target/target.ts";
export { time } from "./time/time.ts";

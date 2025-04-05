/**
 * Quick Permission Library
 *
 * A flexible and type-safe permission system for TypeScript/JavaScript applications.
 *
 * This library provides a hierarchical permission system with strong type safety, allowing
 * you to define complex permission rules that can be composed together and validated
 * against multiple permission sources.
 *
 * ## Key Features
 *
 * - **Hierarchical Structure**: Organize permissions in an intuitive tree structure
 * - **Strong Type Safety**: Full TypeScript support for permission requests and states
 * - **Rule Composition**: Combine rules with AND, OR, and NOT operators
 * - **Multiple Permission Sources**: Validate against multiple state sources simultaneously
 * - **Performance Focused**: Optimized for efficient validation in large applications
 *
 * ## Basic Usage
 *
 * ```typescript
 * import { hierarchy, permission, validate } from "@diister/quick-permission";
 * import { allowTarget } from "@diister/quick-permission/rules/allowTarget";
 * import { allowOwner } from "@diister/quick-permission/rules/allowOwner";
 *
 * // Create a permission hierarchy
 * const filePermissions = hierarchy({
 *   files: permission({
 *     rules: [allowTarget({ wildcards: true })],
 *     children: {
 *       read: permission({
 *         rules: [allowTarget()],
 *       }),
 *       write: permission({
 *         rules: [allowOwner()],
 *       }),
 *     },
 *   }),
 * });
 *
 * // Define permission states
 * const states = [
 *   {
 *     "files.read": { target: ["file:public/*", "file:user/123/*"] },
 *     "files.write": { target: ["file:user/123/*"] },
 *   },
 * ];
 *
 * // Check a permission request
 * const result = validate(filePermissions, states, "files.read", {
 *   from: "user:123",
 *   target: "file:public/document.txt",
 * });
 *
 * console.log(result.allowed); // true
 * ```
 *
 * @module
 */

// Re-export core components
export { hierarchy, permission, validate } from "./core/permission.ts";
export { createDefaultStateSet, satisfiedBy } from "./core/hierarchy.ts";

// Re-export operators
export { and, merge, not, or } from "./operators/operations.ts";

// Re-export rules
export { allowOwner } from "./rules/allowOwner/allowOwner.ts";
export { allowSelf } from "./rules/allowSelf/allowSelf.ts";
export { allowTarget } from "./rules/allowTarget/allowTarget.ts";
export { denySelf } from "./rules/denySelf/denySelf.ts";
export { ensureTime } from "./rules/ensureTime/ensureTime.ts";

// Re-export schemas
export { owner } from "./schemas/owner/owner.ts";
export { target } from "./schemas/target/target.ts";
export { time } from "./schemas/time/time.ts";

// Re-export types
export type {
  Hierarchy,
  Permission,
  PermissionHierarchy,
  PermissionKey,
  PermissionRequests,
  PermissionStateSet,
  ValidationError,
  ValidationResult,
} from "./types/common.ts";

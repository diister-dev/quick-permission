/**
 * Quick Permission Library
 *
 * A flexible and type-safe permission system for TypeScript
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

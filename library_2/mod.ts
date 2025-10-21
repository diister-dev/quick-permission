/**
 * Quick Permission - Type-safe permission system
 *
 * @module
 */

// Core
export { createPermissionSystem } from "./core/permission.ts";
export { matchPath } from "./core/matching.ts";
export type {
  Subject,
  Permission,
  IntermediatePermission,
  PermissionDefinition,
  PermissionSchemas,
  PermissionProvider,
  PermissionRule,
  OutputRule,
  PermissionWithMetadata,
  PermissionResult,
  PermissionSystemConfig,
  MergeRequestContexts,
  ExtractPermissionOutput,
  ExtractRuleOutput,
  MergeRuleOutputs,
} from "./core/types.ts";

// Helpers
export { permission, intermediate } from "./helpers/builders.ts";

// Providers
export { directProvider } from "./providers/direct.ts";
export { ownerProvider } from "./providers/owner.ts";

// Rules
export { TimeRule } from "./rules/time.ts";
export { IpRule } from "./rules/ip.ts";
export { WithRule } from "./rules/with.ts";
export { FilterRule } from "./rules/filter.ts";

// Utilities
export { applyFilter, pickFields } from "./core/filtering.ts";
export { mergeFilters, mergeOutputs } from "./core/merging.ts";
export type { FilterSpec } from "./core/merging.ts";

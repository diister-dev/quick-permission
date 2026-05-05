export { seg, target } from "./target.ts";
export type {
  AnySegment,
  AnyTarget,
  SegmentNames,
  SegmentSpec,
  SpecToSegment,
  TargetArgs,
  TargetNone,
  TargetOptional,
  TargetPath,
  TargetRequired,
} from "./types.ts";

export { payload } from "./payload.ts";
export type { ExtractPayload, PayloadSpec } from "./payload.ts";

export { custom, filter, ip, match, time } from "./rules.ts";
export type {
  CustomCtx,
  CustomRule,
  FilterRule,
  IpRule,
  MatchRule,
  Rule,
  TimeRule,
} from "./rules.ts";

export { intermediate, permission } from "./permission.ts";
export type {
  AnyIntermediate,
  AnyPermission,
  Intermediate,
  IntermediateChild,
  Permission,
  PermissionBuilder,
  PermissionConfig,
} from "./permission.ts";

export { createPermissionFactory } from "./factory.ts";
export type { PermissionFactory } from "./factory.ts";

export { createSystem } from "./system.ts";
export type {
  CanContext,
  CanResult,
  Grant,
  ListEntry,
  Provider,
  RuleDescriptor,
  SerializableSegment,
  SerializableTarget,
  Subject,
  System,
  TreeNode,
} from "./system.ts";

export { directProvider, ownerProvider } from "./providers.ts";
export type { DirectGrant } from "./providers.ts";

export { applyFilter, pickFields } from "./core/filtering.ts";
export type { FilterSpec } from "./core/merging.ts";

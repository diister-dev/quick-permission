/**
 * `@diister/quick-permission` — API publique.
 *
 * Expose une primitive unique `defineRule({ needs, check })` autour de
 * laquelle sont organisés les `Resource`, méthodes de sucre, et le moteur
 * d'orchestration avec dedup par contexte.
 *
 * Cf. `docs/rfc-resource-pipe-api.md` pour la motivation, les décisions
 * de design et le plan de migration.
 */

// ─── Targets ─────────────────────────────────────────────────────────────
export { seg, target } from "./target.ts";

// ─── Core types ──────────────────────────────────────────────────────────
export type {
  AnySegment,
  AnyTarget,
  CanResult,
  FetchCtx,
  FilterContribution,
  Grant,
  ListEntry,
  Permission,
  Resource,
  ResourceData,
  ResourcesData,
  Rule,
  RuleDescriptor,
  RuleResult,
  SegmentSpec,
  SerializableSegment,
  SerializableTarget,
  SpecToSegment,
  Subject,
  TargetArgs,
  TargetNone,
  TargetOptional,
  TargetPath,
  TargetRequired,
  TreeNode,
} from "./types.ts";

// ─── Resource factory + sugar methods ────────────────────────────────────
export { resource } from "./resource.ts";

// ─── Indirect resource (JOIN-based, generates aggregation pipeline) ──────
export { indirectResource } from "./indirect-resource.ts";
export type {
  IndirectResource,
  IndirectResourceJoin,
} from "./indirect-resource.ts";
export type { AggregationStage } from "./indirect-aggregation.ts";

// ─── defineRule + standalone helpers ─────────────────────────────────────
export { defineRule, matchPath, requireSelf } from "./rules.ts";
export type { DefineRuleOpts } from "./rules.ts";

// ─── Permission builders ─────────────────────────────────────────────────
export { intermediate, permission } from "./permission.ts";
export type {
  IntermediateBuilder,
  IntermediateConfig,
  PermissionBuilder,
  PermissionConfig,
} from "./permission.ts";

// ─── System ──────────────────────────────────────────────────────────────
export { createSystem } from "./system.ts";
export type {
  CanContext,
  Provider,
  ProviderFn,
  ProviderObject,
  System,
} from "./system.ts";

// ─── Field-projection helpers (used outside permission checks too) ───────
export { applyFilter, pickFields } from "./core/filtering.ts";
export type { FilterSpec } from "./core/merging.ts";

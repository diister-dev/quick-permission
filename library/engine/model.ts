import type { Condition } from "../condition.ts";
import type { Grant } from "../grant.ts";
import type { RefConvention } from "../refs.ts";
import type { RelationInfo } from "../storage/plan.ts";
import type { DocumentSource, MaybePromise, RelatedSource } from "./loader.ts";

export type Subject = { readonly id: string } & Readonly<
  Record<string, unknown>
>;

export type Scope = "self" | "parent" | "none";

export type Facts = {
  readonly subject: Subject;
  readonly ids: readonly string[];
  readonly input?: unknown;
  readonly at?: Date;
  readonly ip?: string;
};

export type ConditionContext = Facts & { readonly grant: Grant };

export type NamedCondition = {
  readonly name: string;
  readonly needsDoc: boolean;
  readonly field?: string;
  readonly whenUnknown: "allow" | "deny";
  holds(doc: unknown, context: ConditionContext): boolean;
};

export type Ownership = {
  readonly name: string;
  readonly to: EntityModel;
  readonly via: "field" | "relation";
  readonly slot: string;
  where(owner: string): Condition;
};

export type RelationModel = RelationInfo & {
  readonly name: string;
  readonly source: RelatedSource;
};

export type EntityModel = {
  readonly name: string;
  readonly refType: string;
  readonly idField: string;
  readonly depth: number;
  readonly lineage: readonly EntityModel[];
  readonly refs: RefConvention;
  readonly wildcard: string;
  readonly stored: boolean;
  readonly verifyExists: boolean;
  readonly source: DocumentSource;
  readonly relations: ReadonlyMap<string, RelationModel>;
  readonly conditions: ReadonlyMap<string, NamedCondition>;
  readonly ownerships: readonly Ownership[];
};

export type RuleVerdict =
  | boolean
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type RuleContext = Facts & {
  readonly key: string;
  readonly grant: Grant;
  readonly decidable: boolean;
  doc(): Promise<unknown>;
  parent(name: string): Promise<unknown>;
};

export type CustomRule = {
  readonly name: string;
  readonly when?: string;
  readonly perDocument?: boolean;
  check(context: RuleContext): MaybePromise<RuleVerdict>;
  rows?(context: RuleContext): Condition | null;
};

export type KeyModel = {
  readonly key: string;
  readonly kind: "action" | "list" | "bundle";
  readonly entity: EntityModel | null;
  readonly on: Scope;
  readonly path: readonly EntityModel[];
  readonly subject: EntityModel | null;
  readonly prefix: string;
  readonly includeRefs: readonly (string | { readonly external: string })[];
  readonly includes: readonly string[];
  readonly read: string | undefined;
  readonly fields: "doc" | "input" | null;
  readonly input: boolean;
  readonly forbid: readonly string[];
  readonly targetConstraint: boolean;
  readonly rules: readonly CustomRule[];
  readonly parents: ReadonlySet<string>;
  readonly conditions: ReadonlySet<string>;
  readonly expand: ((grant: Grant) => readonly Grant[]) | undefined;
  readonly meta: unknown;
};

export type Catalogue = ReadonlyMap<string, KeyModel>;

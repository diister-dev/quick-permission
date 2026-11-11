import type { Condition } from "./condition.ts";
import type { MaybePromise } from "./engine/loader.ts";
import type {
  ConditionContext,
  EntityModel,
  NamedCondition,
  Ownership,
  RelationModel,
  Subject,
} from "./engine/model.ts";
import type { Grant, ProviderObject } from "./grant.ts";
import { type RefConvention, typedRefs } from "./refs.ts";

export type { Ownership };

export type Path = readonly string[];

export type RelationSpec<
  TDoc,
  TPath extends Path,
  TRelation extends string = string,
> = {
  readonly id?: string;
  readonly localField: string;
  readonly foreignField: string;
  readonly foreignCollection?: string;
  readonly only?: Condition;
  readonly via?: TRelation;
  readonly load: (doc: TDoc, ...ids: TPath) => MaybePromise<readonly unknown[]>;
};

export type ConditionSpec<TDoc, TField extends string = string> =
  | { readonly self: true }
  | { readonly owner: TField | ((doc: TDoc) => string | undefined) }
  | { readonly member: TField | ((doc: TDoc) => readonly string[]) }
  | {
      readonly test: (doc: TDoc, context: ConditionContext) => boolean;
      readonly whenUnknown?: "allow" | "deny";
    };

export type OwnershipSpec<
  TField extends string = string,
  TRelation extends string = string,
> =
  | { readonly to: AnyEntity; readonly field: TField }
  | {
      readonly to: AnyEntity;
      readonly through: TRelation;
      readonly where: (owner: string) => Condition;
    };

export type EntityOptions<
  TDoc,
  TPath extends Path,
  TRelation extends string,
  TCondition extends string,
> = {
  readonly load?: (...ids: TPath) => MaybePromise<TDoc | null | undefined>;
  readonly loadMany?: (
    paths: readonly TPath[],
  ) => MaybePromise<readonly (TDoc | null | undefined)[]>;
  readonly idField?: string;
  readonly refType?: string;
  readonly refs?: RefConvention;
  readonly verifyExists?: boolean;
  readonly relations?: {
    readonly [R in TRelation]: RelationSpec<
      NoInfer<TDoc>,
      TPath,
      NoInfer<TRelation>
    >;
  };
  readonly conditions?: {
    readonly [C in TCondition]: ConditionSpec<
      NoInfer<TDoc>,
      keyof TDoc & string
    >;
  };
  readonly belongsTo?: Readonly<
    Record<string, OwnershipSpec<keyof TDoc & string, NoInfer<TRelation>>>
  >;
};

export type GrantsRequest<TDoc, TPath extends Path> = {
  readonly subject: Subject;
  readonly key: string;
  readonly ids: TPath;
  doc(): Promise<TDoc | null>;
};

export type GrantsOptions<TDoc, TPath extends Path> = {
  readonly keys: readonly string[];
  readonly for: (
    request: GrantsRequest<TDoc, TPath>,
  ) => MaybePromise<readonly Grant[]>;
};

export interface Entity<
  TDoc = unknown,
  TPath extends Path = Path,
  TRelation extends string = string,
  TCondition extends string = string,
> extends EntityModel {
  readonly lineage: readonly AnyEntity[];
  readonly phantom?: {
    readonly doc: TDoc;
    readonly path: TPath;
    readonly relation: TRelation;
    readonly condition: TCondition;
  };
  child<
    CDoc,
    CRelation extends string = never,
    CCondition extends string = never,
  >(
    name: string,
    options: EntityOptions<
      CDoc,
      readonly [...TPath, string],
      CRelation,
      CCondition
    >,
  ): Entity<CDoc, readonly [...TPath, string], CRelation, CCondition>;
  grants(name: string, options: GrantsOptions<TDoc, TPath>): ProviderObject;
}

// deno-lint-ignore no-explicit-any -- the registry holds entities of every document type
export type AnyEntity = Entity<any, any, any, any>;

type LooseOptions = {
  readonly load?: (...ids: string[]) => MaybePromise<unknown>;
  readonly loadMany?: (
    paths: readonly (readonly string[])[],
  ) => MaybePromise<readonly unknown[]>;
  readonly idField?: string;
  readonly refType?: string;
  readonly refs?: RefConvention;
  readonly verifyExists?: boolean;
  readonly relations?: Readonly<Record<string, LooseRelation>>;
  readonly conditions?: Readonly<Record<string, LooseCondition>>;
  readonly belongsTo?: Readonly<Record<string, OwnershipSpec>>;
};

type LooseRelation = RelationSpec<unknown, readonly string[]>;
type LooseCondition = ConditionSpec<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function concreteIds(
  ids: readonly unknown[],
  length: number,
  refs: RefConvention,
): readonly string[] | null {
  if (ids.length < length) return null;
  const head = ids.slice(0, length);
  return head.every(
    (id): id is string => typeof id === "string" && !refs.isWildcard(id),
  )
    ? head
    : null;
}

function namedCondition(
  name: string,
  spec: LooseCondition,
  depth: number,
  idField: string,
): NamedCondition {
  if ("self" in spec) {
    return {
      name,
      needsDoc: false,
      field: idField,
      whenUnknown: "deny",
      holds: (_doc, context) => context.ids[depth] === context.subject.id,
    };
  }
  if ("owner" in spec) {
    const owner = spec.owner;
    if (typeof owner === "string") {
      return {
        name,
        needsDoc: true,
        field: owner,
        whenUnknown: "deny",
        holds: (doc, context) =>
          isRecord(doc) && doc[owner] === context.subject.id,
      };
    }
    return {
      name,
      needsDoc: true,
      whenUnknown: "deny",
      holds: (doc, context) =>
        doc !== null && doc !== undefined && owner(doc) === context.subject.id,
    };
  }
  if ("member" in spec) {
    const member = spec.member;
    if (typeof member === "string") {
      return {
        name,
        needsDoc: true,
        field: member,
        whenUnknown: "deny",
        holds: (doc, context) => {
          const list = isRecord(doc) ? doc[member] : undefined;
          return Array.isArray(list) && list.includes(context.subject.id);
        },
      };
    }
    return {
      name,
      needsDoc: true,
      whenUnknown: "deny",
      holds: (doc, context) =>
        doc !== null &&
        doc !== undefined &&
        member(doc).includes(context.subject.id),
    };
  }
  return {
    name,
    needsDoc: true,
    whenUnknown: spec.whenUnknown ?? "deny",
    holds: (doc, context) =>
      doc !== null && doc !== undefined && spec.test(doc, context),
  };
}

function relationsOf(
  entityName: string,
  specs: Readonly<Record<string, LooseRelation>>,
): Map<string, RelationModel> {
  const relations = new Map<string, RelationModel>();
  for (const [name, spec] of Object.entries(specs)) {
    const via = spec.via === undefined ? undefined : relations.get(spec.via);
    if (spec.via !== undefined && via === undefined) {
      throw new Error(
        `Relation "${name}" of entity "${entityName}" goes through "${spec.via}", which must be declared before it`,
      );
    }
    const id = spec.id ?? `${name}_of_${entityName}`;
    relations.set(name, {
      name,
      id,
      localField: spec.localField,
      foreignField: spec.foreignField,
      ...(spec.foreignCollection !== undefined && {
        collection: spec.foreignCollection,
      }),
      ...(spec.only !== undefined && { only: spec.only }),
      ...(via !== undefined && { via }),
      source: { id, load: (doc, ...ids) => spec.load(doc, ...ids) },
    });
  }
  return relations;
}

function ownershipsOf(
  entityName: string,
  stored: boolean,
  relations: ReadonlyMap<string, RelationModel>,
  specs: Readonly<Record<string, OwnershipSpec>>,
): Ownership[] {
  return Object.entries(specs).map(([name, spec]): Ownership => {
    if ("field" in spec) {
      if (!stored) {
        throw new Error(
          `Entity "${entityName}" belongs to "${name}" by a field, but declares no load`,
        );
      }
      const { field } = spec;
      return {
        name,
        to: spec.to,
        via: "field",
        slot: entityName,
        where: (owner) => ({ [field]: owner }),
      };
    }
    const relation = relations.get(spec.through);
    if (!relation) {
      throw new Error(
        `Entity "${entityName}" belongs to "${name}" through "${spec.through}", which is not one of its relations`,
      );
    }
    return {
      name,
      to: spec.to,
      via: "relation",
      slot: relation.id,
      where: spec.where,
    };
  });
}

function build(
  name: string,
  ancestors: readonly AnyEntity[],
  options: LooseOptions,
): AnyEntity {
  const depth = ancestors.length;
  const length = depth + 1;
  const inherited = ancestors[0]?.refs;
  if (inherited && options.refs && options.refs !== inherited) {
    throw new Error(
      `Entity "${name}" cannot use another reference convention than its parent`,
    );
  }
  const refs = inherited ?? options.refs ?? typedRefs;
  const refType = options.refType ?? name;
  const idField = options.idField ?? "_id";
  const { load, loadMany } = options;
  const stored = load !== undefined || loadMany !== undefined;
  const relations = relationsOf(name, options.relations ?? {});
  const conditions = new Map<string, NamedCondition>();
  for (const [conditionName, spec] of Object.entries(
    options.conditions ?? {},
  )) {
    conditions.set(
      conditionName,
      namedCondition(conditionName, spec, depth, idField),
    );
  }

  const entity: AnyEntity = {
    name,
    refType,
    idField,
    depth,
    lineage: [],
    refs,
    wildcard: refs.wildcard(refType),
    stored,
    verifyExists: options.verifyExists === true,
    source: {
      name,
      ...(load && { load: (...ids: string[]) => load(...ids) }),
      ...(loadMany && { loadMany }),
    },
    relations,
    conditions,
    ownerships: ownershipsOf(name, stored, relations, options.belongsTo ?? {}),
    child: ((childName: string, childOptions: LooseOptions) =>
      build(childName, entity.lineage, childOptions)) as AnyEntity["child"],
    grants(providerName: string, grantsOptions: GrantsOptions<unknown, Path>) {
      const root = entity.lineage[0] ?? entity;
      return {
        name: providerName,
        keys: grantsOptions.keys,
        targetType: root.refType,
        cacheKey: (subject, _key, ids) => {
          const concrete = concreteIds(ids ?? [], length, refs);
          return concrete
            ? `${providerName}::${subject.id}::${concrete.join("/")}`
            : undefined;
        },
        fetch: async (subject, key, ids, access) => {
          const concrete = concreteIds(ids ?? [], length, refs);
          if (!concrete) return [];
          return await grantsOptions.for({
            subject,
            key,
            ids: concrete,
            doc: async () => (await access.read(entity)) ?? null,
          });
        },
      };
    },
  };
  (entity as { lineage: readonly AnyEntity[] }).lineage = [
    ...ancestors,
    entity,
  ];
  return entity;
}

export function entity<
  TDoc,
  TRelation extends string = never,
  TCondition extends string = never,
>(
  name: string,
  options: EntityOptions<TDoc, readonly [string], TRelation, TCondition>,
): Entity<TDoc, readonly [string], TRelation, TCondition> {
  return build(name, [], options as LooseOptions);
}

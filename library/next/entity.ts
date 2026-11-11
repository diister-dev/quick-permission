import {
  type IndirectResource,
  indirectResource,
} from "../indirect-resource.ts";
import { resource } from "../resource.ts";
import { defineRule } from "../rules.ts";
import {
  isWildcardSegment,
  type ProviderAccess,
  type ProviderObject,
} from "../system.ts";
import type { FetchCtx, Grant, Resource, Rule, Subject } from "../types.ts";

export type Path = readonly string[];

type MaybePromise<T> = T | Promise<T>;

export type RelationSpec<TDoc, TPath extends Path> = {
  readonly id?: string;
  readonly localField: string;
  readonly foreignField: string;
  readonly foreignCollection?: string;
  readonly type?: string;
  readonly cardinality?: "one" | "many";
  readonly load?: (
    doc: TDoc,
    ...ids: TPath
  ) => MaybePromise<readonly unknown[]>;
};

export type ConditionSpec<TDoc, TField extends string = string> =
  | { readonly self: true }
  | { readonly owner: TField | ((doc: TDoc) => string | undefined) }
  | { readonly member: TField | ((doc: TDoc) => readonly string[]) }
  | {
      readonly test: (doc: TDoc, ctx: FetchCtx) => boolean;
      readonly whenUnknown?: "allow" | "deny";
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
  readonly verifyExists?:
    | boolean
    | ((own: Resource<NoInfer<TDoc> | null>) => Rule);
  readonly relations?: {
    readonly [R in TRelation]: RelationSpec<NoInfer<TDoc>, TPath>;
  };
  readonly conditions?: {
    readonly [C in TCondition]: ConditionSpec<
      NoInfer<TDoc>,
      keyof TDoc & string
    >;
  };
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
> {
  readonly name: string;
  readonly refType: string;
  readonly idField: string;
  readonly depth: number;
  readonly lineage: readonly AnyEntity[];
  readonly resource: Resource<TDoc | null>;
  readonly relations: ReadonlyMap<
    string,
    { readonly id: string; readonly indirect: IndirectResource }
  >;
  readonly conditions: ReadonlyMap<
    string,
    { readonly require: Rule; readonly forbid: Rule }
  >;
  readonly existsRule: Rule | undefined;
  readonly wildcard: string;
  readonly stored: boolean;
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

function concretePath(
  target: readonly unknown[],
  length: number,
): string[] | null {
  const ids = target.slice(0, length);
  if (ids.length !== length) return null;
  for (const id of ids) {
    if (typeof id !== "string" || isWildcardSegment(id)) return null;
  }
  return ids as string[];
}

type Judgement<TDoc> = {
  readonly kind: string;
  readonly needsDoc: boolean;
  readonly holds: (doc: TDoc | null | undefined, ctx: FetchCtx) => boolean;
  readonly field?: string;
  readonly whenUnknown: "allow" | "deny";
};

function judgementOf<TDoc>(
  spec: ConditionSpec<TDoc>,
  depth: number,
  idField: string,
): Judgement<TDoc> {
  if ("self" in spec) {
    return {
      kind: "require-self",
      needsDoc: false,
      holds: (_doc, ctx) => ctx.target[depth] === ctx.subject.id,
      field: idField,
      whenUnknown: "deny",
    };
  }
  if ("owner" in spec) {
    const owner = spec.owner;
    if (typeof owner === "string") {
      return {
        kind: "require-owner",
        needsDoc: true,
        holds: (doc, ctx) =>
          (doc as Record<string, unknown> | null | undefined)?.[owner] ===
          ctx.subject.id,
        field: owner,
        whenUnknown: "deny",
      };
    }
    return {
      kind: "require-owner",
      needsDoc: true,
      holds: (doc, ctx) =>
        doc !== null && doc !== undefined && owner(doc) === ctx.subject.id,
      whenUnknown: "deny",
    };
  }
  if ("member" in spec) {
    const member = spec.member;
    if (typeof member === "string") {
      return {
        kind: "require-membership",
        needsDoc: true,
        holds: (doc, ctx) => {
          const list = (doc as Record<string, unknown> | null | undefined)?.[
            member
          ];
          return Array.isArray(list) && list.includes(ctx.subject.id);
        },
        field: member,
        whenUnknown: "deny",
      };
    }
    return {
      kind: "require-membership",
      needsDoc: true,
      holds: (doc, ctx) =>
        doc !== null &&
        doc !== undefined &&
        member(doc).includes(ctx.subject.id),
      whenUnknown: "deny",
    };
  }
  return {
    kind: "require-custom",
    needsDoc: true,
    holds: (doc, ctx) =>
      doc !== null && doc !== undefined && spec.test(doc, ctx),
    whenUnknown: spec.whenUnknown ?? "deny",
  };
}

function conditionRules<TDoc>(
  name: string,
  spec: ConditionSpec<TDoc>,
  own: Resource<TDoc | null>,
  depth: number,
  idField: string,
): { readonly require: Rule; readonly forbid: Rule } {
  const judgement = judgementOf(spec, depth, idField);
  const needs = judgement.needsDoc ? ([own] as const) : ([] as const);
  const field = judgement.field;
  const decidable = (ctx: FetchCtx) =>
    concretePath(ctx.target, depth + 1) !== null;

  return {
    require: defineRule({
      kind: judgement.kind,
      needs,
      flag: name,
      describe: () => ({ condition: name }),
      check: (data, _payload, ctx) => {
        if (decidable(ctx)) {
          return judgement.holds(data[0] as TDoc | null | undefined, ctx)
            ? true
            : { ok: false, reason: `condition "${name}" does not hold` };
        }
        if (field !== undefined) {
          return { ok: true, constraint: { [field]: ctx.subject.id } };
        }
        return judgement.whenUnknown === "allow"
          ? true
          : {
              ok: false,
              reason: `condition "${name}" cannot be decided without a target`,
            };
      },
    }),
    forbid: defineRule({
      kind: "forbid",
      needs,
      describe: () => ({ condition: name }),
      check: (data, _payload, ctx) => {
        if (decidable(ctx)) {
          return judgement.holds(data[0] as TDoc | null | undefined, ctx)
            ? { ok: false, reason: `forbidden when "${name}" holds` }
            : true;
        }
        if (field !== undefined) {
          return {
            ok: true,
            constraint: { [field]: { $ne: ctx.subject.id } },
          };
        }
        return true;
      },
    }),
  };
}

function build<
  TDoc,
  TPath extends Path,
  TRelation extends string,
  TCondition extends string,
>(
  name: string,
  ancestors: readonly AnyEntity[],
  options: EntityOptions<TDoc, TPath, TRelation, TCondition>,
): Entity<TDoc, TPath, TRelation, TCondition> {
  const depth = ancestors.length;
  const length = depth + 1;
  const refType = options.refType ?? name;
  const idField = options.idField ?? "_id";
  const loadMany = options.loadMany;
  const load = options.load;
  const loadOne = async (ids: readonly string[]) =>
    load ? ((await load(...(ids as unknown as TPath))) ?? null) : null;

  const own = resource<TDoc | null>({
    id: name,
    fetch: ({ target }) => {
      const ids = concretePath(target, length);
      return ids ? loadOne(ids) : null;
    },
    ...(loadMany && {
      fetchMany: async (ctxs) => {
        const paths = ctxs.map(({ target }) => concretePath(target, length));
        const concrete = paths.filter((ids) => ids !== null);
        const loaded = await loadMany(concrete as unknown as readonly TPath[]);
        if (loaded.length !== concrete.length) {
          throw new Error(
            `loadMany of entity "${name}" returned ${loaded.length} documents for ${concrete.length} paths`,
          );
        }
        let cursor = 0;
        return paths.map((ids) =>
          ids === null ? null : (loaded[cursor++] ?? null),
        );
      },
    }),
    dedupKey: ({ target }) => target.slice(0, length).join("::"),
  });

  const relations = new Map<
    string,
    { readonly id: string; readonly indirect: IndirectResource }
  >();
  const relationSpecs = (options.relations ?? {}) as Record<
    string,
    RelationSpec<TDoc, TPath>
  >;
  for (const [relationName, spec] of Object.entries(relationSpecs)) {
    const id = spec.id ?? `${relationName}_of_${name}`;
    const load = spec.load;
    relations.set(relationName, {
      id,
      indirect: indirectResource({
        id,
        from: own,
        on: {
          localField: spec.localField,
          foreignField: spec.foreignField,
          ...(spec.foreignCollection !== undefined && {
            foreignCollection: spec.foreignCollection,
          }),
        },
        ...(spec.type !== undefined && { to: { _type: spec.type } }),
        cardinality: spec.cardinality ?? "many",
        ...(load && {
          fetch: (doc: unknown, ctx: FetchCtx) => {
            const ids = concretePath(ctx.target, length);
            if (!ids) return [];
            return load(doc as TDoc, ...(ids as unknown as TPath));
          },
        }),
      }),
    });
  }

  const conditions = new Map<
    string,
    { readonly require: Rule; readonly forbid: Rule }
  >();
  const conditionSpecs = (options.conditions ?? {}) as Record<
    string,
    ConditionSpec<TDoc>
  >;
  for (const [conditionName, spec] of Object.entries(conditionSpecs)) {
    conditions.set(
      conditionName,
      conditionRules(conditionName, spec, own, depth, idField),
    );
  }

  const verify = options.verifyExists;
  const existsRule =
    typeof verify === "function"
      ? verify(own)
      : verify
        ? defineRule({
            kind: "exists",
            needs: [own] as const,
            check: ([doc], _payload, ctx) => {
              if (concretePath(ctx.target, length) === null) return true;
              return doc !== null && doc !== undefined
                ? true
                : {
                    ok: false,
                    reason: `exists[${name}] ${String(ctx.target[depth])} not found under its parents`,
                  };
            },
          })
        : undefined;

  const entity: Entity<TDoc, TPath, TRelation, TCondition> = {
    name,
    refType,
    idField,
    depth,
    lineage: [],
    resource: own,
    relations,
    conditions,
    existsRule,
    wildcard: `${refType}:*`,
    stored: load !== undefined,
    child(childName, childOptions) {
      return build(childName, entity.lineage, childOptions);
    },
    grants(providerName, grantsOptions) {
      const root = (entity.lineage[0] ?? entity).refType;
      return {
        name: providerName,
        keys: grantsOptions.keys,
        targetType: root,
        cacheKey: (subject, _key, target) => {
          const ids = concretePath(target ?? [], length);
          return ids
            ? `${providerName}::${subject.id}::${ids.join("/")}`
            : undefined;
        },
        fetch: async (
          subject: Subject,
          key: string,
          target?: readonly unknown[],
          access?: ProviderAccess,
        ) => {
          const ids = concretePath(target ?? [], length);
          if (!ids) return [];
          return await grantsOptions.for({
            subject,
            key,
            ids: ids as unknown as TPath,
            doc: () => (access ? access.read(own) : loadOne(ids)),
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
  return build(name, [], options);
}

import {
  type Compiled as Catalogued,
  compile,
  type Rejection,
} from "./compile.ts";
import { type Condition, isRecord } from "./condition.ts";
import {
  type Boundary,
  createDelegation,
  type Delegation,
  type DelegationOptions,
  type DelegationRefusal,
} from "./delegation.ts";
import {
  createEvaluator,
  type Decision,
  type Session,
} from "./engine/evaluate.ts";
import { createLoader } from "./engine/loader.ts";
import type { EntityModel, KeyModel, Scope, Subject } from "./engine/model.ts";
import { createProviders, type Hooks } from "./engine/providers.ts";
import type { Path } from "./entity.ts";
import type { Grant, GrantProvider } from "./grant.ts";
import type { AnyPermissionSet, KeyInfo } from "./permissions.ts";
import { type RefConvention, typedRefs } from "./refs.ts";
import { type MongoQuery, mongo } from "./storage/mongo.ts";
import { type Plan, planOf, type StorageAdapter } from "./storage/plan.ts";

export type { Hooks, Rejection as GrantRejection };

type UnionToIntersection<U> = (
  U extends unknown
    ? (value: U) => void
    : never
) extends (value: infer I) => void
  ? I
  : never;

export type TypesOf<Sets extends readonly AnyPermissionSet[]> =
  UnionToIntersection<Sets[number]["types"]>;

// deno-lint-ignore no-explicit-any -- each helper reads one slot of the key description
type AnyKeyInfo = KeyInfo<any, any, any, any>;

type PathOfKey<T, K extends keyof T> =
  T[K] extends KeyInfo<
    infer P,
    // deno-lint-ignore no-explicit-any -- only the path is read here
    any,
    // deno-lint-ignore no-explicit-any -- only the path is read here
    any,
    // deno-lint-ignore no-explicit-any -- only the path is read here
    any
  >
    ? P
    : never;

type DocOfKey<T, K extends keyof T> = T[K] extends AnyKeyInfo
  ? T[K]["doc"]
  : never;

type ScopableKeys<T> = {
  [K in keyof T]: T[K] extends AnyKeyInfo
    ? T[K]["on"] extends "self"
      ? K
      : never
    : never;
}[keyof T] &
  string;

type DropLast<T extends Path> = T extends readonly [...infer Head, unknown]
  ? Head
  : readonly [];

export type CheckOptions = {
  readonly input?: unknown;
  readonly at?: Date;
  readonly ip?: string;
};

export type CheckResult<TDoc> =
  | {
      readonly ok: true;
      readonly doc?: Partial<TDoc>;
      readonly input?: unknown;
      readonly grants: readonly string[];
    }
  | { readonly ok: false; readonly reasons: readonly string[] };

export type Reach = "all" | "some" | "none";

export type ScopeResult<TDoc, TQuery = MongoQuery> =
  | {
      readonly ok: true;
      readonly plan: Plan;
      readonly query: TQuery;
      readonly grants: readonly string[];
      project(doc: TDoc): Promise<Partial<TDoc> | null>;
      project<F>(
        doc: TDoc,
        options: { readonly denied: (doc: TDoc) => F },
      ): Promise<Partial<TDoc> | F>;
      projectAll(docs: readonly TDoc[]): Promise<Partial<TDoc>[]>;
    }
  | { readonly ok: false; readonly reasons: readonly string[] };

export interface Context<T, TQuery = MongoQuery> {
  check<K extends keyof T & string>(
    key: K,
    ...args: [...PathOfKey<T, K>, options?: CheckOptions]
  ): Promise<CheckResult<DocOfKey<T, K>>>;
  could<K extends keyof T & string>(
    key: K,
    ...ids: Partial<PathOfKey<T, K>>
  ): Promise<boolean>;
  reach<K extends keyof T & string>(
    key: K,
    ...ids: Partial<PathOfKey<T, K>>
  ): Promise<Reach>;
  scope<K extends ScopableKeys<T>>(
    key: K,
    ...parents: DropLast<PathOfKey<T, K>>
  ): Promise<ScopeResult<DocOfKey<T, K>, TQuery>>;
  ask(key: string, target: unknown, options?: CheckOptions): Promise<boolean>;
  seed(
    owner: EntityModel,
    docs: readonly unknown[],
    ...parents: string[]
  ): void;
  seedRelated(
    owner: EntityModel,
    relation: string,
    rows: readonly unknown[],
    ...ids: string[]
  ): void;
  delegationRefusal(
    asked: Grant,
    options?: DelegationOptions,
  ): Promise<DelegationRefusal | null>;
  heldGrants(): Promise<readonly Grant[]>;
  fetchCounters(): Readonly<Record<string, number>>;
}

export type CatalogEntry<TMeta = unknown> = {
  readonly key: string;
  readonly kind: "action" | "list" | "bundle";
  readonly meta: TMeta | undefined;
  readonly on: Scope;
  readonly path: readonly {
    readonly name: string;
    readonly refType: string;
  }[];
  readonly includes: readonly string[];
  readonly expandsTo: readonly string[];
  readonly accepts: {
    readonly where: boolean;
    readonly parents: readonly string[];
    readonly related: readonly {
      readonly name: string;
      readonly id: string;
      readonly localField: string;
      readonly foreignField: string;
      readonly collection?: string;
      readonly only?: Condition;
      readonly via?: string;
    }[];
    readonly when: readonly string[];
    readonly fields: "doc" | "input" | null;
    readonly input: boolean;
  };
};

export interface Compiled<T, TMeta = unknown> {
  readonly keys: readonly (keyof T & string)[];
  readonly delegation: Delegation;
  catalog(): readonly CatalogEntry<TMeta>[];
  explain(grant: Grant): string | null;
  expand(grants: readonly Grant[]): readonly Grant[];
  audit(grants: Iterable<Grant>): readonly Rejection[];
  wildcardGrants(idPrefix: string): readonly Grant[];
  boundary(entity: EntityModel, ...path: string[]): Boundary;
}

export interface System<T, TQuery = MongoQuery, TMeta = unknown>
  extends Compiled<T, TMeta> {
  context(
    bound: { readonly subject: Subject } & CheckOptions,
  ): Context<T, TQuery>;
}

function refsOf(sets: readonly AnyPermissionSet[]): RefConvention {
  let refs: RefConvention | undefined;
  for (const set of sets) {
    const own = set.entity?.refs;
    if (own === undefined) continue;
    if (refs !== undefined && refs !== own) {
      throw new Error("Every entity of a system uses one reference convention");
    }
    refs = own;
  }
  return refs ?? typedRefs;
}

function describe<TMeta>(
  model: KeyModel,
  catalogued: Catalogued,
): CatalogEntry<TMeta> {
  const subject = model.subject;
  return {
    key: model.key,
    kind: model.kind,
    meta: model.meta as TMeta | undefined,
    on: model.on,
    path: model.path.map((step) => ({
      name: step.name,
      refType: step.refType,
    })),
    includes: model.includes,
    expandsTo: catalogued.reached(model.key),
    accepts: {
      where: subject?.stored === true,
      parents: [...model.parents],
      related: [...(subject?.relations.values() ?? [])].map((relation) => ({
        name: relation.name,
        id: relation.id,
        localField: relation.localField,
        foreignField: relation.foreignField,
        ...(relation.collection !== undefined && {
          collection: relation.collection,
        }),
        ...(relation.only !== undefined && { only: relation.only }),
        ...(relation.via !== undefined && { via: relation.via.id }),
      })),
      when: [...model.conditions],
      fields: model.fields,
      input: model.input,
    },
  };
}

function build<T, TMeta>(
  catalogued: Catalogued,
): Compiled<T, TMeta> & {
  readonly engine: ReturnType<typeof createDelegation>;
} {
  const engine = createDelegation(catalogued);
  const { catalogue } = catalogued;

  return {
    engine,
    keys: [...catalogue.keys()] as (keyof T & string)[],
    delegation: engine.delegation,
    boundary: engine.delegation.boundary,
    catalog: () =>
      [...catalogue.values()].map((model) =>
        describe<TMeta>(model, catalogued),
      ),
    explain(grant) {
      const admission = catalogued.admit(grant);
      return admission.ok ? null : admission.problem;
    },
    expand(grants) {
      const valid = grants.flatMap((grant) => {
        const admission = catalogued.admit(grant);
        return admission.ok ? [admission.grant] : [];
      });
      return catalogued.expand(valid).map((entry) => entry.grant.source);
    },
    audit(grants) {
      const rejections: Rejection[] = [];
      for (const grant of grants) {
        const admission = catalogued.admit(grant);
        if (!admission.ok) {
          rejections.push({ grant, reason: admission.problem });
          continue;
        }
        catalogued.expand([admission.grant], (rejection) =>
          rejections.push(rejection),
        );
      }
      return rejections;
    },
    wildcardGrants: (idPrefix) =>
      [...catalogue.values()].map((model) => ({
        id: `${idPrefix}:${model.key}`,
        key: model.key,
        ...(model.path.length > 0 && {
          on: model.path.map((step) => step.wildcard),
        }),
      })),
  };
}

export function compilePermissions<
  const Sets extends readonly AnyPermissionSet[],
  TMeta = unknown,
>(sets: Sets): Compiled<TypesOf<Sets>, TMeta> {
  const { engine: _engine, ...compiled } = build<TypesOf<Sets>, TMeta>(
    compile(sets, refsOf(sets)),
  );
  return compiled;
}

function idsOf(target: unknown): readonly unknown[] {
  if (target === undefined) return [];
  return Array.isArray(target) ? target : [target];
}

export function createSystem<
  const Sets extends readonly AnyPermissionSet[],
  TQuery = MongoQuery,
  TMeta = unknown,
>(options: {
  readonly permissions: Sets;
  readonly providers?: readonly GrantProvider[];
  readonly hooks?: Hooks;
  readonly storage?: StorageAdapter<TQuery>;
}): System<TypesOf<Sets>, TQuery, TMeta> {
  type T = TypesOf<Sets>;
  const hooks = options.hooks ?? {};
  const refs = refsOf(options.permissions);
  const catalogued = compile(options.permissions, refs);
  const { catalogue } = catalogued;
  const { engine, ...compiled } = build<T, TMeta>(catalogued);
  const providers = createProviders(options.providers ?? [], catalogued, hooks);
  const evaluator = createEvaluator(catalogued, providers, hooks);
  const storage = (options.storage ?? mongo()) as StorageAdapter<TQuery>;

  function modelOf(key: string): KeyModel {
    const model = catalogue.get(key);
    if (!model) throw new Error(`Unknown permission key "${key}"`);
    return model;
  }

  const isConcrete = (id: unknown): id is string =>
    typeof id === "string" && !refs.isWildcard(id);

  return {
    ...compiled,
    context(bound) {
      const { subject, ...defaults } = bound;
      const session: Session = { loader: createLoader(), cache: new Map() };

      const decide = (
        model: KeyModel,
        ids: readonly string[],
        perCall?: CheckOptions,
      ): Promise<Decision> =>
        evaluator.decide(
          { model, ids, facts: { subject, ids, ...defaults, ...perCall } },
          session,
        );

      const padded = (model: KeyModel, ids: readonly unknown[]): string[] =>
        model.path.map((step, index) => {
          const id = ids[index];
          return typeof id === "string" ? id : step.wildcard;
        });

      const seed: Context<T, TQuery>["seed"] = (owner, docs, ...parents) => {
        for (const doc of docs) {
          const id = isRecord(doc) ? doc[owner.idField] : undefined;
          if (typeof id !== "string") continue;
          session.loader.seedDocument(owner.source, [...parents, id], doc);
        }
      };

      const context: Context<T, TQuery> = {
        async check(key, ...args) {
          const model = modelOf(key);
          const size = model.path.length;
          const ids = args.slice(0, size);
          const perCall = args[size] as CheckOptions | undefined;
          if (ids.length !== size || !ids.every(isConcrete)) {
            return {
              ok: false,
              reasons: [
                `check(${key}) needs ${size} concrete ids; ask could(), reach() or scope() for a capability`,
              ],
            };
          }
          const decision = await decide(model, ids, perCall);
          if (!decision.ok) return decision;
          return {
            ok: true,
            grants: decision.grants,
            ...("doc" in decision && { doc: decision.doc as never }),
            ...("input" in decision && { input: decision.input }),
          };
        },

        async could(key, ...ids) {
          const model = modelOf(key);
          return (await decide(model, padded(model, ids))).ok;
        },

        async reach(key, ...ids) {
          const model = modelOf(key);
          const requested = padded(model, ids);
          const decision = await decide(model, requested);
          if (!decision.ok) return "none";
          if (requested.every(isConcrete)) return "all";
          const open =
            !decision.undecided &&
            decision.unlistable === undefined &&
            planOf(decision.alternatives).alternatives.every(
              (alternative) =>
                alternative.where === undefined &&
                alternative.through === undefined,
            );
          return open ? "all" : "some";
        },

        async scope(key, ...parents) {
          const model = modelOf(key);
          const owner = model.subject;
          if (owner === null) {
            throw new Error(`scope(${key}): the key acts on no document`);
          }
          const parentIds: readonly unknown[] = parents;
          if (
            parentIds.length !== model.path.length - 1 ||
            !parentIds.every(isConcrete)
          ) {
            return {
              ok: false,
              reasons: [
                `scope(${key}) needs ${model.path.length - 1} concrete parent ids`,
              ],
            };
          }
          const decision = await decide(model, [...parentIds, owner.wildcard]);
          if (!decision.ok) return decision;
          if (decision.unlistable !== undefined) {
            return {
              ok: false,
              reasons: [
                `rule "${decision.unlistable}" of "${key}" decides per document and declares no rows`,
              ],
            };
          }
          const plan = planOf(decision.alternatives);
          const read =
            model.read === undefined ? undefined : modelOf(model.read);

          const project = async (
            doc: unknown,
            projection?: { readonly denied: (doc: never) => unknown },
          ): Promise<unknown> => {
            const id = isRecord(doc) ? doc[owner.idField] : undefined;
            const denied = () =>
              projection ? projection.denied(doc as never) : null;
            if (!isConcrete(id)) return denied();
            seed(owner, [doc], ...parentIds);
            const row = [...parentIds, id];
            const [covered, rights] = await Promise.all([
              decide(model, row),
              read === undefined ? undefined : decide(read, row),
            ]);
            const fields = rights ?? covered;
            if (!covered.ok || !fields.ok) return denied();
            return "doc" in fields ? (fields.doc ?? doc) : doc;
          };

          return {
            ok: true,
            plan,
            query: storage.compile(plan),
            grants: decision.grants,
            project: project as never,
            async projectAll(docs: readonly unknown[]) {
              const projected = await Promise.all(
                docs.map((doc) => project(doc)),
              );
              return projected.filter((item) => item !== null) as never;
            },
          };
        },

        async ask(key, target, perCall) {
          const model = catalogue.get(key);
          if (!model) return false;
          const ids = idsOf(target);
          if (
            ids.length !== model.path.length ||
            !ids.every((id): id is string => typeof id === "string")
          ) {
            return false;
          }
          return (await decide(model, ids, perCall)).ok;
        },

        seed,

        seedRelated(owner, relationName, rows, ...ids) {
          const relation = owner.relations.get(relationName);
          if (!relation) {
            throw new Error(
              `seedRelated: "${owner.name}" has no relation "${relationName}"`,
            );
          }
          session.loader.seedRelated(relation.source, ids, rows);
        },

        async delegationRefusal(asked, delegation = {}) {
          const upfront = engine.judgeAgainst([], asked, delegation);
          if (upfront === null || upfront.code !== "not-held") return upfront;
          const model = catalogue.get(asked.key);
          if (model) await decide(model, [...(asked.on ?? [])]);
          return engine.judgeAgainst(
            await providers.dump(session.cache),
            asked,
            delegation,
          );
        },

        heldGrants: async () =>
          (await providers.dump(session.cache)).map((grant) => grant.source),

        fetchCounters: () => session.loader.counters(),
      };
      return context;
    },
  };
}

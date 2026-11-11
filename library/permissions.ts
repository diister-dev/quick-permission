import { admitGrant } from "./compile.ts";
import type { Condition } from "./condition.ts";
import type {
  CustomRule,
  EntityModel,
  KeyModel,
  Scope,
} from "./engine/model.ts";
import type { AnyEntity, Entity, Path } from "./entity.ts";
import type { FieldSelection } from "./fields.ts";
import type { Grant } from "./grant.ts";
import { typedRefs } from "./refs.ts";

export type { Scope };

export const ALL = "all" as const;

export type ActionOptions<TMeta = unknown> = {
  readonly on?: Scope;
  readonly fields?: "doc" | "input";
  readonly input?: boolean;
  readonly forbid?: readonly string[];
  readonly targetConstraint?: boolean;
  readonly rules?: readonly CustomRule[];
  readonly meta?: TMeta;
};

export type BundleOptions<TMeta = unknown> = {
  readonly on?: Scope;
  readonly fields?: "doc";
  readonly expand?: (grant: Grant) => readonly Grant[];
  readonly rules?: readonly CustomRule[];
  readonly meta?: TMeta;
};

export type External = { readonly external: string };
export type Include = string | External;

export function external(key: string): External {
  return { external: key };
}

export type ActionDef<O> = { readonly kind: "action"; readonly options: O };
export type BundleDef<O> = {
  readonly kind: "bundle";
  readonly includes: readonly Include[];
  readonly options: O;
};
export type ListDef<O> = {
  readonly kind: "list";
  readonly read: string;
  readonly includes: readonly Include[];
  readonly options: O;
};
export type AnyDef =
  | ActionDef<ActionOptions>
  | BundleDef<BundleOptions>
  | ListDef<BundleOptions>;

export function action<const O extends ActionOptions = Record<never, never>>(
  options?: O,
): ActionDef<O> {
  return { kind: "action", options: (options ?? {}) as O };
}

export function bundle<const O extends BundleOptions = Record<never, never>>(
  includes: readonly Include[],
  options?: O,
): BundleDef<O> {
  return { kind: "bundle", includes, options: (options ?? {}) as O };
}

export function list<const O extends BundleOptions = Record<never, never>>(
  read: string,
  options?: O & { readonly includes?: readonly Include[] },
): ListDef<O> {
  const { includes = [], ...rest } = options ?? {};
  return {
    kind: "list",
    read,
    includes: [read, ...includes],
    options: rest as unknown as O,
  };
}

type DropLast<T extends Path> = T extends readonly [...infer Head, unknown]
  ? Head extends Path
    ? Head
    : readonly []
  : readonly [];

type OptionsOf<D> = D extends { readonly options: infer O } ? O : never;

type OnOfDef<D> =
  OptionsOf<D> extends { readonly on: "none" }
    ? "none"
    : OptionsOf<D> extends { readonly on: "parent" }
      ? "parent"
      : "self";

export type PathOf<D, TPath extends Path> =
  OnOfDef<D> extends "none"
    ? readonly []
    : OnOfDef<D> extends "parent"
      ? DropLast<TPath>
      : TPath;

export type KeyInfo<
  TPath extends Path = Path,
  TDoc = unknown,
  TKind extends string = string,
  TOn extends Scope = Scope,
> = {
  readonly path: TPath;
  readonly doc: TDoc;
  readonly kind: TKind;
  readonly on: TOn;
};

type Joined<P extends string, K extends string> = P extends ""
  ? K
  : `${P}.${K}`;

function joined(prefix: string, name: string): string {
  return prefix === "" ? name : `${prefix}.${name}`;
}

type SetTypes<
  P extends string,
  S extends Record<string, AnyDef>,
  TDoc,
  TPath extends Path,
> = {
  readonly [K in keyof S & string as Joined<P, K>]: KeyInfo<
    PathOf<S[K], TPath>,
    TDoc,
    S[K]["kind"],
    OnOfDef<S[K]>
  >;
};

export type Where<TDoc> = [TDoc] extends [object]
  ? { readonly [K in keyof TDoc & string]?: unknown } & {
      readonly [dotted: `${string}.${string}`]: unknown;
    } & {
      readonly $and?: readonly Where<TDoc>[];
      readonly $or?: readonly Where<TDoc>[];
      readonly $nor?: readonly Where<TDoc>[];
    }
  : Condition;

export type FieldsOf<TDoc> = [TDoc] extends [object]
  ? { readonly [K in keyof TDoc & string]?: true | FieldSelection }
  : FieldSelection;

type OnOf<P extends Path> = P extends readonly []
  ? { readonly on?: undefined }
  : {
      readonly on:
        | typeof ALL
        | { readonly [I in keyof P]: string }
        | (P extends readonly [string] ? string : never);
    };

export type GrantOptions<
  TDoc,
  P extends Path,
  TRelation extends string,
  TCondition extends string,
> = OnOf<P> & {
  readonly id?: string;
  readonly where?: Where<TDoc>;
  readonly parents?: Readonly<Record<string, Condition>>;
  readonly related?: { readonly [R in TRelation]?: Condition };
  readonly fields?: typeof ALL | FieldsOf<TDoc>;
  readonly when?: readonly TCondition[];
  readonly input?: Condition;
  readonly payload?: unknown;
  readonly extra?: Readonly<Record<string, unknown>>;
};

export interface PermissionSet<
  TTypes = Record<string, KeyInfo>,
  S extends Record<string, AnyDef> = Record<string, AnyDef>,
  TDoc = unknown,
  TPath extends Path = Path,
  TRelation extends string = string,
  TCondition extends string = string,
> {
  readonly prefix: string;
  readonly entity: AnyEntity | null;
  readonly keys: ReadonlyMap<string, KeyModel>;
  readonly types: TTypes;
  grant<N extends keyof S & string>(
    name: N,
    options: GrantOptions<TDoc, PathOf<S[N], TPath>, TRelation, TCondition>,
  ): Grant;
}

// deno-lint-ignore no-explicit-any -- a system takes sets of every document type
export type AnyPermissionSet = PermissionSet<any, any, any, any, any, any>;

function pathFor(owner: EntityModel | null, on: Scope): readonly EntityModel[] {
  if (owner === null || on === "none") return [];
  return on === "parent" ? owner.lineage.slice(0, -1) : owner.lineage;
}

function buildKey(
  prefix: string,
  name: string,
  def: AnyDef,
  owner: EntityModel | null,
): KeyModel {
  const key = joined(prefix, name);
  const on: Scope = owner === null ? "none" : (def.options.on ?? "self");
  const path = pathFor(owner, on);
  const subject = on === "self" ? owner : null;
  const action = def.kind === "action" ? def.options : undefined;
  const rules = def.options.rules ?? [];
  const forbid = action?.forbid ?? [];

  for (const forbidden of forbid) {
    if (!subject?.conditions.has(forbidden)) {
      throw new Error(
        `${key}: cannot forbid "${forbidden}", ${subject ? `"${subject.name}" declares no such condition` : "the key acts on no document"}`,
      );
    }
  }

  const parents = new Set<string>();
  for (const step of path) {
    if (step !== subject && step.stored) parents.add(step.name);
  }
  const conditions = new Set<string>(subject?.conditions.keys() ?? []);
  for (const rule of rules) {
    if (rule.when !== undefined) conditions.add(rule.when);
  }

  const wanted = def.kind === "list" ? "doc" : (def.options.fields ?? null);
  const fields = wanted === "doc" ? (subject?.stored ? "doc" : null) : wanted;

  return {
    key,
    kind: def.kind,
    entity: owner,
    on,
    path,
    subject,
    prefix,
    includeRefs: def.kind === "action" ? [] : def.includes,
    includes: [],
    read: def.kind === "list" ? joined(prefix, def.read) : undefined,
    fields,
    input: action?.input === true,
    forbid,
    targetConstraint: action?.targetConstraint !== false,
    rules,
    parents,
    conditions,
    expand: def.kind === "action" ? undefined : def.options.expand,
    meta: def.options.meta,
  };
}

type LooseGrantOptions = {
  readonly on?: typeof ALL | string | readonly string[];
  readonly id?: string;
  readonly where?: Condition;
  readonly parents?: Readonly<Record<string, Condition>>;
  readonly related?: Readonly<Record<string, Condition | undefined>>;
  readonly fields?: typeof ALL | FieldSelection;
  readonly when?: readonly string[];
  readonly input?: Condition;
  readonly payload?: unknown;
  readonly extra?: Readonly<Record<string, unknown>>;
};

function targetOf(
  model: KeyModel,
  on: LooseGrantOptions["on"],
): readonly string[] | undefined {
  if (model.path.length === 0) {
    if (on !== undefined) {
      throw new Error(`grant(${model.key}): this key takes no target`);
    }
    return undefined;
  }
  if (on === undefined) {
    throw new Error(`grant(${model.key}): "on" is required`);
  }
  if (on === ALL) return model.path.map((step) => step.wildcard);
  const segments = typeof on === "string" ? [on] : on;
  if (segments.length !== model.path.length) {
    throw new Error(
      `grant(${model.key}): expected ${model.path.length} target segments, got ${segments.length}`,
    );
  }
  return segments.map((segment, index) =>
    segment === ALL ? model.path[index].wildcard : segment,
  );
}

function definedOnly(
  conditions: Readonly<Record<string, Condition | undefined>>,
): Readonly<Record<string, Condition>> {
  const out: Record<string, Condition> = {};
  for (const [name, condition] of Object.entries(conditions)) {
    if (condition !== undefined) out[name] = condition;
  }
  return out;
}

function buildGrant(
  model: KeyModel,
  options: LooseGrantOptions,
  problem: (grant: Grant) => string | null,
): Grant {
  const on = targetOf(model, options.on);
  const related = definedOnly(options.related ?? {});
  const grant: Grant = {
    ...options.extra,
    ...(options.id !== undefined && { id: options.id }),
    key: model.key,
    ...(on && { on }),
    ...(options.where !== undefined && { where: options.where }),
    ...(options.parents !== undefined &&
      Object.keys(options.parents).length > 0 && { parents: options.parents }),
    ...(Object.keys(related).length > 0 && { related }),
    ...(options.fields !== undefined &&
      options.fields !== ALL && { fields: options.fields }),
    ...(options.when !== undefined &&
      options.when.length > 0 && { when: options.when }),
    ...(options.input !== undefined && { input: options.input }),
    ...(options.payload !== undefined && { payload: options.payload }),
  };
  const refused = problem(grant);
  if (refused !== null) throw new Error(`grant(${model.key}): ${refused}`);
  return grant;
}

function buildSet(
  owner: AnyEntity | null,
  prefix: string,
  spec: Record<string, AnyDef>,
  problemOf: (model: KeyModel, grant: Grant) => string | null,
): AnyPermissionSet {
  const keys = new Map<string, KeyModel>();
  for (const [name, def] of Object.entries(spec)) {
    const model = buildKey(prefix, name, def, owner);
    keys.set(model.key, model);
  }
  return {
    prefix,
    entity: owner,
    keys,
    types: {},
    grant(name: string, options: LooseGrantOptions) {
      const model = keys.get(joined(prefix, name));
      if (!model) {
        throw new Error(`grant: unknown key "${joined(prefix, name)}"`);
      }
      return buildGrant(model, options, (grant) => problemOf(model, grant));
    },
  };
}

function problemOf(model: KeyModel, grant: Grant): string | null {
  const admission = admitGrant(model, grant, model.entity?.refs ?? typedRefs);
  return admission.ok ? null : admission.problem;
}

export function permissions<
  TDoc,
  TPath extends Path,
  TRelation extends string,
  TCondition extends string,
  const S extends Record<string, AnyDef>,
>(
  owner: Entity<TDoc, TPath, TRelation, TCondition>,
  spec: S,
): PermissionSet<
  SetTypes<"", S, TDoc, TPath>,
  S,
  TDoc,
  TPath,
  TRelation,
  TCondition
>;
export function permissions<
  TDoc,
  TPath extends Path,
  TRelation extends string,
  TCondition extends string,
  const P extends string,
  const S extends Record<string, AnyDef>,
>(
  owner: Entity<TDoc, TPath, TRelation, TCondition>,
  prefix: P,
  spec: S,
): PermissionSet<
  SetTypes<P, S, TDoc, TPath>,
  S,
  TDoc,
  TPath,
  TRelation,
  TCondition
>;
export function permissions(
  owner: AnyEntity,
  prefixOrSpec: string | Record<string, AnyDef>,
  spec?: Record<string, AnyDef>,
): AnyPermissionSet {
  return typeof prefixOrSpec === "string"
    ? buildSet(owner, prefixOrSpec, spec ?? {}, problemOf)
    : buildSet(owner, "", prefixOrSpec, problemOf);
}

type GlobalTypes<P extends string, S extends Record<string, AnyDef>> = {
  readonly [K in keyof S & string as Joined<P, K>]: KeyInfo<
    readonly [],
    never,
    S[K]["kind"],
    "none"
  >;
};

export function globalPermissions<const S extends Record<string, AnyDef>>(
  spec: S,
): PermissionSet<GlobalTypes<"", S>, S, never, readonly [], never, never>;
export function globalPermissions<
  const P extends string,
  const S extends Record<string, AnyDef>,
>(
  prefix: P,
  spec: S,
): PermissionSet<GlobalTypes<P, S>, S, never, readonly [], never, never>;
export function globalPermissions(
  prefixOrSpec: string | Record<string, AnyDef>,
  spec?: Record<string, AnyDef>,
): AnyPermissionSet {
  return typeof prefixOrSpec === "string"
    ? buildSet(null, prefixOrSpec, spec ?? {}, problemOf)
    : buildSet(null, "", prefixOrSpec, problemOf);
}

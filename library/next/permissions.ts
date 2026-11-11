import { defineRule, inputMatch, matchPath } from "../rules.ts";
import type { Grant, Rule } from "../types.ts";
import type { AnyEntity, Entity, Path } from "./entity.ts";

export const ALL = "all" as const;

export function inputFilter(): Rule {
  return defineRule({
    kind: "input-filter",
    needs: [] as const,
    check: (_data, _payload, ctx) => {
      if (ctx.input === undefined) return { ok: true };
      const spec = ctx.grant.filter ? { ...ctx.grant.filter } : null;
      return { ok: true, filter: { source: ctx.input, spec } };
    },
  });
}

export type Scope = "self" | "parent" | "none";

export type ActionOptions<TMeta = unknown> = {
  readonly on?: Scope;
  readonly fields?: "doc" | "input";
  readonly input?: boolean;
  readonly forbid?: readonly string[];
  readonly targetConstraint?: boolean;
  readonly rules?: readonly Rule[];
  readonly slots?: readonly string[];
  readonly meta?: TMeta;
};

export type BundleOptions<TMeta = unknown> = {
  readonly on?: Scope;
  readonly fields?: "doc";
  readonly expand?: (grant: Grant) => readonly Grant[];
  readonly rules?: readonly Rule[];
  readonly slots?: readonly string[];
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
  : Readonly<Record<string, unknown>>;

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
  readonly parents?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  readonly related?: {
    readonly [R in TRelation]?: Readonly<Record<string, unknown>>;
  };
  readonly fields?:
    | typeof ALL
    | readonly ((keyof TDoc & string) | `${string}.${string}`)[];
  readonly when?: readonly TCondition[];
  readonly input?: Readonly<Record<string, unknown>>;
  readonly payload?: unknown;
  readonly extra?: Readonly<Record<string, unknown>>;
};

export type Entry = {
  readonly key: string;
  readonly kind: "action" | "bundle" | "list";
  readonly entity: AnyEntity | null;
  readonly on: Scope;
  readonly path: readonly AnyEntity[];
  readonly prefix: string;
  readonly includeRefs: readonly Include[];
  readonly includes: readonly string[];
  readonly read: string | undefined;
  readonly consumesDocFields: boolean;
  readonly consumesInputFields: boolean;
  readonly consumesInput: boolean;
  readonly rules: readonly Rule[];
  readonly slots: ReadonlySet<string>;
  readonly flags: ReadonlySet<string>;
  readonly expand: ((grant: Grant) => readonly Grant[]) | undefined;
  readonly meta: unknown;
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
  readonly entries: ReadonlyMap<string, Entry>;
  readonly types: TTypes;
  grant<N extends keyof S & string>(
    name: N,
    options: GrantOptions<TDoc, PathOf<S[N], TPath>, TRelation, TCondition>,
  ): Grant;
}

// deno-lint-ignore no-explicit-any -- a system takes sets of every document type
export type AnyPermissionSet = PermissionSet<any, any, any, any, any, any>;

function pathFor(owner: AnyEntity | null, on: Scope): readonly AnyEntity[] {
  if (owner === null || on === "none") return [];
  return on === "parent" ? owner.lineage.slice(0, -1) : owner.lineage;
}

function slotOfCustomRule(rule: Rule): string | undefined {
  const descriptor = rule.descriptor;
  if (descriptor.kind === "match") return descriptor.source;
  if (descriptor.kind === "includes") {
    return typeof descriptor.grantField === "string"
      ? descriptor.grantField
      : undefined;
  }
  if (descriptor.kind === "indirect-match") {
    const indirect = descriptor.indirectResource as
      | { id?: unknown }
      | undefined;
    return typeof indirect?.id === "string" ? indirect.id : undefined;
  }
  return undefined;
}

function buildEntry(
  prefix: string,
  name: string,
  def: AnyDef,
  owner: AnyEntity | null,
): Entry {
  const key = joined(prefix, name);
  const on: Scope = owner === null ? "none" : (def.options.on ?? "self");
  const path = pathFor(owner, on);
  const options: ActionOptions =
    def.kind === "action"
      ? def.options
      : { rules: def.options.rules, slots: def.options.slots };
  const fields =
    def.kind === "list" ? "doc" : (def.options.fields ?? undefined);

  const rules: Rule[] = [];
  const slots = new Set<string>(options.slots ?? []);
  const flags = new Set<string>();

  const subject = on === "self" ? owner : null;
  for (const step of path) {
    if (step === subject || !step.stored) continue;
    rules.push(step.resource.match());
    slots.add(step.name);
  }
  if (subject) {
    if (subject.stored) {
      if (subject.existsRule) rules.push(subject.existsRule);
      rules.push(subject.resource.match());
      slots.add(subject.name);
    }
    if (options.targetConstraint !== false) {
      rules.push(matchPath({ field: subject.idField, segment: subject.depth }));
    }
    for (const relation of subject.relations.values()) {
      rules.push(relation.indirect.match());
      slots.add(relation.id);
    }
    for (const [flag, condition] of subject.conditions) {
      rules.push(condition.require);
      flags.add(flag);
    }
  }
  for (const forbidden of options.forbid ?? []) {
    const condition = subject?.conditions.get(forbidden);
    if (!condition) {
      throw new Error(
        `${key}: cannot forbid "${forbidden}", ${subject ? `"${subject.name}" declares no such condition` : "the key acts on no document"}`,
      );
    }
    rules.push(condition.forbid);
  }
  if (fields === "doc" && subject?.stored) {
    rules.push(subject.resource.filter());
  }
  if (fields === "input") rules.push(inputFilter());
  if (options.input) rules.push(inputMatch());
  for (const rule of options.rules ?? []) {
    rules.push(rule);
    if (rule.descriptor.flag !== undefined) flags.add(rule.descriptor.flag);
    const slot = slotOfCustomRule(rule);
    if (slot !== undefined) slots.add(slot);
  }

  return {
    key,
    kind: def.kind,
    entity: owner,
    on,
    path,
    prefix,
    includeRefs: def.kind === "action" ? [] : def.includes,
    includes: [],
    read: def.kind === "list" ? joined(prefix, def.read) : undefined,
    consumesDocFields: fields === "doc" && subject?.stored === true,
    consumesInputFields: fields === "input",
    consumesInput: options.input === true,
    rules,
    slots,
    flags,
    expand: def.kind === "action" ? undefined : def.options.expand,
    meta: def.options.meta,
  };
}

type LooseGrantOptions = {
  readonly on?: typeof ALL | string | readonly string[];
  readonly id?: string;
  readonly where?: Readonly<Record<string, unknown>>;
  readonly parents?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  readonly related?: Readonly<Record<string, unknown>>;
  readonly fields?: typeof ALL | readonly string[];
  readonly when?: readonly string[];
  readonly input?: Readonly<Record<string, unknown>>;
  readonly payload?: unknown;
  readonly extra?: Readonly<Record<string, unknown>>;
};

function targetOf(
  entry: Entry,
  on: LooseGrantOptions["on"],
): readonly string[] | undefined {
  if (entry.path.length === 0) {
    if (on !== undefined) {
      throw new Error(`grant(${entry.key}): this key takes no target`);
    }
    return undefined;
  }
  if (on === undefined) {
    throw new Error(`grant(${entry.key}): "on" is required`);
  }
  if (on === ALL) return entry.path.map((step) => step.wildcard);
  const segments = typeof on === "string" ? [on] : on;
  if (segments.length !== entry.path.length) {
    throw new Error(
      `grant(${entry.key}): expected ${entry.path.length} target segments, got ${segments.length}`,
    );
  }
  return segments.map((segment, index) =>
    segment === ALL ? entry.path[index].wildcard : segment,
  );
}

function buildGrant(entry: Entry, options: LooseGrantOptions): Grant {
  const target = targetOf(entry, options.on);
  const constraints: Record<string, unknown> = { ...options.parents };
  if (options.where !== undefined) {
    if (entry.entity === null || entry.on !== "self") {
      throw new Error(
        `grant(${entry.key}): "where" needs a key that acts on a document`,
      );
    }
    constraints[entry.entity.name] = options.where;
  }
  for (const [name, spec] of Object.entries(options.related ?? {})) {
    const relation = entry.entity?.relations.get(name);
    if (!relation) {
      throw new Error(`grant(${entry.key}): unknown relation "${name}"`);
    }
    constraints[relation.id] = spec;
  }
  const fields = options.fields;
  return {
    ...options.extra,
    ...(options.id !== undefined && { id: options.id }),
    key: entry.key,
    ...(target && { target }),
    ...(Object.keys(constraints).length > 0 && { with: constraints }),
    ...(fields !== undefined &&
      fields !== ALL && {
        filter: Object.fromEntries(fields.map((field) => [field, true])),
      }),
    ...(options.when &&
      options.when.length > 0 && {
        flags: Object.fromEntries(options.when.map((flag) => [flag, true])),
      }),
    ...(options.input !== undefined && { inputWith: options.input }),
    ...(options.payload !== undefined && { payload: options.payload }),
  };
}

function buildSet(
  owner: AnyEntity | null,
  prefix: string,
  spec: Record<string, AnyDef>,
): AnyPermissionSet {
  const entries = new Map<string, Entry>();
  for (const [name, def] of Object.entries(spec)) {
    const entry = buildEntry(prefix, name, def, owner);
    entries.set(entry.key, entry);
  }
  return {
    prefix,
    entity: owner,
    entries,
    types: {},
    grant(name: string, options: LooseGrantOptions) {
      const entry = entries.get(joined(prefix, name));
      if (!entry) {
        throw new Error(`grant: unknown key "${joined(prefix, name)}"`);
      }
      return buildGrant(entry, options);
    },
  };
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
    ? buildSet(owner, prefixOrSpec, spec ?? {})
    : buildSet(owner, "", prefixOrSpec);
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
    ? buildSet(null, prefixOrSpec, spec ?? {})
    : buildSet(null, "", prefixOrSpec);
}

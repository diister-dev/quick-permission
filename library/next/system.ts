import { validateSpec } from "../mongo-query.ts";
import { deepEqual } from "../rules.ts";
import {
  type CanContext,
  createSystem as createEngine,
  isWildcardSegment,
  type Provider,
  type System as Engine,
  type SystemHooks,
} from "../system.ts";
import { seg, target } from "../target.ts";
import type {
  AnySegment,
  AnyTarget,
  Grant,
  ListEntry,
  Permission,
  Subject,
  TargetNone,
  TargetPath,
  TargetRequired,
} from "../types.ts";
import type { AnyEntity, Path } from "./entity.ts";
import type { AnyPermissionSet, Entry, KeyInfo } from "./permissions.ts";

export type GrantRejection = {
  readonly grant: Grant;
  readonly reason: string;
  readonly provider?: string;
  readonly via?: string;
};

export type TenantAnchor =
  | { readonly entity: AnyEntity; readonly path: readonly string[] }
  | {
      readonly entity: AnyEntity;
      readonly slot?: string;
      readonly where: Readonly<Record<string, unknown>>;
    };

export type Tenant = readonly TenantAnchor[];

export type DelegationOptions = {
  readonly within?: Tenant;
  readonly reserved?: (key: string) => boolean;
};

export type DelegationRefusal = {
  readonly grant: Grant;
  readonly code: "invalid" | "reserved" | "outside-tenant" | "not-held";
  readonly reason: string;
};

export type Hooks = SystemHooks & {
  readonly onGrantRejected?: (event: GrantRejection) => void;
};

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

type TargetFor<P extends Path> = P extends readonly []
  ? TargetNone
  : P extends readonly [string]
    ? TargetRequired<AnySegment>
    : TargetPath<{ readonly [I in keyof P]: AnySegment }>;

export type EngineSchema<T, TMeta = unknown> = {
  readonly [K in keyof T & string]: Permission<TMeta> & {
    readonly target: TargetFor<PathOfKey<T, K>>;
  };
};

export type CheckOptions = Pick<CanContext, "input" | "checkDate" | "checkIp">;

export type CheckResult<TDoc> =
  | {
      readonly ok: true;
      readonly doc?: Partial<TDoc>;
      readonly input?: unknown;
      readonly grants: readonly string[];
    }
  | { readonly ok: false; readonly reasons: readonly string[] };

export type Reach = "all" | "some" | "none";

export type ScopeResult<TDoc> =
  | {
      readonly ok: true;
      readonly rows: "all" | Readonly<Record<string, unknown>>;
      readonly stages?: readonly Readonly<Record<string, unknown>>[];
      readonly grants: readonly string[];
      project(doc: TDoc): Promise<Partial<TDoc> | null>;
      project<F>(
        doc: TDoc,
        options: { readonly denied: (doc: TDoc) => F },
      ): Promise<Partial<TDoc> | F>;
      projectAll(docs: readonly TDoc[]): Promise<Partial<TDoc>[]>;
    }
  | { readonly ok: false; readonly reasons: readonly string[] };

export interface Context<T> {
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
  ): Promise<ScopeResult<DocOfKey<T, K>>>;
  seed(owner: AnyEntity, docs: readonly unknown[], ...parents: string[]): void;
  ask(key: string, target: unknown, options?: CheckOptions): Promise<boolean>;
  delegationRefusal(
    asked: Grant,
    options?: DelegationOptions,
  ): Promise<DelegationRefusal | null>;
  heldGrants(): Promise<readonly Grant[]>;
  fetchCounters(): Readonly<Record<string, number>>;
}

export interface Compiled<T, TMeta = unknown> {
  readonly keys: readonly (keyof T & string)[];
  readonly schema: EngineSchema<T, TMeta>;
  guard(provider: Provider, name?: string): Provider;
  wildcardGrants(idPrefix: string): readonly Grant[];
  expand(grants: readonly Grant[]): readonly Grant[];
  explain(grant: Grant): string | null;
  audit(grants: Iterable<Grant>): readonly GrantRejection[];
  covers(held: Grant, asked: Grant): boolean;
  delegable(root: AnyEntity): readonly (keyof T & string)[];
  delegationRefusal(
    held: readonly Grant[],
    asked: Grant,
    options?: DelegationOptions,
  ): DelegationRefusal | null;
  withinEnvelope(
    envelope: readonly Grant[],
    grants: readonly Grant[],
    options?: DelegationOptions,
  ): {
    readonly kept: readonly Grant[];
    readonly dropped: readonly DelegationRefusal[];
  };
  entry(key: string): Entry | undefined;
}

export interface System<T>
  extends Omit<Compiled<T>, "schema" | "guard" | "entry"> {
  readonly engine: Engine<unknown>;
  catalog(): readonly ListEntry<unknown>[];
  context(bound: { readonly subject: Subject } & CanContext): Context<T>;
}

const MAX_EXPANSION_DEPTH = 10;
const REPORTED_LIMIT = 2000;

function engineTarget(path: readonly AnyEntity[]): AnyTarget {
  if (path.length === 0) return target.none();
  const segments = path.map((step) => seg(step.name, step.refType));
  if (segments.length === 1) return target.required(segments[0]);
  return target.path(...segments);
}

function asSegments(value: unknown): readonly unknown[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function targetProblem(entry: Entry, grant: Grant): string | null {
  if (entry.path.length === 0) return null;
  const segments = asSegments(grant.target);
  if (segments === undefined) return "target is missing";
  if (segments.length !== entry.path.length) {
    return `target has ${segments.length} segments, the key takes ${entry.path.length}`;
  }
  for (const [index, segment] of segments.entries()) {
    const step = entry.path[index];
    if (segment === "*") continue;
    if (
      typeof segment !== "string" ||
      !segment.startsWith(`${step.refType}:`)
    ) {
      return `target segment ${index} is not a "${step.refType}" reference`;
    }
  }
  return null;
}

function restrictionProblem(entry: Entry, grant: Grant): string | null {
  for (const [slot, spec] of Object.entries(grant.with ?? {})) {
    if (!entry.slots.has(slot)) {
      return `constraint "${slot}" is read by no rule of this key`;
    }
    if (spec !== null && typeof spec === "object") {
      try {
        validateSpec(spec);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  }
  for (const flag of Object.keys(grant.flags ?? {})) {
    if (!entry.flags.has(flag)) {
      return `condition "${flag}" is declared by no rule of this key`;
    }
  }
  if (entry.kind !== "action") return null;
  if (grant.inputWith !== undefined && !entry.consumesInput) {
    return "an input constraint is set on a key that reads no input";
  }
  if (
    grant.filter !== undefined &&
    !entry.consumesDocFields &&
    !entry.consumesInputFields
  ) {
    return "a field list is set on a key that projects nothing";
  }
  return null;
}

function resolve(sets: readonly AnyPermissionSet[]): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const set of sets) {
    for (const [key, entry] of set.entries) {
      if (entries.has(key)) {
        throw new Error(`Duplicate permission key "${key}"`);
      }
      entries.set(key, entry);
    }
  }
  return entries;
}

function validate(
  entries: Map<string, Entry>,
  isForeignKey: (key: string) => boolean,
): void {
  const issues: string[] = [];
  for (const [key, entry] of entries) {
    const includes = entry.includeRefs.map((include) => {
      if (typeof include !== "string") return include.external;
      if (entry.prefix === "") return include;
      const sibling = `${entry.prefix}.${include}`;
      return entries.has(sibling) ? sibling : include;
    });
    entries.set(key, { ...entry, includes });
  }
  for (const entry of entries.values()) {
    if (
      entry.read !== undefined &&
      entries.get(entry.read)?.kind !== "action"
    ) {
      issues.push(
        `"${entry.key}" lists through "${entry.read}", which is not an action`,
      );
    }
    for (const includedKey of entry.includes) {
      const included = entries.get(includedKey);
      if (!included) {
        if (!isForeignKey(includedKey)) {
          issues.push(`"${entry.key}" includes unknown key "${includedKey}"`);
        }
        continue;
      }
      if (included.path.length < entry.path.length) {
        issues.push(
          `"${entry.key}" includes "${includedKey}", which acts on a wider scope`,
        );
        continue;
      }
      if (
        entry.path.some(
          (step, index) =>
            included.path[index].name !== step.name ||
            included.path[index].refType !== step.refType,
        )
      ) {
        issues.push(
          `"${entry.key}" includes "${includedKey}", which is not under the same entities`,
        );
      }
    }
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (key: string, trail: readonly string[]): void => {
    if (state.get(key) === "done") return;
    if (state.get(key) === "visiting") {
      issues.push(`bundle cycle: ${[...trail, key].join(" -> ")}`);
      return;
    }
    state.set(key, "visiting");
    for (const next of entries.get(key)?.includes ?? []) {
      if (entries.has(next)) visit(next, [...trail, key]);
    }
    state.set(key, "done");
  };
  for (const key of entries.keys()) visit(key, []);
  if (issues.length > 0) {
    throw new Error(
      `Permission schema is invalid:\n  - ${issues.join("\n  - ")}`,
    );
  }
}

function targetCovers(held: unknown, asked: unknown): boolean {
  const heldPath = asSegments(held);
  const askedPath = asSegments(asked);
  if (heldPath === undefined || askedPath === undefined) {
    return heldPath === askedPath;
  }
  if (heldPath.length !== askedPath.length) return false;
  return heldPath.every((segment, index) => {
    const wanted = askedPath[index];
    if (segment === "*") return true;
    if (typeof segment === "string" && isWildcardSegment(segment)) {
      return (
        typeof wanted === "string" && wanted.startsWith(segment.slice(0, -1))
      );
    }
    return segment === wanted;
  });
}

function isSpec(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type Conjunct = readonly [field: string, condition: unknown];

function conjuncts(spec: Record<string, unknown>): Conjunct[] {
  const out: Conjunct[] = [];
  for (const [field, condition] of Object.entries(spec)) {
    if (
      field === "$and" &&
      Array.isArray(condition) &&
      condition.every(isSpec)
    ) {
      for (const part of condition) out.push(...conjuncts(part));
    } else {
      out.push([field, condition]);
    }
  }
  return out;
}

function listOf(condition: unknown): readonly unknown[] | undefined {
  if (!isSpec(condition)) return [condition];
  const operators = Object.keys(condition);
  if (operators.length !== 1) return undefined;
  if (operators[0] === "$eq") return [condition.$eq];
  if (operators[0] === "$in" && Array.isArray(condition.$in)) {
    return condition.$in;
  }
  return undefined;
}

function conditionImplies(narrow: unknown, wide: unknown): boolean {
  if (deepEqual(narrow, wide)) return true;
  const allowed = listOf(wide);
  const wanted = listOf(narrow);
  if (allowed === undefined || wanted === undefined) return false;
  if (wanted.some((value) => isSpec(value) || Array.isArray(value))) {
    return false;
  }
  return wanted.every((value) =>
    allowed.some((candidate) => deepEqual(candidate, value)),
  );
}

export function specImplies(narrow: unknown, wide: unknown): boolean {
  if (wide === undefined) return true;
  if (narrow === undefined) return false;
  if (!isSpec(wide) || !isSpec(narrow)) return deepEqual(narrow, wide);
  const held = conjuncts(narrow);
  return conjuncts(wide).every(([field, condition]) =>
    held.some(
      ([candidate, value]) =>
        candidate === field &&
        (field.startsWith("$")
          ? deepEqual(value, condition)
          : conditionImplies(value, condition)),
    ),
  );
}

function restrictionsCover(held: Grant, asked: Grant): boolean {
  for (const [slot, spec] of Object.entries(held.with ?? {})) {
    if (!specImplies(asked.with?.[slot], spec)) return false;
  }
  if (!specImplies(asked.inputWith, held.inputWith)) return false;
  if (held.payload !== undefined && !deepEqual(asked.payload, held.payload)) {
    return false;
  }
  for (const [flag, on] of Object.entries(held.flags ?? {})) {
    if (on && asked.flags?.[flag] !== true) return false;
  }
  if (held.filter !== undefined) {
    if (asked.filter === undefined) return false;
    const allowed = held.filter;
    const wanted = Object.entries(asked.filter).filter(([, on]) => on);
    if (
      !wanted.every(
        ([field]) =>
          allowed[field] === true ||
          field
            .split(".")
            .some(
              (_part, index, parts) =>
                index > 0 && allowed[parts.slice(0, index).join(".")] === true,
            ),
      )
    ) {
      return false;
    }
  }
  return true;
}

export function compilePermissions<
  const Sets extends readonly AnyPermissionSet[],
  TMeta = unknown,
>(
  sets: Sets,
  options: {
    readonly hooks?: Pick<Hooks, "onGrantRejected">;
    readonly isForeignKey?: (key: string) => boolean;
  } = {},
): Compiled<TypesOf<Sets>, TMeta> {
  type T = TypesOf<Sets>;
  const entries = resolve(sets);
  validate(entries, options.isForeignKey ?? (() => false));
  const hooks = options.hooks ?? {};

  const reported = new Set<string>();
  const reject = (event: GrantRejection): void => {
    const signature = `${event.provider ?? ""}|${event.via ?? ""}|${event.reason}|${JSON.stringify(event.grant)}`;
    if (reported.has(signature)) return;
    if (reported.size >= REPORTED_LIMIT) reported.clear();
    reported.add(signature);
    try {
      hooks.onGrantRejected?.(event);
    } catch {
      return;
    }
  };

  function expandOne(
    entry: Entry,
    grant: Grant,
    report: (event: GrantRejection) => void,
  ): Grant[] {
    const base = asSegments(grant.target) ?? [];
    if (base.length !== entry.path.length) return [];
    const children: Grant[] = [];
    for (const includedKey of entry.includes) {
      const included = entries.get(includedKey);
      if (!included) {
        children.push({ ...grant, key: includedKey });
        continue;
      }
      const { target: _parentTarget, filter, ...rest } = grant;
      const keepsFields =
        included.kind !== "action" ||
        included.consumesDocFields ||
        included.consumesInputFields;
      const child: Grant = {
        ...rest,
        key: includedKey,
        ...(included.path.length > 0 && {
          target: [
            ...base,
            ...included.path.slice(base.length).map((step) => step.wildcard),
          ],
        }),
        ...(filter !== undefined && keepsFields && { filter }),
      };
      const problem = restrictionProblem(included, child);
      if (problem === null) children.push(child);
      else report({ grant: child, reason: problem, via: entry.key });
    }
    if (entry.expand) children.push(...entry.expand(grant));
    return children;
  }

  const schema: Record<string, Permission<unknown>> = {};
  for (const entry of entries.values()) {
    schema[entry.key] = {
      metadata: entry.meta,
      target: engineTarget(entry.path),
      rules: entry.rules,
      ...(entry.kind !== "action" && {
        expandsTo: (grant: Grant) => expandOne(entry, grant, reject),
      }),
    };
  }

  const verdicts = new WeakMap<Grant, string | null>();

  function explain(grant: Grant): string | null {
    const known = verdicts.get(grant);
    if (known !== undefined) return known;
    const entry = entries.get(grant.key);
    const verdict = !entry
      ? `unknown permission key "${grant.key}"`
      : (targetProblem(entry, grant) ?? restrictionProblem(entry, grant));
    verdicts.set(grant, verdict);
    return verdict;
  }

  function admitted(grants: readonly Grant[], provider: string): Grant[] {
    const kept: Grant[] = [];
    for (const grant of grants) {
      if (!entries.has(grant.key) && options.isForeignKey?.(grant.key)) {
        kept.push(grant);
        continue;
      }
      const reason = explain(grant);
      if (reason === null) kept.push(grant);
      else reject({ grant, reason, provider });
    }
    return kept;
  }

  function expand(
    grants: readonly Grant[],
    report: (event: GrantRejection) => void = () => {},
  ): readonly Grant[] {
    const queue = grants.map((grant) => ({ grant, depth: 0 }));
    const expanded: Grant[] = [];
    for (let head = 0; head < queue.length; head++) {
      const { grant, depth } = queue[head];
      const entry = entries.get(grant.key);
      if (!entry) continue;
      const reason = depth === 0 ? explain(grant) : null;
      if (reason !== null) {
        report({ grant, reason });
        continue;
      }
      expanded.push(grant);
      if (entry.kind === "action" || depth >= MAX_EXPANSION_DEPTH) continue;
      for (const child of expandOne(entry, grant, report)) {
        queue.push({ grant: child, depth: depth + 1 });
      }
    }
    return expanded;
  }

  const coveredBy = (expanded: readonly Grant[], asked: Grant): boolean =>
    expanded.some(
      (candidate) =>
        candidate.key === asked.key &&
        targetCovers(candidate.target, asked.target) &&
        restrictionsCover(candidate, asked),
    );

  const covers = (held: Grant, asked: Grant): boolean =>
    coveredBy(expand([held]), asked);

  const startsAt = (entry: Entry, root: AnyEntity): boolean =>
    root.lineage.length > 0 &&
    root.lineage.every(
      (step, index) =>
        entry.path[index]?.name === step.name &&
        entry.path[index]?.refType === step.refType,
    );

  function anchorProblem(anchor: TenantAnchor): string | null {
    if ("path" in anchor) {
      const concrete =
        anchor.path.length === anchor.entity.lineage.length &&
        anchor.path.length > 0 &&
        anchor.path.every(
          (id, index) =>
            !isWildcardSegment(id) &&
            id.startsWith(`${anchor.entity.lineage[index].refType}:`),
        );
      return concrete
        ? null
        : `a tenant anchor is not a concrete "${anchor.entity.name}" reference`;
    }
    return Object.keys(anchor.where).length > 0
      ? null
      : `a tenant anchor on "${anchor.entity.name}" carries no condition`;
  }

  function anchored(grant: Grant, entry: Entry, anchor: TenantAnchor): boolean {
    if (!startsAt(entry, anchor.entity)) return false;
    if ("path" in anchor) {
      const segments = asSegments(grant.target) ?? [];
      return anchor.path.every((id, index) => segments[index] === id);
    }
    return specImplies(
      grant.with?.[anchor.slot ?? anchor.entity.name],
      anchor.where,
    );
  }

  function tenantProblem(asked: Grant, tenant: Tenant): string | null {
    if (tenant.length === 0) return "the tenant has no anchor";
    for (const anchor of tenant) {
      const malformed = anchorProblem(anchor);
      if (malformed !== null) return malformed;
    }
    const queue = [{ grant: asked, depth: 0 }];
    for (let head = 0; head < queue.length; head++) {
      const { grant, depth } = queue[head];
      const entry = entries.get(grant.key);
      if (!entry) return `"${grant.key}" is not a key of this schema`;
      if (!tenant.some((anchor) => anchored(grant, entry, anchor))) {
        return `"${grant.key}" is not bound to the tenant`;
      }
      if (entry.kind === "action") continue;
      if (depth >= MAX_EXPANSION_DEPTH) {
        return `"${grant.key}" expands deeper than ${MAX_EXPANSION_DEPTH} levels`;
      }
      for (const child of expandOne(entry, grant, () => {})) {
        queue.push({ grant: child, depth: depth + 1 });
      }
    }
    return null;
  }

  function refusalAgainst(
    expanded: readonly Grant[],
    asked: Grant,
    delegation: DelegationOptions,
  ): DelegationRefusal | null {
    const invalid = explain(asked);
    if (invalid !== null) {
      return { grant: asked, code: "invalid", reason: invalid };
    }
    if (delegation.reserved?.(asked.key)) {
      return {
        grant: asked,
        code: "reserved",
        reason: `"${asked.key}" cannot be delegated`,
      };
    }
    if (delegation.within) {
      const outside = tenantProblem(asked, delegation.within);
      if (outside !== null) {
        return { grant: asked, code: "outside-tenant", reason: outside };
      }
    }
    if (!coveredBy(expanded, asked)) {
      return {
        grant: asked,
        code: "not-held",
        reason: `"${asked.key}" exceeds what the delegator holds`,
      };
    }
    return null;
  }

  const delegationRefusal = (
    held: readonly Grant[],
    asked: Grant,
    delegation: DelegationOptions = {},
  ): DelegationRefusal | null =>
    refusalAgainst(expand(held), asked, delegation);

  function withinEnvelope(
    envelope: readonly Grant[],
    grants: readonly Grant[],
    delegation: DelegationOptions = {},
  ): { kept: Grant[]; dropped: DelegationRefusal[] } {
    const expanded = expand(envelope);
    const kept: Grant[] = [];
    const dropped: DelegationRefusal[] = [];
    for (const grant of grants) {
      const refusal = refusalAgainst(expanded, grant, delegation);
      if (refusal === null) kept.push(grant);
      else dropped.push(refusal);
    }
    return { kept, dropped };
  }

  return {
    keys: [...entries.keys()] as (keyof T & string)[],
    schema: schema as EngineSchema<T, TMeta>,
    entry: (key) => entries.get(key),
    delegable: (root) =>
      [...entries.values()]
        .filter((entry) => startsAt(entry, root))
        .map((entry) => entry.key) as (keyof T & string)[],
    delegationRefusal,
    withinEnvelope,
    explain,
    expand: (grants) => expand(grants),
    guard(provider, name) {
      if (typeof provider === "function") {
        const label = name ?? "provider";
        return async (subject, key, requested, access) =>
          admitted(await provider(subject, key, requested, access), label);
      }
      const label = name ?? provider.name ?? "provider";
      return {
        ...provider,
        fetch: async (subject, key, requested, access) =>
          admitted(
            await provider.fetch(subject, key, requested, access),
            label,
          ),
      };
    },
    wildcardGrants(idPrefix) {
      return [...entries.values()].map((entry) => ({
        id: `${idPrefix}:${entry.key}`,
        key: entry.key,
        ...(entry.path.length > 0 && {
          target: entry.path.map((step) => step.wildcard),
        }),
      }));
    },
    audit(grants) {
      const rejections: GrantRejection[] = [];
      for (const grant of grants) {
        if (!entries.has(grant.key)) {
          rejections.push({
            grant,
            reason: `unknown permission key "${grant.key}"`,
          });
          continue;
        }
        expand([grant], (event) => rejections.push(event));
      }
      return rejections;
    },
    covers,
  };
}

export function createSystem<
  const Sets extends readonly AnyPermissionSet[],
>(options: {
  readonly permissions: Sets;
  readonly providers?: readonly Provider[];
  readonly hooks?: Hooks;
}): System<TypesOf<Sets>> {
  type T = TypesOf<Sets>;
  const hooks = options.hooks ?? {};
  const compiled = compilePermissions(options.permissions, { hooks });

  const providers = (options.providers ?? []).map((provider, index) =>
    compiled.guard(
      provider,
      (typeof provider === "object" && provider.name) || `provider#${index}`,
    ),
  );

  const engine = createEngine<unknown>({
    schema: compiled.schema,
    providers,
    hooks: {
      ...(hooks.onProviderFetch && { onProviderFetch: hooks.onProviderFetch }),
      ...(hooks.onError && { onError: hooks.onError }),
    },
  });

  function entryOf(key: string): Entry {
    const entry = compiled.entry(key);
    if (!entry) throw new Error(`Unknown permission key "${key}"`);
    return entry;
  }

  return {
    keys: compiled.keys,
    engine,
    catalog: () => engine.list(),
    explain: compiled.explain,
    expand: compiled.expand,
    wildcardGrants: compiled.wildcardGrants,
    audit: compiled.audit,
    covers: compiled.covers,
    delegable: compiled.delegable,
    delegationRefusal: compiled.delegationRefusal,
    withinEnvelope: compiled.withinEnvelope,
    context(bound) {
      const inner = engine.context(bound);

      const seed: Context<T>["seed"] = (owner, docs, ...parents) => {
        inner.preseed(owner.resource, docs, {
          dedupKey: (doc) => [
            ...parents,
            (doc as Record<string, unknown>)[owner.idField],
          ],
        });
      };

      const wildcardRequest = (entry: Entry, ids: readonly unknown[]) =>
        entry.path.map((step, index) => ids[index] ?? step.wildcard);

      const context: Context<T> = {
        async check(key, ...args) {
          const entry = entryOf(key);
          const ids = args.slice(0, entry.path.length);
          const perCall = args[entry.path.length] as CheckOptions | undefined;
          if (ids.length !== entry.path.length || ids.some(isWildcardSegment)) {
            return {
              ok: false,
              reasons: [
                `check(${key}) needs ${entry.path.length} concrete ids; ask could(), reach() or scope() for a capability`,
              ],
            };
          }
          const result = await inner.can(
            key,
            ids.length > 0 ? ids : undefined,
            perCall,
          );
          if (!result.ok) return result;
          const data = result.data as never;
          return {
            ok: true,
            grants: result.matchedGrants ?? [],
            ...(entry.consumesDocFields && data !== undefined && { doc: data }),
            ...(entry.consumesInputFields &&
              data !== undefined && { input: data }),
          };
        },

        async could(key, ...ids) {
          const entry = entryOf(key);
          if (entry.path.length === 0) return (await inner.can(key)).ok;
          return (await inner.can(key, wildcardRequest(entry, ids))).ok;
        },

        async reach(key, ...ids) {
          const entry = entryOf(key);
          if (entry.path.length === 0) {
            return (await inner.can(key)).ok ? "all" : "none";
          }
          const requested = wildcardRequest(entry, ids);
          const result = await inner.can(key, requested);
          if (!result.ok) return "none";
          if (!requested.some(isWildcardSegment)) return "all";
          const constraints = result.constraints;
          const unrestricted =
            (constraints === undefined ||
              Object.keys(constraints).length === 0) &&
            result.stages === undefined;
          return unrestricted ? "all" : "some";
        },

        async scope(key, ...parents) {
          const entry = entryOf(key);
          const owner = entry.entity;
          if (entry.on !== "self" || owner === null) {
            throw new Error(`scope(${key}): the key acts on no document`);
          }
          const read = entry.read;
          const parentIds = parents as readonly string[];
          const result = await inner.can(key, [...parentIds, owner.wildcard]);
          if (!result.ok) return result;
          const constraints = result.constraints;
          const rows =
            constraints === undefined || Object.keys(constraints).length === 0
              ? ("all" as const)
              : constraints;

          const project = async (
            doc: unknown,
            projection?: { readonly denied: (doc: never) => unknown },
          ): Promise<unknown> => {
            const id = (doc as Record<string, unknown>)[owner.idField];
            seed(owner, [doc], ...parentIds);
            const row = [...parentIds, id];
            const [covered, rights] = await Promise.all([
              inner.can(key, row),
              read === undefined ? undefined : inner.can(read, row),
            ]);
            const fields = rights ?? covered;
            if (!covered.ok || !fields.ok) {
              return projection ? projection.denied(doc as never) : null;
            }
            return entry.consumesDocFields || read !== undefined
              ? (fields.data ?? doc)
              : doc;
          };

          return {
            ok: true,
            rows,
            ...(result.stages && { stages: result.stages }),
            grants: result.matchedGrants ?? [],
            project: project as never,
            async projectAll(docs: readonly unknown[]) {
              const projected = await Promise.all(
                docs.map((doc) => project(doc)),
              );
              return projected.filter((item) => item !== null) as never;
            },
          };
        },

        seed,

        async ask(key, requested, perCall) {
          if (!compiled.entry(key)) return false;
          return (await inner.can(key, asSegments(requested), perCall)).ok;
        },

        async delegationRefusal(asked, delegation) {
          const upfront = compiled.delegationRefusal([], asked, delegation);
          if (upfront === null || upfront.code !== "not-held") return upfront;
          await inner.can(asked.key, asSegments(asked.target));
          return compiled.delegationRefusal(
            await inner.dumpGrants(),
            asked,
            delegation,
          );
        },

        heldGrants: async () => compiled.expand(await inner.dumpGrants()),
        fetchCounters: () => inner.getFetchCounters(),
      };
      return context;
    },
  };
}

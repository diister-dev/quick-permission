import type {
  AnyTarget,
  CanResult,
  FetchCtx,
  FilterContribution,
  Grant,
  IndirectResourceInfo,
  ListEntry,
  Permission,
  Resource,
  SerializableSegment,
  SerializableTarget,
  Subject,
  TreeNode,
} from "./types.ts";
import {
  aggregateConstraints,
  combineGrantConstraints,
  type FilterUnion,
  mergeFilterSpec,
  resolveFilteredData,
} from "./aggregation.ts";
import { buildAggregationStages } from "./indirect-aggregation.ts";
import {
  extractIndirectResource,
  type IndirectResource,
} from "./indirect-resource.ts";

export type ProviderFn = (
  subject: Subject,
  key: string,
  target?: readonly unknown[],
) => readonly Grant[] | Promise<readonly Grant[]>;

export type ProviderObject = {
  readonly name?: string;
  readonly keys?: readonly string[];
  readonly matches?: (key: string) => boolean;
  readonly targetType?: string | readonly string[];
  readonly cacheKey?: (
    subject: Subject,
    key: string,
    target?: readonly unknown[],
  ) => string | undefined;
  readonly fetch: ProviderFn;
};

export type Provider = ProviderFn | ProviderObject;

export type ProviderFetchEvent = {
  readonly provider: string;
  readonly subject: Subject;
  readonly key: string;
  readonly target: readonly unknown[] | undefined;
  readonly durationMs: number;
  readonly grantCount: number;
};

export type PermissionErrorEvent =
  | {
      readonly source: "provider";
      readonly provider: string;
      readonly subject: Subject;
      readonly key: string;
      readonly target: readonly unknown[] | undefined;
      readonly error: unknown;
    }
  | {
      readonly source: "rule";
      readonly grantId: string | undefined;
      readonly subject: Subject;
      readonly key: string;
      readonly target: readonly unknown[] | undefined;
      readonly error: unknown;
    };

export type SystemHooks = {
  readonly onProviderFetch?: (event: ProviderFetchEvent) => void;
  readonly onError?: (event: PermissionErrorEvent) => void;
};

function keyMatchesPattern(key: string, pattern: string): boolean {
  if (pattern === key) return true;
  if (pattern.endsWith("*")) {
    return key.startsWith(pattern.slice(0, -1));
  }
  return false;
}

function providerDeclaresKey(provider: ProviderObject, key: string): boolean {
  if (provider.keys?.some((p) => keyMatchesPattern(key, p))) return true;
  return provider.matches?.(key) === true;
}

export function refType(segment: unknown): string | undefined {
  if (typeof segment !== "string") return undefined;
  const colon = segment.indexOf(":");
  return colon > 0 ? segment.slice(0, colon) : undefined;
}

function providerHandlesTarget(
  provider: ProviderObject,
  target: readonly unknown[] | undefined,
): boolean {
  if (provider.targetType === undefined) return true;
  const first = target?.[0];
  if (first === undefined || isWildcardSegment(first)) return false;
  const type = refType(first);
  if (type === undefined) return false;
  return typeof provider.targetType === "string"
    ? provider.targetType === type
    : provider.targetType.includes(type);
}

type ProviderOutcome = {
  readonly grants: readonly Grant[];
  readonly failure?: string;
};

type GrantsCache = Map<Provider, Map<string, Promise<ProviderOutcome>>>;

function callHook(invoke: () => void): void {
  try {
    invoke();
  } catch {
    return;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type CanContext = {
  readonly checkDate?: Date;
  readonly checkIp?: string;
  /** Check-time payload read by `inputMatch()`, as opposed to the grant's static `payload`. */
  readonly input?: unknown;
};

export type System<TMeta = unknown> = {
  list(): readonly ListEntry<TMeta>[];
  tree(): { readonly children: Readonly<Record<string, TreeNode<TMeta>>> };
  schema(key: string): Permission<TMeta> | undefined;
  /** Deduplicated by id, in declaration order, without their functions. */
  indirectResources(): readonly IndirectResourceInfo[];
  indirectsUsedBy(key: string): readonly IndirectResourceInfo[];
  /** Nothing is cached across calls; prefer `context()` for a request. */
  can(
    subject: Subject,
    key: string,
    target?: readonly unknown[],
    context?: CanContext,
  ): Promise<CanResult>;
  /** Resources and provider grants are cached across every `can()` of the context. */
  context(bound: { readonly subject: Subject } & CanContext): {
    /** `perCall` overrides the bound context for this check only, typically `input` on a create. */
    can(
      key: string,
      target?: readonly unknown[],
      perCall?: CanContext,
    ): Promise<CanResult>;
    /**
     * `dedupKey(doc)` must return the segments the resource's own `dedupKey`
     * computes at fetch time, or the seeded value is never found. `value(doc)`
     * defaults to the doc; an indirect resource caches its joined docs instead.
     */
    preseed<T, V = T>(
      resource: Resource<unknown> | IndirectResource | string,
      docs: ReadonlyArray<T>,
      opts: {
        dedupKey: (doc: T) => readonly unknown[];
        value?: (doc: T) => V;
      },
    ): void;
    getFetchCounters(): Readonly<Record<string, number>>;
    /** Resets the counters, never the cache. */
    clearCounters(): void;
    /** Only the grants of cached providers already consulted in this context. */
    dumpGrants(): Promise<readonly Grant[]>;
  };
};

function validateSchema<TMeta>(
  schema: Readonly<Record<string, Permission<TMeta>>>,
): void {
  const issues: string[] = [];
  for (const [key, perm] of Object.entries(schema)) {
    if (!perm.expandsTo) continue;
    let samples: readonly Grant[] = [];
    try {
      samples = perm.expandsTo({
        key,
        target: ["*"],
      });
    } catch {
      continue;
    }
    for (const child of samples) {
      if (!(child.key in schema)) {
        issues.push(
          `intermediate "${key}" expands to unknown key "${child.key}"`,
        );
      }
    }
  }
  if (issues.length > 0) {
    throw new Error(`Schema validation failed:\n  - ${issues.join("\n  - ")}`);
  }
}

function asPath(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** A query with any wildcard segment asks "could this subject, on some target"; rules that need a concrete document pass silently. */
export function isCapabilityQuery(
  target: readonly unknown[] | undefined,
): boolean {
  if (!target) return false;
  return target.some(isWildcardSegment);
}

export function isWildcardSegment(seg: unknown): boolean {
  return seg === "*" || (typeof seg === "string" && seg.endsWith("*"));
}

function segmentOverlaps(a: unknown, b: unknown): boolean {
  if (a === "*" || b === "*") return true;
  if (typeof a === "string" && typeof b === "string") {
    const aPrefix = a.endsWith("*") ? a.slice(0, -1) : null;
    const bPrefix = b.endsWith("*") ? b.slice(0, -1) : null;
    if (aPrefix !== null && bPrefix !== null) {
      return aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix);
    }
    if (aPrefix !== null) return b.startsWith(aPrefix);
    if (bPrefix !== null) return a.startsWith(bPrefix);
  }
  return a === b;
}

function targetMatches(
  grantTarget: readonly unknown[] | unknown | undefined,
  requestTarget: readonly unknown[] | undefined,
  schemaKind: AnyTarget["kind"],
  capability: boolean,
): boolean {
  if (schemaKind === "none") return true;
  if (grantTarget === undefined) return schemaKind === "optional";
  if (requestTarget === undefined) return false;
  const g = asPath(grantTarget);
  if (g.length !== requestTarget.length) return false;
  if (capability) {
    return g.every((seg, i) => segmentOverlaps(seg, requestTarget[i]));
  }
  return g.every((seg, i) => {
    if (seg === "*") return true;
    if (typeof seg === "string" && seg.endsWith("*")) {
      const prefix = seg.slice(0, -1);
      return (
        typeof requestTarget[i] === "string" &&
        (requestTarget[i] as string).startsWith(prefix)
      );
    }
    return seg === requestTarget[i];
  });
}

function expandGrants<TMeta>(
  grants: readonly Grant[],
  schema: Readonly<Record<string, Permission<TMeta>>>,
  maxDepth = 10,
): Grant[] {
  const out: Grant[] = [];
  const queue: Array<{ grant: Grant; depth: number }> = grants.map((g) => ({
    grant: g,
    depth: 0,
  }));
  for (let head = 0; head < queue.length; head++) {
    const { grant, depth } = queue[head];
    const perm = schema[grant.key];
    if (
      perm &&
      grant.target === undefined &&
      (perm.target.kind === "required" || perm.target.kind === "path")
    ) {
      continue;
    }
    out.push(grant);
    if (depth >= maxDepth) continue;
    if (perm?.expandsTo) {
      const children = perm.expandsTo(grant);
      for (const child of children) {
        queue.push({ grant: child, depth: depth + 1 });
      }
    }
  }
  return out;
}

function serializeSegment(s: {
  readonly name: string;
  readonly types: unknown;
}): SerializableSegment {
  const types = s.types as string | readonly string[];
  return { name: s.name, types };
}

function serializeTarget(t: AnyTarget): SerializableTarget {
  switch (t.kind) {
    case "none":
      return { kind: "none" };
    case "optional":
      return { kind: "optional", segment: serializeSegment(t.segments[0]) };
    case "required":
      return { kind: "required", segment: serializeSegment(t.segments[0]) };
    case "path":
      return {
        kind: "path",
        segments: t.segments.map(serializeSegment),
      };
  }
}

function serializeIndirectResource(ir: IndirectResource): IndirectResourceInfo {
  return {
    id: ir.id,
    kind: "indirect",
    from: { id: ir.from.id, kind: ir.from.kind },
    on: {
      localField: ir.on.localField,
      foreignField: ir.on.foreignField,
      ...(ir.on.foreignCollection !== undefined && {
        foreignCollection: ir.on.foreignCollection,
      }),
    },
    ...(ir.to !== undefined && { to: { ...ir.to } }),
    cardinality: ir.cardinality,
  };
}

function collectIndirectsForPermission<TMeta>(
  perm: Permission<TMeta>,
): IndirectResource[] {
  const collected = new Map<string, IndirectResource>();
  for (const rule of perm.rules) {
    const ir = extractIndirectResource(rule);
    if (ir && !collected.has(ir.id)) collected.set(ir.id, ir);
  }
  return Array.from(collected.values());
}

function stubTargetFor(t: AnyTarget): readonly unknown[] | undefined {
  if (t.kind === "none") return undefined;
  if (t.kind === "optional" || t.kind === "required") return ["*"];
  return t.segments.map(() => "*");
}

type ExpansionGraph = {
  readonly descendants: ReadonlyMap<string, readonly string[]>;
  readonly ancestors: ReadonlyMap<string, readonly string[]>;
};

// An intermediate is sampled with a wildcard grant: by convention `expandsTo`
// routes keys and does not depend on the grant's target or payload.
function expansionGraph<TMeta>(
  schema: Readonly<Record<string, Permission<TMeta>>>,
  maxDepth = 10,
): ExpansionGraph {
  const descendants = new Map<string, string[]>();
  const ancestors = new Map<string, string[]>();
  for (const [rootKey, root] of Object.entries(schema)) {
    if (!root.expandsTo) continue;
    const leaves: string[] = [];
    const visited = new Set<string>([rootKey]);
    const queue: Array<{ key: string; depth: number }> = [
      { key: rootKey, depth: 0 },
    ];
    for (let head = 0; head < queue.length; head++) {
      const { key, depth } = queue[head];
      const perm = schema[key];
      if (!perm) continue;
      if (!perm.expandsTo) {
        leaves.push(key);
        continue;
      }
      if (depth >= maxDepth) continue;
      let children: readonly Grant[] = [];
      try {
        children = perm.expandsTo({ key, target: stubTargetFor(perm.target) });
      } catch {
        continue;
      }
      for (const child of children) {
        if (visited.has(child.key)) continue;
        visited.add(child.key);
        const list = ancestors.get(child.key) ?? [];
        list.push(rootKey);
        ancestors.set(child.key, list);
        queue.push({ key: child.key, depth: depth + 1 });
      }
    }
    descendants.set(rootKey, leaves);
  }
  return { descendants, ancestors };
}

function buildTree<TMeta>(
  schema: Readonly<Record<string, Permission<TMeta>>>,
  graph: ExpansionGraph,
): { children: Record<string, TreeNode<TMeta>> } {
  const root: { children: Record<string, TreeNode<TMeta>> } = { children: {} };

  function ensureGroup(
    parent: { children: Record<string, TreeNode<TMeta>> },
    name: string,
  ): TreeNode<TMeta> {
    const existing = parent.children[name];
    if (existing) return existing;
    const group: TreeNode<TMeta> = {
      kind: "group",
      metadata: undefined,
      children: {},
    };
    parent.children[name] = group;
    return group;
  }

  for (const [key, perm] of Object.entries(schema)) {
    const parts = key.split(".");
    let cursor: { children: Record<string, TreeNode<TMeta>> } = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const node = ensureGroup(cursor, parts[i]);
      if (node.kind !== "group") {
        const newGroup: TreeNode<TMeta> = {
          kind: "group",
          metadata: undefined,
          children: {},
        };
        cursor.children[parts[i]] = newGroup;
        cursor = newGroup;
      } else {
        cursor = node as {
          kind: "group";
          metadata: undefined;
          children: Record<string, TreeNode<TMeta>>;
        };
      }
    }
    const leafName = parts[parts.length - 1];
    const descendants = graph.descendants.get(key);
    cursor.children[leafName] = {
      kind: perm.expandsTo ? "intermediate" : "permission",
      key,
      metadata: perm.metadata,
      target: serializeTarget(perm.target),
      rules: perm.rules.map((r) => r.descriptor),
      ...(descendants !== undefined && { expandsTo: descendants }),
    };
  }

  return root;
}

export function createSystem<TMeta = unknown>(opts: {
  readonly schema: Readonly<Record<string, Permission<TMeta>>>;
  readonly providers?: readonly Provider[];
  readonly hooks?: SystemHooks;
}): System<TMeta> {
  const { schema, providers = [], hooks = {} } = opts;
  validateSchema(schema);

  const graph = expansionGraph(schema);
  const providerNames = new Map<Provider, string>(
    providers.map((provider, index) => [
      provider,
      (typeof provider === "object" && provider.name) || `provider#${index}`,
    ]),
  );
  const handledKeys = new Map<ProviderObject, Map<string, boolean>>();

  function providerHandlesKey(provider: ProviderObject, key: string): boolean {
    if (!provider.keys && !provider.matches) return true;
    let memo = handledKeys.get(provider);
    if (!memo) {
      memo = new Map();
      handledKeys.set(provider, memo);
    }
    const known = memo.get(key);
    if (known !== undefined) return known;
    const handled =
      providerDeclaresKey(provider, key) ||
      (graph.ancestors.get(key) ?? []).some((ancestor) =>
        providerDeclaresKey(provider, ancestor),
      );
    memo.set(key, handled);
    return handled;
  }

  const resourceRegistry = new Map<
    string,
    Resource<unknown> | IndirectResource
  >();
  for (const perm of Object.values(schema)) {
    for (const rule of perm.rules) {
      for (const r of rule.needs) {
        if (!resourceRegistry.has(r.id)) resourceRegistry.set(r.id, r);
      }
      const ir = extractIndirectResource(rule);
      if (ir && !resourceRegistry.has(ir.id)) resourceRegistry.set(ir.id, ir);
    }
  }

  return {
    list() {
      return Object.entries(schema).map(([key, perm]) => {
        const descendants = graph.descendants.get(key);
        return {
          key,
          kind: perm.expandsTo
            ? ("intermediate" as const)
            : ("permission" as const),
          metadata: perm.metadata,
          target: serializeTarget(perm.target),
          rules: perm.rules.map((r) => r.descriptor),
          ...(descendants !== undefined && { expandsTo: descendants }),
        };
      });
    },

    tree() {
      return buildTree<TMeta>(schema, graph);
    },

    schema(key) {
      return schema[key];
    },

    indirectResources() {
      const seen = new Map<string, IndirectResource>();
      for (const perm of Object.values(schema)) {
        for (const ir of collectIndirectsForPermission(perm)) {
          if (!seen.has(ir.id)) seen.set(ir.id, ir);
        }
      }
      return Array.from(seen.values()).map(serializeIndirectResource);
    },

    indirectsUsedBy(key) {
      const perm = schema[key];
      if (!perm) return [];
      return collectIndirectsForPermission(perm).map(serializeIndirectResource);
    },

    can(subject, key, target, context) {
      return systemCan(subject, key, target, context, undefined);
    },

    context(bound) {
      const cache = new Map<string, Promise<unknown>>();
      const grantsCache: GrantsCache = new Map();
      const fetchCounters = new Map<string, number>();
      const { subject, ...boundCtx } = bound;
      const resolveResource = (
        resourceOrId: Resource<unknown> | IndirectResource | string,
      ): Resource<unknown> | IndirectResource => {
        if (typeof resourceOrId !== "string") return resourceOrId;
        const r = resourceRegistry.get(resourceOrId);
        if (!r) {
          throw new Error(
            `preseed: no resource registered with id "${resourceOrId}". ` +
              `Available: ${[...resourceRegistry.keys()].join(", ") || "(none)"}`,
          );
        }
        return r;
      };
      return {
        can(key, target, perCall) {
          const ctx: CanContext = perCall
            ? { ...boundCtx, ...perCall }
            : boundCtx;
          return systemCan(subject, key, target, ctx, {
            cache,
            grantsCache,
            fetchCounters,
          });
        },
        preseed(resourceOrId, docs, opts) {
          const resource = resolveResource(resourceOrId);
          const extract = opts.value ?? ((d: unknown) => d);
          for (const doc of docs) {
            const target = opts.dedupKey(doc as never);
            const cacheKey = resource.cacheKeyForTarget(target);
            cache.set(cacheKey, Promise.resolve(extract(doc as never)));
          }
        },
        getFetchCounters() {
          return Object.fromEntries(fetchCounters);
        },
        clearCounters() {
          fetchCounters.clear();
        },
        async dumpGrants() {
          const outcomes = await Promise.all(
            [...grantsCache.values()].flatMap((byKey) => [...byKey.values()]),
          );
          return outcomes.flatMap((outcome) => outcome.grants);
        },
      };
    },
  };

  type ContextState = {
    readonly cache: Map<string, Promise<unknown>>;
    readonly grantsCache: GrantsCache;
    readonly fetchCounters: Map<string, number>;
  };

  function reportError(event: PermissionErrorEvent): void {
    callHook(() => hooks.onError?.(event));
  }

  async function fetchFromProvider(
    provider: Provider,
    name: string,
    subject: Subject,
    key: string,
    target: readonly unknown[] | undefined,
  ): Promise<ProviderOutcome> {
    const started = performance.now();
    let grants: readonly Grant[];
    try {
      grants =
        typeof provider === "function"
          ? await provider(subject, key, target)
          : await provider.fetch(subject, key, target);
    } catch (error) {
      reportError({
        source: "provider",
        provider: name,
        subject,
        key,
        target,
        error,
      });
      return {
        grants: [],
        failure: `provider ${name} failed: ${describeError(error)}`,
      };
    }
    const durationMs = performance.now() - started;
    callHook(() =>
      hooks.onProviderFetch?.({
        provider: name,
        subject,
        key,
        target,
        durationMs,
        grantCount: grants.length,
      }),
    );
    return { grants };
  }

  async function invokeProvider(
    provider: Provider,
    subject: Subject,
    key: string,
    target: readonly unknown[] | undefined,
    state: ContextState | undefined,
  ): Promise<ProviderOutcome> {
    const name = providerNames.get(provider) ?? "provider";
    if (typeof provider === "object") {
      if (!providerHandlesKey(provider, key)) return { grants: [] };
      if (!providerHandlesTarget(provider, target)) return { grants: [] };
    }
    let ck: string | undefined;
    try {
      ck =
        typeof provider === "object"
          ? provider.cacheKey?.(subject, key, target)
          : undefined;
    } catch (error) {
      reportError({
        source: "provider",
        provider: name,
        subject,
        key,
        target,
        error,
      });
      return {
        grants: [],
        failure: `provider ${name} failed: ${describeError(error)}`,
      };
    }
    if (!state || !ck) {
      return fetchFromProvider(provider, name, subject, key, target);
    }
    let byKey = state.grantsCache.get(provider);
    if (!byKey) {
      byKey = new Map();
      state.grantsCache.set(provider, byKey);
    }
    let pending = byKey.get(ck);
    if (!pending) {
      pending = fetchFromProvider(provider, name, subject, key, target);
      byKey.set(ck, pending);
    }
    return pending;
  }

  async function fetchResource(
    resource: Resource<unknown>,
    ctx: FetchCtx,
    state: ContextState | undefined,
  ): Promise<unknown> {
    if (!state) {
      return Promise.resolve(resource.fetcher(ctx));
    }
    const key = resource.computeDedupKey(ctx);
    const existing = state.cache.get(key);
    if (existing) return existing;
    state.fetchCounters.set(
      resource.id,
      (state.fetchCounters.get(resource.id) ?? 0) + 1,
    );
    const pending = Promise.resolve(resource.fetcher(ctx));
    state.cache.set(key, pending);
    return pending;
  }

  function validateArity(
    perm: Permission<TMeta>,
    target: readonly unknown[] | undefined,
  ): string | null {
    const expected = perm.target.segments.length;
    const actual = target?.length ?? 0;
    if (perm.target.kind === "none") {
      if (actual > 0) return `target arity mismatch: expected 0, got ${actual}`;
      return null;
    }
    if (perm.target.kind === "optional") {
      if (actual !== 0 && actual !== expected) {
        return `target arity mismatch: expected 0 or ${expected}, got ${actual}`;
      }
      return null;
    }
    if (actual !== expected) {
      return `target arity mismatch: expected ${expected}, got ${actual}`;
    }
    return null;
  }

  async function systemCan(
    subject: Subject,
    key: string,
    target: readonly unknown[] | undefined,
    context: CanContext | undefined,
    state: ContextState | undefined,
  ): Promise<CanResult> {
    const perm = schema[key];
    if (!perm) {
      return { ok: false, reasons: [`unknown permission: ${key}`] };
    }

    const arityErr = validateArity(perm, target);
    if (arityErr) return { ok: false, reasons: [arityErr] };

    const allGrants: Grant[] = [];
    const failures: string[] = [];
    for (const provider of providers) {
      const outcome = await invokeProvider(
        provider,
        subject,
        key,
        target,
        state,
      );
      allGrants.push(...outcome.grants);
      if (outcome.failure) failures.push(outcome.failure);
    }

    const expanded = expandGrants(allGrants, schema);

    const capability = isCapabilityQuery(target);
    const matching = expanded.filter(
      (g) =>
        g.key === key &&
        targetMatches(g.target, target, perm.target.kind, capability),
    );
    if (matching.length === 0) {
      return { ok: false, reasons: ["no matching grant", ...failures] };
    }

    const reasons: string[] = [];
    let lastData: unknown = undefined;
    const matchedGrantIds: string[] = [];
    let anyOk = false;
    const collectedConstraints: Array<Record<string, unknown> | undefined> = [];
    let referenceSource: unknown = undefined;
    let filterUnion: FilterUnion = undefined;
    const successfulGrants: Grant[] = [];

    for (const grant of matching) {
      const ctx: FetchCtx = {
        subject,
        target: target ?? [],
        grant,
        checkDate: context?.checkDate,
        checkIp: context?.checkIp,
        capability,
        input: context?.input,
      };

      const activeRules = perm.rules.filter((r) => {
        if (r.activeWhen && !r.activeWhen(grant)) return false;
        return r.needs.every((res) => res.isActiveFor(grant));
      });

      // A capability query still fetches a resource named like a segment
      // (`resource.id === segment.name`) when that segment is concrete.
      const requestTarget = target ?? [];
      const targetSegmentIndexById = (() => {
        const out = new Map<string, number>();
        if (perm.target.kind === "none") return out;
        const segments =
          perm.target.kind === "path"
            ? perm.target.segments
            : [perm.target.segments[0]];
        segments.forEach((seg, i) => {
          if (seg) out.set(seg.name, i);
        });
        return out;
      })();
      const uniqueResources = capability
        ? Array.from(
            new Map(
              activeRules
                .flatMap((r) => r.needs)
                .filter((r) => {
                  const idx = targetSegmentIndexById.get(r.id);
                  if (idx === undefined) return false;
                  const seg = requestTarget[idx];
                  return seg !== undefined && !isWildcardSegment(seg);
                })
                .map((r) => [r.id, r] as const),
            ).values(),
          )
        : Array.from(
            new Map(
              activeRules
                .flatMap((r) => r.needs)
                .map((r) => [r.id, r] as const),
            ).values(),
          );
      let grantOk = true;
      let grantData: unknown = undefined;
      const grantConstraints: Record<string, unknown>[] = [];
      const grantFilters: FilterContribution[] = [];
      let grantHasMatchRule = false;
      try {
        const fetched = new Map<string, unknown>();
        await Promise.all(
          uniqueResources.map(async (r) => {
            fetched.set(r.id, await fetchResource(r, ctx, state));
          }),
        );

        const indirectFetched = new Map<string, readonly unknown[]>();
        if (!capability) {
          const indirectsToFetch = perm.rules
            .map((r) => extractIndirectResource(r))
            .filter(
              (ir): ir is IndirectResource =>
                ir !== null && ir.fetcher !== undefined,
            );
          await Promise.all(
            indirectsToFetch.map(async (ir) => {
              const sourceDoc = fetched.get(ir.from.id);
              if (sourceDoc === undefined || sourceDoc === null) return;
              const cacheKey = ir.cacheKeyForTarget(ctx.target);
              if (state) {
                const existing = state.cache.get(cacheKey);
                if (existing) {
                  indirectFetched.set(
                    ir.id,
                    (await existing) as readonly unknown[],
                  );
                  return;
                }
                const pending = Promise.resolve(ir.fetcher!(sourceDoc, ctx));
                state.cache.set(cacheKey, pending);
                indirectFetched.set(ir.id, await pending);
              } else {
                indirectFetched.set(ir.id, await ir.fetcher!(sourceDoc, ctx));
              }
            }),
          );
        }

        const ctxWithIndirect = Object.assign({}, ctx, {
          _indirectFetched: indirectFetched,
        });

        for (const rule of activeRules) {
          if (rule.descriptor.kind === "match") grantHasMatchRule = true;
          const data = rule.needs.map((r) => fetched.get(r.id));
          const result = rule.check(data, ctxWithIndirect);
          if (!result.ok) {
            grantOk = false;
            reasons.push(
              grant.id ? `[${grant.id}] ${result.reason}` : result.reason,
            );
            break;
          }
          if (result.data !== undefined) grantData = result.data;
          if (result.constraint !== undefined) {
            grantConstraints.push(result.constraint);
          }
          if (result.filter !== undefined) grantFilters.push(result.filter);
        }
      } catch (error) {
        grantOk = false;
        reportError({
          source: "rule",
          grantId: grant.id,
          subject,
          key,
          target,
          error,
        });
        const reason = `rule evaluation failed: ${describeError(error)}`;
        reasons.push(grant.id ? `[${grant.id}] ${reason}` : reason);
      }

      if (grantOk) {
        for (const contribution of grantFilters) {
          referenceSource = contribution.source;
          filterUnion = mergeFilterSpec(filterUnion, contribution.spec);
        }
        anyOk = true;
        successfulGrants.push(grant);
        if (grant.id) matchedGrantIds.push(grant.id);
        if (grantData !== undefined) lastData = grantData;
        const grantConstraint = combineGrantConstraints(grantConstraints);
        if (grantHasMatchRule && grantConstraint === undefined) {
          collectedConstraints.push({});
        } else {
          collectedConstraints.push(grantConstraint);
        }
      }
    }

    if (!anyOk) {
      return {
        ok: false,
        reasons: [
          ...(reasons.length > 0 ? reasons : ["no matching grant"]),
          ...failures,
        ],
      };
    }

    const constraints = aggregateConstraints(collectedConstraints);
    const finalData = resolveFilteredData(
      filterUnion,
      referenceSource,
      lastData,
    );

    const declaredIndirect: IndirectResource[] = [];
    for (const rule of perm.rules) {
      const ir = extractIndirectResource(rule);
      if (ir) declaredIndirect.push(ir);
    }
    let stages: readonly Record<string, unknown>[] | undefined;
    if (declaredIndirect.length > 0) {
      const baseFilter = constraints ?? {};
      // A rejected grant without an indirect reference would win "any" and
      // lift the join filter for its siblings, so only accepted grants count.
      const result = buildAggregationStages(
        baseFilter,
        successfulGrants,
        declaredIndirect,
      );
      if (result !== null) stages = result;
    }

    return {
      ok: true,
      ...(finalData !== undefined ? { data: finalData } : {}),
      ...(constraints !== undefined ? { constraints } : {}),
      ...(stages !== undefined ? { stages } : {}),
      ...(matchedGrantIds.length > 0 ? { matchedGrants: matchedGrantIds } : {}),
    };
  }
}

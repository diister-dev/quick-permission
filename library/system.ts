/**
 * Moteur d'orchestration resource-pipe.
 *
 * Responsabilités :
 *  - Maintenir un cache `(resource.id, dedupKey) → Promise<T>` par context()
 *  - Filtrer les rules actives (activeWhen) avant de fetcher leurs needs
 *  - Lancer les fetches en parallèle (Promise.all) avec dedup
 *  - Évaluer les rules d'un grant en série (préserve l'ordre des reasons)
 *  - OR sémantique entre grants : un grant qui passe = `ok: true`
 *  - Validation d'arity du target au boot et au check
 *
 * Cf. RFC §"Sémantique d'exécution".
 */

import type {
  AnyTarget,
  CanResult,
  FetchCtx,
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
import {
  buildAggregationStages,
} from "./indirect-aggregation.ts";
import {
  extractIndirectResource,
  type IndirectResource,
} from "./indirect-resource.ts";

export type ProviderFn = (
  subject: Subject,
  key: string,
  target?: readonly unknown[],
) => readonly Grant[] | Promise<readonly Grant[]>;

/**
 * Provider sous forme objet : permet d'opt-in à la dedup de grants
 * (cacheKey) et au filtrage par préfixe de key (keys/matches).
 *
 * - `keys`/`matches` : le provider est skip si la key demandée ne match pas
 * - `cacheKey` : grants memoizés par (subject, key, target) au sein d'un context
 */
export type ProviderObject = {
  readonly keys?: readonly string[];
  readonly matches?: (key: string) => boolean;
  readonly cacheKey?: (
    subject: Subject,
    key: string,
    target?: readonly unknown[],
  ) => string;
  readonly fetch: ProviderFn;
};

export type Provider = ProviderFn | ProviderObject;

function keyMatchesPattern(key: string, pattern: string): boolean {
  if (pattern === key) return true;
  if (pattern.endsWith("*")) {
    return key.startsWith(pattern.slice(0, -1));
  }
  return false;
}

function providerHandlesKey(provider: ProviderObject, key: string): boolean {
  if (!provider.keys && !provider.matches) return true;
  if (provider.keys?.some((p) => keyMatchesPattern(key, p))) return true;
  if (provider.matches?.(key)) return true;
  return false;
}

export type CanContext = {
  readonly checkDate?: Date;
  readonly checkIp?: string;
  /** True : le target peut contenir des wildcards et matche les grants overlap. */
  readonly broadMatch?: boolean;
  /**
   * Check-time payload exposed to rules as `ctx.input`. Distinct from
   * `grant.payload` (static, seed-time). Consumed by `inputMatch()` to
   * validate a CREATE body against `grant.with`.
   */
  readonly input?: unknown;
};

export type System<TMeta = unknown> = {
  list(): readonly ListEntry<TMeta>[];
  tree(): { readonly children: Readonly<Record<string, TreeNode<TMeta>>> };
  schema(key: string): Permission<TMeta> | undefined;
  /**
   * Every distinct indirect resource referenced by the schema's rules,
   * deduped by id. Returned in declaration-walk order (first-occurrence
   * wins for dedup). Function fields are stripped — see
   * `IndirectResourceInfo`. Empty if no permission uses `.match()` on an
   * `indirectResource`.
   */
  indirectResources(): readonly IndirectResourceInfo[];
  /**
   * Indirect resources referenced by a single permission's rules.
   * `[]` if `key` is unknown or has no `indirect-match` rule. Useful so
   * matrix UIs only render the indirect-match editor on permissions where
   * it has a semantic.
   */
  indirectsUsedBy(key: string): readonly IndirectResourceInfo[];
  /** Check direct (sans cache cross-can) — préfère `context()` en HTTP. */
  can(
    subject: Subject,
    key: string,
    target?: readonly unknown[],
    context?: CanContext,
  ): Promise<CanResult>;
  /**
   * Crée un context request-scoped avec cache de fetches partagé entre
   * tous les `can()` qui en découlent.
   */
  context(
    bound: { readonly subject: Subject } & CanContext,
  ): {
    /**
     * `perCall` overrides the bound `CanContext` for this single check.
     * Canonical use : passing `input` for a CREATE while keeping the
     * shared (per-request) context. Other fields stay bound — override
     * only when truly per-call.
     */
    can(
      key: string,
      target?: readonly unknown[],
      perCall?: CanContext,
    ): Promise<CanResult>;
    /**
     * Inject pre-loaded docs into the resource cache so subsequent
     * `can()` calls skip the fetch. Typical use : after a paginated
     * list, the caller has all docs in memory — pre-seed them so the
     * per-doc projection check doesn't hit the DB again.
     *
     * `dedupKey(doc)` MUST return the same target segments the resource's
     * `dedupKey` would compute at fetch time — otherwise the cache key
     * won't match and the preseed is silently ineffective. For most
     * resources whose dedupKey is `target[i]`, just return `[doc._id]`
     * (or the relevant segments).
     *
     * `value(doc)` is optional. Defaults to identity (the doc itself,
     * used for direct resources). Provide it for indirect resources
     * where the cached value is an array of joined docs nested under
     * an alias (e.g. `d => d._memberships_of_participant`).
     */
    preseed<T, V = T>(
      resource: Resource<unknown> | IndirectResource | string,
      docs: ReadonlyArray<T>,
      opts: {
        dedupKey: (doc: T) => readonly unknown[];
        value?: (doc: T) => V;
      },
    ): void;
    /** Compteurs de fetches par resource.id (debug / observabilité). */
    getFetchCounters(): Readonly<Record<string, number>>;
    /** Reset des compteurs (pas du cache). */
    clearCounters(): void;
  };
};

// ─── Schema validation au boot ──────────────────────────────────────────

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
      // Best-effort : si expandsTo throw sur le stub, on skip.
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
    throw new Error(
      `Schema validation failed:\n  - ${issues.join("\n  - ")}`,
    );
  }
}

// ─── Target matching (wildcards par segment) ────────────────────────────

function asPath(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Une request target est une "capability query" si elle contient au moins
 * un wildcard (`"*"` ou suffix `":*"`). Dans ce mode, on n'a pas de
 * ressource concrète à fetcher — les rules font silent-pass quand elles
 * ne peuvent pas vérifier leur contrainte.
 */
function isCapabilityQuery(target: readonly unknown[] | undefined): boolean {
  if (!target) return false;
  return target.some(isWildcardSegment);
}

/**
 * True if a single target segment is a wildcard (`"*"` or `"xxx:*"`).
 * Inverse de "concret" — utilisé pour décider si une resource peut être
 * fetchée en cap-mode (segment concret → fetch OK).
 */
function isWildcardSegment(seg: unknown): boolean {
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
  if (grantTarget === undefined) {
    // A target-less grant only matches when the schema permits it.
    // `optional` documents this "global grant" mode; `required` and `path`
    // require the grant to carry a target.
    return schemaKind === "optional";
  }
  if (requestTarget === undefined) return false;
  const g = asPath(grantTarget);
  if (g.length !== requestTarget.length) return false;
  // Capability mode (request has wildcards) uses overlap semantics so a
  // specific-target grant like ["user:lucas"] still matches ["user:*"].
  if (capability) {
    return g.every((seg, i) => segmentOverlaps(seg, requestTarget[i]));
  }
  return g.every((seg, i) => {
    if (seg === "*") return true;
    if (typeof seg === "string" && seg.endsWith("*")) {
      const prefix = seg.slice(0, -1);
      return typeof requestTarget[i] === "string" &&
        (requestTarget[i] as string).startsWith(prefix);
    }
    return seg === requestTarget[i];
  });
}

// ─── Intermediate expansion ──────────────────────────────────────────────

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
  while (queue.length) {
    const { grant, depth } = queue.shift()!;
    const perm = schema[grant.key];
    // Drop grants that violate the schema's target contract: a grant
    // without `target` on a `required` / `path` schema cannot match
    // (see `targetMatches`) and its `expandsTo` cannot synthesize valid
    // children. Skip silently so one bad grant doesn't break the call.
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

// ─── Serialization (pour list/tree) ──────────────────────────────────────

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

/**
 * Build a wildcard target stub matching the schema's arity. Used to sample
 * `expandsTo(grant)` at catalog enumeration time — we don't have a real
 * grant target available, but we need ARG_ARITY to match or `targetMatches`
 * would drop the synthesized child grants (see `expandGrants:228-234`).
 *
 *  - none      → undefined (no segments)
 *  - optional  → ["*"]
 *  - required  → ["*"]
 *  - path(n)   → ["*", "*", ..., "*"] (n segments)
 */
function stubTargetFor(t: AnyTarget): readonly unknown[] | undefined {
  if (t.kind === "none") return undefined;
  if (t.kind === "optional" || t.kind === "required") return ["*"];
  return t.segments.map(() => "*");
}

// ─── Descendant computation (pour list/tree) ─────────────────────────────

/**
 * BFS transitive expansion of an intermediate's `expandsTo` callback,
 * collecting LEAVES only (keys whose schema entry has no `expandsTo`).
 *
 * Sampling strategy : we call `perm.expandsTo({ key, target: <wildcard> })`
 * with an arity-matched wildcard stub. Real consumers (`expandGrants`)
 * call expandsTo with a concrete grant carrying `with`/`filter`/`flags` —
 * but for catalog enumeration we only care about the resulting child KEYS
 * (the same keys would be produced regardless of grant payload, since
 * macros are by convention pure key-routers).
 *
 * Defensive : caught exceptions in `expandsTo` (e.g. a callback that
 * asserts on a concrete segment) silently drop that branch — same posture
 * as `validateSchema`. Cycles are broken by the `visited` set.
 *
 * Returns `undefined` if `rootKey` is a leaf or not in schema (the caller
 * uses this signal to omit the field from the serialized entry rather
 * than emit an empty array).
 */
function computeDescendants<TMeta>(
  rootKey: string,
  schema: Readonly<Record<string, Permission<TMeta>>>,
  maxDepth = 10,
): readonly string[] | undefined {
  const root = schema[rootKey];
  if (!root?.expandsTo) return undefined;

  const leaves = new Set<string>();
  const visited = new Set<string>([rootKey]);
  const queue: Array<{ key: string; depth: number }> = [
    { key: rootKey, depth: 0 },
  ];

  while (queue.length) {
    const { key, depth } = queue.shift()!;
    const perm = schema[key];
    if (!perm) continue;
    if (!perm.expandsTo) {
      // Leaf reached. Exclude the root itself from its own descendant list.
      if (key !== rootKey) leaves.add(key);
      continue;
    }
    if (depth >= maxDepth) continue;
    let children: readonly Grant[] = [];
    try {
      children = perm.expandsTo({
        key,
        target: stubTargetFor(perm.target),
      });
    } catch {
      // Stub-throwing macro — best-effort skip, same as validateSchema.
      continue;
    }
    for (const child of children) {
      if (visited.has(child.key)) continue;
      visited.add(child.key);
      queue.push({ key: child.key, depth: depth + 1 });
    }
  }
  return [...leaves];
}

// ─── Tree builder ────────────────────────────────────────────────────────

function buildTree<TMeta>(
  schema: Readonly<Record<string, Permission<TMeta>>>,
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
        cursor = node as { kind: "group"; metadata: undefined; children: Record<string, TreeNode<TMeta>> };
      }
    }
    const leafName = parts[parts.length - 1];
    const descendants = perm.expandsTo
      ? computeDescendants(key, schema)
      : undefined;
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

// ─── createSystem ────────────────────────────────────────────────────────

export function createSystem<TMeta = unknown>(opts: {
  readonly schema: Readonly<Record<string, Permission<TMeta>>>;
  readonly providers?: readonly Provider[];
}): System<TMeta> {
  const { schema, providers = [] } = opts;
  validateSchema(schema);

  // Resource registry built at boot from all rules' `needs` (direct
  // resources) and indirect descriptors. Enables `ctx.preseed("id", ...)`
  // to look up the resource by id — callers don't need to import the
  // resource instance (handy when it lives inside a factory closure).
  // Typo guard : throws with the list of available ids when missed.
  const resourceRegistry = new Map<string, Resource<unknown> | IndirectResource>();
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
        const descendants = perm.expandsTo
          ? computeDescendants(key, schema)
          : undefined;
        return {
          key,
          kind: perm.expandsTo ? "intermediate" as const : "permission" as const,
          metadata: perm.metadata,
          target: serializeTarget(perm.target),
          rules: perm.rules.map((r) => r.descriptor),
          ...(descendants !== undefined && { expandsTo: descendants }),
        };
      });
    },

    tree() {
      return buildTree<TMeta>(schema);
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
      const grantsCache = new Map<string, Promise<readonly Grant[]>>();
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
      };
    },
  };

  // ─── Implémentation can() ─────────────────────────────────────────────

  type ContextState = {
    /** Cache des fetches de Resource au sein d'un context. */
    readonly cache: Map<string, Promise<unknown>>;
    /** Cache des grants émis par les providers (pour cacheKey). */
    readonly grantsCache: Map<string, Promise<readonly Grant[]>>;
    readonly fetchCounters: Map<string, number>;
  };

  async function invokeProvider(
    provider: Provider,
    subject: Subject,
    key: string,
    target: readonly unknown[] | undefined,
    state: ContextState | undefined,
  ): Promise<readonly Grant[]> {
    if (typeof provider === "function") {
      return await provider(subject, key, target);
    }
    if (!providerHandlesKey(provider, key)) return [];
    const ck = provider.cacheKey?.(subject, key, target);
    if (state && ck) {
      let pending = state.grantsCache.get(ck);
      if (!pending) {
        pending = Promise.resolve(provider.fetch(subject, key, target));
        state.grantsCache.set(ck, pending);
      }
      return await pending;
    }
    return await provider.fetch(subject, key, target);
  }

  async function fetchResource(
    resource: Resource<unknown>,
    ctx: FetchCtx,
    state: ContextState | undefined,
  ): Promise<unknown> {
    if (!state) {
      // Mode `system.can()` direct — pas de cache cross-grant.
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

  function validateArity(perm: Permission<TMeta>, target: readonly unknown[] | undefined): string | null {
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

    // Collect grants depuis les providers (en série pour préserver l'ordre)
    const allGrants: Grant[] = [];
    for (const provider of providers) {
      const grants = await invokeProvider(provider, subject, key, target, state);
      allGrants.push(...grants);
    }

    const expanded = expandGrants(allGrants, schema);

    const capability = isCapabilityQuery(target);
    const matching = expanded.filter((g) =>
      g.key === key &&
      targetMatches(g.target, target, perm.target.kind, capability)
    );
    if (matching.length === 0) {
      return { ok: false, reasons: ["no matching grant"] };
    }

    const reasons: string[] = [];
    let lastData: unknown = undefined;
    const matchedGrantIds: string[] = [];
    let anyOk = false;
    // One entry per matched grant. undefined = "any" (no constraint).
    const collectedConstraints: Array<Record<string, unknown> | undefined> = [];
    // Filter rule cross-grant aggregation. `null` once any grant exposes
    // no filter (= all fields). Else accumulates the union of filter specs.
    let referenceSource: unknown = undefined;
    let filterUnion: FilterUnion = undefined;
    // Grants that PASSED their rules — needed by indirect-resource
    // aggregation. `matching` contains all grants that match key + target
    // shape, but rules can reject some (e.g. a `with` spec evaluated
    // against an auto-fetched resource in cap-mode). The indirect
    // orchestrator must consider only successful grants — otherwise a
    // rejected grant without indirect reference would trigger any-wins
    // and disable the filter.
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

      // In cap-mode the engine normally skips all fetches. Exception : a
      // resource whose `id` matches a segment NAME of the permission's
      // target AND whose corresponding segment in the request target is
      // CONCRETE (not `*` / not `xxx:*`) is fetched anyway. This lets
      // `match()` evaluate properly for foreign resources (auxiliary
      // checks like "the request's exposition belongs to my tenant")
      // when only one segment of a multi-segment target is wildcard.
      //
      // Auto-binding is by convention : `resource.id === segment.name`.
      // No opt-in needed — it just works if the convention is respected.
      // Resources whose id matches no segment in the permission's schema
      // are skipped in cap-mode (silent-pass + constraint emit, the
      // legacy behaviour that powers `users.read` + `userOf.match`
      // self-referencing pushdown).
      const requestTarget = target ?? [];
      const targetSegmentIndexById = (() => {
        const out = new Map<string, number>();
        if (perm.target.kind === "none") return out;
        const segments = perm.target.kind === "path"
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
      const fetched = new Map<string, unknown>();
      await Promise.all(uniqueResources.map(async (r) => {
        fetched.set(r.id, await fetchResource(r, ctx, state));
      }));

      // In concrete mode, indirect resources that declared a `fetcher`
      // are fetched as well (their joined docs are attached to the ctx
      // so `indirect.match()` can evaluate the spec). The cache key is
      // target-derived so `CanContext.preseed()` can inject values
      // produced by a cap-mode pipeline aggregation (no DB hit when
      // listed docs already carry the `_lookupAlias`).
      const indirectFetched = new Map<string, readonly unknown[]>();
      if (!capability) {
        const indirectsToFetch = perm.rules
          .map((r) => extractIndirectResource(r))
          .filter((ir): ir is IndirectResource => ir !== null && ir.fetcher !== undefined);
        await Promise.all(indirectsToFetch.map(async (ir) => {
          const sourceDoc = fetched.get(ir.from.id);
          if (sourceDoc === undefined || sourceDoc === null) return;
          const cacheKey = ir.cacheKeyForTarget(ctx.target);
          if (state) {
            const existing = state.cache.get(cacheKey);
            if (existing) {
              indirectFetched.set(ir.id, (await existing) as readonly unknown[]);
              return;
            }
            const pending = Promise.resolve(ir.fetcher!(sourceDoc, ctx));
            state.cache.set(cacheKey, pending);
            indirectFetched.set(ir.id, await pending);
          } else {
            indirectFetched.set(ir.id, await ir.fetcher!(sourceDoc, ctx));
          }
        }));
      }

      // Attach indirect-fetched joined docs to the context so
      // `indirect.match()` rule can read them.
      const ctxWithIndirect = Object.assign({}, ctx, {
        _indirectFetched: indirectFetched,
      });

      let grantOk = true;
      let grantData: unknown = undefined;
      // Multiple match rules in one permission (e.g., expositionInfo + badge)
      // contribute distinct constraints — AND-merge them per grant.
      const grantConstraints: Record<string, unknown>[] = [];
      let grantHasMatchRule = false;
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
        if (result.filter !== undefined) {
          referenceSource = result.filter.source;
          filterUnion = mergeFilterSpec(filterUnion, result.filter.spec);
        }
      }

      if (grantOk) {
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
        reasons: reasons.length > 0 ? reasons : ["no matching grant"],
      };
    }

    const constraints = aggregateConstraints(collectedConstraints);
    const finalData = resolveFilteredData(filterUnion, referenceSource, lastData);

    // Collect indirect resources referenced by the permission's rules
    // (sentinel rules with descriptor.kind === "indirect-match"). If any
    // are referenced by matched grants' `with`, emit an aggregation
    // pipeline that pushes the JOIN constraint to the DB.
    const declaredIndirect: IndirectResource[] = [];
    for (const rule of perm.rules) {
      const ir = extractIndirectResource(rule);
      if (ir) declaredIndirect.push(ir);
    }
    let stages: readonly Record<string, unknown>[] | undefined;
    if (declaredIndirect.length > 0) {
      const baseFilter = constraints ?? {};
      // Must pass `successfulGrants` (rules accepted), NOT `matching`
      // (raw key+target match). A grant rejected by a rule must not
      // contribute to indirect any-wins — otherwise it would silently
      // disable the indirect filter for its siblings.
      const result = buildAggregationStages(baseFilter, successfulGrants, declaredIndirect);
      if (result !== null) stages = result;
    }

    return {
      ok: true,
      ...(finalData !== undefined ? { data: finalData } : {}),
      ...(constraints !== undefined ? { constraints } : {}),
      ...(stages !== undefined ? { stages } : {}),
      ...(matchedGrantIds.length > 0
        ? { matchedGrants: matchedGrantIds }
        : {}),
    };
  }
}

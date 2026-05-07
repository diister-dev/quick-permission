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
  ListEntry,
  Permission,
  Resource,
  Rule,
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
};

export type System<TMeta = unknown> = {
  list(): readonly ListEntry<TMeta>[];
  tree(): { readonly children: Readonly<Record<string, TreeNode<TMeta>>> };
  schema(key: string): Permission<TMeta> | undefined;
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
    can(key: string, target?: readonly unknown[]): Promise<CanResult>;
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
  return target.some(
    (seg) => seg === "*" || (typeof seg === "string" && seg.endsWith("*")),
  );
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
    cursor.children[leafName] = {
      kind: perm.expandsTo ? "intermediate" : "permission",
      key,
      metadata: perm.metadata,
      target: serializeTarget(perm.target),
      rules: perm.rules.map((r) => r.descriptor),
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

  return {
    list() {
      return Object.entries(schema).map(([key, perm]) => ({
        key,
        kind: perm.expandsTo ? "intermediate" as const : "permission" as const,
        metadata: perm.metadata,
        target: serializeTarget(perm.target),
        rules: perm.rules.map((r) => r.descriptor),
      }));
    },

    tree() {
      return buildTree<TMeta>(schema);
    },

    schema(key) {
      return schema[key];
    },

    can(subject, key, target, context) {
      return systemCan(subject, key, target, context, undefined);
    },

    context(bound) {
      const cache = new Map<string, Promise<unknown>>();
      const grantsCache = new Map<string, Promise<readonly Grant[]>>();
      const fetchCounters = new Map<string, number>();
      const { subject, ...ctxOverrides } = bound;
      return {
        can(key, target) {
          return systemCan(subject, key, target, ctxOverrides, {
            cache,
            grantsCache,
            fetchCounters,
          });
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

    for (const grant of matching) {
      const ctx: FetchCtx = {
        subject,
        target: target ?? [],
        grant,
        checkDate: context?.checkDate,
        checkIp: context?.checkIp,
        capability,
      };

      const activeRules = perm.rules.filter((r) => {
        if (r.activeWhen && !r.activeWhen(grant)) return false;
        return r.needs.every((res) => res.isActiveFor(grant));
      });

      const uniqueResources = capability ? [] : Array.from(
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

      let grantOk = true;
      let grantData: unknown = undefined;
      // Multiple match rules in one permission (e.g., expositionInfo + badge)
      // contribute distinct constraints — AND-merge them per grant.
      const grantConstraints: Record<string, unknown>[] = [];
      let grantHasMatchRule = false;
      for (const rule of activeRules) {
        if (rule.descriptor.kind === "match") grantHasMatchRule = true;
        const data = rule.needs.map((r) => fetched.get(r.id));
        const result = rule.check(data, ctx);
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

    return {
      ok: true,
      ...(finalData !== undefined ? { data: finalData } : {}),
      ...(constraints !== undefined ? { constraints } : {}),
      ...(matchedGrantIds.length > 0
        ? { matchedGrants: matchedGrantIds }
        : {}),
    };
  }
}

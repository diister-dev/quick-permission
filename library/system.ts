import type { AnyTarget, SegmentSpec } from "./types.ts";
import type {
  AnyIntermediate,
  AnyPermission,
  GrantState,
  SchemaEntry,
} from "./permission.ts";
export type { GrantState } from "./permission.ts";
import { matchPath, overlapPath } from "./core/matching.ts";

export type Subject = { id: string; [key: string]: unknown };

export type Grant = GrantState;

export type Provider = (
  subject: Subject,
  key: string,
  target?: readonly unknown[],
) => Grant[] | Promise<Grant[]>;

export type SerializableSegment = {
  name: string;
  types: string | readonly string[];
};

export type SerializableTarget =
  | { kind: "none" }
  | { kind: "optional"; segment: SerializableSegment }
  | { kind: "required"; segment: SerializableSegment }
  | { kind: "path"; segments: readonly SerializableSegment[] };

/**
 * Serialisable description of a rule attached to a permission. Closures
 * (`extractor`, `check`) are stripped — only the `kind` and any structural
 * metadata that names what the rule consumes from a grant is exposed. The
 * frontend dispatches editors per `kind`.
 *
 * Built-in shapes:
 *  - `{ kind: "match", segment }` → grant.with[segment]
 *  - `{ kind: "filter" }`         → grant.filter
 *  - `{ kind: "time" }`           → grant.startDate / grant.endDate
 *  - `{ kind: "ip" }`             → grant.ips
 *  - `{ kind: "custom" }`         → grant.payload (shape unknown to the lib)
 *
 * Custom rules added by consumers can ship their own descriptor — anything
 * with a `kind` field is preserved through serialisation.
 */
export type RuleDescriptor = {
  readonly kind: string;
  readonly segment?: string;
  readonly [extra: string]: unknown;
};

export type ListEntry<TMeta> = {
  key: string;
  kind: "permission" | "intermediate";
  metadata: TMeta | undefined;
  target: SerializableTarget;
  hasPayload: boolean;
  rules: readonly RuleDescriptor[];
};

export type TreeNode<TMeta> =
  | {
    kind: "permission" | "intermediate";
    key: string;
    metadata: TMeta | undefined;
    target: SerializableTarget;
    hasPayload: boolean;
    rules: readonly RuleDescriptor[];
  }
  | {
    kind: "group";
    metadata: undefined;
    children: Record<string, TreeNode<TMeta>>;
  };

export type CanContext = {
  checkDate?: Date;
  checkIp?: string;
  /**
   * When true, the request target may contain wildcards and matches any grant
   * whose target overlaps. Useful for "do I have any access in expo X?" queries.
   */
  broadMatch?: boolean;
};

export type CanResult =
  | {
    ok: true;
    output?: { data?: unknown; filter?: Record<string, unknown> };
    matchedGrants?: readonly string[];
  }
  | { ok: false; reasons: string[] };

export type System<TMeta> = {
  list: () => ListEntry<TMeta>[];
  tree: () => { children: Record<string, TreeNode<TMeta>> };
  schema: (key: string) => SchemaEntry | undefined;
  can: (
    subject: Subject,
    key: string,
    target?: readonly unknown[],
    context?: CanContext,
  ) => Promise<CanResult>;
  context: (
    bound: { subject: Subject } & CanContext,
  ) => {
    can: (key: string, target?: readonly unknown[]) => Promise<CanResult>;
  };
};

function serializeSegment(s: SegmentSpec): SerializableSegment {
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

function isIntermediate(entry: SchemaEntry): entry is AnyIntermediate {
  return entry.kind === "intermediate";
}

function isPermission(entry: SchemaEntry): entry is AnyPermission {
  return entry.kind === "permission";
}

/**
 * Strip closures (extractor / check) from a rule, keeping only serialisable
 * structural fields. Whatever the lib doesn't know about is preserved as-is —
 * custom rules with extra metadata flow through unchanged.
 */
function describeRule(rule: unknown): RuleDescriptor {
  if (rule === null || typeof rule !== "object") {
    return { kind: "unknown" };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rule as Record<string, unknown>)) {
    if (typeof v === "function") continue;
    out[k] = v;
  }
  if (typeof out.kind !== "string") out.kind = "unknown";
  return out as RuleDescriptor;
}

function entryRuleDescriptors(entry: SchemaEntry): readonly RuleDescriptor[] {
  return (entry.rules ?? []).map(describeRule);
}

function asPath(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

function targetMatches(
  grantTarget: unknown,
  requestTarget: readonly unknown[] | undefined,
  schemaKind: AnyTarget["kind"],
  isAncestorGrant: boolean,
  broad: boolean,
): boolean {
  if (schemaKind === "none") return true;
  if (grantTarget === undefined) return true;
  if (requestTarget === undefined) return broad;
  let g = asPath(grantTarget);
  const r = requestTarget;
  // Grant on an intermediate ancestor of the request key with shorter target →
  // pad the missing trailing segments with wildcards. "I have access to the
  // whole parent" implicitly covers all sub-resources.
  if (isAncestorGrant && g.length < r.length) {
    g = [...g, ...Array(r.length - g.length).fill("*")];
  }
  if (broad) return overlapPath(r, g);
  return matchPath(r, g);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    )
  );
}

function applyFilter(
  data: unknown,
  filter: Record<string, boolean | unknown> | undefined,
): unknown {
  if (filter === undefined) return data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (v === true && k in (data as Record<string, unknown>)) {
      out[k] = (data as Record<string, unknown>)[k];
    }
  }
  return out;
}

function mergeFilters(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return { ...a, ...b };
}

/**
 * Recursively expand grants whose key is an intermediate. Limited depth to
 * guard against accidental expansion cycles.
 */
function expandGrants(
  grants: readonly Grant[],
  schema: Record<string, SchemaEntry>,
  maxDepth = 10,
): Grant[] {
  const out: Grant[] = [];
  const queue: Array<{ grant: Grant; depth: number }> = grants.map((g) => ({
    grant: g,
    depth: 0,
  }));
  while (queue.length) {
    const { grant, depth } = queue.shift()!;
    out.push(grant);
    if (depth >= maxDepth) continue;
    const entry = schema[grant.key];
    if (entry && isIntermediate(entry)) {
      const children = entry.expandsTo(grant);
      for (const child of children) {
        queue.push({ grant: child, depth: depth + 1 });
      }
    }
  }
  return out;
}

function isCapabilityQuery(target: readonly unknown[] | undefined): boolean {
  if (!target) return false;
  return target.some(
    (seg) => seg === "*" || (typeof seg === "string" && seg.endsWith("*")),
  );
}

async function evaluateGrant(
  perm: AnyPermission | AnyIntermediate,
  grant: Grant,
  subject: Subject,
  target: readonly unknown[] | undefined,
  context: CanContext | undefined,
): Promise<
  | { ok: true; data?: unknown; filterUnion?: Record<string, unknown> }
  | { ok: false; reason: string }
> {
  // Capability query: request target carries wildcards ("role:*", "*"), so
  // there's no concrete resource to fetch. Skip fetch + resource-dependent
  // rule branches and treat the check as "do I have a grant in principle?".
  const capability = isCapabilityQuery(target);
  let resource: unknown = undefined;
  if (perm.fetch && target !== undefined && !capability) {
    try {
      resource = await perm.fetch(target);
    } catch (e) {
      return {
        ok: false,
        reason: `fetch failed: ${(e as Error).message ?? String(e)}`,
      };
    }
  }

  let filteredData: unknown = undefined;
  let filterUnion: Record<string, unknown> | undefined = undefined;
  let appliedFilter = false;

  for (const rule of perm.rules) {
    switch (rule.kind) {
      case "match": {
        const spec = grant.with?.[rule.segment];
        if (spec === undefined) break;
        if (capability) {
          // Constraint can't be verified without a concrete resource; deny.
          return {
            ok: false,
            reason: `match[${rule.segment}] cannot be verified in capability query`,
          };
        }
        const actual = rule.extractor(resource);
        if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
          if (!deepEqual(spec, actual)) {
            return { ok: false, reason: `match[${rule.segment}] mismatch` };
          }
          break;
        }
        const actualObj = (actual ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(spec)) {
          if (!deepEqual(v, actualObj[k])) {
            return {
              ok: false,
              reason: `match[${rule.segment}].${k} mismatch`,
            };
          }
        }
        break;
      }
      case "filter": {
        if (capability) break; // no resource to filter; skip silently
        const sub = rule.extractor(resource);
        filteredData = applyFilter(sub, grant.filter);
        if (grant.filter) {
          const unionEntries: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(grant.filter)) {
            if (v === true) unionEntries[k] = true;
          }
          filterUnion = mergeFilters(filterUnion, unionEntries);
        }
        appliedFilter = true;
        break;
      }
      case "custom": {
        const ok = rule.check({
          resource,
          payload: grant.payload ?? {},
          subject,
          target: target ?? [],
        });
        if (!ok) return { ok: false, reason: "custom predicate denied" };
        break;
      }
      case "time": {
        const now = context?.checkDate ?? new Date();
        if (grant.startDate && now < grant.startDate) {
          return { ok: false, reason: "before grant.startDate" };
        }
        if (grant.endDate && now > grant.endDate) {
          return { ok: false, reason: "after grant.endDate" };
        }
        break;
      }
      case "ip": {
        if (grant.ips === undefined) break;
        if (context?.checkIp === undefined) {
          return {
            ok: false,
            reason: "ip restriction set but no checkIp in context",
          };
        }
        if (!grant.ips.includes(context.checkIp)) {
          return {
            ok: false,
            reason: `ip ${context.checkIp} not in grant.ips`,
          };
        }
        break;
      }
    }
  }

  return {
    ok: true,
    data: appliedFilter ? filteredData : resource,
    filterUnion,
  };
}

/**
 * Tree built from flat dotted keys. `users.create`, `users.read`, etc. are
 * grouped under a synthetic `users` node when no schema entry exists at
 * `users` itself; otherwise the schema entry sits at that node.
 */
function buildTree<TMeta>(
  schema: Record<string, SchemaEntry>,
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

  for (const [key, entry] of Object.entries(schema)) {
    const parts = key.split(".");
    let cursor: { children: Record<string, TreeNode<TMeta>> } = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const node = ensureGroup(cursor, parts[i]);
      if (node.kind !== "group") {
        // A leaf already sits here; convert to group lazily by stashing in children.
        const newGroup: TreeNode<TMeta> = {
          kind: "group",
          metadata: undefined,
          children: {},
        };
        cursor.children[parts[i]] = newGroup;
        cursor = newGroup;
      } else {
        cursor = node;
      }
    }
    const leafName = parts[parts.length - 1];
    cursor.children[leafName] = {
      kind: entry.kind,
      key,
      metadata: entry.metadata as TMeta | undefined,
      target: serializeTarget(entry.target),
      hasPayload: entry.payload !== undefined,
      rules: entryRuleDescriptors(entry),
    };
  }

  return root;
}

/**
 * Validates that every intermediate's `expandsTo` only references keys that
 * exist in the schema. Catches typos at boot rather than silently denying.
 * The check calls each intermediate's callback with a stub grant — if the
 * callback requires a specific target shape, the call may throw, in which
 * case the entry is skipped (best-effort validation).
 */
function validateSchema(schema: Record<string, SchemaEntry>): void {
  const issues: string[] = [];
  for (const [key, entry] of Object.entries(schema)) {
    if (entry.kind !== "intermediate") continue;
    let samples: readonly GrantState[] = [];
    try {
      samples = entry.expandsTo({ key, target: ["*"] });
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
    throw new Error(
      `Schema validation failed:\n  - ${issues.join("\n  - ")}`,
    );
  }
}

export function createSystem<TMeta>(config: {
  schema: Record<string, SchemaEntry>;
  providers?: Provider[];
}): System<TMeta> {
  const { schema, providers = [] } = config;
  validateSchema(schema);
  const knownKeys = new Set(Object.keys(schema));

  return {
    list: () =>
      Object.entries(schema).map(([key, entry]) => ({
        key,
        kind: entry.kind,
        metadata: entry.metadata as TMeta | undefined,
        target: serializeTarget(entry.target),
        hasPayload: entry.payload !== undefined,
        rules: entryRuleDescriptors(entry),
      })),

    tree: () => buildTree<TMeta>(schema),

    schema: (key) => schema[key],

    context: (bound) => ({
      can: (key, target) => {
        const { subject, ...ctx } = bound;
        return systemCan(subject, key, target, ctx);
      },
    }),

    can: (subject, key, target, context) =>
      systemCan(subject, key, target, context),
  };

  async function systemCan(
    subject: Subject,
    key: string,
    target?: readonly unknown[],
    context?: CanContext,
  ): Promise<CanResult> {
    if (!knownKeys.has(key)) {
      return { ok: false, reasons: [`unknown permission: ${key}`] };
    }
    const perm = schema[key];
    if (!perm || (!isPermission(perm) && !isIntermediate(perm))) {
      return { ok: false, reasons: [`unknown permission: ${key}`] };
    }

    const reasons: string[] = [];
    let lastData: unknown = undefined;
    let mergedFilter: Record<string, unknown> | undefined = undefined;
    const matchedGrantIds: string[] = [];
    let anyOk = false;

    for (const provider of providers) {
      const rawGrants = await provider(subject, key, target);
      const expanded = expandGrants(rawGrants, schema);

      for (const grant of expanded) {
        if (grant.key !== key) continue;
        const isAncestor = false; // grant.key === request key by the filter above
        if (
          !targetMatches(
            grant.target,
            target,
            perm.target.kind,
            isAncestor,
            context?.broadMatch === true,
          )
        ) continue;

        const evalResult = await evaluateGrant(
          perm,
          grant,
          subject,
          target,
          context,
        );
        if (!evalResult.ok) {
          reasons.push(
            grant.id ? `[${grant.id}] ${evalResult.reason}` : evalResult.reason,
          );
          continue;
        }
        anyOk = true;
        if (grant.id) matchedGrantIds.push(grant.id);
        if (evalResult.data !== undefined) lastData = evalResult.data;
        mergedFilter = mergeFilters(mergedFilter, evalResult.filterUnion);
      }
    }

    if (!anyOk) {
      return {
        ok: false,
        reasons: reasons.length > 0 ? reasons : ["no matching grant"],
      };
    }

    return {
      ok: true,
      output: lastData !== undefined || mergedFilter !== undefined
        ? { data: lastData, filter: mergedFilter }
        : undefined,
      ...(matchedGrantIds.length > 0 ? { matchedGrants: matchedGrantIds } : {}),
    };
  }
}

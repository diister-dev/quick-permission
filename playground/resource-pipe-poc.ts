/**
 * PoC : "Resource-pipe" API — chaque rule déclare la donnée dont elle a besoin
 * via un Resource autonome. Le système orchestre les fetches en parallèle, les
 * déduplique au sein d'un context, et n'invoque que les resources dont au moins
 * une rule active dans un grant en a besoin.
 *
 * v2 : ajoute target.required / target.path (avec arités profondes), et
 *      démontre comment des resources qui consomment des préfixes différents
 *      du target path se déduplique correctement (ex: expositionInfoOf prend
 *      target[0], programOf prend target[0..1], registrationOf prend
 *      target[0..2]).
 *
 * Buts vérifiés :
 *   1. Lazy : les resources non-pertinentes ne sont jamais fetchées
 *   2. Dedup intra-grant : 2 rules sur la même resource = 1 fetch
 *   3. Dedup inter-grant : 5 grants matchant le même target = 1 fetch
 *   4. Dedup cross-permission : can(read) puis can(update) sur le même target
 *      = 1 fetch chacun
 *   5. activeWhen évite le fetch tertiaire si aucun grant n'en a besoin
 *   6. Target paths profonds : path("exposition","program","registration")
 *      avec wildcards à chaque niveau
 *   7. Dedup partiel sur target path : 2 registrations dans le même program
 *      → expositionInfoOf=1, programOf=1, registrationOf=2
 *
 * Lancer : `deno run --allow-all playground/resource-pipe-poc.ts`
 */

// =============================================================================
// TARGET SHAPES — minimal mais représentatif de l'API actuelle
// =============================================================================

type TargetNone = { readonly kind: "none"; readonly segments: readonly [] };
type TargetRequired = {
  readonly kind: "required";
  readonly segments: readonly [string];
};
type TargetPath = {
  readonly kind: "path";
  readonly segments: readonly string[];
};
type AnyTarget = TargetNone | TargetRequired | TargetPath;

const target = {
  none: (): TargetNone => ({ kind: "none", segments: [] }),
  required: (name: string): TargetRequired => ({
    kind: "required",
    segments: [name],
  }),
  path: <const N extends readonly string[]>(
    ...names: N
  ): TargetPath => ({ kind: "path", segments: names }),
};

// =============================================================================
// TYPES
// =============================================================================

type Subject = { id: string };

type Grant = {
  id?: string;
  key: string;
  target?: readonly unknown[];
  /** Constraint specs read by `match` / `includes` (objet ou primitive). */
  with?: Record<string, unknown>;
  /** Field-level filters read by `filter`. */
  filter?: Record<string, boolean>;
  /** Boolean opt-ins read par les `require*` rules. */
  flags?: Record<string, boolean>;
  /** Données arbitraires pour `requireCustom` ou rules custom. */
  payload?: unknown;
};

type FetchCtx = {
  subject: Subject;
  target: readonly unknown[];
  grant: Grant;
};

type RuleResult =
  | { ok: true; data?: unknown }
  | { ok: false; reason: string };

type RuleDescriptor = {
  kind: string;
  /** Resource id si la rule en a une — absent pour les rules pures (ex: requireSelf). */
  source?: string;
  [extra: string]: unknown;
};

interface Rule {
  descriptor: RuleDescriptor;
  /** Resources que la rule consomme. Vide pour les rules pures (requireSelf, etc.) */
  needs: readonly ResourceImpl<unknown>[];
  /** Si défini et retourne false, la rule est skip silencieusement (no fetch). */
  activeWhen?: (grant: Grant) => boolean;
  check: (
    data: readonly unknown[],
    ctx: FetchCtx,
  ) => RuleResult;
}

// Type helpers pour l'inférence des données depuis les needs
type ResourceData<R> = R extends ResourceImpl<infer T> ? T : never;
type ResourcesData<RS extends readonly ResourceImpl<unknown>[]> = {
  [K in keyof RS]: ResourceData<RS[K]>;
};

/**
 * Primitive unique pour fabriquer une rule. Toutes les méthodes resource
 * (`match`, `filter`, `includes`, `requireOwner`, etc.) sont du sucre par-dessus.
 *
 * - `needs` : resources fetchées (en parallèle, dédupliquées) avant le check
 * - `flag` : sucre pour activeWhen via grant.flags
 * - `activeWhen` : escape hatch pour activation conditionnelle complexe
 * - `check` : reçoit les données fetchées (tuple typé) + payload + ctx
 */
function defineRule<
  const RS extends readonly ResourceImpl<unknown>[],
  P = unknown,
>(opts: {
  kind: string;
  needs?: RS;
  flag?: string;
  activeWhen?: (grant: Grant) => boolean;
  describe?: () => Record<string, unknown>;
  check: (
    data: ResourcesData<RS>,
    payload: P,
    ctx: FetchCtx,
  ) => boolean | RuleResult;
}): Rule {
  const needs = (opts.needs ?? []) as readonly ResourceImpl<unknown>[];
  const flag = opts.flag;
  const activeWhen = flag !== undefined
    ? (grant: Grant) => grant.flags?.[flag] === true
    : opts.activeWhen;
  return {
    descriptor: {
      kind: opts.kind,
      ...(needs.length === 1 ? { source: needs[0].id } : {}),
      ...(needs.length > 1 ? { sources: needs.map((n) => n.id) } : {}),
      ...(flag !== undefined ? { flag } : {}),
      ...(opts.describe?.() ?? {}),
    },
    needs,
    activeWhen,
    check: (data, ctx) => {
      const payload = ctx.grant.payload as P;
      const result = opts.check(data as ResourcesData<RS>, payload, ctx);
      if (typeof result === "boolean") {
        return result
          ? { ok: true }
          : { ok: false, reason: `${opts.kind} denied` };
      }
      return result;
    },
  };
}

// =============================================================================
// RESOURCE
// =============================================================================

class ResourceImpl<T> {
  constructor(
    public readonly id: string,
    public readonly fetcher: (ctx: FetchCtx) => T | Promise<T>,
    public readonly activator?: (grant: Grant) => boolean,
    public readonly dedupKey?: (ctx: FetchCtx) => string,
  ) {}

  isActiveFor(grant: Grant): boolean {
    return this.activator ? this.activator(grant) : true;
  }

  computeDedupKey(ctx: FetchCtx): string {
    if (this.dedupKey) return `${this.id}::${this.dedupKey(ctx)}`;
    return `${this.id}::${ctx.subject.id}::${
      JSON.stringify(ctx.target)
    }::${JSON.stringify(ctx.grant.with ?? {})}`;
  }

  // Toutes les méthodes ci-dessous = sucre par-dessus defineRule.
  // → 1 seule mécanique d'orchestration, 1 seul format de descriptor.

  // match : always-active. Le resource est toujours fetché (consommateurs
  // attendent qu'il soit là). Le check fait silent-pass si pas de spec.
  match(extractor?: (data: T) => unknown): Rule {
    const id = this.id;
    const project = extractor ?? ((d: T) => d);
    return defineRule({
      kind: "match",
      needs: [this] as const,
      check: ([data], _payload, ctx) => {
        const spec = ctx.grant.with?.[id];
        if (spec === undefined) return { ok: true };
        const actual = project(data as T);
        if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
          return deepEqual(spec, actual)
            ? { ok: true }
            : { ok: false, reason: `match[${id}] mismatch` };
        }
        const actualObj = (actual ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(spec as object)) {
          if (!deepEqual(v, actualObj[k])) {
            return { ok: false, reason: `match[${id}].${k} mismatch` };
          }
        }
        return { ok: true };
      },
    });
  }

  // filter : always-active. Retourne le resource entier si pas de grant.filter,
  // sinon les champs sélectionnés.
  filter(extractor?: (data: T) => unknown): Rule {
    const project = extractor ?? ((d: T) => d);
    return defineRule({
      kind: "filter",
      needs: [this] as const,
      check: ([data], _payload, ctx) => {
        const sub = project(data as T);
        const filter = ctx.grant.filter;
        if (
          !filter || sub === null || typeof sub !== "object" ||
          Array.isArray(sub)
        ) {
          return { ok: true, data: sub };
        }
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(filter)) {
          if (v === true && k in (sub as Record<string, unknown>)) {
            out[k] = (sub as Record<string, unknown>)[k];
          }
        }
        return { ok: true, data: out };
      },
    });
  }

  includes(
    grantField: string,
    extractor: (data: T) => readonly unknown[],
  ): Rule {
    return defineRule({
      kind: "includes",
      needs: [this] as const,
      activeWhen: (grant) => grant.with?.[grantField] !== undefined,
      describe: () => ({ grantField }),
      check: ([data], _payload, ctx) => {
        const required = ctx.grant.with![grantField];
        const list = extractor(data as T);
        if (Array.isArray(required)) {
          return required.some((r) => list.includes(r))
            ? { ok: true }
            : {
              ok: false,
              reason: `includes[${grantField}] none of ${
                JSON.stringify(required)
              } present`,
            };
        }
        return list.includes(required)
          ? { ok: true }
          : { ok: false, reason: `includes[${grantField}] ${required} absent` };
      },
    });
  }

  requireTruthy(): Rule {
    const id = this.id;
    return defineRule({
      kind: "require-truthy",
      needs: [this] as const,
      check: ([data]) =>
        data
          ? { ok: true }
          : { ok: false, reason: `require-truthy[${id}] is falsy` },
    });
  }

  requireOwner(
    getter: (data: T) => string | undefined,
    opts: { flag: string },
  ): Rule {
    const id = this.id;
    return defineRule({
      kind: "require-owner",
      needs: [this] as const,
      flag: opts.flag,
      check: ([data], _payload, ctx) =>
        getter(data as T) === ctx.subject.id
          ? { ok: true }
          : { ok: false, reason: `not owner of ${id} (flag: ${opts.flag})` },
    });
  }

  requireMembership(
    getter: (data: T) => readonly string[],
    opts: { flag: string },
  ): Rule {
    const id = this.id;
    return defineRule({
      kind: "require-membership",
      needs: [this] as const,
      flag: opts.flag,
      check: ([data], _payload, ctx) => {
        const list = getter(data as T);
        return list.includes(ctx.subject.id)
          ? { ok: true }
          : { ok: false, reason: `subject not member of ${id} (flag: ${opts.flag})` };
      },
    });
  }

  requireCustom(
    predicate: (data: T, ctx: FetchCtx) => boolean,
    opts: { flag: string; descriptor?: Record<string, unknown> },
  ): Rule {
    const id = this.id;
    return defineRule({
      kind: "require-custom",
      needs: [this] as const,
      flag: opts.flag,
      describe: () => opts.descriptor ?? {},
      check: ([data], _payload, ctx) =>
        predicate(data as T, ctx)
          ? { ok: true }
          : { ok: false, reason: `require-custom[${id}] denied (flag: ${opts.flag})` },
    });
  }
}

/**
 * Rule sans resource : compare un segment du target à subject.id.
 * Opt-in via `flags[flag] === true`.
 */
function requireSelf(opts: { flag: string; segment?: number }): Rule {
  const segment = opts.segment ?? 0;
  return defineRule({
    kind: "require-self",
    needs: [] as const,
    flag: opts.flag,
    describe: () => ({ segment }),
    check: (_data, _payload, ctx) =>
      ctx.target[segment] === ctx.subject.id
        ? { ok: true }
        : { ok: false, reason: `target[${segment}] is not self (flag: ${opts.flag})` },
  });
}

function resource<T>(opts: {
  id: string;
  fetch: (ctx: FetchCtx) => T | Promise<T>;
  activeWhen?: (grant: Grant) => boolean;
  dedupKey?: (ctx: FetchCtx) => string;
}): ResourceImpl<T> {
  return new ResourceImpl(
    opts.id,
    opts.fetch,
    opts.activeWhen,
    opts.dedupKey,
  );
}

// =============================================================================
// PERMISSION + SYSTEM
// =============================================================================

type Permission = { target: AnyTarget; rules: Rule[] };

function permission(opts: { target: AnyTarget }) {
  return {
    rules: (rules: Rule[]): Permission => ({
      target: opts.target,
      rules,
    }),
  };
}

type Provider = (
  subject: Subject,
  key: string,
  target?: readonly unknown[],
) => Grant[] | Promise<Grant[]>;

function createSystem(opts: {
  schema: Record<string, Permission>;
  providers: Provider[];
}) {
  // Validate target arity at boot — same as the production lib.
  for (const [key, perm] of Object.entries(opts.schema)) {
    // (no-op for now — could check rule resources are compatible with target shape)
    if (!perm) throw new Error(`schema[${key}] is empty`);
  }

  return {
    context(subject: Subject) {
      const cache = new Map<string, Promise<unknown>>();
      const fetchCounters = new Map<string, number>();

      function fetchResource(
        resource: ResourceImpl<unknown>,
        ctx: FetchCtx,
      ): Promise<unknown> {
        const key = resource.computeDedupKey(ctx);
        const existing = cache.get(key);
        if (existing) return existing;
        fetchCounters.set(
          resource.id,
          (fetchCounters.get(resource.id) ?? 0) + 1,
        );
        const pending = Promise.resolve(resource.fetcher(ctx));
        cache.set(key, pending);
        return pending;
      }

      return {
        getFetchCounters: () =>
          Object.fromEntries(fetchCounters) as Record<string, number>,
        clearCounters: () => fetchCounters.clear(),
        async can(
          key: string,
          target?: readonly unknown[],
        ): Promise<
          { ok: true; data?: unknown } | { ok: false; reasons: string[] }
        > {
          const perm = opts.schema[key];
          if (!perm) return { ok: false, reasons: [`unknown perm: ${key}`] };

          // Validate target arity against schema
          const expectedArity = perm.target.segments.length;
          const actualArity = target?.length ?? 0;
          if (perm.target.kind === "none" && actualArity > 0) {
            return {
              ok: false,
              reasons: [`target arity mismatch: expected 0, got ${actualArity}`],
            };
          }
          if (
            perm.target.kind !== "none" && actualArity !== expectedArity
          ) {
            return {
              ok: false,
              reasons: [
                `target arity mismatch: expected ${expectedArity}, got ${actualArity}`,
              ],
            };
          }

          const allGrants: Grant[] = [];
          for (const provider of opts.providers) {
            const grants = await provider(subject, key, target);
            allGrants.push(...grants);
          }

          const matching = allGrants.filter((g) =>
            g.key === key && targetMatches(g.target, target, perm.target)
          );
          if (matching.length === 0) {
            return { ok: false, reasons: ["no matching grant"] };
          }

          const reasons: string[] = [];
          let lastData: unknown = undefined;
          let anyOk = false;

          for (const grant of matching) {
            const ctx: FetchCtx = {
              subject,
              target: target ?? [],
              grant,
            };
            // Une rule est active si :
            //   - elle n'a pas d'activeWhen (toujours active)
            //   - OU son activeWhen retourne true pour ce grant
            //   - ET toutes ses needs sont actives pour ce grant (resource activeWhen)
            const activeRules = perm.rules.filter((r) => {
              if (r.activeWhen && !r.activeWhen(grant)) return false;
              return r.needs.every((res) => res.isActiveFor(grant));
            });

            // Collect all unique resources from active rules
            const uniqueResources = Array.from(
              new Map(
                activeRules
                  .flatMap((r) => r.needs)
                  .map((r) => [r.id, r] as const),
              ).values(),
            );
            const fetched = new Map<string, unknown>();
            await Promise.all(uniqueResources.map(async (r) => {
              fetched.set(r.id, await fetchResource(r, ctx));
            }));

            let grantOk = true;
            let grantData: unknown = undefined;
            for (const rule of activeRules) {
              const data = rule.needs.map((r) => fetched.get(r.id));
              const result = rule.check(data, ctx);
              if (!result.ok) {
                grantOk = false;
                reasons.push(
                  grant.id
                    ? `[${grant.id}] ${result.reason}`
                    : result.reason,
                );
                break;
              }
              if (result.data !== undefined) grantData = result.data;
            }

            if (grantOk) {
              anyOk = true;
              if (grantData !== undefined) lastData = grantData;
            }
          }

          return anyOk
            ? { ok: true, data: lastData }
            : { ok: false, reasons };
        },
      };
    },
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
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

function targetMatches(
  grantTarget: readonly unknown[] | unknown | undefined,
  requestTarget: readonly unknown[] | undefined,
  schemaTarget: AnyTarget,
): boolean {
  if (schemaTarget.kind === "none") return true;
  if (grantTarget === undefined) return true;
  if (requestTarget === undefined) return false;
  const g = Array.isArray(grantTarget)
    ? (grantTarget as readonly unknown[])
    : [grantTarget];
  if (g.length !== requestTarget.length) return false;
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

// =============================================================================
// FAKE DIIVENTO REPOS — chaque appel est loggué pour vérifier le dedup
// =============================================================================

const fetchLog: string[] = [];

const fakeUsers: Record<string, {
  _id: string;
  firstname: string;
  lastname: string;
  email: string;
  roles: string[];
}> = {
  "user:editor": {
    _id: "user:editor",
    firstname: "Alice",
    lastname: "Editor",
    email: "alice@example.com",
    roles: ["role:editor"],
  },
  "user:viewer": {
    _id: "user:viewer",
    firstname: "Bob",
    lastname: "Viewer",
    email: "bob@example.com",
    roles: ["role:viewer"],
  },
};

const fakeMemberships: Record<string, { tenantId: string; role: string }[]> = {
  "user:editor": [{ tenantId: "entreprise:B", role: "member" }],
  "user:viewer": [{ tenantId: "entreprise:A", role: "member" }],
};

const fakeExpoInfo: Record<string, { _id: string; name: string; owner: string }> = {
  "exposition:e1": {
    _id: "exposition:e1",
    name: "Salon 2026",
    owner: "user:owner",
  },
};

const fakePrograms: Record<string, { _id: string; name: string }> = {
  "exposition:e1::program:p7": {
    _id: "program:p7",
    name: "Conference Track A",
  },
  "exposition:e1::program:p8": {
    _id: "program:p8",
    name: "Workshop Track",
  },
};

const fakeRegistrations: Record<
  string,
  { _id: string; visitorId: string; programId: string; status: string }
> = {
  "exposition:e1::program:p7::registration:r1": {
    _id: "registration:r1",
    visitorId: "visitor:v1",
    programId: "program:p7",
    status: "confirmed",
  },
  "exposition:e1::program:p7::registration:r2": {
    _id: "registration:r2",
    visitorId: "visitor:v2",
    programId: "program:p7",
    status: "pending",
  },
};

const fakeExhibitors: Record<string, { _id: string; name: string }> = {
  "exposition:e1::exhibitor:x1": {
    _id: "exhibitor:x1",
    name: "Acme Corp",
  },
};

const fakeCollaboratorRecords: Record<
  string,
  { _id: string; userId: string; status: string }
> = {
  "exposition:e1::exhibitor:x1::collaborator:c10": {
    _id: "collaborator:c10",
    userId: "user:editor",
    status: "active",
  },
  "exposition:e1::exhibitor:x1::collaborator:c11": {
    _id: "collaborator:c11",
    userId: "user:viewer",
    status: "active",
  },
};

const fakeMyCollabs: { exhibitorId: string; userId: string; status: string }[] = [
  { exhibitorId: "exhibitor:x1", userId: "user:editor", status: "active" },
  { exhibitorId: "exhibitor:x2", userId: "user:editor", status: "inactive" },
];

const fakeArticles: Record<
  string,
  { _id: string; title: string; authorId: string; status: string }
> = {
  "article:a1": {
    _id: "article:a1",
    title: "On the migration",
    authorId: "user:editor",
    status: "published",
  },
  "article:a2": {
    _id: "article:a2",
    title: "Misc thoughts",
    authorId: "user:viewer",
    status: "draft",
  },
};

const articlesRepo = {
  findById(id: string) {
    fetchLog.push(`articlesRepo.findById(${id})`);
    return Promise.resolve(fakeArticles[id] ?? null);
  },
};

// Pour le case "validate dépense < 500 €"
const fakeExpenses: Record<string, { _id: string; amount: number; submittedBy: string }> = {
  "expense:e1": { _id: "expense:e1", amount: 250, submittedBy: "user:viewer" },
  "expense:e2": { _id: "expense:e2", amount: 1200, submittedBy: "user:viewer" },
};
const expensesRepo = {
  findById(id: string) {
    fetchLog.push(`expensesRepo.findById(${id})`);
    return Promise.resolve(fakeExpenses[id] ?? null);
  },
};

// Pour le case "Manager voit son équipe sauf lui"
// teamMembers = users dont user:editor est manager
const fakeTeamMembers: Record<string, string[]> = {
  "user:editor": ["user:editor", "user:viewer"], // editor manage editor (lui-même!) et viewer
};
const teamsRepo = {
  findTeamMembersOf(managerId: string) {
    fetchLog.push(`teamsRepo.findTeamMembersOf(${managerId})`);
    return Promise.resolve(fakeTeamMembers[managerId] ?? []);
  },
};

// Articles avec une orga (pour case "lit articles de mes orgas")
const fakeArticlesWithOrg: Record<
  string,
  { _id: string; title: string; authorId: string; orgId: string | null }
> = {
  "article:a1": { _id: "article:a1", title: "Migration", authorId: "user:editor", orgId: "entreprise:B" },
  "article:a2": { _id: "article:a2", title: "Misc", authorId: "user:viewer", orgId: "entreprise:A" },
  "article:a3": { _id: "article:a3", title: "Personal", authorId: "user:viewer", orgId: null },
};
const articlesWithOrgRepo = {
  findById(id: string) {
    fetchLog.push(`articlesWithOrgRepo.findById(${id})`);
    return Promise.resolve(fakeArticlesWithOrg[id] ?? null);
  },
};

const usersRepo = {
  findById(id: string) {
    fetchLog.push(`usersRepo.findById(${id})`);
    return Promise.resolve(fakeUsers[id] ?? null);
  },
};

const entreprisesRepo = {
  findActiveMembersByUserId(id: string) {
    fetchLog.push(`entreprisesRepo.findActiveMembersByUserId(${id})`);
    return Promise.resolve(fakeMemberships[id] ?? []);
  },
};

const expoRepo = {
  getInfo(id: string) {
    fetchLog.push(`expoRepo.getInfo(${id})`);
    return Promise.resolve(fakeExpoInfo[id] ?? null);
  },
  getProgram(expoId: string, programId: string) {
    fetchLog.push(`expoRepo.getProgram(${expoId}, ${programId})`);
    return Promise.resolve(fakePrograms[`${expoId}::${programId}`] ?? null);
  },
  getRegistration(expoId: string, programId: string, registrationId: string) {
    fetchLog.push(
      `expoRepo.getRegistration(${expoId}, ${programId}, ${registrationId})`,
    );
    return Promise.resolve(
      fakeRegistrations[`${expoId}::${programId}::${registrationId}`] ?? null,
    );
  },
  getExhibitor(expoId: string, exhibitorId: string) {
    fetchLog.push(`expoRepo.getExhibitor(${expoId}, ${exhibitorId})`);
    return Promise.resolve(fakeExhibitors[`${expoId}::${exhibitorId}`] ?? null);
  },
  getCollaboratorRecord(
    expoId: string,
    exhibitorId: string,
    collaboratorId: string,
  ) {
    fetchLog.push(
      `expoRepo.getCollaboratorRecord(${expoId}, ${exhibitorId}, ${collaboratorId})`,
    );
    return Promise.resolve(
      fakeCollaboratorRecords[
        `${expoId}::${exhibitorId}::${collaboratorId}`
      ] ?? null,
    );
  },
  findMyActiveCollab(exhibitorId: string, userId: string) {
    fetchLog.push(
      `expoRepo.findMyActiveCollab(${exhibitorId}, ${userId})`,
    );
    return Promise.resolve(
      fakeMyCollabs.find((c) =>
        c.exhibitorId === exhibitorId && c.userId === userId &&
        c.status === "active"
      ) ?? null,
    );
  },
};

// =============================================================================
// RESOURCES PARTAGÉES
//
// Note importante : chaque resource déclare quelles SEGMENTS du target elle
// consomme via son `dedupKey`. Plusieurs resources sur un même path target
// peuvent ainsi avoir des granularités de cache différentes. Exemple :
//  - expositionInfoOf : dedup sur target[0] uniquement
//  - programOf       : dedup sur target[0..1]
//  - registrationOf  : dedup sur target[0..2]
// =============================================================================

const userOf = resource({
  id: "user",
  fetch: ({ target }) => usersRepo.findById(target[0] as string),
  dedupKey: ({ target }) => target[0] as string,
});

const userMembershipsOf = resource({
  id: "user-memberships",
  fetch: ({ target }) =>
    entreprisesRepo.findActiveMembersByUserId(target[0] as string),
  activeWhen: (grant) => grant.with?.requiredEntreprise !== undefined,
  dedupKey: ({ target }) => target[0] as string,
});

// Consomme target[0] uniquement — partagé entre toutes les permissions expo.
const expositionInfoOf = resource({
  id: "exposition",
  fetch: ({ target }) => expoRepo.getInfo(target[0] as string),
  dedupKey: ({ target }) => target[0] as string,
});

// Consomme target[0..1].
const programOf = resource({
  id: "program",
  fetch: ({ target }) =>
    expoRepo.getProgram(target[0] as string, target[1] as string),
  dedupKey: ({ target }) => `${target[0]}::${target[1]}`,
});

// Consomme target[0..2].
const registrationOf = resource({
  id: "registration",
  fetch: ({ target }) =>
    expoRepo.getRegistration(
      target[0] as string,
      target[1] as string,
      target[2] as string,
    ),
  dedupKey: ({ target }) => `${target[0]}::${target[1]}::${target[2]}`,
});

const exhibitorOf = resource({
  id: "exhibitor",
  fetch: ({ target }) =>
    expoRepo.getExhibitor(target[0] as string, target[1] as string),
  dedupKey: ({ target }) => `${target[0]}::${target[1]}`,
});

const collaboratorOf = resource({
  id: "collaborator",
  fetch: ({ target }) =>
    expoRepo.getCollaboratorRecord(
      target[0] as string,
      target[1] as string,
      target[2] as string,
    ),
  dedupKey: ({ target }) => `${target[0]}::${target[1]}::${target[2]}`,
});

const myActiveCollabOf = resource({
  id: "my-collab",
  fetch: ({ subject, target }) =>
    expoRepo.findMyActiveCollab(target[1] as string, subject.id),
  dedupKey: ({ subject, target }) => `${subject.id}::${target[1]}`,
});

const articleOf = resource({
  id: "article",
  fetch: ({ target }) => articlesRepo.findById(target[0] as string),
  dedupKey: ({ target }) => target[0] as string,
});

// CASE 1 — "Article de mes orgas" : resource composite qui PRÉCALCULE
// l'accès en faisant 2 fetches (article + memberships) et retourne un boolean.
// C'est le workaround au manque de cross-resource rule.
const myArticleAccessOf = resource({
  id: "my-article-access",
  fetch: async ({ subject, target }) => {
    const article = await articlesWithOrgRepo.findById(target[0] as string);
    if (!article) return { ok: false as const, reason: "not-found" };
    if (article.authorId === subject.id) return { ok: true as const, via: "owner" };
    if (article.orgId === null) return { ok: false as const, reason: "private" };
    const memberships = await entreprisesRepo.findActiveMembersByUserId(
      subject.id,
    );
    const myOrgs = memberships.map((m) => m.tenantId);
    return myOrgs.includes(article.orgId)
      ? { ok: true as const, via: "org" }
      : { ok: false as const, reason: "wrong-org" };
  },
  dedupKey: ({ subject, target }) => `${subject.id}::${target[0]}`,
});

// CASE 2 — "Manager voit team sauf lui" : précalcule l'accès en multi-fetch.
const teamPayslipAccessOf = resource({
  id: "team-payslip-access",
  fetch: async ({ subject, target }) => {
    const targetUserId = target[0] as string;
    if (targetUserId === subject.id) return false; // exclude self
    const teamMembers = await teamsRepo.findTeamMembersOf(subject.id);
    return teamMembers.includes(targetUserId);
  },
  activeWhen: (grant) => grant.flags?.teamScope === true,
  dedupKey: ({ subject, target }) => `${subject.id}::${target[0]}`,
});

// CASE 3 — Conditional numeric (depense < grant.payload.maxAmount)
const expenseOf = resource({
  id: "expense",
  fetch: ({ target }) => expensesRepo.findById(target[0] as string),
  dedupKey: ({ target }) => target[0] as string,
});

// =============================================================================
// SCHEMA
// =============================================================================

const schema: Record<string, Permission> = {
  // ─── Plat (1 segment) ──────────────────────────────────────────────────
  "users.read": permission({
    target: target.required("user"),
  }).rules([
    userOf.match(),
    userOf.filter(),
  ]),

  "users.update": permission({
    target: target.required("user"),
  }).rules([
    userOf.match(),
    userOf.filter(),
    userOf.includes("requiredRole", (u) => u?.roles ?? []),
    userMembershipsOf.includes(
      "requiredEntreprise",
      (memberships) => memberships.map((m) => m.tenantId),
    ),
  ]),

  // ─── Path 2 segments ───────────────────────────────────────────────────
  "expositions.exhibitors.private_space.manage": permission({
    target: target.path("exposition", "exhibitor"),
  }).rules([
    exhibitorOf.match(),
    exhibitorOf.filter(),
    myActiveCollabOf.requireTruthy(),
  ]),

  // ─── Path 3 segments — c'est ICI qu'on attaque le bug "registrations" ──
  "expositions.programs.registrations.read": permission({
    target: target.path("exposition", "program", "registration"),
  }).rules([
    expositionInfoOf.match(),
    programOf.match(),
    registrationOf.match(),
    registrationOf.filter(),
  ]),

  "expositions.programs.registrations.update": permission({
    target: target.path("exposition", "program", "registration"),
  }).rules([
    expositionInfoOf.match(),
    programOf.match(),
    registrationOf.match(),
  ]),

  // ─── Path 3 segments — collaborateurs scopés dans un exhibitor ─────────
  "expositions.exhibitors.collaborators.read": permission({
    target: target.path("exposition", "exhibitor", "collaborator"),
  }).rules([
    expositionInfoOf.match(),
    exhibitorOf.match(),
    collaboratorOf.match(),
    collaboratorOf.filter(),
  ]),

  // ─── Helpers require* avec opt-in via flags ────────────────────────────
  // articles.update — un grant peut être :
  //   • admin : { target: ["article:*"] }
  //   • auteur seulement : { target: ["article:*"], flags: { ownerOnly: true } }
  // Le rule requireOwner ne fire que pour l'auteur grant.
  "articles.update": permission({
    target: target.required("article"),
  }).rules([
    articleOf.match(),
    articleOf.filter(),
    articleOf.requireOwner((a) => a?.authorId, { flag: "ownerOnly" }),
  ]),

  // users.update — démontre requireSelf (target[0] === subject.id)
  // Un grant peut être :
  //   • admin : { target: ["user:*"] }
  //   • self : { target: ["user:*"], flags: { selfOnly: true } }
  "users.update.with-self": permission({
    target: target.required("user"),
  }).rules([
    userOf.match(),
    userOf.filter(),
    requireSelf({ flag: "selfOnly", segment: 0 }),
  ]),

  // CASE STUDY 1 — articles de mes orgas (cross-resource via "fat resource")
  "articles.read.org-aware": permission({
    target: target.required("article"),
  }).rules([
    myArticleAccessOf.requireCustom((access) => access.ok, {
      flag: "myArticles",
      descriptor: {
        // Métadonnée pour la matrix UI : sait qu'il s'agit d'un check d'accès
        // composite "owner OR my-org member"
        intent: "owner-or-org-member",
      },
    }),
  ]),

  // CASE STUDY 2 — manager voit team sauf lui-même
  "payslips.read.team": permission({
    target: target.required("user"),
  }).rules([
    userOf.match(),
    userOf.filter(),
    teamPayslipAccessOf.requireTruthy(),
  ]),

  // CASE STUDY 3 — valider dépense si amount <= grant.payload.maxAmount
  "expenses.validate": permission({
    target: target.required("expense"),
  }).rules([
    expenseOf.match(),
    expenseOf.requireCustom(
      (expense, ctx) => {
        const max = (ctx.grant.payload as { maxAmount?: number })?.maxAmount;
        return expense !== null && (max === undefined || expense.amount <= max);
      },
      {
        flag: "amountLimit",
        descriptor: { intent: "amount-le", payloadField: "maxAmount" },
      },
    ),
  ]),
};


// =============================================================================
// PROVIDERS
// =============================================================================

const grantsByKey: Record<string, Grant[]> = {
  "users.read": [
    { id: "g-admin-read", key: "users.read", target: ["user:*"] },
  ],
  "users.update": [
    { id: "g-admin-update", key: "users.update", target: ["user:*"] },
    {
      id: "g-editor-scope",
      key: "users.update",
      target: ["user:*"],
      with: { requiredRole: "role:editor" },
    },
    {
      id: "g-orga-b",
      key: "users.update",
      target: ["user:*"],
      with: { requiredEntreprise: "entreprise:B" },
    },
    {
      id: "g-orga-a",
      key: "users.update",
      target: ["user:*"],
      with: { requiredEntreprise: "entreprise:A" },
    },
    {
      id: "g-editor-of-orga-b",
      key: "users.update",
      target: ["user:*"],
      with: { requiredRole: "role:editor", requiredEntreprise: "entreprise:B" },
    },
  ],
  "expositions.exhibitors.private_space.manage": [
    {
      id: "g-collab-self",
      key: "expositions.exhibitors.private_space.manage",
      target: ["exposition:*", "exhibitor:*"],
    },
  ],
  "expositions.programs.registrations.read": [
    // Grant niveau expo (wildcard sur program ET registration)
    {
      id: "g-all-registrations-of-e1",
      key: "expositions.programs.registrations.read",
      target: ["exposition:e1", "program:*", "registration:*"],
    },
    // Grant niveau program (wildcard sur registration uniquement)
    {
      id: "g-registrations-of-program-p7",
      key: "expositions.programs.registrations.read",
      target: ["exposition:e1", "program:p7", "registration:*"],
    },
  ],
  "expositions.programs.registrations.update": [
    {
      id: "g-update-registrations-e1-p7",
      key: "expositions.programs.registrations.update",
      target: ["exposition:e1", "program:p7", "registration:*"],
    },
  ],
  "expositions.exhibitors.collaborators.read": [
    // Grant niveau expo
    {
      id: "g-all-collaborators-e1",
      key: "expositions.exhibitors.collaborators.read",
      target: ["exposition:e1", "exhibitor:*", "collaborator:*"],
    },
    // Grant scopé à un exhibitor précis
    {
      id: "g-collaborators-of-x1",
      key: "expositions.exhibitors.collaborators.read",
      target: ["exposition:e1", "exhibitor:x1", "collaborator:*"],
    },
  ],
  "articles.update": [
    // Admin grant — pas de flag, requireOwner passe silencieusement
    {
      id: "g-admin-articles",
      key: "articles.update",
      target: ["article:*"],
    },
    // Auteur grant — opt-in à requireOwner via flags.ownerOnly
    {
      id: "g-author-articles",
      key: "articles.update",
      target: ["article:*"],
      flags: { ownerOnly: true },
    },
  ],
  "users.update.with-self": [
    // Admin grant — pas de flag
    {
      id: "g-admin-users-self",
      key: "users.update.with-self",
      target: ["user:*"],
    },
    // Self grant — opt-in à requireSelf via flags.selfOnly
    {
      id: "g-self-only-update",
      key: "users.update.with-self",
      target: ["user:*"],
      flags: { selfOnly: true },
    },
  ],
  "articles.read.org-aware": [
    {
      id: "g-articles-mine-or-orga",
      key: "articles.read.org-aware",
      target: ["article:*"],
      flags: { myArticles: true },
    },
  ],
  "payslips.read.team": [
    {
      id: "g-team-payslips",
      key: "payslips.read.team",
      target: ["user:*"],
      flags: { teamScope: true },
    },
  ],
  "expenses.validate": [
    // Junior validateur : limite à 500 €
    {
      id: "g-validate-junior",
      key: "expenses.validate",
      target: ["expense:*"],
      flags: { amountLimit: true },
      payload: { maxAmount: 500 },
    },
    // Senior : pas de limite (admin)
    {
      id: "g-validate-senior",
      key: "expenses.validate",
      target: ["expense:*"],
    },
  ],
};

const directProvider: Provider = (_subject, key) =>
  Promise.resolve(grantsByKey[key] ?? []);

// =============================================================================
// MAIN — exécute les scénarios et vérifie le comportement
// =============================================================================

function header(title: string) {
  console.log(`\n${"=".repeat(72)}\n  ${title}\n${"=".repeat(72)}`);
}

function reset(ctx: ReturnType<ReturnType<typeof createSystem>["context"]>) {
  fetchLog.length = 0;
  ctx.clearCounters();
}

async function main() {
  const sys = createSystem({ schema, providers: [directProvider] });

  // ─────────────────────────────────────────────────────────────────────────
  header("1. Lazy + dedup intra-grant — users.update sur user:editor");
  // ─────────────────────────────────────────────────────────────────────────
  {
    const ctx = sys.context({ id: "user:alice" });
    reset(ctx);
    const result = await ctx.can("users.update", ["user:editor"]);
    console.log("Result.ok:", result.ok);
    console.log("Counters:", ctx.getFetchCounters());
    console.log("Calls:");
    for (const call of fetchLog) console.log("  •", call);
    console.log(
      "Attendu : userOf=1, userMembershipsOf=1 (5 grants → 1 fetch chacun)",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("2. activeWhen — admin grant seul, user-memberships PAS fetché");
  // ─────────────────────────────────────────────────────────────────────────
  {
    const adminOnly: Provider = (_s, key) =>
      Promise.resolve(
        (grantsByKey[key] ?? []).filter((g) => g.id === "g-admin-update"),
      );
    const sysAdmin = createSystem({ schema, providers: [adminOnly] });
    const ctx = sysAdmin.context({ id: "user:alice" });
    reset(ctx);
    await ctx.can("users.update", ["user:editor"]);
    console.log("Counters:", ctx.getFetchCounters());
    console.log("Attendu : { user: 1 } — pas de user-memberships");
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("3. Cross-permission dedup — read puis update sur user:editor");
  // ─────────────────────────────────────────────────────────────────────────
  {
    const ctx = sys.context({ id: "user:alice" });
    reset(ctx);
    await ctx.can("users.read", ["user:editor"]);
    await ctx.can("users.update", ["user:editor"]);
    console.log("Counters:", ctx.getFetchCounters());
    console.log("Attendu : userOf=1, userMembershipsOf=1 (1 fetch chacun)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("4. Subject-aware — private_space (target.path 2 segments)");
  // ─────────────────────────────────────────────────────────────────────────
  {
    const ctx = sys.context({ id: "user:editor" });
    reset(ctx);
    const okR = await ctx.can(
      "expositions.exhibitors.private_space.manage",
      ["exposition:e1", "exhibitor:x1"],
    );
    console.log("On x1 (active collab):", okR.ok ? "OK" : "DENY");

    reset(ctx);
    const denyR = await ctx.can(
      "expositions.exhibitors.private_space.manage",
      ["exposition:e1", "exhibitor:x2"],
    );
    console.log(
      "On x2 (inactive):",
      denyR.ok ? "OK" : "DENY",
    );
    console.log("Attendu : OK / DENY");
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("5. Path 3 segments — registrations.read sur 1 registration précise");
  // ─────────────────────────────────────────────────────────────────────────
  // Le request : ["exposition:e1", "program:p7", "registration:r1"]
  // Deux grants matchent (g-all-registrations-of-e1 et g-registrations-of-program-p7).
  // 4 rules : exposition.match, program.match, registration.match, registration.filter
  // 3 resources distinctes → 3 fetches max, peu importe le nombre de grants.
  {
    const ctx = sys.context({ id: "user:alice" });
    reset(ctx);
    const result = await ctx.can(
      "expositions.programs.registrations.read",
      ["exposition:e1", "program:p7", "registration:r1"],
    );
    console.log("Result.ok:", result.ok);
    console.log("Counters:", ctx.getFetchCounters());
    console.log("Calls:");
    for (const call of fetchLog) console.log("  •", call);
    console.log(
      "Attendu : exposition=1, program=1, registration=1 (malgré 2 grants)",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("6. Dedup partiel sur path — 2 registrations dans le MÊME program");
  // ─────────────────────────────────────────────────────────────────────────
  // expositionInfoOf consomme target[0] → 1 fetch (mêmes expo pour les 2 calls)
  // programOf consomme target[0..1] → 1 fetch (même program pour les 2 calls)
  // registrationOf consomme target[0..2] → 2 fetches (registrations différentes)
  {
    const ctx = sys.context({ id: "user:alice" });
    reset(ctx);
    await ctx.can("expositions.programs.registrations.read", [
      "exposition:e1",
      "program:p7",
      "registration:r1",
    ]);
    await ctx.can("expositions.programs.registrations.read", [
      "exposition:e1",
      "program:p7",
      "registration:r2",
    ]);
    console.log("Counters:", ctx.getFetchCounters());
    console.log("Calls:");
    for (const call of fetchLog) console.log("  •", call);
    console.log(
      "Attendu : exposition=1, program=1, registration=2",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("7. Cross-permission dedup à 3 niveaux — read puis update même reg");
  // ─────────────────────────────────────────────────────────────────────────
  // expositionInfoOf, programOf, registrationOf : tous partagés entre les
  // 2 permissions → 1 fetch chacun pour les 2 can() combinés.
  {
    const ctx = sys.context({ id: "user:alice" });
    reset(ctx);
    await ctx.can("expositions.programs.registrations.read", [
      "exposition:e1",
      "program:p7",
      "registration:r1",
    ]);
    await ctx.can("expositions.programs.registrations.update", [
      "exposition:e1",
      "program:p7",
      "registration:r1",
    ]);
    console.log("Counters:", ctx.getFetchCounters());
    console.log(
      "Attendu : exposition=1, program=1, registration=1 (cross-perm dedup)",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("8. Wildcards à différents niveaux du path");
  // ─────────────────────────────────────────────────────────────────────────
  // Test des grants qui scopent à différents niveaux
  {
    const ctx = sys.context({ id: "user:alice" });

    // Cas A : registration de program:p7 → matche les 2 grants (e1+all et e1+p7)
    reset(ctx);
    const a = await ctx.can(
      "expositions.programs.registrations.read",
      ["exposition:e1", "program:p7", "registration:r1"],
    );
    console.log("e1/p7/r1:", a.ok ? "OK" : "DENY");

    // Cas B : registration de program:p8 → matche seulement g-all (wildcard sur program)
    reset(ctx);
    const b = await ctx.can(
      "expositions.programs.registrations.read",
      ["exposition:e1", "program:p8", "registration:r1"],
    );
    console.log("e1/p8/r1:", b.ok ? "OK (via grant wildcard program)" : "DENY");

    // Cas C : autre expo → aucun grant ne matche
    reset(ctx);
    const c = await ctx.can(
      "expositions.programs.registrations.read",
      ["exposition:e99", "program:p1", "registration:r1"],
    );
    console.log(
      "e99/p1/r1:",
      c.ok ? "OK" : `DENY (${("reasons" in c ? c.reasons : []).join(", ")})`,
    );

    console.log("Attendu : OK / OK / DENY");
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("9. Path 3 segments — collaborators (variante hiérarchique)");
  // ─────────────────────────────────────────────────────────────────────────
  // Pareil que registrations, mais avec exhibitor au milieu. Démontre que le
  // pattern marche pour n'importe quelle hiérarchie.
  {
    const ctx = sys.context({ id: "user:alice" });
    reset(ctx);
    const result = await ctx.can(
      "expositions.exhibitors.collaborators.read",
      ["exposition:e1", "exhibitor:x1", "collaborator:c10"],
    );
    console.log("Result.ok:", result.ok);
    console.log("Counters:", ctx.getFetchCounters());
    console.log(
      "Attendu : exposition=1, exhibitor=1, collaborator=1",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("10. Validation de l'arité du target (schema check)");
  // ─────────────────────────────────────────────────────────────────────────
  {
    const ctx = sys.context({ id: "user:alice" });

    // Trop court : registrations.read attend 3 segments, on en passe 2
    const short = await ctx.can(
      "expositions.programs.registrations.read",
      ["exposition:e1", "program:p7"],
    );
    console.log(
      "2 segments au lieu de 3 :",
      short.ok ? "OK" : `DENY (${("reasons" in short ? short.reasons : []).join(", ")})`,
    );

    // Trop long : users.read attend 1 segment, on en passe 2
    const long = await ctx.can("users.read", ["user:editor", "extra"]);
    console.log(
      "2 segments au lieu de 1 :",
      long.ok ? "OK" : `DENY (${("reasons" in long ? long.reasons : []).join(", ")})`,
    );

    console.log("Attendu : 2 DENY (arity mismatch)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("11. requireOwner — opt-in via flags.ownerOnly");
  // ─────────────────────────────────────────────────────────────────────────
  // Auteur grant a flags.ownerOnly=true → la rule fire et check authorId.
  // Admin grant n'a pas de flag → la rule passe silencieusement.
  // user:editor est l'auteur de article:a1 mais PAS de article:a2.
  {
    // Tester user:editor seul (sans admin)
    const onlyAuthorProvider: Provider = (_s, key) =>
      Promise.resolve(
        (grantsByKey[key] ?? []).filter((g) => g.id === "g-author-articles"),
      );
    const sysAuthor = createSystem({
      schema,
      providers: [onlyAuthorProvider],
    });
    const ctx = sysAuthor.context({ id: "user:editor" });

    reset(ctx);
    const own = await ctx.can("articles.update", ["article:a1"]);
    console.log(
      "user:editor sur article:a1 (le sien) :",
      own.ok ? "OK" : "DENY",
    );

    reset(ctx);
    const notOwn = await ctx.can("articles.update", ["article:a2"]);
    console.log(
      "user:editor sur article:a2 (pas le sien) :",
      notOwn.ok ? "OK" : `DENY (${("reasons" in notOwn ? notOwn.reasons : []).join(", ")})`,
    );

    // Et avec admin grant en plus → bypass
    const ctxFull = sys.context({ id: "user:editor" });
    reset(ctxFull);
    const adminBypass = await ctxFull.can("articles.update", ["article:a2"]);
    console.log(
      "user:editor sur article:a2 AVEC admin grant en plus :",
      adminBypass.ok ? "OK (admin grant a bypass requireOwner)" : "DENY",
    );

    console.log("Attendu : OK / DENY / OK (admin bypass)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("12. requireSelf — opt-in via flags.selfOnly");
  // ─────────────────────────────────────────────────────────────────────────
  // Self grant a flags.selfOnly=true → check target[0] === subject.id
  // Admin grant pas de flag → passe.
  {
    const onlySelf: Provider = (_s, key) =>
      Promise.resolve(
        (grantsByKey[key] ?? []).filter((g) => g.id === "g-self-only-update"),
      );
    const sysSelf = createSystem({ schema, providers: [onlySelf] });
    const ctx = sysSelf.context({ id: "user:editor" });

    reset(ctx);
    const onSelf = await ctx.can("users.update.with-self", ["user:editor"]);
    console.log(
      "self update on user:editor (==subject) :",
      onSelf.ok ? "OK" : "DENY",
    );

    reset(ctx);
    const onOther = await ctx.can("users.update.with-self", ["user:viewer"]);
    console.log(
      "self update on user:viewer (!=subject) :",
      onOther.ok ? "OK" : `DENY (${("reasons" in onOther ? onOther.reasons : []).join(", ")})`,
    );

    console.log("Attendu : OK / DENY");
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("CASE STUDY 1 — articles de mes orgas (cross-resource)");
  // ─────────────────────────────────────────────────────────────────────────
  // Le grant donne accès aux articles dont je suis auteur OU dont l'orgId
  // est dans une de mes entreprises actives. La logique cross-fetch est
  // encapsulée dans le resource `myArticleAccessOf`.
  {
    const ctx = sys.context({ id: "user:editor" });

    reset(ctx);
    const own = await ctx.can("articles.read.org-aware", ["article:a1"]);
    console.log("article:a1 (auteur) :", own.ok ? "OK" : "DENY");

    reset(ctx);
    const myOrg = await ctx.can("articles.read.org-aware", ["article:a2"]);
    // article:a2 a orgId=entreprise:A, mais editor est dans entreprise:B
    console.log(
      "article:a2 (autre orga) :",
      myOrg.ok ? "OK" : `DENY (${("reasons" in myOrg ? myOrg.reasons : []).join(", ")})`,
    );

    reset(ctx);
    const personal = await ctx.can("articles.read.org-aware", ["article:a3"]);
    console.log(
      "article:a3 (orgId=null) :",
      personal.ok ? "OK" : "DENY (private)",
    );

    console.log("Attendu : OK / DENY / DENY");
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("CASE STUDY 2 — manager team payslips, sauf le sien");
  // ─────────────────────────────────────────────────────────────────────────
  {
    const ctx = sys.context({ id: "user:editor" });

    reset(ctx);
    const teammate = await ctx.can("payslips.read.team", ["user:viewer"]);
    console.log(
      "user:viewer (teammate) :",
      teammate.ok ? "OK" : "DENY",
    );

    reset(ctx);
    const myself = await ctx.can("payslips.read.team", ["user:editor"]);
    console.log(
      "user:editor (moi-même, dans la team) :",
      myself.ok ? "OK" : "DENY (auto-exclude)",
    );

    console.log("Attendu : OK / DENY (exclude self)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("CASE STUDY 3 — valider dépense ≤ payload.maxAmount");
  // ─────────────────────────────────────────────────────────────────────────
  // 2 grants: junior (≤500) et senior (illimité). On test sur expense:e1 (250)
  // et expense:e2 (1200).
  {
    const ctx = sys.context({ id: "user:editor" });

    reset(ctx);
    const small = await ctx.can("expenses.validate", ["expense:e1"]);
    console.log("e1 (250€) :", small.ok ? "OK" : "DENY");

    reset(ctx);
    const big = await ctx.can("expenses.validate", ["expense:e2"]);
    console.log("e2 (1200€) :", big.ok ? "OK (via senior grant)" : "DENY");

    // Test avec UNIQUEMENT le junior grant
    const onlyJunior: Provider = (_s, key) =>
      Promise.resolve(
        (grantsByKey[key] ?? []).filter((g) => g.id === "g-validate-junior"),
      );
    const sysJunior = createSystem({ schema, providers: [onlyJunior] });
    const ctxJ = sysJunior.context({ id: "user:editor" });

    reset(ctxJ);
    const smallJ = await ctxJ.can("expenses.validate", ["expense:e1"]);
    console.log("e1 (250€) en junior seul :", smallJ.ok ? "OK" : "DENY");

    reset(ctxJ);
    const bigJ = await ctxJ.can("expenses.validate", ["expense:e2"]);
    console.log(
      "e2 (1200€) en junior seul :",
      bigJ.ok ? "OK" : `DENY (${("reasons" in bigJ ? bigJ.reasons : []).join(", ")})`,
    );

    console.log("Attendu : OK / OK / OK / DENY");
  }

  // ─────────────────────────────────────────────────────────────────────────
  header("13. La rule introspection — descriptors visibles pour la matrix UI");
  // ─────────────────────────────────────────────────────────────────────────
  // Le frontend matrix peut lire les descriptors pour rendre le bon picker.
  {
    const ruleDescriptors = (
      schema["articles.update"] as Permission
    ).rules.map((r) => r.descriptor);
    console.log(
      "Rules de articles.update :",
      JSON.stringify(ruleDescriptors, null, 2),
    );
    console.log(
      "→ Le frontend voit { kind: 'require-owner', source: 'article', flag: 'ownerOnly' }",
    );
    console.log(
      "→ Il sait afficher un toggle 'Owner only' et un picker article",
    );
  }

  console.log("\n" + "=".repeat(72));
  console.log("  PoC done.");
  console.log("=".repeat(72));
}

await main();

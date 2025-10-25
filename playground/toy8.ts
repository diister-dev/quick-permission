type Subject = {
  id: string;
}

type Permission<C = undefined> = {
  type: "permission";
  fetchTarget?: (id: C) => Promise<any>;
}

type IntermediatePermission<C = undefined> = {
  type: "intermediate";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provide: (ctx: { subject: Subject, target: C }) => Array<{ subject: Subject, key: string, target?: any }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchTarget?: (id: C) => Promise<any>;
}

type ExtractContext<P> = P extends Permission<infer C> ? C : never;

function permission<C = undefined>(
  ...args: C extends undefined ? [] : [(id: C) => Promise<any>]
) : Permission<C> {
  return {
    type: "permission",
    fetchTarget: args[0],
  }
}

function intermediate<C = undefined>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provide: (ctx: { subject: Subject, target: C }) => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: C extends undefined ? [] : [(id: C) => Promise<any>]
) : IntermediatePermission<C> {
  return {
    type: "intermediate",
    provide,
    fetchTarget: args[0],
  }
}

type ArticleId = string;

async function getArticle(id: ArticleId) {
  return articles.find(a => a.id === id);
}

async function getArticleComment(ids: [ArticleId, string]) {
  const [articleId, commentId] = ids;
  return articlesComments.find(c => c.id === commentId && c.articleId === articleId);
}

const permissionsSchemas = {
  "article.create": permission(),
  "article.read": permission<ArticleId>(getArticle),
  "article.update": permission<ArticleId>(getArticle),
  "article.delete": permission<ArticleId>(getArticle),
  "article.manage": intermediate<ArticleId>((ctx) => {
    return [
      { ...ctx, key: "article.read" },
      { ...ctx, key: "article.update" },
      { ...ctx, key: "article.delete"},
      { ...ctx, key: "article.comment.manage", target: [ctx.target, "*"] }
    ]
  }, getArticle),
  "article.comment.create": permission<[ArticleId, string]>(getArticleComment),
  "article.comment.delete": permission<[ArticleId, string]>(getArticleComment),
  "article.comment.manage": intermediate<[ArticleId, string]>((ctx) => {
    return [
      { ...ctx, key: "article.comment.create"},
      { ...ctx, key: "article.comment.delete"},
    ]
  }, getArticleComment),
}

const articles = [
  { id: "article:1", owner: "user:1" },
  { id: "article:2", owner: "user:2" },
  { id: "article:3", owner: "user:3" },
]

const articlesComments = [
  { id: "comment:1", articleId: "article:1", owner: "user:2" },
  { id: "comment:2", articleId: "article:1", owner: "user:3" },
  { id: "comment:3", articleId: "article:2", owner: "user:1" },
]

const user1 = {
  id: "user:1",
}

const permSource0 = [
  {
    subject: user1,
    key: "article.create",
  }
]

type PermissionProvider = {
  provide: (subject: Subject, key: string, target?: any) => Promise<({
    subject: Subject;
    key: string;
    target?: any;
    [key: string]: any;
  })[]>;
}

function directProvider(source: any) : PermissionProvider {
  return {
    provide: async (subject: Subject, key: string, target?: any) => {
      return source.filter((entry: any) => {
        return entry.subject.id === subject.id && entry.key === key;
      });
    }
  }
}

/**
 * Match a requested path against a pattern with wildcard support
 *
 * @example
 * matchPath("article:123", "*") // true
 * matchPath("article:123", "article:*") // true
 * matchPath(["article:123", "comment:456"], ["article:*", "*"]) // true
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchPath(requested: any, pattern: any): boolean {
  // Wildcard complet
  if (pattern === "*") return true;

  // Même type primitif
  if (typeof requested !== 'object' && typeof pattern !== 'object') {
    // Pattern avec wildcard: "article:*" matches "article:123"
    if (typeof pattern === 'string' && pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return typeof requested === 'string' && requested.startsWith(prefix);
    }
    return requested === pattern;
  }

  // Matching de tableaux (pour les paths composés)
  if (Array.isArray(requested) && Array.isArray(pattern)) {
    if (requested.length !== pattern.length) return false;

    return requested.every((segment, i) =>
      matchPath(segment, pattern[i])
    );
  }

  // Types incompatibles
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ownerProvider(keys: string[], targetPattern: any): PermissionProvider {
  return {
    provide: async (subject: Subject) => {
      return keys.map(k => {
        return {
          subject,
          key: k,
          target: targetPattern,
          with: {
            owner: subject.id,
          }
        }
      });
    }
  }
}

function publicArticleProvider(): PermissionProvider {
  return {
    provide: async (subject, key, target) => {
      return [
        { key: "article.read", subject, target: "*", with: { public: true } },
        { key: "article.comment.create", subject, target: "*", with: { public: true } },
      ]
    }
  }
}

type PermissionSchemas = {
  [key: string]: Permission<any> | IntermediatePermission<any>;
}

type PermissionWithMetadata = {
  subject: Subject;
  key: string;
  target?: unknown;
  [key: string]: unknown;
}

// eslint-disable-next-line @typescript-eslint/ban-types
type PermissionRule<TState extends Record<string, unknown>, TRequest extends Record<string, unknown> = {}> = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  check: (
    state: PermissionWithMetadata & Partial<TState>,
    ctx: TRequest & {
      subject: Subject;
      key: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      target?: any;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    permission: Permission<any> | IntermediatePermission<any>
  ) => boolean | Promise<boolean>;
  default: () => TRequest;
}

// Type utility to merge all rule request contexts
type MergeRequestContexts<TRules extends readonly PermissionRule<any, any>[]> =
  TRules extends readonly [infer First, ...infer Rest]
    ? First extends PermissionRule<infer R1, any>
      ? Rest extends readonly PermissionRule<any, any>[]
        ? R1 & MergeRequestContexts<Rest>
        : R1
      : never
    : Record<string, any>;

// Type utility to merge all rule state contexts
type MergeStateContexts<TRules extends readonly PermissionRule<any, any>[]> =
  TRules extends readonly [infer First, ...infer Rest]
    ? First extends PermissionRule<any, infer S1>
      ? Rest extends readonly PermissionRule<any, any>[]
        ? S1 & MergeStateContexts<Rest>
        : S1
      : never
    : Record<string, any>;

// Helper functions to create typed rules
function TimeRule(): PermissionRule<{ startDate?: Date; endDate?: Date }, { checkDate: Date }> {
  return {
    name: "time",
    check: (state, ctx, _permission) => {
      const start = state.startDate;
      const end = state.endDate;
      if (start && ctx.checkDate < start) return false;
      if (end && ctx.checkDate > end) return false;
      return true;
    },
    default: () => ({ checkDate: new Date() }),
  };
}

function IpRule(): PermissionRule<{ allowedIps?: string[] }, { ips: string[] }> {
  return {
    name: "ip",
    check: (state, ctx, _permission) => {
      const allowed = state.allowedIps;
      if (!allowed?.length) return true;
      return ctx.ips.some((ip: string) => allowed.includes(ip));
    },
    default: () => ({ ips: [] }),
  };
}

function WithRule(): PermissionRule<
  { with?: Record<string, any> }
> {
  return {
    name: "with",
    check: async (state, ctx, permission) => {
      if (!state.with) return true; // No 'with' condition, allow

      // If we have a target and the permission has a resolver, fetch the resource
      if (ctx.target && permission.fetchTarget) {
        const resource = await permission.fetchTarget(ctx.target);

        // Check if resource matches all constraints in 'with'
        for (const [key, value] of Object.entries(state.with)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((resource as any)[key] !== value) {
            return false;
          }
        }
      }

      return true;
    },
    default: () => ({}),
  };
}

type PermissionSystemConfig<
  S extends PermissionSchemas,
  TRules extends readonly PermissionRule<any, any>[]
> = {
  schemas: S;
  sources: PermissionProvider[];
  rules?: TRules;
}

function createPermissionSystem<
  PS extends PermissionSchemas,
  TRules extends readonly PermissionRule<any, any>[]
>(
  config: PermissionSystemConfig<PS, TRules>
) {
  const { schemas: _schemas, sources: _sources, rules = [] } = config;

  async function defaultContext() : Promise<Partial<MergeRequestContexts<TRules>>> {
    const context: Partial<MergeRequestContexts<TRules>> = {};
    for (const rule of rules) {
      Object.assign(context, await rule.default());
    }
    return context;
  }

  async function checkPermission(
    subject: Subject,
    key: string,
    target: any,
    context: any,
  ) {
    return {
      ok: false,
    }
  }

  async function can<K extends keyof PS>(
    subject: Subject,
    key: K,
    ...args: PS[K] extends Permission<infer C> ? C extends undefined ? [] : [C] : []
  ) : Promise<{ ok: boolean }> {
    return checkPermission(
      subject,
      key as string,
      args[0],
      await defaultContext(),
    );
  }

  function withContext(context: Partial<MergeRequestContexts<TRules>>) {
    return {
      async can<K extends keyof PS>(
        subject: Subject,
        key: K,
        ...args: PS[K] extends Permission<infer C> ? C extends undefined ? [] : [C] : []
      ) : Promise<{ ok: boolean }> {
        return checkPermission(
          subject,
          key as string,
          args[0],
          { ...await defaultContext(), ...context },
        );
      }
    }
  }

  return {
    can,
    withContext,
  }
}

const permSystem = createPermissionSystem({
  schemas: permissionsSchemas,
  sources: [
    directProvider(permSource0),
    ownerProvider(["article.read", "article.update"], "article:*"),
    ownerProvider(["article.comment.delete"], ["article:*", "comment:*"]),
    publicArticleProvider(),
  ],
  rules: [
    TimeRule(),
    IpRule(),
    WithRule(),
  ] as const,
});

const { ok } = await permSystem.can(user1, "article.manage");
console.log("user1 can read article:", ok);

const checker = permSystem.withContext({
  checkDate: new Date("2024-01-01"),
})

const { ok: ok2 } = await checker.can(user1, "article.manage");
console.log("user1 can update article on 2024-01-01:", ok2);
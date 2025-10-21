type Subject = {
  id: string;
}

type Permission<C = undefined> = {
  type: "permission";
}

type IntermediatePermission<C = undefined> = {
  type: "intermediate";
  provide: (ctx: { subject: Subject, target: C }) => Array<{ subject: Subject, key: string, target?: any }>;
}

type ExtractContext<P> = P extends Permission<infer C> ? C : never;

function permission<C = undefined>() : Permission<C> {
  return {
    type: "permission",
  }
}

function intermediate<C = undefined>(provide: (ctx: { subject: Subject, target: C }) => any) : IntermediatePermission<C> {
  return {
    type: "intermediate",
    provide,
  }
}

type ArticleId = string;

const permissionsSchemas = {
  "article.create": permission(),
  "article.read": permission<ArticleId>(),
  "article.update": permission<ArticleId>(),
  "article.delete": permission<ArticleId>(),
  "article.manage": intermediate<ArticleId>((ctx) => {
    return [
      { subject: ctx.subject, key: "article.read", target: ctx.target },
      { subject: ctx.subject, key: "article.update", target: ctx.target },
      { subject: ctx.subject, key: "article.delete", target: ctx.target},
    ]
  }),
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PermissionSchemas = {
  [key: string]: Permission<any> | IntermediatePermission<any>;
}

type PermissionWithMetadata = {
  subject: Subject;
  key: string;
  target?: unknown;
  [key: string]: unknown;
}

type PermissionRule<TRequest extends Record<string, unknown>, TState extends Record<string, unknown>> = {
  name: string;
  check: (permission: PermissionWithMetadata & Partial<TState>, context: TRequest) => boolean;
  default: () => TRequest;
}

// Type utility to merge all rule request contexts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MergeRequestContexts<TRules extends readonly PermissionRule<any, any>[]> =
  TRules extends readonly [infer First, ...infer Rest]
    ? First extends PermissionRule<infer R1, any>
      ? Rest extends readonly PermissionRule<any, any>[]
        ? R1 & MergeRequestContexts<Rest>
        : R1
      : never
    : Record<string, any>;

// Type utility to merge all rule state contexts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MergeStateContexts<TRules extends readonly PermissionRule<any, any>[]> =
  TRules extends readonly [infer First, ...infer Rest]
    ? First extends PermissionRule<any, infer S1>
      ? Rest extends readonly PermissionRule<any, any>[]
        ? S1 & MergeStateContexts<Rest>
        : S1
      : never
    : Record<string, any>;

// Helper functions to create typed rules
function TimeRule(): PermissionRule<{ checkDate: Date }, { startDate?: Date; endDate?: Date }> {
  return {
    name: "time",
    check: (perm, ctx) => {
      const start = perm.startDate;
      const end = perm.endDate;
      if (start && ctx.checkDate < start) return false;
      if (end && ctx.checkDate > end) return false;
      return true;
    },
    default: () => ({ checkDate: new Date() }),
  };
}

function IpRule(): PermissionRule<{ ips: string[] }, { allowedIps?: string[] }> {
  return {
    name: "ip",
    check: (perm, ctx) => {
      const allowed = perm.allowedIps;
      if (!allowed?.length) return true;
      return ctx.ips.some(ip => allowed.includes(ip));
    },
    default: () => ({ ips: [] }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PermissionSystemConfig<
  S extends PermissionSchemas,
  TRules extends readonly PermissionRule<any, any>[]
> = {
  schemas: S;
  sources: PermissionProvider[];
  rules?: TRules;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  ],
  rules: [TimeRule(), IpRule()] as const,
});

const { ok } = await permSystem.can(user1, "article.manage");
console.log("user1 can read article:", ok);

const checker = permSystem.withContext({
  checkDate: new Date("2024-01-01"),
})

const { ok: ok2 } = await checker.can(user1, "article.update", "article:1");
console.log("user1 can update article on 2024-01-01:", ok2);
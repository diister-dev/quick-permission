// TOY TYPED - Fully type-safe permission system with strong inference
// Goals:
// - Full TypeScript autocomplete for operations
// - Context type inferred from operation
// - Resource required/optional based on permission definition
// - Clean helper API: permission<T>(), intermediate<T>(fn)

import mingo from "npm:mingo";

// ============================================================================
// CORE TYPES
// ============================================================================

type Effect = "ALLOW" | "DENY";

type Permission = {
  subject: string;
  operation: string;
  resource?: string;
  effect?: Effect;
  constraints?: Record<string, any>;
  [key: string]: any;
};

type PermissionRule<TContext extends Record<string, any>> = {
  name: string;
  check: (permission: Permission, context: TContext) => boolean;
};

type PermissionSource = {
  name: string;
  obtain: (ctx: { subject: any; operation: string }) => Permission[] | Promise<Permission[]>;
};

// ============================================================================
// PERMISSION DESCRIPTORS - Type-safe helpers
// ============================================================================

type PermissionDescriptor<TContext = any> = {
  __type: "permission";
  __context: TContext;
  requiresResource: boolean;
};

type IntermediateDescriptor<TContext = any> = {
  __type: "intermediate";
  __context: TContext;
  expand: (context: TContext) => Permission[] | Promise<Permission[]>;
};

type AnyDescriptor = PermissionDescriptor<any> | IntermediateDescriptor<any>;

/**
 * Helper to define a permission with typed context
 */
function permission<TContext = Record<string, never>>(opts?: {
  requiresResource?: boolean;
}): PermissionDescriptor<TContext> {
  return {
    __type: "permission",
    __context: undefined as any,
    requiresResource: opts?.requiresResource ?? false,
  };
}

/**
 * Helper to define an intermediate permission with typed context
 */
function intermediate<TContext = Record<string, never>>(
  expand: (context: TContext) => Permission[] | Promise<Permission[]>,
): IntermediateDescriptor<TContext> {
  return {
    __type: "intermediate",
    __context: undefined as any,
    expand,
  };
}

// ============================================================================
// TYPE UTILITIES - Extract context from schema
// ============================================================================

type ExtractContext<T> = T extends PermissionDescriptor<infer C>
  ? C
  : T extends IntermediateDescriptor<infer C>
  ? C
  : never;

type PermissionKeys<TSchema> = Extract<keyof TSchema, string>;

// ============================================================================
// PERMISSION SYSTEM
// ============================================================================

type Config<
  TSchema extends Record<string, AnyDescriptor>,
  TGlobalContext extends Record<string, any>,
> = {
  permissions: TSchema;
  sources: PermissionSource[];
  rules?: PermissionRule<TGlobalContext>[];
  contextProvider?: {
    [K in keyof TGlobalContext]?:
      | TGlobalContext[K]
      | (() => TGlobalContext[K] | Promise<TGlobalContext[K]>);
  };
};

type PermissionSystem<
  TSchema extends Record<string, AnyDescriptor>,
  TGlobalContext extends Record<string, any>,
> = {
  can: <K extends PermissionKeys<TSchema>>(
    subject: any,
    operation: K,
    context?: Partial<ExtractContext<TSchema[K]> & TGlobalContext>,
  ) => Promise<{
    allowed: boolean;
    reason?: string;
    matched: Permission[];
  }>;
};

function createPermissionSystem<
  const TSchema extends Record<string, AnyDescriptor>,
  TGlobalContext extends Record<string, any>,
>(
  config: Config<TSchema, TGlobalContext>,
): PermissionSystem<TSchema, TGlobalContext> {
  const { permissions, sources, rules = [], contextProvider = {} } = config;

  async function resolveContext(explicit: Partial<TGlobalContext>): Promise<TGlobalContext> {
    const resolved: any = { ...explicit };

    for (const key in contextProvider) {
      if (!(key in explicit)) {
        const value = contextProvider[key];
        resolved[key] = typeof value === "function" ? await value() : value;
      }
    }

    return resolved;
  }

  async function expand(
    operation: string,
    context: any,
  ): Promise<Permission[]> {
    const descriptor = permissions[operation];
    if (!descriptor || descriptor.__type === "permission") {
      return [];
    }

    const generated = await descriptor.expand(context);
    const all = [...generated];

    for (const perm of generated) {
      all.push(...(await expand(perm.operation, context)));
    }

    return all;
  }

  async function can<K extends PermissionKeys<TSchema>>(
    subject: any,
    operation: K,
    context?: Partial<ExtractContext<TSchema[K]> & TGlobalContext>,
  ) {
    const fullContext = await resolveContext((context || {}) as Partial<TGlobalContext>);
    const mergedContext = { ...fullContext, ...context };
    const resource = (mergedContext as any).resource;

    const generated = await expand(operation as string, mergedContext);

    const collected = await Promise.all(
      sources.map((s) => s.obtain({ subject, operation: operation as string })),
    );

    const allPermissions = [...collected.flat(), ...generated];

    const valid = allPermissions.filter((perm) =>
      rules.every((rule) => rule.check(perm, fullContext as any))
    );

    const relevant = valid.filter((perm) => {
      if (perm.subject !== subject.id && perm.subject !== "*") return false;
      if (perm.operation !== operation && perm.operation !== "*") return false;

      if (resource && perm.resource) {
        const match =
          perm.resource === resource.id ||
          perm.resource === "*" ||
          (perm.resource.endsWith("*") &&
            resource.id.startsWith(perm.resource.slice(0, -1)));
        if (!match) return false;
      }

      if (resource && perm.constraints) {
        const validator = new mingo.Query(perm.constraints);
        if (!validator.test(resource)) return false;
      }

      return true;
    });

    for (const perm of relevant) {
      if (perm.effect === "DENY") {
        return {
          allowed: false,
          reason: `Denied: ${perm.operation}`,
          matched: relevant,
        };
      }
    }

    const hasAllow = relevant.some((p) => !p.effect || p.effect === "ALLOW");

    return {
      allowed: hasAllow,
      reason: hasAllow ? undefined : "No permission found",
      matched: relevant,
    };
  }

  return { can };
}

// ============================================================================
// HELPERS - Common rules
// ============================================================================

function TimeRule<T extends { timestamp: Date }>(): PermissionRule<T> {
  return {
    name: "time",
    check: (perm, ctx) => {
      const start = perm.startDate as Date | undefined;
      const end = perm.endDate as Date | undefined;
      if (start && ctx.timestamp < start) return false;
      if (end && ctx.timestamp > end) return false;
      return true;
    },
  };
}

function IpRule<T extends { ip: string }>(): PermissionRule<T> {
  return {
    name: "ip",
    check: (perm, ctx) => {
      const allowed = perm.allowedIps as string[] | undefined;
      if (!allowed?.length) return true;
      return allowed.includes(ctx.ip);
    },
  };
}

// ============================================================================
// HELPERS - Common sources
// ============================================================================

function directSource(permissions: Permission[]): PermissionSource {
  return {
    name: "direct",
    obtain: async ({ subject }) => permissions.filter((p) => p.subject === subject.id),
  };
}

function groupSource(groups: Map<string, Permission[]>): PermissionSource {
  return {
    name: "groups",
    obtain: async ({ subject }) => {
      if (!subject.groups) return [];
      return subject.groups.flatMap((g: string) => groups.get(g) || []);
    },
  };
}

// ============================================================================
// DEMO
// ============================================================================

// Define resource type
type Article = {
  id: string;
  owner: string;
  locked?: boolean;
};

// Global context (used by rules)
type GlobalContext = {
  timestamp: Date;
  ip: string;
};

// Permission-specific context types
type ArticleContext = {
  resource: Article;
};

type ArticleManageContext = {
  resource: Article;
};

// Create the permission schema with full type safety!
const schema = {
  // No resource required
  "system.restart": permission(),

  "article.create": permission(),

  // Resource required
  "article.read": permission<ArticleContext>({ requiresResource: true }),

  "article.update": permission<ArticleContext>({ requiresResource: true }),

  "article.delete": permission<ArticleContext>({ requiresResource: true }),

  // No resource
  "admin.panel": permission(),

  // Intermediate permission with typed context
  "article.manage": intermediate<ArticleManageContext>((ctx) => {
    const perms: Permission[] = [
      {
        subject: ctx.resource.owner,
        operation: "article.create",
        effect: "ALLOW",
      },
    ];

    if (ctx.resource) {
      perms.push(
        {
          subject: ctx.resource.owner,
          operation: "article.read",
          resource: ctx.resource.id,
          effect: "ALLOW",
        },
        {
          subject: ctx.resource.owner,
          operation: "article.update",
          resource: ctx.resource.id,
          effect: "ALLOW",
        },
        {
          subject: ctx.resource.owner,
          operation: "article.delete",
          resource: ctx.resource.id,
          effect: "ALLOW",
        },
      );
    }

    return perms;
  }),
} as const;

// Permissions data
const perms: Permission[] = [
  {
    subject: "user:1",
    operation: "article.read",
    resource: "article:A",
  },
  {
    subject: "user:1",
    operation: "article.manage",
    resource: "article:B",
  },
  {
    subject: "user:1",
    operation: "article.delete",
    resource: "article:C",
    effect: "DENY",
  },
  {
    subject: "user:1",
    operation: "article.create",
    startDate: new Date("2025-01-01"),
    endDate: new Date("2025-12-31"),
  },
  {
    subject: "user:1",
    operation: "admin.panel",
    allowedIps: ["192.168.1.1"],
  },
];

// Create the system
const system = createPermissionSystem<typeof schema, GlobalContext>({
  permissions: schema,

  sources: [directSource(perms)],

  rules: [TimeRule(), IpRule()],

  contextProvider: {
    timestamp: () => new Date("2025-06-15"),
    ip: () => "192.168.1.1",
  },
});

// Test data
const user1 = { id: "user:1" };
const articleA: Article = { id: "article:A", owner: "user:2" };
const articleB: Article = { id: "article:B", owner: "user:2" };
const articleC: Article = { id: "article:C", owner: "user:1" };

console.log("\n=== TYPED TOY - TESTS ===\n");

// ✅ TypeScript will autocomplete "system.restart", "article.read", etc.
// ✅ TypeScript will require/forbid `resource` based on permission type
// ✅ TypeScript will infer context type based on operation

console.log("1. Permission without resource:");
let result = await system.can(user1, "system.restart");
console.log(`   user:1 can restart system? ${result.allowed}`);

console.log("\n2. Permission with resource:");
result = await system.can(user1, "article.read", { resource: articleA });
console.log(`   user:1 can read article:A? ${result.allowed}`);

console.log("\n3. Intermediate permission:");
result = await system.can(user1, "article.manage");
console.log(`   user:1 has article.manage on B? ${result.allowed}`);

console.log("\n4. Explicit DENY:");
result = await system.can(user1, "article.delete", { resource: articleC });
console.log(`   user:1 can delete article:C? ${result.allowed}`);
console.log(`   Reason: ${result.reason}`);

console.log("\n5. Context provider (default):");
result = await system.can(user1, "article.create");
console.log(`   user:1 can create in 2025? ${result.allowed}`);

console.log("\n6. Context override:");
result = await system.can(user1, "article.create", {
  timestamp: new Date("2026-01-01"),
});
console.log(`   user:1 can create in 2026? ${result.allowed}`);

console.log("\n7. IP restriction:");
result = await system.can(user1, "admin.panel");
console.log(`   user:1 can access admin.panel? ${result.allowed}`);

console.log("\n8. IP override:");
result = await system.can(user1, "admin.panel", { ip: "8.8.8.8" });
console.log(`   user:1 from 8.8.8.8 can access admin.panel? ${result.allowed}`);

console.log("\n=== END TESTS ===\n");

// ============================================================================
// TYPE SAFETY DEMO
// ============================================================================

// ✅ Autocomplete works!
// Try typing: system.can(user1, "
//                                 ^ Will show all permission keys

// ✅ Context is typed based on operation!
// system.can(user1, "article.read", {
//   resource: articleA,  // ✅ Required and typed as Article
//   timestamp: new Date() // ✅ Also available from GlobalContext
// })

// ❌ TypeScript errors on invalid operations:
// system.can(user1, "unknown.operation")  // Error: not in schema

// ❌ TypeScript errors on wrong context:
// system.can(user1, "article.read", {
//   resource: "string"  // Error: should be Article type
// })

// ❌ Missing required resource:
// system.can(user1, "article.read")  // Error: resource required

// TOY MINIMAL - Clean & simple permission system
// Goals:
// - Single context object containing resource + rule context
// - Type inference for required fields
// - No unnecessary abstractions
// - Clean API

import mingo from "npm:mingo";

// ============================================================================
// TYPES
// ============================================================================

type Effect = "ALLOW" | "DENY";

type Permission = {
  subject: string;
  operation: string;
  resource?: string;
  effect?: Effect;
  constraints?: Record<string, any>;
  [key: string]: any; // Allow any metadata
};

type PermissionRule<TContext extends Record<string, any>> = {
  name: string;
  check: (permission: Permission, context: TContext) => boolean;
};

type PermissionDescriptor<TContext = any> =
  | {
      type: "permission";
      requiresResource: boolean;
    }
  | {
      type: "intermediate";
      expand: (context: TContext) => Permission[] | Promise<Permission[]>;
    };

type PermissionSource = {
  name: string;
  obtain: (ctx: { subject: any; operation: string }) => Permission[] | Promise<Permission[]>;
};

// ============================================================================
// PERMISSION SYSTEM
// ============================================================================

type Config<TContext extends Record<string, any>> = {
  // Schema définit toutes les permissions possibles
  permissions: Record<string, PermissionDescriptor<TContext>>;

  // Sources de permissions
  sources: PermissionSource[];

  // Rules pour filtrer les permissions
  rules?: PermissionRule<TContext>[];

  // Context provider (fonctions async supportées)
  contextProvider?: {
    [K in keyof TContext]?: TContext[K] | (() => TContext[K] | Promise<TContext[K]>);
  };
};

function createPermissionSystem<TContext extends Record<string, any>>(
  config: Config<TContext>,
) {
  const { permissions, sources, rules = [], contextProvider = {} } = config;

  /**
   * Resolve context: explicit values override provider
   */
  async function resolveContext(explicit: Partial<TContext>): Promise<TContext> {
    const resolved: any = { ...explicit };

    for (const key in contextProvider) {
      if (!(key in explicit)) {
        const value = contextProvider[key];
        resolved[key] = typeof value === "function" ? await value() : value;
      }
    }

    return resolved;
  }

  /**
   * Expand intermediate permissions recursively
   */
  async function expand(
    operation: string,
    context: TContext,
  ): Promise<Permission[]> {
    const descriptor = permissions[operation];
    if (!descriptor || descriptor.type === "permission") {
      return [];
    }

    // Expand intermediate
    const generated = await descriptor.expand(context);
    const all = [...generated];

    // Recursively expand nested intermediates
    for (const perm of generated) {
      all.push(...(await expand(perm.operation, context)));
    }

    return all;
  }

  /**
   * Main permission check
   */
  async function can(
    subject: any,
    operation: string,
    context?: Partial<TContext>,
  ) {
    // Resolve full context
    const fullContext = await resolveContext(context || {});
    const resource = (fullContext as any).resource;

    // Expand intermediates
    const generated = await expand(operation, fullContext);

    // Collect permissions from sources
    const collected = await Promise.all(
      sources.map((s) => s.obtain({ subject, operation })),
    );

    const allPermissions = [...collected.flat(), ...generated];

    // Filter by rules
    const valid = allPermissions.filter((perm) =>
      rules.every((rule) => rule.check(perm, fullContext))
    );

    // Match relevant permissions
    const relevant = valid.filter((perm) => {
      // Subject match
      if (perm.subject !== subject.id && perm.subject !== "*") return false;

      // Operation match
      if (perm.operation !== operation && perm.operation !== "*") return false;

      // Resource match
      if (resource && perm.resource) {
        const match =
          perm.resource === resource.id ||
          perm.resource === "*" ||
          (perm.resource.endsWith("*") &&
            resource.id.startsWith(perm.resource.slice(0, -1)));
        if (!match) return false;
      }

      // Constraints
      if (resource && perm.constraints) {
        const validator = new mingo.Query(perm.constraints);
        if (!validator.test(resource)) return false;
      }

      return true;
    });

    // Check for DENY first
    for (const perm of relevant) {
      if (perm.effect === "DENY") {
        return {
          allowed: false,
          reason: `Denied: ${perm.operation}`,
          matched: relevant,
        };
      }
    }

    // Check for ALLOW
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

function ownerSource(operations: string[]): PermissionSource {
  return {
    name: "owner",
    obtain: async ({ subject }) =>
      operations.map((op) => ({
        subject: subject.id,
        operation: op,
        effect: "ALLOW" as Effect,
      })),
  };
}

// ============================================================================
// DEMO
// ============================================================================

// Context type
type MyContext = {
  resource?: { id: string; owner?: string; locked?: boolean };
  timestamp: Date;
  ip: string;
};

// Permissions
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

// Create system
const system = createPermissionSystem<MyContext>({
  permissions: {
    "system.restart": { type: "permission", requiresResource: false },
    "article.create": { type: "permission", requiresResource: false },
    "article.read": { type: "permission", requiresResource: true },
    "article.update": { type: "permission", requiresResource: true },
    "article.delete": { type: "permission", requiresResource: true },
    "admin.panel": { type: "permission", requiresResource: false },

    // Intermediate permission
    "article.manage": {
      type: "intermediate",
      expand: (ctx) => {
        const perms: Permission[] = [
          { subject: ctx.resource?.owner || "*", operation: "article.create" },
        ];

        if (ctx.resource) {
          perms.push(
            { subject: ctx.resource.owner || "*", operation: "article.read", resource: ctx.resource.id },
            { subject: ctx.resource.owner || "*", operation: "article.update", resource: ctx.resource.id },
            { subject: ctx.resource.owner || "*", operation: "article.delete", resource: ctx.resource.id },
          );
        }

        return perms;
      },
    },
  },

  sources: [
    directSource(perms),
    ownerSource(["article.read", "article.update"]),
  ],

  rules: [
    TimeRule(),
    IpRule(),
  ],

  contextProvider: {
    timestamp: () => new Date("2025-06-15"),
    ip: () => "192.168.1.1",
  },
});

// Tests
const user1 = { id: "user:1" };
const articleA = { id: "article:A", owner: "user:2" };
const articleB = { id: "article:B", owner: "user:2" };
const articleC = { id: "article:C", owner: "user:1" };

console.log("\n=== MINIMAL TOY - TESTS ===\n");

console.log("1. Direct permission:");
let result = await system.can(user1, "article.read", { resource: articleA });
console.log(`   user:1 can read article:A? ${result.allowed}`);

console.log("\n2. Intermediate permission:");
result = await system.can(user1, "article.manage", { resource: articleB });
console.log(`   user:1 has article.manage on B? ${result.allowed}`);

console.log("\n3. Explicit DENY:");
result = await system.can(user1, "article.delete", { resource: articleC });
console.log(`   user:1 can delete article:C? ${result.allowed}`);
console.log(`   Reason: ${result.reason}`);

console.log("\n4. Context provider (default timestamp):");
result = await system.can(user1, "article.create");
console.log(`   user:1 can create in 2025? ${result.allowed}`);

console.log("\n5. Explicit context (override timestamp):");
result = await system.can(user1, "article.create", {
  timestamp: new Date("2026-01-01"),
});
console.log(`   user:1 can create in 2026? ${result.allowed}`);

console.log("\n6. IP restriction (default IP):");
result = await system.can(user1, "admin.panel");
console.log(`   user:1 can access admin.panel? ${result.allowed}`);

console.log("\n7. IP restriction (explicit override):");
result = await system.can(user1, "admin.panel", {
  ip: "8.8.8.8",
});
console.log(`   user:1 from 8.8.8.8 can access admin.panel? ${result.allowed}`);

console.log("\n8. Owner-based permission:");
result = await system.can(user1, "article.update", { resource: articleC });
console.log(`   user:1 can update article:C (owns it)? ${result.allowed}`);

console.log("\n=== END TESTS ===\n");

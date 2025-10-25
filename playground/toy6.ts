// TOY 6 - Fully declarative permission system with async context & dynamic intermediates
// Goals:
// - Permission descriptors with types ("permission" | "intermediate")
// - Async context provider functions
// - Async intermediate permission generators
// - Full type inference and safety

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
  metadata?: Record<string, any>;
};

// ============================================================================
// RULE SYSTEM
// ============================================================================

type PermissionRule<TContext extends Record<string, any> = Record<string, any>> = {
  name: string;
  contextSchema: TContext;
  check: (permission: Permission, context: TContext) => boolean;
};

function createRule<TContext extends Record<string, any>>(
  name: string,
  contextSchema: TContext,
  check: (permission: Permission, context: TContext) => boolean,
): PermissionRule<TContext> {
  return { name, contextSchema, check };
}

function TimeConstraintRule() {
  return createRule(
    "TimeConstraint",
    { timestamp: new Date() } as const,
    (permission, context) => {
      const now = context.timestamp;
      const startDate = permission.metadata?.startDate as Date | undefined;
      const endDate = permission.metadata?.endDate as Date | undefined;

      if (startDate && now < startDate) return false;
      if (endDate && now > endDate) return false;

      return true;
    },
  );
}

function IpRestrictionRule() {
  return createRule(
    "IpRestriction",
    { ip: "" } as const,
    (permission, context) => {
      const allowedIps = permission.metadata?.allowedIps as string[] | undefined;
      if (!allowedIps || allowedIps.length === 0) return true;
      return allowedIps.includes(context.ip);
    },
  );
}

function FeatureFlagRule(flags: Map<string, boolean>) {
  return createRule(
    "FeatureFlag",
    {} as const,
    (permission, _context) => {
      const requiredFlag = permission.metadata?.featureFlag as string | undefined;
      if (!requiredFlag) return true;
      return flags.get(requiredFlag) === true;
    },
  );
}

// ============================================================================
// TYPE UTILITIES
// ============================================================================

type MergeContexts<TRules extends readonly PermissionRule<any>[]> =
  TRules extends readonly [infer First, ...infer Rest]
    ? First extends PermissionRule<infer C1>
      ? Rest extends readonly PermissionRule<any>[]
        ? C1 & MergeContexts<Rest>
        : C1
      : never
    : Record<string, never>;

// ============================================================================
// PERMISSION DESCRIPTORS
// ============================================================================

type PermissionDescriptor = {
  type: "permission";
  requiresResource: boolean;
  description?: string;
};

type IntermediatePermissionDescriptor<TContext = any> = {
  type: "intermediate";
  description?: string;
  /**
   * Dynamically generates permissions based on the request context
   */
  expand: (context: {
    subject: any;
    resource?: any;
    ruleContext: TContext;
  }) => Promise<Permission[]> | Permission[];
};

type PermissionSchema = Record<
  string,
  PermissionDescriptor | IntermediatePermissionDescriptor
>;

// ============================================================================
// PERMISSION SOURCES
// ============================================================================

type PermissionSource = {
  name: string;
  obtain: (context: { subject: any; operation: string; resource?: any }) => Promise<Permission[]>;
};

function directPermissionSource(permissions: Permission[]): PermissionSource {
  return {
    name: "direct",
    obtain: async (context) => {
      return permissions.filter((p) => p.subject === context.subject.id);
    },
  };
}

function groupPermissionSource(
  groupPermissions: Map<string, Permission[]>,
): PermissionSource {
  return {
    name: "groups",
    obtain: async (context) => {
      if (!context.subject.groups) return [];

      const permissions: Permission[] = [];
      for (const groupId of context.subject.groups) {
        const groupPerms = groupPermissions.get(groupId) || [];
        permissions.push(...groupPerms);
      }
      return permissions;
    },
  };
}

function ownershipPermissionSource(
  allowedOperations: string[],
): PermissionSource {
  return {
    name: "ownership",
    obtain: async (context) => {
      if (!context.resource || !context.resource.owner) return [];

      if (context.subject.id === context.resource.owner) {
        return allowedOperations.map((op) => ({
          subject: context.subject.id,
          operation: op,
          resource: context.resource.id,
          effect: "ALLOW" as Effect,
        }));
      }

      return [];
    },
  };
}

// ============================================================================
// CONTEXT PROVIDER
// ============================================================================

type ContextProvider<TContext> = {
  [K in keyof TContext]: TContext[K] | (() => TContext[K]) | (() => Promise<TContext[K]>);
};

async function resolveContext<TContext>(
  provider: Partial<ContextProvider<TContext>>,
  explicit: Partial<TContext>,
): Promise<TContext> {
  const resolved: any = { ...explicit };

  for (const key in provider) {
    if (!(key in explicit)) {
      const value = provider[key];
      if (typeof value === "function") {
        resolved[key] = await value();
      } else {
        resolved[key] = value;
      }
    }
  }

  return resolved as TContext;
}

// ============================================================================
// PERMISSION SYSTEM
// ============================================================================

type PermissionSystemConfig<TRules extends readonly PermissionRule<any>[]> = {
  schema: PermissionSchema;
  sources: PermissionSource[];
  defaults?: Permission[];
  rules: TRules;
  contextProvider?: Partial<ContextProvider<MergeContexts<TRules>>>;
};

type PermissionSystem<TRules extends readonly PermissionRule<any>[]> = {
  can: (
    subject: any,
    operation: string,
    resource?: any,
    context?: Partial<MergeContexts<TRules>>,
  ) => Promise<{
    allowed: boolean;
    reason?: string;
    matchedPermissions?: Permission[];
    filteredCount?: number;
    expandedPermissions?: Permission[];
  }>;
};

function createPermissionSystem<const TRules extends readonly PermissionRule<any>[]>(
  config: PermissionSystemConfig<TRules>,
): PermissionSystem<TRules> {
  const { schema, sources, defaults = [], rules, contextProvider = {} } = config;

  /**
   * Expand intermediate permissions recursively
   */
  async function expandOperation(
    operation: string,
    context: {
      subject: any;
      resource?: any;
      ruleContext: MergeContexts<TRules>;
    },
  ): Promise<{ operations: string[]; generatedPermissions: Permission[] }> {
    const descriptor = schema[operation];

    if (!descriptor) {
      // Unknown operation, treat as regular permission
      return { operations: [operation], generatedPermissions: [] };
    }

    if (descriptor.type === "permission") {
      return { operations: [operation], generatedPermissions: [] };
    }

    // Intermediate permission - expand it
    const generatedPermissions = await descriptor.expand(context);
    const allOperations = [operation];
    const allGenerated = [...generatedPermissions];

    // Recursively expand generated permissions
    for (const perm of generatedPermissions) {
      const expanded = await expandOperation(perm.operation, context);
      allOperations.push(...expanded.operations);
      allGenerated.push(...expanded.generatedPermissions);
    }

    return {
      operations: [...new Set(allOperations)],
      generatedPermissions: allGenerated,
    };
  }

  /**
   * Main permission check
   */
  async function can(
    subject: any,
    operation: string,
    resource?: any,
    explicitContext?: Partial<MergeContexts<TRules>>,
  ) {
    // Resolve context: explicit > provider (with async support)
    const fullContext = await resolveContext(
      contextProvider as Partial<ContextProvider<MergeContexts<TRules>>>,
      explicitContext || {},
    );

    // 1. Expand intermediate permissions
    const { operations: resolvedOperations, generatedPermissions } = await expandOperation(
      operation,
      { subject, resource, ruleContext: fullContext },
    );

    // 2. Collect permissions from all sources
    const allPermissions: Permission[] = [
      ...defaults,
      ...generatedPermissions, // Add generated permissions from intermediates
      ...(await Promise.all(sources.map((s) => s.obtain({ subject, operation, resource })))).flat(),
    ];

    // 3. Apply rules to filter permissions
    const initialCount = allPermissions.length;
    const validPermissions = allPermissions.filter((perm) =>
      rules.every((rule) => rule.check(perm, fullContext as any))
    );
    const filteredCount = initialCount - validPermissions.length;

    // 4. Filter relevant permissions
    const relevantPermissions = validPermissions.filter((perm) => {
      // Subject match
      if (perm.subject !== subject.id && perm.subject !== "*") return false;

      // Operation match (check against all resolved operations)
      if (!resolvedOperations.includes(perm.operation) && perm.operation !== "*") {
        return false;
      }

      return true;
    });

    // 5. Process permissions: DENY > ALLOW
    let hasAllow = false;
    const matchedPermissions: Permission[] = [];

    for (const perm of relevantPermissions) {
      // Resource match
      if (resource && perm.resource) {
        const resourceMatch =
          perm.resource === resource.id ||
          perm.resource === "*" ||
          (perm.resource.endsWith("*") && resource.id.startsWith(perm.resource.slice(0, -1)));

        if (!resourceMatch) continue;
      }

      // Constraints (MongoDB-style queries)
      if (resource && perm.constraints) {
        const validator = new mingo.Query(perm.constraints);
        if (!validator.test(resource)) continue;
      }

      matchedPermissions.push(perm);

      // DENY has absolute priority
      if (perm.effect === "DENY") {
        return {
          allowed: false,
          reason: `Explicitly denied: ${perm.operation} on ${perm.resource || "any"}`,
          matchedPermissions,
          filteredCount,
          expandedPermissions: generatedPermissions,
        };
      }

      // Track ALLOW
      if (!perm.effect || perm.effect === "ALLOW") {
        hasAllow = true;
      }
    }

    // 6. Final decision
    if (hasAllow) {
      return { allowed: true, matchedPermissions, filteredCount, expandedPermissions: generatedPermissions };
    }

    return {
      allowed: false,
      reason: "No matching permission found",
      matchedPermissions: [],
      filteredCount,
      expandedPermissions: generatedPermissions,
    };
  }

  return { can };
}

// ============================================================================
// DEMO / TESTS
// ============================================================================

// Feature flags
const featureFlags = new Map([
  ["beta-enabled", true],
  ["experimental", false],
]);

// Permissions storage
const directPerms: Permission[] = [
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
    metadata: {
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-12-31"),
    },
  },
  {
    subject: "user:1",
    operation: "admin.panel",
    metadata: {
      allowedIps: ["192.168.1.1", "10.0.0.1"],
    },
  },
];

const groupPerms = new Map<string, Permission[]>([
  [
    "group:admin",
    [
      { subject: "*", operation: "system.restart", effect: "ALLOW" },
      { subject: "*", operation: "article.delete", resource: "article:*", effect: "ALLOW" },
    ],
  ],
]);

// Permission schema with intermediates
const permissionSchema: PermissionSchema = {
  "system.restart": {
    type: "permission",
    requiresResource: false,
    description: "Restart the system",
  },
  "article.create": {
    type: "permission",
    requiresResource: false,
    description: "Create a new article",
  },
  "article.read": {
    type: "permission",
    requiresResource: true,
    description: "Read an article",
  },
  "article.update": {
    type: "permission",
    requiresResource: true,
    description: "Update an article",
  },
  "article.delete": {
    type: "permission",
    requiresResource: true,
    description: "Delete an article",
  },
  "admin.panel": {
    type: "permission",
    requiresResource: false,
    description: "Access admin panel",
  },
  // Intermediate permission - dynamically generates permissions
  "article.manage": {
    type: "intermediate",
    description: "Full management access to an article",
    expand: async (context) => {
      // Generate permissions based on context
      const permissions: Permission[] = [
        {
          subject: context.subject.id,
          operation: "article.create",
          effect: "ALLOW",
        },
      ];

      // Resource-specific permissions
      if (context.resource) {
        permissions.push(
          {
            subject: context.subject.id,
            operation: "article.read",
            resource: context.resource.id,
            effect: "ALLOW",
          },
          {
            subject: context.subject.id,
            operation: "article.update",
            resource: context.resource.id,
            effect: "ALLOW",
          },
          {
            subject: context.subject.id,
            operation: "article.delete",
            resource: context.resource.id,
            effect: "ALLOW",
          },
        );
      }

      return permissions;
    },
  },
  // Another intermediate - admin full access
  "admin.full": {
    type: "intermediate",
    description: "Full admin access",
    expand: async (context) => {
      return [
        {
          subject: context.subject.id,
          operation: "system.restart",
          effect: "ALLOW",
        },
        {
          subject: context.subject.id,
          operation: "article.manage", // Can reference other intermediates!
          resource: context.resource?.id,
          effect: "ALLOW",
        },
      ];
    },
  },
};

// Create permission system with async context provider
const permSystem = createPermissionSystem({
  schema: permissionSchema,
  sources: [
    directPermissionSource(directPerms),
    groupPermissionSource(groupPerms),
    ownershipPermissionSource(["article.read", "article.update"]),
  ],
  rules: [
    TimeConstraintRule(),
    IpRestrictionRule(),
    FeatureFlagRule(featureFlags),
  ] as const,
  contextProvider: {
    // Async functions!
    timestamp: async () => {
      // Could fetch from NTP server, etc.
      return new Date("2025-06-15");
    },
    ip: () => {
      // Could extract from request headers, etc.
      return "192.168.1.1";
    },
  },
});

// Test data
const user1 = { id: "user:1", groups: ["group:admin"] };
const articleA = { id: "article:A", owner: "user:2" };
const articleB = { id: "article:B", owner: "user:2" };
const articleC = { id: "article:C", owner: "user:1" };

// Run tests
console.log("\n=== TOY 6 - DECLARATIVE PERMISSION TESTS ===\n");

console.log("1. Direct permission:");
const test1 = await permSystem.can(user1, "article.read", articleA);
console.log(`   ✓ user:1 can read article:A? ${test1.allowed}`);

console.log("\n2. Intermediate permission (article.manage) - dynamic expansion:");
const test2 = await permSystem.can(user1, "article.manage", articleB);
console.log(`   ✓ user:1 has article.manage on article:B? ${test2.allowed}`);
console.log(`   Generated permissions:`, test2.expandedPermissions?.length);
console.log(`   Expanded operations:`, test2.expandedPermissions?.map((p) => p.operation));

console.log("\n3. Check specific operation via intermediate:");
const test3 = await permSystem.can(user1, "article.delete", articleB);
console.log(`   ✓ user:1 can delete article:B (via manage)? ${test3.allowed}`);

console.log("\n4. Explicit DENY overrides intermediate:");
const test4 = await permSystem.can(user1, "article.delete", articleC);
console.log(`   ✗ user:1 can delete article:C? ${test4.allowed}`);
console.log(`   Reason: ${test4.reason}`);

console.log("\n5. Async context provider (default):");
const test5 = await permSystem.can(user1, "article.create");
console.log(`   ✓ user:1 can create article (async timestamp)? ${test5.allowed}`);

console.log("\n6. Explicit context override:");
const test6 = await permSystem.can(user1, "article.create", undefined, {
  timestamp: new Date("2026-01-01"),
});
console.log(`   ✗ user:1 can create article in 2026? ${test6.allowed}`);
console.log(`   Filtered by rules: ${test6.filteredCount} permissions`);

console.log("\n7. IP restriction with async provider:");
const test7 = await permSystem.can(user1, "admin.panel");
console.log(`   ✓ user:1 can access admin.panel (async IP)? ${test7.allowed}`);

console.log("\n8. Nested intermediate (admin.full -> article.manage):");
const test8 = await permSystem.can(user1, "admin.full", articleA);
console.log(`   ✓ user:1 has admin.full on article:A? ${test8.allowed}`);
console.log(`   Generated permissions:`, test8.expandedPermissions?.length);

console.log("\n=== END TESTS ===\n");

// TOY 5 - Fully type-safe permission system with context inference
// Goals:
// - Pure functions (no classes)
// - RuleContext inferred from rules
// - Resource optional/required based on permission definition
// - Context provider with explicit override
// - DENY support, intermediate permissions, modular sources

import mingo from "npm:mingo";

// ============================================================================
// CORE TYPES
// ============================================================================

type Effect = "ALLOW" | "DENY";

type Permission<TResource extends string | undefined = string | undefined> = {
  subject: string;
  operation: string;
  resource?: TResource;
  effect?: Effect;
  constraints?: Record<string, any>;
  metadata?: Record<string, any>;
};

// ============================================================================
// RULE SYSTEM - Type-safe rules with context inference
// ============================================================================

type PermissionRule<TContext extends Record<string, any> = Record<string, any>> = {
  name: string;
  /**
   * Defines the context shape required by this rule
   */
  contextSchema: TContext;
  /**
   * Checks if a permission is valid in the current context
   */
  check: (permission: Permission, context: TContext) => boolean;
};

/**
 * Helper to create a typed rule
 */
function createRule<TContext extends Record<string, any>>(
  name: string,
  contextSchema: TContext,
  check: (permission: Permission, context: TContext) => boolean,
): PermissionRule<TContext> {
  return { name, contextSchema, check };
}

/**
 * Time constraint rule
 */
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

/**
 * IP restriction rule
 */
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

/**
 * Feature flag rule
 */
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
// TYPE UTILITIES - Infer context from rules
// ============================================================================

type ExtractRuleContext<T> = T extends PermissionRule<infer C> ? C : never;

type MergeContexts<TRules extends readonly PermissionRule<any>[]> =
  TRules extends readonly [infer First, ...infer Rest]
    ? First extends PermissionRule<infer C1>
      ? Rest extends readonly PermissionRule<any>[]
        ? C1 & MergeContexts<Rest>
        : C1
      : never
    : Record<string, never>;

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
// PERMISSION SYSTEM - Main logic
// ============================================================================

type IntermediatePermissions = Record<string, string[]>;

type PermissionSystemConfig<TRules extends readonly PermissionRule<any>[]> = {
  sources: PermissionSource[];
  defaults?: Permission[];
  intermediates?: IntermediatePermissions;
  rules: TRules;
  contextProvider?: Partial<MergeContexts<TRules>>;
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
  }>;
};

function createPermissionSystem<const TRules extends readonly PermissionRule<any>[]>(
  config: PermissionSystemConfig<TRules>,
): PermissionSystem<TRules> {
  const { sources, defaults = [], intermediates = {}, rules, contextProvider = {} } = config;

  /**
   * Resolve intermediate permissions recursively
   */
  function resolveOperation(operation: string): string[] {
    const operations = [operation];

    if (intermediates[operation]) {
      for (const grantedOp of intermediates[operation]) {
        if (grantedOp === "*") return ["*"];
        operations.push(...resolveOperation(grantedOp));
      }
    }

    return [...new Set(operations)];
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
    // Merge context: explicit > provider > defaults
    const fullContext = {
      ...contextProvider,
      ...explicitContext,
    } as MergeContexts<TRules>;

    // 1. Collect permissions from all sources
    const allPermissions: Permission[] = [
      ...defaults,
      ...(await Promise.all(sources.map((s) => s.obtain({ subject, operation, resource })))).flat(),
    ];

    // 2. Apply rules to filter permissions
    const initialCount = allPermissions.length;
    const validPermissions = allPermissions.filter((perm) =>
      rules.every((rule) => rule.check(perm, fullContext as any))
    );
    const filteredCount = initialCount - validPermissions.length;

    // 3. Resolve intermediate permissions
    const resolvedOperations = resolveOperation(operation);
    const isWildcard = resolvedOperations.includes("*");

    // 4. Filter relevant permissions
    const relevantPermissions = validPermissions.filter((perm) => {
      // Subject match
      if (perm.subject !== subject.id && perm.subject !== "*") return false;

      // Operation match
      if (!isWildcard && !resolvedOperations.includes(perm.operation) && perm.operation !== "*") {
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
        };
      }

      // Track ALLOW
      if (!perm.effect || perm.effect === "ALLOW") {
        hasAllow = true;
      }
    }

    // 6. Final decision
    if (hasAllow) {
      return { allowed: true, matchedPermissions, filteredCount };
    }

    return {
      allowed: false,
      reason: "No matching permission found",
      matchedPermissions: [],
      filteredCount,
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
  {
    subject: "user:1",
    operation: "beta.feature",
    metadata: { featureFlag: "beta-enabled" },
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

// Create permission system
const permSystem = createPermissionSystem({
  sources: [
    directPermissionSource(directPerms),
    groupPermissionSource(groupPerms),
    ownershipPermissionSource(["article.read", "article.update"]),
  ],
  intermediates: {
    "article.manage": ["article.create", "article.read", "article.update", "article.delete"],
  },
  rules: [
    TimeConstraintRule(),
    IpRestrictionRule(),
    FeatureFlagRule(featureFlags),
  ] as const,
  contextProvider: {
    timestamp: new Date("2025-06-15"), // Default: mid-2025
    ip: "192.168.1.1",                 // Default: allowed IP
  },
});

// Test data
const user1 = { id: "user:1", groups: ["group:admin"] };
const articleA = { id: "article:A", owner: "user:2" };
const articleB = { id: "article:B", owner: "user:2" };
const articleC = { id: "article:C", owner: "user:1" };

// Run tests
console.log("\n=== TOY 5 - TYPE-SAFE PERMISSION TESTS ===\n");

console.log("1. Direct permission:");
const test1 = await permSystem.can(user1, "article.read", articleA);
console.log(`   ✓ user:1 can read article:A? ${test1.allowed}`);

console.log("\n2. Intermediate permission (article.manage):");
const test2 = await permSystem.can(user1, "article.delete", articleB);
console.log(`   ✓ user:1 can delete article:B via manage? ${test2.allowed}`);

console.log("\n3. Explicit DENY:");
const test3 = await permSystem.can(user1, "article.delete", articleC);
console.log(`   ✗ user:1 can delete article:C? ${test3.allowed}`);
console.log(`   Reason: ${test3.reason}`);

console.log("\n4. Context provider (default timestamp & IP):");
const test4 = await permSystem.can(user1, "article.create");
console.log(`   ✓ user:1 can create article (default 2025-06-15)? ${test4.allowed}`);

const test5 = await permSystem.can(user1, "admin.panel");
console.log(`   ✓ user:1 can access admin.panel (default IP)? ${test5.allowed}`);

console.log("\n5. Explicit context override (expired time):");
const test6 = await permSystem.can(user1, "article.create", undefined, {
  timestamp: new Date("2026-01-01"),
});
console.log(`   ✗ user:1 can create article in 2026? ${test6.allowed}`);
console.log(`   Filtered by rules: ${test6.filteredCount} permissions`);

console.log("\n6. Explicit context override (forbidden IP):");
const test7 = await permSystem.can(user1, "admin.panel", undefined, {
  ip: "8.8.8.8",
});
console.log(`   ✗ user:1 can access admin.panel from 8.8.8.8? ${test7.allowed}`);
console.log(`   Filtered by rules: ${test7.filteredCount} permissions`);

console.log("\n7. Feature flag:");
const test8 = await permSystem.can(user1, "beta.feature");
console.log(`   ✓ user:1 can use beta.feature (flag=true)? ${test8.allowed}`);

console.log("\n8. Ownership-based permission:");
const articleD = { id: "article:D", owner: "user:1" };
const test9 = await permSystem.can(user1, "article.update", articleD);
console.log(`   ✓ user:1 can update article:D (owns it)? ${test9.allowed}`);

console.log("\n9. Group permission:");
const test10 = await permSystem.can(user1, "system.restart");
console.log(`   ✓ user:1 can restart system (via group:admin)? ${test10.allowed}`);

console.log("\n=== END TESTS ===\n");

// ============================================================================
// TYPE SAFETY DEMO
// ============================================================================

// The context type is automatically inferred from the rules!
// Try uncommenting this to see TypeScript errors:

// await permSystem.can(user1, "test", undefined, {
//   wrongField: "test" // ❌ TypeScript error: unknown property
// });

// await permSystem.can(user1, "test", undefined, {
//   timestamp: "not a date" // ❌ TypeScript error: wrong type
// });

// Valid usage:
await permSystem.can(user1, "test", undefined, {
  timestamp: new Date(),  // ✅ Correct type
  ip: "127.0.0.1",       // ✅ Correct type
});

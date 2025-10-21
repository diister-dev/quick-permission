// TOY 4 - Permission System with DENY, Intermediate Permissions, Modular Sources & Rules
// Goals:
// - Support explicit DENY with high priority
// - Intermediate permissions (shortcuts that grant multiple permissions)
// - Modular permission sources (direct, groups, ownership, etc.)
// - Permission Rules (time constraints, IP restrictions, etc.) that filter permissions
// - Simple, intuitive API

import mingo from "npm:mingo";

// ============================================================================
// TYPES
// ============================================================================

type Effect = "ALLOW" | "DENY";

type Permission = {
  subject: string;
  operation: string;
  resource?: string;
  effect?: Effect; // Default: "ALLOW"
  constraints?: Record<string, any>; // MongoDB-style queries on the RESOURCE

  // Rule-specific data (evaluated by rules)
  startDate?: Date;
  endDate?: Date;
  allowedIps?: string[];
  metadata?: Record<string, any>; // Custom data for custom rules
};

type IntermediatePermission = {
  [key: string]: string[]; // "article.manage" -> ["article.create", "article.read", ...]
};

type PermissionSource = {
  name: string;
  obtain: (context: SourceContext) => Promise<Permission[]>;
};

type PermissionRule = {
  name: string;
  /**
   * Checks if a permission is valid in the current context
   * Returns true if permission should be kept, false if it should be filtered out
   */
  check: (permission: Permission, context: RuleContext) => boolean;
};

type SourceContext = {
  subject: any;
  operation: string;
  resource?: any;
};

type RuleContext = {
  subject: any;
  operation: string;
  resource?: any;
  timestamp?: Date;
  ip?: string;
  [key: string]: any; // Allow custom context
};

// ============================================================================
// PERMISSION RULES - Filter permissions based on context
// ============================================================================

/**
 * Time-based constraint: permission is only valid between startDate and endDate
 */
function TimeConstraintRule(): PermissionRule {
  return {
    name: "TimeConstraint",
    check: (permission, context) => {
      const now = context.timestamp || new Date();

      if (permission.startDate && now < permission.startDate) {
        return false; // Not yet valid
      }

      if (permission.endDate && now > permission.endDate) {
        return false; // Expired
      }

      return true;
    },
  };
}

/**
 * IP restriction: permission is only valid from specific IPs
 */
function IpRestrictionRule(): PermissionRule {
  return {
    name: "IpRestriction",
    check: (permission, context) => {
      if (!permission.allowedIps || permission.allowedIps.length === 0) {
        return true; // No restriction
      }

      if (!context.ip) {
        return false; // IP required but not provided
      }

      return permission.allowedIps.includes(context.ip);
    },
  };
}

/**
 * Custom rule example: feature flag check
 */
function FeatureFlagRule(flags: Map<string, boolean>): PermissionRule {
  return {
    name: "FeatureFlag",
    check: (permission, context) => {
      const requiredFlag = permission.metadata?.featureFlag;
      if (!requiredFlag) return true; // No flag required

      return flags.get(requiredFlag) === true;
    },
  };
}

// ============================================================================
// CORE - Permission Resolver
// ============================================================================

class PermissionSystem {
  private sources: PermissionSource[] = [];
  private defaults: Permission[] = [];
  private intermediates: IntermediatePermission = {};
  private rules: PermissionRule[] = [];

  constructor(config: {
    sources?: PermissionSource[];
    defaults?: Permission[];
    intermediates?: IntermediatePermission;
    rules?: PermissionRule[];
  }) {
    this.sources = config.sources || [];
    this.defaults = config.defaults || [];
    this.intermediates = config.intermediates || {};
    this.rules = config.rules || [];
  }

  /**
   * Resolves an operation through intermediate permissions
   * Example: "article.manage" -> ["article.create", "article.read", "article.update", "article.delete"]
   */
  private resolveOperation(operation: string): string[] {
    const operations = [operation];

    // Check if this operation grants other permissions
    if (this.intermediates[operation]) {
      for (const grantedOp of this.intermediates[operation]) {
        if (grantedOp === "*") {
          // Wildcard - grants everything (be careful!)
          return ["*"];
        }
        operations.push(...this.resolveOperation(grantedOp));
      }
    }

    return [...new Set(operations)]; // Remove duplicates
  }

  /**
   * Main permission check
   */
  async can(
    subject: any,
    operation: string,
    resource?: any,
    ruleContext?: Partial<RuleContext>,
  ): Promise<{ allowed: boolean; reason?: string; matchedPermissions?: Permission[]; filteredCount?: number }> {
    const context: SourceContext = { subject, operation, resource };
    const fullRuleContext: RuleContext = {
      subject,
      operation,
      resource,
      timestamp: new Date(),
      ...ruleContext,
    };

    // 1. Collect permissions from all sources
    const allPermissions: Permission[] = [];

    // Add defaults
    allPermissions.push(...this.defaults);

    // Gather from sources
    const sourcePermissions = await Promise.all(
      this.sources.map((source) => source.obtain(context)),
    );
    allPermissions.push(...sourcePermissions.flat());

    // 2. Apply permission rules (FILTER permissions based on context)
    const initialCount = allPermissions.length;
    const validPermissions = allPermissions.filter((perm) => {
      return this.rules.every((rule) => rule.check(perm, fullRuleContext));
    });
    const filteredCount = initialCount - validPermissions.length;

    // 3. Resolve intermediate permissions
    const resolvedOperations = this.resolveOperation(operation);
    const isWildcard = resolvedOperations.includes("*");

    // 4. Filter relevant permissions
    const relevantPermissions = validPermissions.filter((perm) => {
      // Check subject match
      if (perm.subject !== subject.id && perm.subject !== "*") {
        return false;
      }

      // Check operation match (including resolved intermediate permissions)
      if (!isWildcard && !resolvedOperations.includes(perm.operation) && perm.operation !== "*") {
        return false;
      }

      return true;
    });

    // 5. Process permissions with priority: DENY > ALLOW
    let hasAllow = false;
    const matchedPermissions: Permission[] = [];

    for (const perm of relevantPermissions) {
      // Check resource match
      if (resource && perm.resource) {
        const resourceMatch =
          perm.resource === resource.id ||
          perm.resource === "*" ||
          (perm.resource.endsWith("*") &&
            resource.id.startsWith(perm.resource.slice(0, -1)));

        if (!resourceMatch) continue;
      }

      // Check constraints (MongoDB-style queries on the resource)
      if (resource && perm.constraints) {
        const validator = new mingo.Query(perm.constraints);
        if (!validator.test(resource)) continue;
      }

      matchedPermissions.push(perm);

      // DENY has absolute priority
      if (perm.effect === "DENY") {
        return {
          allowed: false,
          reason: `Explicitly denied by permission: ${perm.operation} on ${perm.resource || "any"}`,
          matchedPermissions,
          filteredCount,
        };
      }

      // Track if we have any ALLOW
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
}

// ============================================================================
// PERMISSION SOURCES - Modular obtainers
// ============================================================================

/**
 * Direct permissions stored in a simple array/DB
 */
function directPermissionSource(permissions: Permission[]): PermissionSource {
  return {
    name: "direct",
    obtain: async (context) => {
      return permissions.filter((p) => p.subject === context.subject.id);
    },
  };
}

/**
 * Group-based permissions
 */
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

/**
 * Ownership-based permissions (auto-granted if user owns resource)
 */
function ownershipPermissionSource(
  allowedOperations: string[],
): PermissionSource {
  return {
    name: "ownership",
    obtain: async (context) => {
      if (!context.resource || !context.resource.owner) return [];

      // Check if subject is the owner
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
// DEMO / TEST
// ============================================================================

// Setup permissions storage
const directPerms: Permission[] = [
  {
    subject: "user:1",
    operation: "article.read",
    resource: "article:A",
  },
  {
    subject: "user:1",
    operation: "article.manage", // Intermediate permission!
    resource: "article:B",
  },
  {
    subject: "user:1",
    operation: "article.delete",
    resource: "article:C",
    effect: "DENY", // Explicit deny - cannot delete C
  },
  {
    subject: "user:1",
    operation: "article.create",
    startDate: new Date("2025-01-01"),
    endDate: new Date("2025-12-31"), // Only valid during 2025
  },
  {
    subject: "user:1",
    operation: "admin.panel",
    allowedIps: ["192.168.1.1", "10.0.0.1"], // IP restricted
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
      {
        subject: "*",
        operation: "system.restart",
        effect: "ALLOW",
      },
      {
        subject: "*",
        operation: "article.delete",
        resource: "article:*",
        effect: "ALLOW",
      },
    ],
  ],
]);

// Feature flags
const featureFlags = new Map([
  ["beta-enabled", true],
  ["experimental", false],
]);

// Create the permission system
const permSystem = new PermissionSystem({
  sources: [
    directPermissionSource(directPerms),
    groupPermissionSource(groupPerms),
    ownershipPermissionSource(["article.read", "article.update"]),
  ],
  defaults: [],
  intermediates: {
    "article.manage": [
      "article.create",
      "article.read",
      "article.update",
      "article.delete",
    ],
    "admin.full": ["*"], // God mode
  },
  rules: [
    TimeConstraintRule(),
    IpRestrictionRule(),
    FeatureFlagRule(featureFlags),
  ],
});

// Test data
const user1 = {
  id: "user:1",
  groups: ["group:admin"],
};

const articleA = {
  id: "article:A",
  owner: "user:2",
  title: "Article A",
};

const articleB = {
  id: "article:B",
  owner: "user:2",
  title: "Article B",
};

const articleC = {
  id: "article:C",
  owner: "user:1",
  title: "Article C - Cannot delete (DENIED)",
};

// Run tests
console.log("\n=== PERMISSION TESTS ===\n");

console.log("1. Direct permission:");
const test1 = await permSystem.can(user1, "article.read", articleA);
console.log(`   user:1 can read article:A? ${test1.allowed}`);
console.log(`   Filtered by rules: ${test1.filteredCount} permissions`);

console.log("\n2. Intermediate permission (article.manage -> article.delete):");
const test2 = await permSystem.can(user1, "article.delete", articleB);
console.log(`   user:1 can delete article:B (via manage)? ${test2.allowed}`);
console.log(`   Matched permissions:`, test2.matchedPermissions?.length);

console.log("\n3. Explicit DENY (overrides everything):");
const test3 = await permSystem.can(user1, "article.delete", articleC);
console.log(`   user:1 can delete article:C? ${test3.allowed}`);
console.log(`   Reason: ${test3.reason}`);

console.log("\n4. Group permission:");
const test4 = await permSystem.can(user1, "system.restart");
console.log(`   user:1 can restart system (via group:admin)? ${test4.allowed}`);

console.log("\n5. Ownership-based permission:");
const articleD = { id: "article:D", owner: "user:1" };
const test5 = await permSystem.can(user1, "article.update", articleD);
console.log(`   user:1 can update article:D (owns it)? ${test5.allowed}`);

console.log("\n6. TIME CONSTRAINT - Valid permission (2025):");
const test6 = await permSystem.can(user1, "article.create", undefined, {
  timestamp: new Date("2025-06-15"),
});
console.log(`   user:1 can create article in June 2025? ${test6.allowed}`);

console.log("\n7. TIME CONSTRAINT - Expired permission (2026):");
const test7 = await permSystem.can(user1, "article.create", undefined, {
  timestamp: new Date("2026-01-01"),
});
console.log(`   user:1 can create article in 2026? ${test7.allowed}`);
console.log(`   Filtered by rules: ${test7.filteredCount} permissions`);

console.log("\n8. IP RESTRICTION - Allowed IP:");
const test8 = await permSystem.can(user1, "admin.panel", undefined, {
  ip: "192.168.1.1",
});
console.log(`   user:1 can access admin panel from 192.168.1.1? ${test8.allowed}`);

console.log("\n9. IP RESTRICTION - Forbidden IP:");
const test9 = await permSystem.can(user1, "admin.panel", undefined, {
  ip: "8.8.8.8",
});
console.log(`   user:1 can access admin panel from 8.8.8.8? ${test9.allowed}`);
console.log(`   Filtered by rules: ${test9.filteredCount} permissions`);

console.log("\n10. FEATURE FLAG - Enabled:");
const test10 = await permSystem.can(user1, "beta.feature");
console.log(`   user:1 can use beta.feature (flag=true)? ${test10.allowed}`);

console.log("\n11. FEATURE FLAG - Disabled:");
featureFlags.set("beta-enabled", false);
const test11 = await permSystem.can(user1, "beta.feature");
console.log(`   user:1 can use beta.feature (flag=false)? ${test11.allowed}`);
console.log(`   Filtered by rules: ${test11.filteredCount} permissions`);

console.log("\n=== END TESTS ===\n");

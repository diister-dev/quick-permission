// TOY 7 - Hierarchical Drive Permission System
// Goals:
// - Folders and files with nested structure
// - Permission inheritance from parent folders
// - Local override (re-protection at any depth)
// - Different permissions for folders vs files
// - Path-based resolution

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
  propagate?: boolean; // If true, applies to all children
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
// DRIVE TYPES
// ============================================================================

type DriveItem = {
  id: string;
  name: string;
  path: string; // e.g., "/folder1/folder2/file.txt"
  type: "folder" | "file";
  owner: string;
  parent?: string; // Parent folder ID
  metadata?: Record<string, any>;
};

// ============================================================================
// PERMISSION DESCRIPTORS
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

function permission<TContext = Record<string, never>>(opts?: {
  requiresResource?: boolean;
}): PermissionDescriptor<TContext> {
  return {
    __type: "permission",
    __context: undefined as any,
    requiresResource: opts?.requiresResource ?? false,
  };
}

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
// TYPE UTILITIES
// ============================================================================

type ExtractContext<T> = T extends PermissionDescriptor<infer C>
  ? C
  : T extends IntermediateDescriptor<infer C>
  ? C
  : never;

type PermissionKeys<TSchema> = Extract<keyof TSchema, string>;

// ============================================================================
// DRIVE-SPECIFIC SOURCE - Hierarchical permissions
// ============================================================================

type DrivePermissionStore = {
  // Map of resource ID to permissions
  [resourceId: string]: Permission[];
};

/**
 * Drive source that handles hierarchical permission inheritance
 */
function driveSource(
  store: DrivePermissionStore,
  itemResolver: (id: string) => DriveItem | undefined,
): PermissionSource {
  return {
    name: "drive",
    obtain: async ({ subject, operation }) => {
      const permissions: Permission[] = [];

      // Collect permissions from the store
      for (const [resourceId, perms] of Object.entries(store)) {
        for (const perm of perms) {
          if (perm.subject === subject.id || perm.subject === "*") {
            permissions.push({ ...perm, resource: resourceId });
          }
        }
      }

      return permissions;
    },
  };
}

/**
 * Helper to resolve permissions for a specific item with inheritance
 */
async function resolveWithInheritance(
  item: DriveItem,
  operation: string,
  subject: any,
  store: DrivePermissionStore,
  itemResolver: (id: string) => DriveItem | undefined,
): Promise<Permission[]> {
  const permissions: Permission[] = [];
  const pathParts = item.path.split("/").filter(Boolean);

  // Build path hierarchy: / -> /folder1 -> /folder1/folder2 -> /folder1/folder2/file
  const paths: string[] = ["/"]; // Root
  for (let i = 0; i < pathParts.length; i++) {
    paths.push("/" + pathParts.slice(0, i + 1).join("/"));
  }

  // Collect permissions from root to current item
  for (const path of paths) {
    // Find item ID for this path
    let itemId: string | undefined;
    if (path === "/") {
      itemId = "root";
    } else {
      // Find item by path (in real app, you'd have a path index)
      for (const [id, perms] of Object.entries(store)) {
        const foundItem = itemResolver(id);
        if (foundItem?.path === path) {
          itemId = id;
          break;
        }
      }
    }

    if (itemId && store[itemId]) {
      for (const perm of store[itemId]) {
        if (
          (perm.subject === subject.id || perm.subject === "*") &&
          (perm.operation === operation || perm.operation === "*")
        ) {
          permissions.push({ ...perm, resource: item.id });
        }
      }
    }
  }

  return permissions;
}

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

  // Drive-specific: item resolver for hierarchy
  itemResolver?: (id: string) => DriveItem | undefined;
  permissionStore?: DrivePermissionStore;
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
    inherited?: Permission[]; // Permissions from parent folders
  }>;
};

function createPermissionSystem<
  const TSchema extends Record<string, AnyDescriptor>,
  TGlobalContext extends Record<string, any>,
>(
  config: Config<TSchema, TGlobalContext>,
): PermissionSystem<TSchema, TGlobalContext> {
  const {
    permissions,
    sources,
    rules = [],
    contextProvider = {},
    itemResolver,
    permissionStore,
  } = config;

  async function resolveContext(explicit: Partial<TGlobalContext>): Promise<TGlobalContext> {
    const resolved = { ...explicit } as Record<string, unknown>;

    for (const key in contextProvider) {
      if (!(key in explicit)) {
        const value = contextProvider[key as keyof typeof contextProvider] as unknown;
        resolved[key] = typeof value === "function" ? await (value as () => Promise<unknown>)() : value;
      }
    }

    return resolved as TGlobalContext;
  }

  async function expand(operation: string, context: any): Promise<Permission[]> {
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
    const resource = (mergedContext as any).resource as DriveItem | undefined;

    const generated = await expand(operation as string, mergedContext);

    // Collect base permissions
    const collected = await Promise.all(
      sources.map((s) => s.obtain({ subject, operation: operation as string })),
    );

    let allPermissions = [...collected.flat(), ...generated];

    // Add inherited permissions from parent folders
    let inheritedPermissions: Permission[] = [];
    if (resource && itemResolver && permissionStore) {
      inheritedPermissions = await resolveWithInheritance(
        resource,
        operation as string,
        subject,
        permissionStore,
        itemResolver,
      );
      allPermissions = [...allPermissions, ...inheritedPermissions];
    }

    // Filter by rules
    const valid = allPermissions.filter((perm) =>
      rules.every((rule) => rule.check(perm, fullContext as any))
    );

    // Match relevant permissions
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

    // Check for DENY first (highest priority)
    for (const perm of relevant) {
      if (perm.effect === "DENY") {
        return {
          allowed: false,
          reason: `Denied: ${perm.operation}`,
          matched: relevant,
          inherited: inheritedPermissions,
        };
      }
    }

    // Check for ALLOW
    const hasAllow = relevant.some((p) => !p.effect || p.effect === "ALLOW");

    return {
      allowed: hasAllow,
      reason: hasAllow ? undefined : "No permission found",
      matched: relevant,
      inherited: inheritedPermissions,
    };
  }

  return { can };
}

// ============================================================================
// DEMO - Drive System
// ============================================================================

type GlobalContext = {
  timestamp: Date;
};

type DriveContext = {
  resource: DriveItem;
};

// Permission schema
const schema = {
  // Folder operations
  "folder.create": permission<DriveContext>({ requiresResource: true }),
  "folder.read": permission<DriveContext>({ requiresResource: true }),
  "folder.update": permission<DriveContext>({ requiresResource: true }),
  "folder.delete": permission<DriveContext>({ requiresResource: true }),
  "folder.share": permission<DriveContext>({ requiresResource: true }),

  // File operations
  "file.create": permission<DriveContext>({ requiresResource: true }),
  "file.read": permission<DriveContext>({ requiresResource: true }),
  "file.update": permission<DriveContext>({ requiresResource: true }),
  "file.delete": permission<DriveContext>({ requiresResource: true }),

  // Intermediate - full access to folder and contents
  "folder.manage": intermediate<DriveContext>((ctx) => [
    { subject: ctx.resource.owner, operation: "folder.read", resource: ctx.resource.id },
    { subject: ctx.resource.owner, operation: "folder.update", resource: ctx.resource.id },
    { subject: ctx.resource.owner, operation: "folder.delete", resource: ctx.resource.id },
    { subject: ctx.resource.owner, operation: "folder.create", resource: ctx.resource.id },
    { subject: ctx.resource.owner, operation: "file.create", resource: ctx.resource.id },
    { subject: ctx.resource.owner, operation: "file.read", resource: ctx.resource.id },
    { subject: ctx.resource.owner, operation: "file.update", resource: ctx.resource.id },
    { subject: ctx.resource.owner, operation: "file.delete", resource: ctx.resource.id },
  ]),
} as const;

// Drive items
const items: Record<string, DriveItem> = {
  root: {
    id: "root",
    name: "/",
    path: "/",
    type: "folder",
    owner: "user:admin",
  },
  "folder:1": {
    id: "folder:1",
    name: "Documents",
    path: "/Documents",
    type: "folder",
    owner: "user:1",
    parent: "root",
  },
  "folder:2": {
    id: "folder:2",
    name: "Work",
    path: "/Documents/Work",
    type: "folder",
    owner: "user:1",
    parent: "folder:1",
  },
  "folder:3": {
    id: "folder:3",
    name: "Confidential",
    path: "/Documents/Work/Confidential",
    type: "folder",
    owner: "user:1",
    parent: "folder:2",
  },
  "file:1": {
    id: "file:1",
    name: "todo.txt",
    path: "/Documents/todo.txt",
    type: "file",
    owner: "user:1",
    parent: "folder:1",
  },
  "file:2": {
    id: "file:2",
    name: "report.pdf",
    path: "/Documents/Work/report.pdf",
    type: "file",
    owner: "user:1",
    parent: "folder:2",
  },
  "file:3": {
    id: "file:3",
    name: "secret.txt",
    path: "/Documents/Work/Confidential/secret.txt",
    type: "file",
    owner: "user:1",
    parent: "folder:3",
  },
};

// Permission store (hierarchical)
const permissionStore: DrivePermissionStore = {
  // Root: everyone can read
  root: [
    {
      subject: "*",
      operation: "folder.read",
      effect: "ALLOW",
      propagate: true,
    },
  ],

  // /Documents: user:1 has full access, user:2 can read
  "folder:1": [
    {
      subject: "user:1",
      operation: "*",
      effect: "ALLOW",
      propagate: true, // Applies to all children
    },
    {
      subject: "user:2",
      operation: "file.read",
      effect: "ALLOW",
      propagate: true,
    },
    {
      subject: "user:2",
      operation: "folder.read",
      effect: "ALLOW",
      propagate: true,
    },
  ],

  // /Documents/Work/Confidential: RE-PROTECTED! Only user:1
  "folder:3": [
    {
      subject: "user:2",
      operation: "*",
      effect: "DENY", // Override parent permissions
    },
    {
      subject: "user:1",
      operation: "*",
      effect: "ALLOW",
    },
  ],
};

// Item resolver
const itemResolver = (id: string) => items[id];

// Create the system
const system = createPermissionSystem<typeof schema, GlobalContext>({
  permissions: schema,
  sources: [driveSource(permissionStore, itemResolver)],
  rules: [],
  itemResolver,
  permissionStore,
  contextProvider: {
    timestamp: () => new Date(),
  },
});

// Test users
const user1 = { id: "user:1" };
const user2 = { id: "user:2" };

console.log("\n=== DRIVE PERMISSION TESTS ===\n");

console.log("1. Root folder - everyone can read:");
let result = await system.can(user2, "folder.read", { resource: items.root });
console.log(`   user:2 can read /? ${result.allowed}`);

console.log("\n2. /Documents - user:1 owner (inherited):");
result = await system.can(user1, "file.create", { resource: items["folder:1"] });
console.log(`   user:1 can create file in /Documents? ${result.allowed}`);

console.log("\n3. /Documents/todo.txt - user:2 can read (inherited):");
result = await system.can(user2, "file.read", { resource: items["file:1"] });
console.log(`   user:2 can read /Documents/todo.txt? ${result.allowed}`);
console.log(`   Inherited permissions: ${result.inherited?.length}`);

console.log("\n4. /Documents/Work/report.pdf - user:2 can read (inherited):");
result = await system.can(user2, "file.read", { resource: items["file:2"] });
console.log(`   user:2 can read /Documents/Work/report.pdf? ${result.allowed}`);

console.log("\n5. /Documents/Work/Confidential - RE-PROTECTED!");
result = await system.can(user2, "folder.read", { resource: items["folder:3"] });
console.log(`   user:2 can read /Documents/Work/Confidential? ${result.allowed}`);
console.log(`   Reason: ${result.reason}`);

console.log("\n6. /Documents/Work/Confidential/secret.txt - user:2 DENIED:");
result = await system.can(user2, "file.read", { resource: items["file:3"] });
console.log(`   user:2 can read secret.txt? ${result.allowed}`);
console.log(`   Reason: ${result.reason}`);

console.log("\n7. /Documents/Work/Confidential/secret.txt - user:1 allowed:");
result = await system.can(user1, "file.read", { resource: items["file:3"] });
console.log(`   user:1 can read secret.txt? ${result.allowed}`);

console.log("\n8. user:2 cannot delete in /Documents (no permission):");
result = await system.can(user2, "file.delete", { resource: items["file:1"] });
console.log(`   user:2 can delete /Documents/todo.txt? ${result.allowed}`);

console.log("\n=== END TESTS ===\n");

console.log("=� Drive Structure:");
console.log("/");
console.log("   Documents/ (user:1 full, user:2 read)");
console.log("      todo.txt");
console.log("      Work/");
console.log("          report.pdf");
console.log("          Confidential/ (RE-PROTECTED: user:1 only)");
console.log("              secret.txt");
console.log();

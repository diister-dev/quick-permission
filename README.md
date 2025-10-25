# Quick Permission - Library 2

A TypeScript permission management library that is **type-safe**, **flexible**, and **composable** with support for hierarchical permissions, field-level filtering, and metadata accumulation.

## 🎯 Key Features

### ✨ **Extreme Type Safety**
```typescript
// ✅ TypeScript enforces the correct argument type
await permSystem.can(user, "article.read", articleId);  // Accepts ArticleId
await permSystem.can(user, "article.create");           // Does not accept argument

// ✅ Output type is inferred automatically
const result = await permSystem.can(user, "article.read", "article:1");
result.output?.filter  // Type: Record<string, boolean> | undefined
result.output?.data    // Type: any
```

### 🔥 **Field-Level Permissions with Accumulation**
```typescript
// Multiple permissions can contribute
// Owner permission : { filter: { _id, title, owner, salary } }
// Public permission : { filter: { _id, title, body } }
// Contributor permission : { filter: { views } }

const result = await permSystem.can(ownerUser, "article.read", "article:1");
// result.output.data = { _id, title, body, owner, salary, views }
// ↑ Union of all filters!
```

### 🎪 **Recursive Intermediate Permissions**
```typescript
"article.manage": intermediate((ctx) => [
  { ...ctx, key: "article.read" },
  { ...ctx, key: "article.update" },
  { ...ctx, key: "article.comment.manage", target: [ctx.target, "*"] }
])

// Recursive resolution with configurable max depth
```

### 🧩 **Providers + Rules Architecture**
```typescript
const permSystem = createPermissionSystem({
  schemas: permissionsSchemas,
  sources: [
    directProvider(staticPerms),
    ownerProvider(["article.read"], "article:*"),
    customDatabaseProvider(),
  ],
  rules: [TimeRule(), IpRule(), WithRule()],
});
```

---

## 📚 Usage Guide

### Installation

```typescript
import {
  createPermissionSystem,
  permission,
  intermediate,
  FilterRule,
  directProvider,
  ownerProvider,
} from "./library_2/mod.ts";
```

### 1. Define Permissions

```typescript
import { permission, intermediate, FilterRule } from "./library_2/mod.ts";

// Resource fetchers
async function getArticle(id: string) {
  return db.articles.findById(id);
}

async function getComment(ids: [string, string]) {
  const [articleId, commentId] = ids;
  return db.comments.findById(commentId, { articleId });
}

// Permission schemas
const permissionsSchemas = {
  // Simple permission
  "article.create": permission(),

  // Permission with context + field filtering
  "article.read": permission(getArticle, [FilterRule()] as const),

  // Permission with context but without rules
  "article.update": permission(getArticle),

  // Intermediate permission (expand to children)
  "article.manage": intermediate(
    (ctx) => [
      { subject: ctx.subject, key: "article.read", target: ctx.target },
      { subject: ctx.subject, key: "article.update", target: ctx.target },
      { subject: ctx.subject, key: "article.delete", target: ctx.target },
    ],
    getArticle
  ),

  // Permission with nested context
  "article.comment.delete": permission(getComment),
};
```

### 2. Create Providers

**Providers** are sources of permissions. They return the permissions for a subject.

```typescript
import { directProvider, ownerProvider } from "./library_2/mod.ts";
import type { PermissionProvider } from "./library_2/mod.ts";

// Provider 1: Static permissions
const staticPerms = directProvider([
  {
    subject: adminUser,
    key: "article.create",
  },
  {
    subject: moderatorUser,
    key: "article.update",
    target: "article:*",
  },
]);

// Provider 2: Ownership-based permissions
const ownerPerms = ownerProvider(
  ["article.read", "article.update", "article.delete"],
  "article:*",
  {
    filter: { _id: true, title: true, body: true, owner: true }
  }
);

// Provider 3: Custom provider (e.g., from database)
function databaseProvider(): PermissionProvider {
  return {
    provide: async (subject, _key, _target) => {
      const userPerms = await db.permissions.find({ userId: subject.id });
      return userPerms.map(p => ({
        subject,
        key: p.permissionKey,
        target: p.target,
        filter: p.filter,
      }));
    }
  };
}

// Provider 4: Conditional provider
function publicArticleProvider(): PermissionProvider {
  return {
    provide: (subject, _key, _target) => {
      return Promise.resolve([
        {
          key: "article.read",
          subject,
          target: "*",
          with: { public: true },  // Condition: article must be public
          filter: { _id: true, title: true, body: true },
        },
      ]);
    }
  };
}
```

### 3. Create the Permission System

```typescript
import { createPermissionSystem, TimeRule, IpRule, WithRule } from "./library_2/mod.ts";

const permSystem = createPermissionSystem({
  schemas: permissionsSchemas,

  sources: [
    staticPerms,
    ownerPerms,
    publicArticleProvider(),
    databaseProvider(),
  ],

  // Global validation rules (applied to ALL permissions)
  rules: [
    TimeRule(),   // Validate time constraints (startDate, endDate)
    IpRule(),     // Validate IP restrictions
    WithRule(),   // Validate resource constraints
  ] as const,

  // Max depth for recursive intermediate resolution
  maxIntermediateDepth: 10,
});
```

### 4. Check Permissions

```typescript
const user = { id: "user:123" };

// Permission without context
const canCreate = await permSystem.can(user, "article.create");
if (canCreate.ok) {
  // User can create articles
}

// Permission with context (target)
const canRead = await permSystem.can(user, "article.read", "article:1");
if (canRead.ok) {
  // User can read article:1
  console.log("Allowed fields:", canRead.output?.filter);
  console.log("Filtered data:", canRead.output?.data);
}

// Create a checker with shared context + cache
const checker = permSystem.context({
  subject: user,
  checkDate: new Date("2024-01-01"),
  ips: ["192.168.1.1"],
});

// All calls to checker.can() share the same cache!
const r1 = await checker.can("article.read", "article:1");  // FETCH
const r2 = await checker.can("article.update", "article:1"); // CACHE HIT
const r3 = await checker.can("article.delete", "article:1"); // CACHE HIT
```

---

## 🧪 Complete Examples

### Example 1: Blog with Field Filtering

```typescript
import { createPermissionSystem, permission, FilterRule, ownerProvider } from "./library_2/mod.ts";

type Article = {
  _id: string;
  title: string;
  body: string;
  owner: string;
  salary?: number;
  secret?: string;
};

async function getArticle(id: string): Promise<Article | undefined> {
  return db.articles.findById(id);
}

const schemas = {
  "article.read": permission(getArticle, [FilterRule()] as const),
};

const permSystem = createPermissionSystem({
  schemas,
  sources: [
    // Public users see basic fields
    publicProvider({
      filter: { _id: true, title: true, body: true }
    }),

    // Owners see more fields
    ownerProvider(["article.read"], "article:*", {
      filter: { _id: true, title: true, body: true, owner: true, salary: true }
    }),

    // Admins see everything
    adminProvider({
      filter: { _id: true, title: true, body: true, owner: true, salary: true, secret: true }
    }),
  ],
});

// Usage
const result = await permSystem.can(publicUser, "article.read", "article:1");
// result.output.data = { _id, title, body } ← filtered automatically

const result2 = await permSystem.can(ownerUser, "article.read", "article:1");
// result2.output.data = { _id, title, body, owner, salary } ← more fields
```

### Example 2: Hierarchical Permissions

```typescript
const schemas = {
  "article.read": permission(getArticle),
  "article.update": permission(getArticle),
  "article.delete": permission(getArticle),

  // Intermediate permission
  "article.manage": intermediate(
    (ctx) => [
      { ...ctx, key: "article.read" },
      { ...ctx, key: "article.update" },
      { ...ctx, key: "article.delete" },
    ],
    getArticle
  ),
};

const permSystem = createPermissionSystem({
  schemas,
  sources: [
    directProvider([
      { subject: admin, key: "article.manage", target: "*" }
    ])
  ],
});

// Admin has article.manage, which expands to read + update + delete
const canRead = await permSystem.can(admin, "article.read", "article:1");
// ✅ true (via article.manage)

const canUpdate = await permSystem.can(admin, "article.update", "article:1");
// ✅ true (via article.manage)
```

### Example 3: Conditional Permissions

```typescript
import { WithRule } from "./library_2/mod.ts";

const schemas = {
  "article.read": permission(getArticle),
};

const permSystem = createPermissionSystem({
  schemas,
  sources: [
    // Only on public articles
    {
      provide: (subject) => Promise.resolve([{
        subject,
        key: "article.read",
        target: "*",
        with: { public: true },  // ← Condition
      }])
    },

    // Only if user is author
    {
      provide: (subject) => Promise.resolve([{
        subject,
        key: "article.read",
        target: "*",
        with: { author: subject.id },  // ← Condition
      }])
    },
  ],
  rules: [WithRule()] as const,
});

// Only works if article.public === true OR article.author === user.id
```

### Example 4: Resource Caching with `context()`

```typescript
import { createPermissionSystem, permission, FilterRule } from "./library_2/mod.ts";

const schemas = {
  "article.read": permission(getArticle, [FilterRule()] as const),
  "article.update": permission(getArticle),
  "article.delete": permission(getArticle),
};

const permSystem = createPermissionSystem({
  schemas,
  sources: [ownerProvider(["article.read", "article.update", "article.delete"], "article:*")],
});

// WITHOUT context(): each permission triggers a fetch
await permSystem.can(user, "article.read", "article:1");   // FETCH #1
await permSystem.can(user, "article.update", "article:1"); // FETCH #2
await permSystem.can(user, "article.delete", "article:1"); // FETCH #3

// WITH context(): cache is shared between all can()
const checker = permSystem.context({ subject: user });
await checker.can("article.read", "article:1");   // FETCH #1
await checker.can("article.update", "article:1"); // CACHE HIT ✨
await checker.can("article.delete", "article:1"); // CACHE HIT ✨

// Cache also works in nested functions
async function checkAllPermissions(checker, articleId: string) {
  const canRead = await checker.can("article.read", articleId);   // CACHE HIT
  const canUpdate = await checker.can("article.update", articleId); // CACHE HIT
  return { canRead: canRead.ok, canUpdate: canUpdate.ok };
}

const perms = await checkAllPermissions(checker, "article:1");
// ↑ No new fetch! Everything is cached
```

**Advantages of `context()`:**
- ✅ Cache shared between all `can()` of the same checker
- ✅ Custom context (dates, IPs, metadata) in all calls
- ✅ Elegant API: `checker.can(key, target)` instead of `can(subject, key, target)`
- ✅ No need for callbacks/closures (unlike AsyncContext)

---

## 🏗️ Architecture

### Validation Flow

```
1. permSystem.can(subject, key, target) or checker.can(key, target)
   ↓
2. Call all providers → [permissions]
   ↓
3. Resolve intermediates (recursive, max depth: 10) → [resolved permissions]
   ↓
4. Filter by key + target matching → [matched permissions]
   ↓
5. Apply global rules (Time, IP, With) → [valid permissions]
   ↓
6. Fetch resource (with cache if context()) ✨
   ↓
7. Apply output rules (FilterRule) → outputs
   ↓
8. Merge outputs (union strategy) → final output
   ↓
9. Return { ok: true, output }
```

**Note on caching**: Without `context()`, each `can()` creates its own local cache. With `context()`, all `can()` of the same checker share the same cache Map.

### Components

| Component | Role | Example |
|-----------|------|---------|
| **Permission** | Defines a permission with optional context | `permission(getArticle)` |
| **Intermediate** | Permission that resolves to other permissions | `intermediate((ctx) => [...])` |
| **Provider** | Source of permissions for a subject | `ownerProvider(...)` |
| **Global Rule** | Global validation (applied to all permissions) | `TimeRule()`, `IpRule()` |
| **Output Rule** | Generates metadata/output | `FilterRule()` |

---

## 🎨 Advanced Patterns

### Pattern 1: Multi-Tenant with Organizations

```typescript
const schemas = {
  "org.member.read": permission(getOrgMember, [FilterRule()] as const),
};

function orgMemberProvider(): PermissionProvider {
  return {
    provide: async (subject, _key, _target) => {
      // Get user's organizations
      const orgs = await db.orgMembers.find({ userId: subject.id });

      return orgs.map(org => ({
        subject,
        key: "org.member.read",
        target: `org:${org.orgId}:member:*`,
        filter: org.role === 'admin'
          ? { _id: true, name: true, email: true, salary: true }
          : { _id: true, name: true, email: true },
      }));
    }
  };
}
```

### Pattern 2: Rate Limiting

```typescript
function RateLimitRule(): OutputRule<
  { rateLimit?: { max: number, window: string } }
> {
  return {
    name: "rateLimit",
    output: ({ state, currentOutput }) => {
      const current = currentOutput?.rateLimit?.max || 0;
      const incoming = state.rateLimit?.max || 0;

      return {
        rateLimit: {
          max: Math.max(current, incoming),  // Most permissive
          window: state.rateLimit?.window || "1h"
        }
      };
    }
  };
}

// Usage
const schemas = {
  "api.call": permission(undefined, [RateLimitRule()] as const),
};

const result = await permSystem.can(user, "api.call");
// result.output.rateLimit = { max: 1000, window: "1h" }
```

### Pattern 3: Temporary Permissions

```typescript
import { TimeRule } from "./library_2/mod.ts";

const permSystem = createPermissionSystem({
  schemas,
  sources: [
    {
      provide: (subject) => Promise.resolve([{
        subject,
        key: "article.read",
        target: "article:1",
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-31"),
      }])
    }
  ],
  rules: [TimeRule()] as const,
});

// Only works between 2024-01-01 and 2024-12-31
```

---

## 🚀 Performance

### Built-in Optimizations

1. **Resource Caching**: With `context()`, cache is shared between all `can()` calls
2. **Resource Fetching**: Resource is fetched **only once** per permission check
3. **Short-Circuit**: Global rules stop validation as soon as one fails
4. **Lazy Evaluation**: Intermediates are resolved only if necessary

### Tips for Best Performance

```typescript
// ✅ GOOD: Put most restrictive rules first
rules: [
  IpRule(),      // Fast, filters many
  WithRule(),    // May fetch resource
  TimeRule(),    // Fast
]

// ❌ BAD: Everyone has access, providers are useless
sources: [
  alwaysAllowProvider(),  // ← Useless if you have this
  ownerProvider(...),     // ← Never used
]

// ✅ GOOD: Specific provider
sources: [
  roleBasedProvider(),  // Return quickly if wrong role
  ownerProvider(...),
]
```

---

## 🔧 API Reference

### Core Functions

#### `createPermissionSystem<PS, TRules>(config)`

Creates a permission system.

```typescript
const permSystem = createPermissionSystem({
  schemas: PermissionSchemas,
  sources: PermissionProvider[],
  rules?: readonly PermissionRule[],
  maxIntermediateDepth?: number,
});
```

#### `permission<C, TRules>(fetchTarget?, rules?)`

Creates a permission.

```typescript
// No context, no rules
permission()

// With context
permission<ArticleId>(getArticle)

// With context + rules
permission(getArticle, [FilterRule()] as const)
```

#### `intermediate<C, TRules>(provide, fetchTarget?, rules?)`

Creates an intermediate permission.

```typescript
intermediate(
  (ctx) => [
    { ...ctx, key: "article.read" },
    { ...ctx, key: "article.update" },
  ],
  getArticle
)
```

### Permission System Methods

#### `permSystem.can<K>(subject, key, ...target?)`

Checks a permission for a given subject.

```typescript
// Without target
await permSystem.can(user, "article.create")

// With target
await permSystem.can(user, "article.read", "article:1")

// Return
type PermissionResult<TOutput> = {
  ok: boolean;
  output?: TOutput;  // Type inferred from rules
}
```

#### `permSystem.context(ctx)`

Creates a checker with shared context and cache.

```typescript
const checker = permSystem.context({
  subject: user,           // Required
  checkDate: new Date(),   // Optional (for TimeRule)
  ips: ["192.168.1.1"],   // Optional (for IpRule)
  // ... other custom properties
});

// All can() of the checker share the same cache
await checker.can("article.read", "article:1");   // FETCH
await checker.can("article.update", "article:1"); // CACHE HIT
```

**Return**: `{ can<K>(key, ...target?) => Promise<PermissionResult<...>> }`

### Built-in Providers

#### `directProvider(permissions)`

Provider with static permissions.

```typescript
directProvider([
  { subject: user1, key: "article.create" },
  { subject: user2, key: "article.read", target: "article:*" },
])
```

#### `ownerProvider(keys, targetPattern, metadata?)`

Ownership-based provider.

```typescript
ownerProvider(
  ["article.read", "article.update"],
  "article:*",
  { filter: { _id: true, title: true } }
)
```

### Built-in Rules

#### Global Rules

- `TimeRule()`: Validates time constraints (`startDate`, `endDate`)
- `IpRule()`: Validates IP restrictions (`allowedIps`)
- `WithRule()`: Validates resource constraints (`with`)

#### Output Rules

- `FilterRule()`: Applies field-level filtering

### Utilities

#### `matchPath(requested, pattern)`

Matches a path with wildcards.

```typescript
matchPath("article:123", "article:*")  // true
matchPath(["article:1", "comment:2"], ["article:*", "*"])  // true
```

#### `applyFilter(obj, filterSpec)`

Applies a filter to an object.

```typescript
applyFilter(
  { _id: 1, name: "John", password: "secret" },
  { _id: true, name: true }
)
// → { _id: 1, name: "John" }
```

#### `mergeFilters(filter1, filter2)`

Merges two filters (union).

```typescript
mergeFilters(
  { _id: true, name: true },
  { name: true, email: true }
)
// → { _id: true, name: true, email: true }
```

---

## 🆚 Comparison with Other Libraries

| Feature | CASL | Casbin | **Library_2** |
|---------|------|--------|---------------|
| Type Safety | ⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ |
| Field-level permissions | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| Auto-filtering | ❌ | ❌ | ✅ |
| Multi-permission accumulation | ❌ | ❌ | ✅ |
| Output metadata | ⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ |
| Hierarchical permissions | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Flexible providers | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 📝 License

MIT

---

## 🤝 Contributing

Contributions welcome! See examples in `/playground` for usage patterns.

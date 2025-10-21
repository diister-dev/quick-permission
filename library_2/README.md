# Quick Permission - Library 2

Une bibliothèque TypeScript de gestion de permissions **type-safe**, **flexible** et **composable** avec support pour les permissions hiérarchiques, le filtrage field-level, et l'accumulation de métadonnées.

## 🎯 Caractéristiques Principales

### ✨ **Type Safety Extrême**
```typescript
// ✅ TypeScript force le bon type d'argument
await permSystem.can(user, "article.read", articleId);  // Accepte ArticleId
await permSystem.can(user, "article.create");           // N'accepte pas d'argument

// ✅ Le type de output est inféré automatiquement
const result = await permSystem.can(user, "article.read", "article:1");
result.output?.filter  // Type: Record<string, boolean> | undefined
result.output?.data    // Type: any
```

### 🔥 **Field-Level Permissions avec Accumulation**
```typescript
// Plusieurs permissions peuvent contribuer
// Owner permission : { filter: { _id, title, owner, salary } }
// Public permission : { filter: { _id, title, body } }
// Contributor permission : { filter: { views } }

const result = await permSystem.can(ownerUser, "article.read", "article:1");
// result.output.data = { _id, title, body, owner, salary, views }
// ↑ Union de tous les filters !
```

### 🎪 **Permissions Intermédiaires Récursives**
```typescript
"article.manage": intermediate((ctx) => [
  { ...ctx, key: "article.read" },
  { ...ctx, key: "article.update" },
  { ...ctx, key: "article.comment.manage", target: [ctx.target, "*"] }
])

// Résolution récursive avec max depth configurable
```

### 🧩 **Architecture Providers + Rules**
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

## 📚 Guide d'Utilisation

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

### 1. Définir les Permissions

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
  // Permission simple
  "article.create": permission(),

  // Permission avec context + field filtering
  "article.read": permission(getArticle, [FilterRule()] as const),

  // Permission avec context mais sans rules
  "article.update": permission(getArticle),

  // Permission intermédiaire (expand to children)
  "article.manage": intermediate(
    (ctx) => [
      { subject: ctx.subject, key: "article.read", target: ctx.target },
      { subject: ctx.subject, key: "article.update", target: ctx.target },
      { subject: ctx.subject, key: "article.delete", target: ctx.target },
    ],
    getArticle
  ),

  // Permission avec nested context
  "article.comment.delete": permission(getComment),
};
```

### 2. Créer des Providers

Les **providers** sont des sources de permissions. Ils retournent les permissions d'un sujet.

```typescript
import { directProvider, ownerProvider } from "./library_2/mod.ts";
import type { PermissionProvider } from "./library_2/mod.ts";

// Provider 1 : Permissions statiques
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

// Provider 2 : Permissions basées sur ownership
const ownerPerms = ownerProvider(
  ["article.read", "article.update", "article.delete"],
  "article:*",
  {
    filter: { _id: true, title: true, body: true, owner: true }
  }
);

// Provider 3 : Custom provider (ex: from database)
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

// Provider 4 : Conditional provider
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

### 3. Créer le Système de Permissions

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

### 4. Vérifier les Permissions

```typescript
const user = { id: "user:123" };

// Permission sans context
const canCreate = await permSystem.can(user, "article.create");
if (canCreate.ok) {
  // User can create articles
}

// Permission avec context
const canRead = await permSystem.can(user, "article.read", "article:1");
if (canRead.ok) {
  // User can read article:1
  console.log("Allowed fields:", canRead.output?.filter);
  console.log("Filtered data:", canRead.output?.data);
}

// Permission avec context custom
const checker = permSystem.withContext({
  checkDate: new Date("2024-01-01"),
  ips: ["192.168.1.1"],
});

const result = await checker.can(user, "article.read", "article:1");
```

---

## 🧪 Exemples Complets

### Exemple 1 : Blog avec Field Filtering

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

### Exemple 2 : Permissions Hiérarchiques

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

### Exemple 3 : Permissions Conditionnelles

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

---

## 🏗️ Architecture

### Flow de Validation

```
1. permSystem.can(subject, key, target)
   ↓
2. Appel de tous les providers → [permissions]
   ↓
3. Résolution des intermediates (récursif) → [permissions résolues]
   ↓
4. Filter par key + target matching → [permissions matchées]
   ↓
5. Application des global rules (Time, IP, With) → [permissions valides]
   ↓
6. Fetch de la resource (une seule fois)
   ↓
7. Application des output rules (FilterRule) → outputs
   ↓
8. Merge des outputs (union) → output final
   ↓
9. Return { ok: true, output }
```

### Composants

| Composant | Rôle | Exemple |
|-----------|------|---------|
| **Permission** | Définit une permission avec contexte optionnel | `permission(getArticle)` |
| **Intermediate** | Permission qui se résout en d'autres permissions | `intermediate((ctx) => [...])` |
| **Provider** | Source de permissions pour un sujet | `ownerProvider(...)` |
| **Global Rule** | Validation globale (s'applique à toutes les permissions) | `TimeRule()`, `IpRule()` |
| **Output Rule** | Génère de la métadata/output | `FilterRule()` |

---

## 🎨 Patterns Avancés

### Pattern 1 : Multi-Tenant avec Organisations

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

### Pattern 2 : Rate Limiting

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

### Pattern 3 : Permissions Temporaires

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

### Optimisations Intégrées

1. **Resource Fetching** : La resource est fetchée **une seule fois** même si plusieurs permissions matchent
2. **Short-Circuit** : Les global rules arrêtent la validation dès qu'une échoue
3. **Lazy Evaluation** : Les intermediate ne sont résolus que si nécessaire

### Tips pour Meilleures Performances

```typescript
// ✅ BON : Mettre les rules les plus restrictives en premier
rules: [
  IpRule(),      // Rapide, filtre beaucoup
  WithRule(),    // Peut fetch resource
  TimeRule(),    // Rapide
]

// ❌ MAUVAIS : Tout le monde a accès, providers inutiles
sources: [
  alwaysAllowProvider(),  // ← Inutile si on a ça
  ownerProvider(...),     // ← Jamais utilisé
]

// ✅ BON : Provider spécifique
sources: [
  roleBasedProvider(),  // Return vite si pas le bon role
  ownerProvider(...),
]
```

---

## 🔧 API Reference

### Core Functions

#### `createPermissionSystem<PS, TRules>(config)`

Crée un système de permissions.

```typescript
const permSystem = createPermissionSystem({
  schemas: PermissionSchemas,
  sources: PermissionProvider[],
  rules?: readonly PermissionRule[],
  maxIntermediateDepth?: number,
});
```

#### `permission<C, TRules>(fetchTarget?, rules?)`

Crée une permission.

```typescript
// No context, no rules
permission()

// With context
permission<ArticleId>(getArticle)

// With context + rules
permission(getArticle, [FilterRule()] as const)
```

#### `intermediate<C, TRules>(provide, fetchTarget?, rules?)`

Crée une permission intermédiaire.

```typescript
intermediate(
  (ctx) => [
    { ...ctx, key: "article.read" },
    { ...ctx, key: "article.update" },
  ],
  getArticle
)
```

### Built-in Providers

#### `directProvider(permissions)`

Provider avec permissions statiques.

```typescript
directProvider([
  { subject: user1, key: "article.create" },
  { subject: user2, key: "article.read", target: "article:*" },
])
```

#### `ownerProvider(keys, targetPattern, metadata?)`

Provider basé sur ownership.

```typescript
ownerProvider(
  ["article.read", "article.update"],
  "article:*",
  { filter: { _id: true, title: true } }
)
```

### Built-in Rules

#### Global Rules

- `TimeRule()` : Valide les contraintes temporelles (`startDate`, `endDate`)
- `IpRule()` : Valide les restrictions IP (`allowedIps`)
- `WithRule()` : Valide les contraintes sur la resource (`with`)

#### Output Rules

- `FilterRule()` : Applique le field-level filtering

### Utilities

#### `matchPath(requested, pattern)`

Match un path avec wildcards.

```typescript
matchPath("article:123", "article:*")  // true
matchPath(["article:1", "comment:2"], ["article:*", "*"])  // true
```

#### `applyFilter(obj, filterSpec)`

Applique un filtre à un objet.

```typescript
applyFilter(
  { _id: 1, name: "John", password: "secret" },
  { _id: true, name: true }
)
// → { _id: 1, name: "John" }
```

#### `mergeFilters(filter1, filter2)`

Merge deux filters (union).

```typescript
mergeFilters(
  { _id: true, name: true },
  { name: true, email: true }
)
// → { _id: true, name: true, email: true }
```

---

## 🆚 Comparaison avec Autres Bibliothèques

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

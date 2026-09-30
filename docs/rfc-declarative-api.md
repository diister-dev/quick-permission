# RFC — API déclarative pour `quick-permission`

> **Statut :** **implémentée** dans `library/declarative/`. Exposée via le sub-export
> `@diister/quick-permission/declarative`. 80 tests dédiés, 187 tests totaux verts (0 régression sur l'ancien runtime).
>
> **Décision majeure post-PoC :** API en **deux étapes** (`permission(config).rules([...])`)
> au lieu de single-call. Justification dans la section "Décision two-call".
>
> **Ce qui marche :** target builders, seg, payload, rules (match/filter/custom/time/ip),
> permission/intermediate, factory typé sur metadata, createSystem avec list/tree/schema/can,
> exécution complète des rules, intermediate expansion (grant à un nœud expanse aux descendants),
> filter accumulation entre multiple grants matching, context override (checkDate/checkIp).

## TL;DR

L'API actuelle de `quick-permission` permet de checker des permissions de manière type-safe au call-site (`can(user, key, target)`), mais elle **ne porte aucune métadonnée déclarative** sur les permissions elles-mêmes : pas de description, pas de spec du target, pas de typage du payload émis par les providers, pas de réflexion runtime.

Cette RFC propose une **forme objet enrichie** pour `permission()` et `intermediate()` qui :

- Ajoute un slot `metadata` libre, typé par projet via `createPermissionFactory<TMeta>()`
- Déclare la **forme du target** (`target.none()` / `target.optional()` / `target.required()` / `target.path()`)
- Type le payload des grants côté provider (`payload<T>()`)
- Garantit la cohérence target ↔ fetch ↔ rules par inférence TypeScript
- Reste backward-compatible avec la forme positional `permission(fetcher, rules)` actuelle

L'objectif est d'avoir une **source unique de vérité typée** d'où découle tout le reste, et d'exposer une API de réflexion (`permSystem.list()`, `permSystem.tree()`) qui permet de générer une matrice UI sans hardcoder de catalogue parallèle.

---

## Contexte

### Le problème dominant

Aujourd'hui une permission se déclare comme :

```typescript
"expositions.badges.read": p.permission(getBadgeWithExposition, [
  p.WithRule("withExposition", (_, value) => value.exposition),
  p.WithRule("withBadge",       (_, value) => value.badge),
  p.FilterRule(                 (_, value) => value.badge),
])
```

Et un provider émet :

```typescript
{
  key: "expositions.badges.read",
  target: [expositionId, "badge:*"],
  withCollaborator: { exhibitorId: exhibitor._id },
}
```

Quatre choses doivent rester synchronisées **à la main** :

1. **L'arity du target** (ici 2 segments)
2. **La signature du fetcher** `(target: [string, string]) => Promise<R>`
3. **La forme du retour du fetcher** `R = { exposition, badge }`
4. **Les noms des rules** `"withExposition"`, `"withBadge"` (stringly-typed contre les payloads des grants)

Si tu renommes un segment ou changes la forme du retour, **rien ne casse à la compilation**. C'est la cause #1 de 403 silencieux selon l'audit Diivento.

### Le besoin frontend

Pour générer une matrice de permissions dans une admin UI, le frontend a besoin de :

- La liste de toutes les permissions exposées
- Une description lisible de chacune
- La forme du target (pour rendre des pickers : "global" / "user picker" / "expo + badge picker" / etc.)
- Une organisation hiérarchique (groupes)

Aujourd'hui rien de tout ça n'existe au runtime — il faudrait soit hardcoder un catalogue parallèle (drift garanti), soit du CRUD-only sur le name du rôle (= ce que fait l'ancien website Diivento).

---

## Objectifs

1. **Type-safety end-to-end** : target → fetch → rules → payload, toutes les frontières doivent être typées et incohérences détectées à la compilation.
2. **Métadonnées déclaratives** : chaque permission porte sa description et tout ce que le projet veut y mettre.
3. **Réflexion runtime** : `permSystem.list()` / `permSystem.tree()` exposent les permissions et leurs métadonnées.
4. **Lib agnostique** : pas d'opinion sur le format d'ID, pas de validation forcée, pas de framework d'i18n.
5. **Backwards compatible** : l'ancienne signature `permission(fetcher, rules)` continue de marcher pendant la migration.
6. **Lisible** : la décla d'une permission doit se lire comme une phrase, pas comme un puzzle TS.

---

## API finale

### Vue d'ensemble

```typescript
import { match, filter, custom, time, ip } from "@diister/quick-permission/rules"
import { target, seg, payload, createPermissionFactory } from "@diister/quick-permission"

type DiiventoMeta = {
  description: string;
  group?: string;
  icon?: string;
  deprecated?: boolean;
};

const { permission, intermediate, createSystem } =
  createPermissionFactory<DiiventoMeta>();

const schema = {
  "users.create": permission({
    metadata: { description: "Créer un utilisateur" },
    target: target.none(),
  }).rules([]),

  "users.read": permission({
    metadata: { description: "Lire le profil d'un utilisateur" },
    target: target.optional("user"),
    fetch: ([id]) => getUserById(id ?? ""),
  }).rules([
    match("user", v => v),
    filter(v => v),
  ]),

  "expositions.badges.read": permission({
    metadata: { description: "Lire un badge d'exposition" },
    target: target.path("exposition", "badge"),
    fetch: ([e, b]) => getBadgeWithExposition(e, b),
  }).rules([
    match("exposition", v => v.exposition),
    match("badge",      v => v.badge),
    filter(v => v.badge),
  ]),

  "expositions.collaborators.manage": permission({
    metadata: { description: "Gérer un collaborateur" },
    target: target.path("exposition", "collaborator"),
    fetch: ([e, c]) => getCollaboratorWithExposition(e, c),
    payload: payload<{ exhibitorId: string }>(),
  }).rules([
    match("exposition",   v => v.exposition),
    match("collaborator", v => v.collaborator),
    filter(v => v.collaborator),
    custom(ctx => ctx.payload.exhibitorId.length > 0), // payload typé !
  ]),
};

const permSystem = createSystem({ schema, providers: [...] });
```

### Décision two-call (post-PoC)

**Pourquoi pas single-call ?** Le PoC a démontré qu'avec un seul appel
`permission({ target, fetch, rules, ... })`, TypeScript ne propage **pas** le
type `R` du retour de `fetch` vers les extracteurs des rules dans le même
appel. La fonction `match("a", v => v.a)` infère son propre `R` au call-site
(= `unknown` faute de contexte), avant que TS n'ait fixé le `R` du `permission`
parent. C'est la limite "higher-order inference" connue de TS.

Tentatives échouées : `NoInfer<>`, `match` curry (`match("a")(v => v.a)`),
réordonnancement des generics. Aucune ne fait propager `R` du fetch vers les
rules dans une signature objet plate.

**Solution two-call** : on découpe en deux étapes. La première résout `T`,
`R`, `P` à partir de `target`/`fetch`/`payload`. La seconde reçoit ces types
déjà fixés, et les rules sont contextually-typées contre eux :

```typescript
permission({
  target: target.path("a", "b"),
  fetch: ([a, b]) => Promise.resolve({ a, b }),
  payload: payload<{ x: string }>(),
})
.rules([
  match("a", v => v.a),               // v: { a: string; b: string }
  match("b", v => v.b),               // ✓
  custom(ctx => ctx.payload.x.length), // ctx.payload: { x: string } ✓
]);
```

**Coût :** un `.rules([...])` à chaîner après le config object. Pas un builder
chainable de 5 méthodes — juste un split en 2 étapes. Pour les permissions
sans rules (ex: `target.none()`), on appelle `.rules([])`.

**Bénéfices :** Q1 (typage payload dans `custom`) résolu, Q3 (cross-check
des segments) résolu, et le pattern dominant Diivento est complètement
typé end-to-end.

### `permission(config)`

```typescript
type PermissionConfig<TMeta, TTarget, R, TPayload> = {
  metadata?: TMeta;
  target: TTarget;
  fetch?: (args: TargetArgs<TTarget>) => Promise<R>;
  rules?: Rule<TTarget, R, TPayload>[];
  payload?: PayloadSpec<TPayload>;
};
```

- `metadata` — typé par le `TMeta` du factory. Ce que la lib en fait : rien. C'est juste exposé via la reflection API.
- `target` — défini avec les helpers `target.*` (voir plus bas).
- `fetch` — signature **inférée** du target. Pour un `target.path("a", "b")`, doit accepter `[string, string]`. Optionnel pour les permissions sans target.
- `rules` — array de rules importées globalement, typées contre target + retour de fetch.
- `payload` — schéma typé du payload que les providers attachent aux grants. Optionnel.

### `intermediate(config)`

Pour les nœuds non-terminaux du tree (groupes) :

```typescript
"expositions": intermediate({
  metadata: { description: "Gestion des expositions", group: "Core" },
  children: {
    read:   permission({ ... }),
    badges: intermediate({
      metadata: { description: "Badges" },
      children: {
        read:   permission({ ... }),
        verify: permission({ ... }),
      },
    }),
  },
})
```

Forme objet identique à `permission()` pour cohérence (pas d'arguments positionnels).

### `target.*` — déclaration de la forme du target

```typescript
target.none()                              // pas de target (perm globale)
target.optional(spec)                      // 0 ou 1 segment
target.required(spec)                      // exactement 1 segment
target.path(spec1, spec2, ...specN)        // N segments, ordre par position des args
```

Où `spec` est :

```typescript
"user"                                     // segment de type "user", name = "user"
seg(name, type)                            // name et type custom
seg(name, ["user", "agent"])               // segment multi-type
seg(name, "*")                             // segment opaque (any type)
seg(name, type, { validate: fn })          // avec validation custom
```

**Exemples :**

```typescript
target.none()                               // → fetch: jamais appelé
target.required("user")                     // → fetch reçoit [string]
target.path("exposition", "badge")          // → fetch reçoit [string, string]
target.path(seg("src", "user"), seg("dst", "user"))  // 2 segments user, names distincts
target.path("exposition", seg("any", "*"))  // expo + segment libre
```

### Helpers de rules (importés)

Tous depuis `@diister/quick-permission/rules` :

```typescript
match(segmentName, extractor)               // sugar de WithRule
filter(extractor)                           // sugar de FilterRule
custom(predicate)                           // règle libre
time()                                      // TimeRule
ip()                                        // IpRule
```

**`match(segmentName, extractor)`** — typé contre les segments du target. Si `target.path("a", "b")`, alors seuls `match("a", ...)` et `match("b", ...)` compilent. Le retour de `extractor(v)` est libre, mais `v` est typé d'après le retour de `fetch`.

**`filter(extractor)`** — applique le filter du grant sur la sous-ressource extraite. `v` est typé d'après le retour de `fetch`.

**`custom(predicate)`** — `predicate` reçoit `{ subject, target, resource, grant, payload }` typé. Pour les règles qui ne rentrent dans aucune case standard.

**`time()` / `ip()`** — règles génériques, pas de paramètres.

### `payload<T>()`

Déclare le shape du payload que les providers attachent aux grants :

```typescript
payload: payload<{ exhibitorId: string; expiresAt?: Date }>()
```

Quand un provider émet :

```typescript
{
  key: "expositions.collaborators.manage",
  target: [...],
  payload: { exhibitorId: "..." },          // typé contre le payload<T>()
}
```

TS valide à l'émission. Plus de drift silencieux entre provider et consumer.

### `createPermissionFactory<TMeta>()`

Bootstrap d'un factory typé pour le projet :

```typescript
type DiiventoMeta = {
  description: string;
  group?: string;
  icon?: string;
};

const { permission, intermediate, createSystem } =
  createPermissionFactory<DiiventoMeta>();
```

Toutes les permissions créées via ce factory sont typées contre `DiiventoMeta`. Si un projet veut un metadata différent, il appelle son propre factory.

Default sans factory : `TMeta = Record<string, unknown>`.

### Reflection API

```typescript
permSystem.list()
// → Array<{ key: string, metadata: TMeta, target: TargetSpec, payload?: PayloadSpec }>

permSystem.tree()
// → arbre intermediate → leaves, avec metadata à chaque nœud

permSystem.schema(key)
// → la décla typée d'une perm précise
```

Le frontend peut consommer ça via un endpoint `GET /api/v1/permissions/schema` (statique, cacheable).

---

## Décisions de design

Chaque décision listée ici a été discutée et tranchée. Les alternatives rejetées sont notées avec leur raison.

### D1 — `metadata` libre typé via factory

✅ **Choisi :** `metadata: TMeta` libre, typé par projet via `createPermissionFactory<TMeta>()`.
❌ **Rejeté :** `description: string` baked dans la lib.

**Pourquoi :** la lib n'a aucune raison de connaître les champs métiers (icon, group, deprecated, owner, tags, i18n keys, etc.). Le factory generic donne au projet un typing strict sans contraindre la lib.

### D2 — `target.path(...)` arguments positionnels

✅ **Choisi :** `target.path("exposition", "badge")` avec ordre par position.
❌ **Rejeté :** `target.path({ exposition: "exposition", badge: "badge" })` forme objet.

**Pourquoi :** les objets JS n'ont pas de notion d'ordre dans la sémantique du langage (même si les clés string sont stables en pratique). Un dev qui réordonne les clés "pour la lisibilité" casserait la logique runtime sans warning. Les arguments positionnels rendent l'ordre explicite et indéplaçable.

### D3 — `seg(name, type)` quand name ≠ type

✅ **Choisi :** shorthand `"user"` quand name == type, `seg("src", "user")` quand ils diffèrent.
❌ **Rejeté :** toujours `seg(name, type)` même quand redondant.

**Pourquoi :** le cas dominant `name = type` (`"exposition"`, `"badge"`, `"user"`) est très commun, le shorthand garde la lecture fluide. Le cas `name ≠ type` (deux users dans un même target) est rare et mérite une syntaxe plus explicite.

### D4 — Extracteur toujours explicite dans les rules

✅ **Choisi :** `match("badge", v => v.badge)` extracteur obligatoire.
❌ **Rejeté :** `match("badge")` avec default magique `v => v.badge`.

**Pourquoi :** le default magique :
- Crée une convention non-évidente (le retour de `fetch` doit avoir des clés qui matchent les segments)
- Force un cas spécial pour mono-segment (`v => v` au lieu de `v => v.user`)
- Cache un couplage entre noms de segments et forme du retour

L'extracteur explicite coûte 5 caractères, et rend tout uniforme et lisible.

### D5 — Helpers de rules importés globalement, pas dans une closure

✅ **Choisi :** `import { match, filter, ... } from ".../rules"` puis `rules: [match(...), ...]`.
❌ **Rejeté :** `rules: ({ match, filter, ... }) => [...]` closure context.

**Pourquoi :** la closure form bundle un context bag injecté à chaque permission, ce qui :
- Suggère faussement qu'il faut "instancier" les helpers
- Casse la lecture linéaire (closure = un niveau d'indentation de plus)
- N'apporte rien de plus que les imports globaux côté DX

Le typing reste préservé via TS variance : `match("foo", ...)` retourne un `Rule<"foo", R>` qui erreur si "foo" n'est pas dans les segments du target.

### D6 — Forme objet pour `permission` et `intermediate`, pas chainable

✅ **Choisi :** `permission({ metadata, target, fetch, rules, payload })`.
❌ **Rejeté :** `permission().description(...).target(...).fetch(...).rule(...)` builder chainable.

**Pourquoi :**
- La forme objet est plus lisible (tout est visible d'un coup)
- Sérialisable et inspectable
- Pas de stateful builder (pas de bug de "j'ai oublié `.build()`")
- Le typing TS est plus simple (un seul generic à propager au lieu d'un type qui mute à chaque chain)

### D7 — `payload<T>()` slot dédié

✅ **Choisi :** slot séparé pour le payload des grants.
❌ **Rejeté :** mélanger le payload dans les rules ou dans le metadata.

**Pourquoi :**
- Le metadata est statique (description, icon, etc.) — il décrit la permission
- Le payload est dynamique (attaché aux grants par les providers) — il décrit chaque instance
- Les mélanger casse la sémantique. Le slot dédié permet de typer chacun indépendamment.

### D8 — Fetch return = composite typé qui flow partout

✅ **Choisi :** `fetch` retourne un objet (composite ou simple), toutes les rules opèrent dessus.
❌ **Rejeté :** plusieurs fetchers per-segment, ou fetch return forcé à `Record<segmentName, T>`.

**Pourquoi :** le pattern dominant Diivento est un fetcher composite (`getBadgeWithExposition`) qui fait UNE requête DB et retourne plusieurs ressources liées. Forcer un fetcher per-segment = N requêtes au lieu de 1. Forcer le shape `{ a, b }` = wrappers triviaux partout.

Le composite est donc libre, et chaque rule extrait ce qui l'intéresse via une fonction explicite.

### D9 — Pas de typing du subject

✅ **Choisi :** subject reste `unknown` (ou typé à la racine du système, pas par perm).
❌ **Rejeté :** typer le subject par permission.

**Pourquoi :** le provider `permissionSourceExpositionsAccountLess` de Diivento utilise `subject.id` comme **email address**, pas comme refId user. Si on contraignait subject à `{ id: string (refId) }`, on casserait ce flow en production. Out of scope.

### D10 — Pas d'enforcement du format `<type>:<id>`

✅ **Choisi :** la lib ne touche pas au format des IDs. C'est une convention Diivento.
❌ **Rejeté :** valider que les IDs matchent un format `<resource>:<id>`.

**Pourquoi :** d'autres consumers de la lib peuvent utiliser des UUIDs, des numbers, des paths, ou n'importe quoi. La lib reste neutre. Si un projet veut imposer un format, il passe un `validate` dans `seg(name, type, { validate })`.

### D11 — `target.path()` variadique

✅ **Choisi :** accepte N segments, même si Diivento ne va pas au-delà de 2 aujourd'hui.
❌ **Rejeté :** longueur fixe à 2.

**Pourquoi :** future-proof, coût zéro côté implémentation, et certaines hiérarchies futures (lead/contacts sous exhibitor, par exemple) pourraient pousser à 3 segments.

### D12 — Multi-type via array dans `seg`

✅ **Choisi :** `seg("subject", ["user", "agent"])` pour les segments qui acceptent plusieurs types.
❌ **Rejeté :** une seule type par segment.

**Pourquoi :** cas réel envisageable (révoquer une session de user OU service-account). Coût zéro si inutilisé. À garder comme safety net.

### D13 — Wildcard `"*"` au niveau decla (en plus du grant)

✅ **Choisi :** `seg("any", "*")` accepté à la déclaration, signifiant "ce segment est sémantiquement libre".
❌ **Rejeté :** wildcards uniquement dans les grants.

**Pourquoi :** permet à l'UI de savoir qu'un picker typé n'est pas approprié pour cette position (input texte libre ou recherche cross-resource). Les wildcards dans les grants (`["badge:*"]`) restent gérés par `matchPath` comme aujourd'hui — c'est un autre niveau.

### D14 — Backwards compat via overload

✅ **Choisi :** `permission(fetcher, rules)` (ancienne signature) continue de marcher en parallèle de `permission({ ... })`.
❌ **Rejeté :** hard break + codemod.

**Pourquoi :** Diivento a ~30-50 permissions à migrer. Un overload permet la migration progressive. Une fois toutes les perms migrées, on pourra déprécier puis supprimer l'ancienne signature dans une release ultérieure.

### D15 — Naming `optional` / `required` / `path` / `none`

✅ **Choisi :** `target.none()` (0), `target.optional(spec)` (0..1), `target.required(spec)` (1), `target.path(...)` (N).

**Pourquoi :**
- `optional` et `required` se lisent comme une phrase ("le target est optionnel/requis")
- `path` capture l'idée hiérarchique (et matche le `TargetPath` interne de la lib)
- `none` plus court que `target.empty()` ou `target.global()`

Alternatives envisagées : `single`/`one`, `maybe`, `tuple`. Toutes moins claires que la combo retenue.

---

## Patterns Diivento couverts

### Permission globale (sans target)

```typescript
"users.create": permission({
  metadata: { description: "Créer un utilisateur" },
  target: target.none(),
})
```

### Permission mono-segment, target optionnel

```typescript
"users.read": permission({
  metadata: { description: "Lire le profil d'un utilisateur" },
  target: target.optional("user"),
  fetch: ([id]) => getUserById(id),
  rules: [
    match("user", v => v),
    filter(v => v),
  ],
})

// Usage:
can(user, "users.read")              // global → check sans target
can(user, "users.read", "user:abc")  // spécifique → fetch + rules
```

### Permission mono-segment, target requis

```typescript
"users.update": permission({
  metadata: { description: "Modifier un utilisateur" },
  target: target.required("user"),
  fetch: ([id]) => getUserById(id),
  rules: [
    match("user", v => v),
    filter(v => v),
  ],
})

// Usage:
can(user, "users.update", "user:abc")   // OK
can(user, "users.update")               // ❌ TS error: target requis
```

### Permission tuple (pattern dominant Diivento)

```typescript
"expositions.badges.read": permission({
  metadata: { description: "Lire un badge d'exposition" },
  target: target.path("exposition", "badge"),
  fetch: ([e, b]) => getBadgeWithExposition(e, b),
  rules: [
    match("exposition", v => v.exposition),
    match("badge",      v => v.badge),
    filter(v => v.badge),
  ],
})
```

### Permission avec payload provider typé

```typescript
"expositions.collaborators.manage": permission({
  metadata: { description: "Gérer un collaborateur" },
  target: target.path("exposition", "collaborator"),
  fetch: ([e, c]) => getCollaboratorWithExposition(e, c),
  rules: [
    match("exposition",   v => v.exposition),
    match("collaborator", v => v.collaborator),
    filter(v => v.collaborator),
  ],
  payload: payload<{ exhibitorId: string }>(),
})

// Provider:
{
  key: "expositions.collaborators.manage",
  target: [expositionId, "collaborator:*"],
  payload: { exhibitorId: exhibitor._id },  // ← typé contre le payload<T>()
}
```

### Permission cross-resource avec custom rule

```typescript
"expositions.audit.read": permission({
  metadata: { description: "Audit d'une exposition" },
  target: target.path("exposition", seg("entity", ["badge", "visitor", "exhibitor"])),
  fetch: ([e, eid]) => getExpositionAuditTarget(e, eid),
  rules: [
    match("exposition", v => v.exposition),
    custom(({ resource, subject }) => {
      // Logique custom : vérifie que l'entity appartient bien à l'exposition
      return resource.entity.expositionId === resource.exposition._id;
    }),
  ],
})
```

### Tree avec intermediate

```typescript
const schema = {
  "expositions": intermediate({
    metadata: { description: "Gestion des expositions", group: "Core" },
    children: {
      read: permission({
        metadata: { description: "Lire une exposition" },
        target: target.required("exposition"),
        fetch: ([id]) => getExpositionById(id),
        rules: [match("exposition", v => v), filter(v => v)],
      }),

      "badges": intermediate({
        metadata: { description: "Badges" },
        children: {
          read: permission({ ... }),
          create: permission({ ... }),
          verify: permission({ ... }),
        },
      }),
    },
  }),
};

// Résultat de permSystem.tree() :
// expositions — Gestion des expositions
// ├── expositions.read — Lire une exposition
// └── expositions.badges — Badges
//     ├── expositions.badges.read — ...
//     ├── expositions.badges.create — ...
//     └── expositions.badges.verify — ...
```

---

## Non-goals (ce qu'on ne fait PAS)

### Subject typing

La lib ne contraint pas la forme du subject. Raison : `permissionSourceExpositionsAccountLess` (Diivento) utilise `subject.id` comme email. Casser ça en imposant un format = régression production.

Si un projet veut typer son subject, il le fait à la racine de son système (`createSystem<Subject>({...})`).

### Validation du format `<type>:<id>`

La lib ne valide pas le format des IDs. C'est une convention Diivento (refId), pas un standard de la lib. Les autres consumers peuvent utiliser UUIDs, numbers, paths.

Pour imposer un format dans son projet : `seg(name, type, { validate: (s) => /^user:/.test(s) })`.

### i18n des descriptions

La lib type `metadata: TMeta` mais ne fait rien des contenus. Si un projet veut i18n, il met une key dans `description` et résout côté UI. Out of scope.

### Variadic paths

Pas de `target.variadic(...)` (genre target de longueur variable). YAGNI selon l'audit Diivento. Si un cas survient, on rouvrira.

### Enforcement du legacy `"badge:ANY"`

L'ancien backend Diivento utilise parfois `"badge:ANY"` comme placeholder. C'est un workaround call-site, pas un pattern à supporter dans la lib. La nouvelle API ne tente pas de le valider — `target.required("badge")` est satisfait par n'importe quelle string, peu importe son format.

---

## Migration

### Stratégie : overload + coexistence

Les deux signatures coexistent dans la lib :

```typescript
// Ancienne signature (continue de marcher)
permission(fetcher, [WithRule(...), FilterRule(...)])

// Nouvelle signature
permission({ metadata, target, fetch, rules, payload })
```

TS distingue les deux par le type du premier argument (function vs object). Pas de conflit.

### Migration progressive Diivento

1. **Phase 1 (lib)** : ship la nouvelle API en parallèle. Pas de breaking change. Bump version mineur (`0.9.0`).
2. **Phase 2 (consumer)** : migrer les permissions Diivento progressivement, perm par perm. Idéalement domaine par domaine pour cohérence.
3. **Phase 3 (lib)** : déprécier l'ancienne signature avec warning de compile.
4. **Phase 4 (lib)** : retirer l'ancienne signature dans une major (`1.0.0`).

### Codemod ?

Pas nécessaire pour la phase 2. La transformation est mécanique :

```typescript
// Avant
"expositions.badges.read": p.permission(getBadgeWithExposition, [
  p.WithRule("withExposition", (_, v) => v.exposition),
  p.WithRule("withBadge", (_, v) => v.badge),
  p.FilterRule((_, v) => v.badge),
])

// Après
"expositions.badges.read": permission({
  metadata: { description: "Lire un badge d'exposition" },
  target: target.path("exposition", "badge"),
  fetch: ([e, b]) => getBadgeWithExposition(e, b),
  rules: [
    match("exposition", v => v.exposition),
    match("badge", v => v.badge),
    filter(v => v.badge),
  ],
})
```

Le seul ajout cognitif est le `metadata.description`, le reste est une re-écriture syntaxique. Faisable à la main pour ~50 perms.

---

## Questions ouvertes (post-PoC)

### Q1 — Bridge `payload` ↔ `custom` rule

✅ **RÉSOLU** par la décision two-call. `payload<T>()` posé dans la première
étape fixe `P`, et `custom(ctx => ctx.payload.foo)` est contextually-typé
contre ce `P` dans la seconde étape. Vérifié dans le PoC (CASE 4 et CASE 5).

### Q2 — Label optionnel sur `filter`

À trancher pendant l'implémentation. Pas bloquant pour le typing — c'est
juste de la métadonnée pour la matrice UI.

### Q3 — Le PoC TypeScript compile-t-il vraiment ?

✅ **RÉSOLU** dans `playground/declarative-api-poc.ts` :
- ✓ Inférence `R` depuis fetch vers les extracteurs des rules
- ✓ Cross-check `match("foo", ...)` contre les segments du target
- ✓ Inférence `P` depuis `payload<T>()` vers `custom(ctx)`
- ✓ Cross-check des champs du payload dans `custom`
- ⚠️ Limite TS sur l'arity du destructuring (voir section "Limites TypeScript découvertes")

**Tentatives échouées** avant le two-call :
- `NoInfer<>` placé sur le slot rules — n'aide pas
- `match` curry (`match("a")(v => v.a)`) — `R` reste `unknown`
- Réordonnancement des generics — sans effet
- Forcer fetch obligatoire — sans effet

Cause racine : `match("a", v => v.a)` est typed comme une expression
indépendante AVANT que TS ait le contexte parent du `permission()`. Son
generic `R` est résolu localement à `unknown`, et la juxtaposition avec le
`R` de fetch donne `unknown` (couvre les deux). Le two-call casse ce
problème en fixant `R` AVANT que les rules soient évaluées.

### Q4 — Reflection API : forme exacte du retour

```typescript
permSystem.list()
// → Array<{ key, metadata, target: ???, payload?: ??? }>
```

Que retourner pour `target` et `payload` ? La spec est typée à la déclaration, mais en JSON il faut un format sérialisable. Probable :

```typescript
type TargetSpec = 
  | { kind: "none" }
  | { kind: "optional", segment: SegmentSpec }
  | { kind: "required", segment: SegmentSpec }
  | { kind: "path", segments: SegmentSpec[] }

type SegmentSpec = {
  name: string,
  types: string[] | "*",
  // validate: pas exposable en JSON
}

type PayloadSpec = {
  // ??? (Valibot ? JSON Schema ? juste un marqueur "this perm has a payload" ?)
}
```

Probable que le payload n'expose qu'un marqueur, pas le schéma précis (sinon on couple à un format de validation).

---

## Limites TypeScript découvertes

### Higher-order inference dans une signature plate

Une signature `permission({ fetch, rules })` où `R` apparaît dans les deux slots
ne propage pas `R` de fetch vers rules. Solution : two-call (voir section
"Décision two-call").

### Arity du tuple destructuring

```typescript
// Ces formes sont ACCEPTÉES par TS même si target = path("a", "b") (arity 2) :
fetch: ([e]) => ...        // destructuring lax
fetch: () => ...           // contravariance des paramètres

// Cette forme est REJETÉE :
fetch: (args: [string]) => ...   // annotation explicite force le check
```

Pas spécifique à notre API — c'est comment TypeScript modélise les fonctions JS.
Acceptable car les rules type-checkent quand même les extracteurs contre le
retour de fetch, ce qui rattrape les usages incorrects en aval.

## Prochaines étapes

1. ✅ **PoC TypeScript** — fait, compile cleanly dans `playground/declarative-api-poc.ts`.
2. ✅ **Décision finale** — two-call form (`permission(config).rules([...])`).
3. **Implémentation runtime** dans `library/` — types existent, reste à câbler la logique d'exécution + matchPath + accumulation.
4. **Tests** — couverture des 5 cas du PoC + edge cases runtime (provider grants, accumulation de filtres).
5. **Documentation** — mise à jour du README avec la nouvelle API.
6. **Release** `0.9.0` (mineur, backwards compat via overload sur l'ancienne signature).
7. **Migration Diivento** — progressive, domaine par domaine.
8. **Adoption matrice UI** côté `new_website`.
9. **Dépréciation** de l'ancienne API à terme (post-`1.0.0`).

---

## Annexe — Imports finaux

```typescript
// Lib
import { 
  target,
  seg,
  payload,
  createPermissionFactory,
} from "@diister/quick-permission";

import {
  match,
  filter,
  custom,
  time,
  ip,
} from "@diister/quick-permission/rules";

// Project (Diivento)
import { permission, intermediate, createSystem } from "./permissions/factory";
```

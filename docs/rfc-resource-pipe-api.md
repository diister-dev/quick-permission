# RFC — API Resource-pipe pour `quick-permission`

> **Statut :** **proposée**, PoC complet et vert dans `playground/resource-pipe-poc.ts` (15+ scénarios couvrant single/multi-resource, target paths profonds, dedup intra/inter-grant + cross-permission, opt-in via flags, introspection des rules).
>
> **Décision majeure :** une **primitive unique** `defineRule({ needs, flag, check })` autour de laquelle s'articule toute la lib. Les méthodes resource (`match`, `filter`, `includes`, `requireOwner`, etc.) sont du sucre déclaratif. Le moteur orchestre le fetch + dedup + lazy.
>
> **Cohabitation :** la nouvelle API vit en parallèle de l'API actuelle (`library/declarative/`). Pas de breaking change tant que la migration n'est pas terminée. L'objectif terminal est de déprécier `match`/`filter`/`custom` au profit de `defineRule`.

## TL;DR

L'API déclarative actuelle (`library/declarative/`, sub-export `@diister/quick-permission/declarative`) a résolu les problèmes de typage et d'introspection de la version originale, mais elle laisse encore plusieurs douleurs concrètes :

- **Pas de dedup des fetches** au sein d'un `context()` ni entre permissions partageant la même ressource.
- **Fetch monolithique par permission** (god-fetch composite `getBadgeWithExposition`, etc.) avec couplage permission ↔ data.
- **Pas de cross-resource rules** : impossible d'écrire proprement "le user dans une de mes orgas".
- **Pas de target paths profonds** exploitables (`expositions.programs.registrations.*` est aujourd'hui scopé `target.required("exposition")` faute d'outils pour dédup partiellement sur le path).
- **Opt-ins booléens mélangés avec les constraint specs** dans `with` (pas de slot dédié).
- **Pas de point d'extension propre pour les rules métier** — les devs hackent via `custom` avec descriptors faits main.

Cette RFC propose un modèle où **les ressources sont des entités de première classe**, déclarées une fois et réutilisées entre permissions. Chaque rule déclare ses `needs` (les ressources qu'elle consomme), ce qui permet :

- Dedup automatique par `(resource.id, dedupKey)` au sein d'un `context()`
- Fetch lazy : seules les ressources des rules **actives** pour un grant donné sont fetchées
- Cross-resource gratuit : une rule peut consommer N ressources, le moteur les fetche en parallèle
- Target paths profonds avec dedup partiel par segment (ressource A consomme `target[0..1]`, ressource B consomme `target[0..2]`, etc.)
- Une primitive unique `defineRule` qui rend la lib plus petite ET les rules custom propres

L'API finale tient la promesse "1 perm Diivento = 1 phrase lisible" :

```ts
"expositions.programs.registrations.read": permission({
  target: target.path("exposition", "program", "registration"),
}).rules([
  expositionInfoOf.match(),
  programOf.match(),
  registrationOf.match(),
  registrationOf.filter(),
]),
```

---

## Contexte

### Les douleurs identifiées sur Diivento avec l'API actuelle

Inventaire factuel après ~28 permissions migrées sur la lib `declarative` actuelle :

#### 1. Le god-fetch composite

```ts
// declarative actuel
const getBadgeWithExposition = async ([expositionId, badgeId]) => {
  const expo = await getExpoSubCollections(expositionId);
  const information = await expo.getById("information", "information:0");
  const badge = await expo.findOne("badge", { _id: badgeId });
  return { exposition: information, badge };
};

"expositions.badges.read": permission({
  target: target.path("exposition", "badge"),
  fetch: getBadgeWithExposition,
}).rules([
  match("exposition", v => v.exposition),
  match("badge",      v => v.badge),
  filter(v => v.badge),
]),
```

Cinq fetches composites comme celui-ci coexistent dans `expositions.permissions.ts`. Chacun est appelé séquentiellement, ne partage rien avec les autres, et on a `getBadgeWithExposition`, `getVisitorWithExposition`, `getExhibitorWithExposition`, `getCollaboratorWithExposition`, etc. Tous reproduisent à 90% le même fetch d'`exposition.information`.

#### 2. Pas de dedup cross-permission

Une route Diivento type `GET /expositions/:id/dashboard` peut faire :

```ts
await ctx.can("expositions.read", expoId);
await ctx.can("expositions.team.manage", expoId);
await ctx.can("expositions.live-stats.read", expoId);
await ctx.can("expositions.exhibitors.read", [expoId, "exhibitor:*"]);
// ...
```

Aujourd'hui : **5 fetches** de `exposition.information` parce que chaque permission a son propre fetch local. La lib actuelle n'a aucun moyen de savoir que ces 5 fetches retournent la même donnée.

#### 3. Le `cacheKey` du provider est limité

On a ajouté `cacheKey` pour le **provider** récemment, ce qui dédup les **grants émis** entre `can()` calls. Mais ça ne dédup pas les **fetches du resource** (le `fetch` de la `permission`). Le pattern reste : si 5 perms fetchent `exposition:e1`, ça fait 5 hits DB.

#### 4. Cross-resource rules impossibles

Cas réel Diivento que la migration declarative a contourné : "Un user collaborator peut lire les `expositions.read` SI il est collab actif sur un exhibitor de cette expo".

```ts
// Aujourd'hui dans permissionSourceExpositionsExhibitorsRoles :
const userExhibitorRoles = await exposition.find("user_exhibitor_role", {
  userId: subject.id,
});
// → on émet des grants par user_exhibitor_role
//   et on espère que les rules en aval sont compatibles
```

La logique métier "est-ce que je suis collab actif ?" est dans le **provider**, pas dans la rule. Conséquence : opaque côté frontend matrix, hard to test, mélange les concerns.

#### 5. Pas de paths profonds exploitables

`expositions.programs.registrations.read` est aujourd'hui :

```ts
"expositions.programs.registrations.read": permission({
  target: target.required("exposition"),  // ← seulement 1 segment
  fetch: ([id]) => getExpositionContentById(id).then(e => ({ exposition: e })),
}).rules([
  match("exposition", v => v.exposition),
  filter(v => v.exposition),
]),
```

On voudrait `target.path("exposition", "program", "registration")` mais ça n'est pas exploitable :

- Le fetch composite serait `getRegistrationWithProgramAndExposition([e, p, r])` → encore plus gros
- Aucun dedup partiel possible : 5 registrations dans le même program → 5 fetches d'expo + 5 de program + 5 de registration
- Donc on retombe sur `target.required("exposition")` et on perd la granularité du grant

→ **Impossible aujourd'hui d'écrire** : "ce manager voit les registrations du program p7 uniquement".

#### 6. Opt-ins mélangés dans `with`

Le slot `with` est documenté pour porter des **constraint specs** consommées par `match` :

```ts
// Spec d'égalité partielle
with: { article: { groupId: "hr", status: "active" } }
```

Mais avec les patterns "owner-only", "self-only", on a des **booléens** :

```ts
with: { ownerOnly: true }  // ← n'est plus un constraint spec
```

Confusion sémantique. Et collision potentielle : si `ownerOnly` collide avec un nom de segment, c'est un bug silencieux.

#### 7. Les rules custom ne se réutilisent pas bien

Pour exprimer "valider une dépense ≤ X", aujourd'hui :

```ts
custom(({ resource, payload }) => {
  const max = (payload as { maxAmount?: number })?.maxAmount;
  return max === undefined || (resource as { amount: number }).amount <= max;
})
```

Trois douleurs :
- Cast manuel partout (`as { ... }`)
- Pas de `kind` propre dans le descriptor → frontend matrix ne sait pas afficher de picker dédié
- Si on veut réutiliser cette rule sur 5 permissions, on copy-paste

### Le besoin

Quand un dev écrit une rule métier (genre `requireSignedContract`, `requireWithinBudget`, `requireSameTimezone`), il devrait pouvoir :

1. La déclarer **une fois**, typée, avec un descriptor propre
2. La réutiliser entre permissions sans bricolage
3. La rendre opt-in granularement (chaque grant choisit s'il l'utilise)
4. La voir apparaître proprement dans la matrix UI avec son propre picker

---

## Objectifs

1. **Une primitive unique pour fabriquer une rule** (`defineRule`), autour de laquelle tout le reste est sucre.
2. **Resources de première classe** : déclarées une fois, réutilisables, dédupliquées au sein d'un context.
3. **Cross-resource gratuit** : une rule peut déclarer N ressources, le moteur orchestre le fetch en parallèle.
4. **Lazy par défaut** : si aucune rule active n'a besoin d'une ressource, elle n'est pas fetchée.
5. **Slot `flags` dédié** pour les opt-ins booléens, séparé de `with` (constraint specs) et `filter` (field selectors).
6. **Target paths profonds avec dedup partiel** : différents niveaux du path peuvent avoir des dedup keys distincts.
7. **Rules métier extensibles propres** : le dev définit ses rules avec la même API que les rules natives, descriptors typés, introspectables côté frontend.
8. **Backwards-compatible** pendant la migration : l'API declarative actuelle reste valide ; on déprécie progressivement.

---

## API finale

### Vue d'ensemble

```ts
import {
  resource,
  defineRule,
  permission,
  target,
  createSystem,
  requireSelf,
} from "@diister/quick-permission";

// 1. Déclarer les ressources (réutilisables entre toutes les perms d'un domaine)
const userOf = resource({
  id: "user",
  fetch: ({ target }) => usersRepo.findById(target[0] as string),
  dedupKey: ({ target }) => target[0] as string,
});

const userMembershipsOf = resource({
  id: "user-memberships",
  fetch: ({ target }) =>
    entreprisesRepo.findActiveMembersByUserId(target[0] as string),
  activeWhen: (grant) => grant.flags?.requiredEntreprise === true,
  dedupKey: ({ target }) => target[0] as string,
});

// 2. Composer les permissions
const schema = {
  "users.read": permission({
    target: target.required("user"),
  }).rules([
    userOf.match(),
    userOf.filter(),
  ]),

  "users.update": permission({
    target: target.required("user"),
  }).rules([
    userOf.match(),
    userOf.filter(),
    userOf.includes("requiredRole", (u) => u?.roles ?? []),
    userMembershipsOf.includes(
      "requiredEntreprise",
      (m) => m.map((x) => x.tenantId),
    ),
    requireSelf({ flag: "selfOnly" }),
    userOf.requireOwner((u) => u?.creatorId, { flag: "ownerOnly" }),
  ]),
};

// 3. Créer le système
const sys = createSystem({ schema, providers: [...] });
```

### Resources

```ts
function resource<T>(opts: {
  id: string;                                       // identifiant unique (matrix UI, dedup)
  fetch: (ctx: FetchCtx) => T | Promise<T>;         // comment récupérer la donnée
  activeWhen?: (grant: Grant) => boolean;           // skip si retourne false
  dedupKey?: (ctx: FetchCtx) => string;             // clé de cache (par défaut: hash de tous les inputs)
}): Resource<T>
```

Une `Resource` :
- N'est pas couplée à une permission (réutilisable)
- Décide de **comment** fetcher et de **quoi** dédupliquer
- A des **méthodes de sucre** pour produire des rules courantes (`match`, `filter`, `includes`, `requireOwner`, …)

### Rules

Une rule est l'unité atomique de validation. Sous le capot, **tout** est `defineRule` :

```ts
function defineRule<
  const RS extends readonly Resource<unknown>[],
  P = unknown,
>(opts: {
  kind: string;                                       // identifiant pour matrix UI
  needs?: RS;                                         // resources à fetcher
  flag?: string;                                      // sucre opt-in : grant.flags?.[flag] === true
  activeWhen?: (grant: Grant) => boolean;             // escape hatch (mutuellement exclusif avec flag)
  describe?: () => Record<string, unknown>;           // métadonnée descriptor
  check: (
    data: ResourcesData<RS>,                          // tuple typé depuis needs
    payload: P,
    ctx: FetchCtx,
  ) => boolean | RuleResult;
}): Rule
```

#### Méthodes resource (sucre par-dessus `defineRule`)

```ts
class Resource<T> {
  // Always-active : le resource est toujours fetché. Check silent-pass si pas de spec.
  match(extractor?: (data: T) => unknown): Rule;
  filter(extractor?: (data: T) => unknown): Rule;

  // Lazy-active : skip si grant.with[grantField] absent
  includes(grantField: string, extractor: (data: T) => readonly unknown[]): Rule;

  // Opt-in via flags
  requireOwner(getter: (data: T) => string | undefined, opts: { flag: string }): Rule;
  requireMembership(getter: (data: T) => readonly string[], opts: { flag: string }): Rule;
  requireCustom(predicate: (data: T, ctx: FetchCtx) => boolean, opts: { flag: string; descriptor?: object }): Rule;

  // Always-active : la resource doit avoir retourné une valeur truthy
  requireTruthy(): Rule;
}

// Standalone — pas de resource, juste subject ↔ target
function requireSelf(opts: { flag: string; segment?: number }): Rule;
```

### Permission

```ts
function permission<TMeta = unknown>(opts: {
  target: AnyTarget;
  metadata?: TMeta;
  payload?: PayloadSpec<unknown>;
}): {
  rules: (rules: Rule[]) => Permission;
}
```

L'API en deux étapes (`permission(opts).rules([])`) reste la même que dans l'API declarative actuelle. La justification (limitation TS sur l'inférence higher-order) est inchangée.

### Grant

```ts
type Grant = {
  id?: string;
  key: string;
  target?: readonly unknown[];

  with?: Record<string, unknown>;       // constraint specs (match, includes)
  filter?: Record<string, boolean>;     // field selectors (filter)
  flags?: Record<string, boolean>;      // opt-ins booléens (require*)
  payload?: unknown;                    // données arbitraires (custom rules)
};
```

Les **quatre slots sont sémantiquement distincts** et lus par des rules différentes. Pas de mélange.

---

## Décisions clés (justifiées une par une)

### 1. `defineRule` comme primitive unique

**Décision** : toute rule (native ou custom) passe par `defineRule({ kind, needs, flag, check, describe })`. Les méthodes resource sont des factories de sucre.

**Pourquoi** :
- **Cohérence** : single-resource vs multi-resource utilisent la même mécanique. Le moteur ne traite qu'un seul format de Rule.
- **Extensibilité** : les devs définissent leurs rules métier avec la même API, pas un dialecte secondaire.
- **Surface réduite** : 1 primitive + ~7 méthodes de sucre = lib plus petite que "1 verbe par cas d'usage".
- **Test du PoC validé** : les 13 scénarios passent au vert avec ce design ; les méthodes resource (`match`, `filter`, etc.) sont délégables à `defineRule` sans frottement.

**Alternatives rejetées** :
- "Plein de verbes natifs" (`requireOwner`, `requireWithinAmount`, `requireDuringHours`, …) → la lib explose. Verboté.
- "Hooks-style avec `use(resource)` à l'intérieur du body" → perd l'introspection structurelle.

### 2. Resources réutilisables, attachées au domaine pas à la permission

**Décision** : `userOf = resource({...})` est déclaré une fois, dans son domaine, et utilisé par les 8 permissions `users.*`. Chaque permission ne re-déclare pas son propre fetch.

**Pourquoi** :
- **Dedup gratuit** : si 3 permissions d'une même requête utilisent `userOf`, 1 seul fetch.
- **Single source of truth** sur la forme du resource.
- **Frontend matrix** : un descriptor de rule expose `source: "user"` → l'UI peut router vers un `UserPicker` partagé.
- **Cohérent avec le mental model OOP/DDD** : l'entité `user` existe une fois, ses permissions sont des actions sur elle.

**Alternative rejetée** :
- Fetch déclaré dans la permission (modèle declarative actuel) → coupling permission ↔ data, godfetch composites, pas de dedup.

### 3. Slot `flags` séparé de `with`

**Décision** : `grant.flags: Record<string, boolean>` est un slot dédié pour les opt-ins. `grant.with` reste réservé aux constraint specs (objects/primitives consommés par `match` et `includes`).

**Pourquoi** :
- **Sémantiquement différent** : un constraint spec décrit la **shape** d'un resource ; un flag est un **mode** d'évaluation. Mélanger crée de la confusion (cf. le "ownerOnly" qui sortait de nulle part dans la première itération du PoC).
- **Pas de collision** : un nom de flag ne peut pas collide avec un nom de segment de match (slots distincts).
- **Lisibilité** : le grant en DB est plus parlant. `flags: { ownerOnly: true }` exprime clairement une option de comportement.

**Alternative rejetée** :
- Tout dans `with` (modèle initial) → conflit sémantique, le user a fait remonter la friction.

### 4. Toggle des rules : `flag` (sucre) ou `activeWhen` (escape hatch)

**Décision** : la majorité des rules `require*` exposent une option `flag: "..."` qui est du sucre pour `activeWhen: (grant) => grant.flags?.[flag] === true`. L'escape hatch `activeWhen` reste disponible pour les cas exotiques.

**Pourquoi** :
- **Lisibilité** : `flag: "ownerOnly"` se lit immédiatement.
- **Introspection** : le descriptor expose `flag` → la matrix UI sait afficher un toggle.
- **Cohérence** : tous les `require*` sont opt-in via flag, le pattern est uniforme.
- **`activeWhen`** reste pour des cas comme "active si grant.payload.amount > 0" — pas couvert par un simple booléen.

### 5. `match` et `filter` sont always-active, `includes` et `require*` sont lazy

**Décision** :
- `match()` et `filter()` sur une resource → **toujours actives** ; le check fait silent-pass si pas de spec/filter dans le grant.
- `includes(grantField, ...)` → lazy, active seulement si `grant.with[grantField] !== undefined`.
- `requireOwner`/`requireSelf`/`requireMembership`/`requireCustom` → lazy, active via flag.
- `requireTruthy` → toujours active.

**Pourquoi** :
- **`match`/`filter` always-active** : le resource fetch est l'**effet de bord** que les consommateurs attendent. Si on fait `await ctx.can("users.read", "user:abc")`, on s'attend à ce que `userOf` soit fetché et que `result.data` contienne l'utilisateur, même sans `with` ni `filter`. Marquer `match` lazy casse cette attente.
- **`includes` lazy** : c'est une contrainte sur une liste ; aucune raison de la déclencher si le grant ne demande pas ce check.
- **`require*` lazy** : c'est l'essence de l'opt-in. Sans flag, la rule est invisible.
- **`requireTruthy` always-active** : utilisé pour valider qu'une resource conditionnelle (`activeWhen` sur la resource) a bien retourné une valeur. Si la resource n'est pas fetchée, la rule ne fire pas (cohérent).

### 6. Pas d'inférence automatique des dedup keys

**Décision** : la `dedupKey` est explicite, fournie par le développeur quand il définit la resource. Par défaut, c'est le hash de `{subject, target, grant.with}`.

**Pourquoi** :
- **Le dev sait quels segments du target sont pertinents** pour son fetch. `programOf` consomme `target[0]` + `target[1]` ; `expositionInfoOf` consomme `target[0]` seulement. Forcer une convention auto rendrait certains cas inefficaces (ex: dedup expo sur 3 segments alors qu'il n'utilise que 1).
- **Performance prévisible** : explicite > magic.
- **Default safe** : si pas fourni, hash de tous les inputs → jamais de fausse dedup, juste pas optimal.

### 7. Les flags sont nommés explicitement à la déclaration de la rule

**Décision** : `articleOf.requireOwner((a) => a.authorId, { flag: "ownerOnly" })` exige le `flag`. Pas de default automatique du genre "le flag = `${resource.id}_owner`".

**Pourquoi** :
- **Traçabilité** : on lit le nom du flag à la définition de la rule. La grant authority sait quel flag activer.
- **Pas de collision silencieuse** : si on a 2 `requireOwner` (sur articleOf et workspaceOf), le dev choisit explicitement deux flags distincts.
- **Convention via documentation, pas via magic** : on recommande dans la doc des flags standardisés (`ownerOnly`, `selfOnly`, `memberOnly`) sans les imposer.

**Alternative envisagée puis rejetée** :
- Default basé sur `resource.id` (genre `flag: "${id}.owner"`) → pratique mais opacifie le grant en DB.

### 8. Pas de fetches en cascade dans la v1

**Décision** : une resource ne peut pas dépendre du **résultat** d'une autre resource. Toutes les `needs` d'une rule sont fetchées en parallèle à partir du même `FetchCtx`.

**Pourquoi** :
- **Simplicité du moteur** : un DAG de dépendances complexifie l'orchestration et les types.
- **Pas de besoin réel identifié dans Diivento aujourd'hui**. Les cas qu'on a regardés (article + memberships, payslip + team) sont indépendants — chaque resource lit `subject` et `target` du ctx.
- **Workaround simple** : les rares cas où ça serait utile peuvent être encapsulés dans un "fat resource" qui fait plusieurs fetches en interne, jusqu'à émergence d'un vrai besoin récurrent.

**À reconsidérer si** : 3+ cas Diivento authentiquement bloqués par cette limite.

### 9. Cohabitation pendant la migration

**Décision** : la nouvelle API vit dans un nouveau module (`library/resource-pipe.ts` ou `library/v2/`), pas dans `library/declarative/`. L'ancienne reste disponible pendant la transition.

**Pourquoi** :
- **Diivento peut migrer perm par perm** sans tout casser
- **Tests parallèles** : on garde les 215 tests de `declarative` pendant qu'on en ajoute pour la nouvelle API
- **Lecture de doc** : le RFC declarative reste pertinent jusqu'à dépréciation officielle

---

## Sémantique d'exécution

### Phase 1 — `system.context({ subject, ...ctxOverrides })`

- Crée un `cache: Map<string, Promise<unknown>>` local au context
- Crée un `fetchCounters: Map<string, number>` (debug/observabilité)
- Retourne un objet avec `can(key, target?)`

### Phase 2 — `ctx.can(key, target?)`

```
1. Lookup schema[key] → permission ; valider arity du target
2. Pour chaque provider, collecter les grants émis pour (subject, key, target)
3. Filtrer les grants dont le target match (via wildcards) la requête
4. Pour chaque grant matchant :
   a. Construire FetchCtx = { subject, target, grant }
   b. Filtrer les rules actives :
      - rule.activeWhen(grant) doit être true (ou undefined → toujours active)
      - chaque resource des rule.needs doit être active pour ce grant
   c. Collecter l'union des `needs` des rules actives → resources uniques
   d. Pour chaque resource unique : compute dedupKey, lookup cache,
      sinon fetch + memoize
   e. Évaluer chaque rule active dans l'ordre :
      - Si check fail → grant rejeté, accumuler reason
      - Si check ok → continuer ; si data renvoyée, garde la dernière
   f. Si toutes les rules passent → grant valide, anyOk = true
5. Retourner { ok: anyOk, reasons | data }
```

**Propriétés garanties** :
- **Lazy** : un fetch n'a lieu que si au moins une rule active dans un grant le demande
- **Dedup intra-context** : même `(resource.id, dedupKey)` → 1 fetch par context, partagé entre toutes les rules de toutes les permissions
- **Parallèle au sein d'un grant** : les `needs` d'un grant donné sont fetchées en parallèle via `Promise.all`
- **Sériel entre grants** : pour préserver l'ordre des reasons (modifiable plus tard si pertinent)
- **OR sémantique entre grants** : un seul grant qui passe suffit pour `ok: true`

### Capability queries (request target with wildcards)

Une request target contenant un wildcard (`"*"` ou suffixe `":*"`) est traitée
comme une **capability query** : "le subject peut-il agir sur N'IMPORTE QUELLE
ressource de cette forme ?". Use cases : matrix UI showing buttons, paginated
lists (`can("users.read", "user:*")`).

Dans ce mode :
- **Aucune resource n'est fetchée** — il n'y a pas de cible concrète.
- **Les grants sont matchés en mode overlap** : un grant `["user:lucas"]`
  match la requête `["user:*"]` (segment-wise overlap).
- **Chaque rule built-in déclare son comportement** quand la donnée est absente :

| Rule | Capability mode |
|---|---|
| `match` | Silent-pass. Si `grant.with[id]` exposé → contribue au `output.constraints` (DB pushdown). |
| `filter` | Silent-pass. Pas de projection — `output.data` reste undefined. |
| `matchPath` | Fonctionne — lit `ctx.target` seul. Émet une constraint si le segment n'est pas wildcard. |
| `requireSelf` | Fonctionne — lit `ctx.subject.id` seul. |
| `includes` | Deny — l'appartenance ne peut pas être vérifiée sans la ressource. |
| `requireTruthy` | Deny — pas de valeur à tester. |
| `requireOwner` | Deny — pas de champ owner accessible. |
| `requireMembership` | Deny — pas de liste à scanner. |
| `requireCustom` | Deny — le prédicat ne peut pas s'exécuter. |

Les rules custom écrites via `defineRule` doivent inspecter `ctx.capability`
et déclarer leur posture explicitement (silent-pass / deny / contribute-only).

### Phase 3 — Observabilité

Le system expose :
- `ctx.getFetchCounters()` : `{ "user": 1, "exposition": 2 }` — utile pour debugging et benchmarks
- `system.list()` : flat array `ListEntry[]` — pour matrix UI
- `system.tree()` : tree par dotted-key prefix — pour matrix UI hiérarchique
- `system.schema(key)` : schema entry brut — pour cas spéciaux

### Format des descriptors (pour matrix UI)

Chaque rule expose un descriptor sérialisable :

```ts
type RuleDescriptor = {
  kind: string;                          // "match", "filter", "require-owner", custom...
  source?: string;                       // resource.id si needs.length === 1
  sources?: readonly string[];           // resource ids si needs.length > 1
  flag?: string;                         // si la rule a un opt-in via flag
  // ...autres clés exposées via opts.describe()
};
```

Le frontend matrix l'utilise pour router :
- `kind === "match"` + `source === "user"` → afficher un `UserPicker`
- `kind === "require-owner"` + `flag === "ownerOnly"` → afficher un toggle "Owner only"
- `kind === "require-amount-le"` + `payloadField === "maxAmount"` → afficher un input numérique

---

## Mapping vs API actuelle

| API declarative actuelle | Resource-pipe |
|---|---|
| `permission({ fetch }).rules([...])` | `permission({}).rules([userOf.match(), ...])` |
| `match("seg", v => v.seg)` | `userOf.match()` (segment = resource.id) |
| `filter(v => v.seg)` | `userOf.filter()` |
| `custom(({ resource, payload }) => ...)` | `userOf.requireCustom((data, ctx) => ..., { flag })` ou `defineRule(...)` |
| `time()` / `ip()` | inchangés en concept ; à porter via `defineRule` sans needs (cf. §future) |
| Provider qui hit DB | inchangé ; le pattern `directProvider` / `ownerProvider` reste valide |
| `RuleDescriptor[]` exposé via `system.list()` | inchangé, enrichi avec `source` / `sources` / `flag` |

### Exemple de migration concret — `users.read`

**Avant** :
```ts
const getUserById = async (id: string) => {
  const user = await deps.usersRepo.findById(id);
  if (!user) throw new Error(`User not found: ${id}`);
  return { user };
};

"users.read": permission({
  metadata: { description: "Read user", group: "Users" },
  target: target.required("user"),
  fetch: ([id]) => getUserById(id),
}).rules([
  match("user", (v) => v.user),
  filter((v) => v.user),
]),
```

**Après** :
```ts
// Une seule fois pour le domaine users :
const userOf = resource({
  id: "user",
  fetch: ({ target }) => deps.usersRepo.findById(target[0] as string),
  dedupKey: ({ target }) => target[0] as string,
});

// Et la perm devient :
"users.read": permission({
  metadata: { description: "Read user", group: "Users" },
  target: target.required("user"),
}).rules([
  userOf.match(),
  userOf.filter(),
]),
```

Bénéfices immédiats :
- `userOf` est partagée entre `users.read`, `users.update`, `users.delete`, `users.roles.*` → 8 perms = 1 fetch DB en pratique pour un dashboard qui en checke plusieurs
- Pas de `getUserById` répété
- Pas de wrapper `{ user }` artificiel pour aller chercher dans `match("user", v => v.user)`

### Exemple de migration concret — `expositions.programs.registrations.read`

**Avant** (target arity réduite, perte de granularité) :
```ts
"expositions.programs.registrations.read": permission({
  target: target.required("exposition"),
  fetch: ([id]) => getExpositionContentById(id).then(e => ({ exposition: e })),
}).rules([
  match("exposition", v => v.exposition),
  filter(v => v.exposition),
]),
```

**Après** (target path 3 segments, granularité native) :
```ts
"expositions.programs.registrations.read": permission({
  target: target.path("exposition", "program", "registration"),
}).rules([
  expositionInfoOf.match(),
  programOf.match(),
  registrationOf.match(),
  registrationOf.filter(),
]),

// Grants désormais possibles :
{ target: ["exposition:e1", "program:*",  "registration:*"] }    // toutes les regs de l'expo
{ target: ["exposition:e1", "program:p7", "registration:*"] }    // regs du program p7 uniquement
{ target: ["exposition:e1", "program:p7", "registration:r99"] }  // une reg précise
```

Avec dedup partiel : 5 `can()` sur 5 registrations différentes du même program → expo=1, program=1, registration=5.

---

## Migration

### Étapes proposées

#### Étape 1 — Implémenter le module lib (~3-4h)

Nouveau fichier `library/resource-pipe.ts` qui port le PoC :
- Types core (`Resource`, `Rule`, `Permission`, `System`, `FetchCtx`, `Grant`)
- `defineRule`, `resource`, `permission`, `target`
- Méthodes resource (`match`, `filter`, `includes`, `requireOwner`, `requireMembership`, `requireCustom`, `requireTruthy`)
- `requireSelf` standalone
- Moteur d'orchestration (cache, dedup, lazy)
- 15+ tests dérivés du PoC

Exports via `mod.ts`. Pas de breaking change : l'API actuelle reste accessible.

#### Étape 2 — Migration pilote Diivento (1-2 perms, ~1h)

- `users.read` + `users.update` (le domaine le plus simple)
- Vérifier les e2e tests passent
- Mesurer le gain DB sur une route type

#### Étape 3 — Migration domaine par domaine (~1 jour total)

Ordre suggéré (du plus simple au plus complexe) :
1. `users.*` (8 perms, target.required, 1 resource)
2. `auth.*` (5 perms, target.required, 1 resource)
3. `roles.*` (5 perms, target.required, 1 resource)
4. `entreprises.*` (13 perms, target.required, 1-2 resources)
5. `jobs.*`
6. `expositions.*` (~20 perms, paths multiples, le plus dense)
7. `expositions.exhibitors.*` + sous-modules

Chaque domaine se migre indépendamment. Les permissions migrées coexistent avec les non-migrées dans le même schema.

#### Étape 4 — Dépréciation `library/declarative/`

Une fois Diivento 100% migré et stable :
- Marquer `library/declarative/*` comme deprecated
- Garder le sub-export `@diister/quick-permission/declarative` pour 1-2 mineures
- Bump 1.0.0 quand on retire

### Risques et mitigations

| Risque | Mitigation |
|---|---|
| Type inference cassée sur les méthodes resource | Tests TS dédiés, `const RS extends` pour tuple typé |
| Régression de comportement (un grant qui passait ne passe plus) | E2E tests Diivento sur chaque domaine migré |
| Devs créent N flags hétérogènes (`ownerOnly` vs `isOwner`) | Doc + skill avec liste recommandée + exemples canoniques |
| Performance dégradée par overhead du dedup | Bench AVANT/APRÈS sur le dashboard expo |

---

## Future / Open questions

### Cascading fetches

Une resource B peut-elle dépendre du résultat d'une resource A ?

**Pas dans la v1.** À reconsidérer si on identifie 3+ cas Diivento authentiquement bloqués par cette limite. Workaround intermédiaire : "fat resource" qui fait les 2 fetches en interne.

### Time / IP rules

L'API declarative actuelle a `time()` et `ip()` natifs. À porter via `defineRule` sans `needs` (rules pures qui lisent `ctx.checkDate` / `ctx.checkIp`). Compatible immédiat.

### Type inference complète sur `defineRule`

Le PoC utilise `const RS extends readonly Resource<unknown>[]` pour inférer le tuple des données. À valider : est-ce que TypeScript propage proprement les types `T` des resources jusqu'à `data: ResourcesData<RS>` dans le `check` ? Tests TS dédiés à écrire.

### Conventions de naming des flags

Pas imposées par la lib. Recommandées par doc :

| Pattern | Flag suggéré |
|---|---|
| Restriction owner-only | `ownerOnly` |
| Restriction self-only | `selfOnly` |
| Restriction membership | `memberOnly` |
| Restriction subject role | `requiresRole` |
| Limite numérique | `withinLimit` |
| Fenêtre temporelle | `duringWindow` |

À documenter dans le skill `quick-permission` une fois la lib publiée.

### Defaults sur les helpers

Question ouverte : devrait-on exposer des defaults pour les flags les plus courants ?

```ts
articleOf.requireOwner((a) => a.authorId)  // flag = "ownerOnly" par défaut ?
```

Pour : ergonomie. Contre : magic. **Décision actuelle** : laisser explicite tant qu'on n'a pas une convention claire dans le skill.

### Subject-info shortcut

Pattern récurrent : une resource qui prend `subject.id` et fetche le user ou ses memberships. Pourrait être un helper :

```ts
const subjectInfo = subjectInfoOf({
  fetch: ({ subject }) => usersRepo.findById(subject.id),
});
```

À valider : sucre utile ou complication inutile ? Décision : **attendre 3+ cas réels** avant d'introduire.

---

## Références

- PoC complet : `playground/resource-pipe-poc.ts` (fichier auto-suffisant, 15+ scénarios)
- RFC précédent : `docs/rfc-declarative-api.md` (API declarative actuelle, base de cette évolution)
- Discussion design : ChatGPT thread "stress-test des cas de permissions" (intermediates, deny rules, cumul roles, etc.)
- Tests de référence : à porter du PoC vers `library/test/resource-pipe/*.test.ts`

---

## Décision finale

À l'issue de cette RFC :

- ✅ **L'API resource-pipe sera implémentée** comme module séparé (`library/resource-pipe.ts` ou équivalent)
- ✅ **L'API declarative actuelle reste valide** pendant la transition
- ✅ **Diivento sera migré progressivement** domaine par domaine
- ⏳ **Dépréciation de `declarative`** une fois la migration Diivento terminée et stable

**Prochaine action concrète** : implémenter le module lib + tests unitaires (étape 1 ci-dessus).

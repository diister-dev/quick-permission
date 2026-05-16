/**
 * Types core de `@diister/quick-permission`.
 *
 * Couvre :
 *  - les target primitives (segments + 4 kinds : none/optional/required/path)
 *  - les types runtime du système (Subject, Grant, Rule, Resource, Permission)
 *  - les types sérialisables exposés via `system.list()` / `system.tree()`
 */

// ─── Target primitives ───────────────────────────────────────────────────

export type SegmentSpec<N extends string = string, T = unknown> = {
  readonly name: N;
  readonly types: T;
  readonly validate?: (value: unknown) => boolean;
};

export type AnySegment = SegmentSpec<string, unknown>;

export type SpecToSegment<S> = S extends string ? SegmentSpec<S, S>
  : S extends AnySegment ? S
  : never;

export type TargetNone = {
  readonly kind: "none";
  readonly segments: readonly [];
};

export type TargetOptional<S extends AnySegment> = {
  readonly kind: "optional";
  readonly segments: readonly [S];
};

export type TargetRequired<S extends AnySegment> = {
  readonly kind: "required";
  readonly segments: readonly [S];
};

export type TargetPath<Ss extends readonly AnySegment[]> = {
  readonly kind: "path";
  readonly segments: Ss;
};

export type AnyTarget =
  | TargetNone
  | TargetOptional<AnySegment>
  | TargetRequired<AnySegment>
  | TargetPath<readonly AnySegment[]>;

export type SegmentNames<T extends AnyTarget> = T extends TargetNone ? never
  : T extends TargetOptional<infer S> ? S["name"]
  : T extends TargetRequired<infer S> ? S["name"]
  : T extends TargetPath<infer Ss>
    ? Ss extends readonly AnySegment[] ? Ss[number]["name"] : never
  : never;

export type TargetArgs<T extends AnyTarget> = T extends TargetNone
  ? readonly []
  : T extends TargetOptional<AnySegment> ? readonly [string?]
  : T extends TargetRequired<AnySegment> ? readonly [string]
  : T extends TargetPath<infer Ss>
    ? Ss extends readonly AnySegment[] ? { -readonly [K in keyof Ss]: string }
    : never
  : never;

export type Subject = {
  readonly id: string;
  readonly [key: string]: unknown;
};

/**
 * Forme d'un grant émis par un provider, avec les 4 slots sémantiques
 * distincts (cf. RFC §"Slot `flags` séparé de `with`").
 */
export type Grant = {
  readonly id?: string;
  readonly key: string;
  readonly target?: readonly unknown[];
  /** Constraint specs lus par `match` / `includes`. */
  readonly with?: Readonly<Record<string, unknown>>;
  /** Sélecteurs de champs lus par `filter`. */
  readonly filter?: Readonly<Record<string, boolean>>;
  /** Opt-ins booléens lus par les `require*` rules. */
  readonly flags?: Readonly<Record<string, boolean>>;
  /** Données arbitraires accessibles aux rules custom. */
  readonly payload?: unknown;
};

/**
 * Contexte transmis aux fetchers et aux rules.
 * Toutes les rules d'un même grant partagent le même FetchCtx.
 */
export type FetchCtx = {
  readonly subject: Subject;
  readonly target: readonly unknown[];
  readonly grant: Grant;
  readonly checkDate?: Date;
  readonly checkIp?: string;
  /**
   * True si la request target contient des wildcards (capability query).
   * Dans ce mode, les resources ne sont PAS fetchées (cf. RFC §"Sémantique
   * d'exécution"). Les rules built-in font silent-pass quand leur contrainte
   * ne peut pas être vérifiée sans ressource concrète.
   */
  readonly capability?: boolean;
};

/**
 * Filter contribution from a single grant. The two fields always go together:
 *  - `source` : the unfiltered reference object (basis for the cross-grant union)
 *  - `spec`   : the field whitelist for this grant; `null` means "all fields"
 *               (saturates the cross-grant union to the most permissive shape).
 */
export type FilterContribution = {
  readonly source: unknown;
  readonly spec: Record<string, boolean> | null;
};

/**
 * Rule evaluation result.
 *
 * Cross-grant aggregation:
 *  - `data`       : last writer wins (generic transform output).
 *  - `constraint` : OR-merged across grants into `output.constraints` (match rules).
 *  - `filter`     : `spec` unioned across grants, applied to `source` to produce
 *                   the most permissive `output.data` (filter rules).
 */
export type RuleResult =
  | {
    readonly ok: true;
    readonly data?: unknown;
    readonly constraint?: Record<string, unknown>;
    readonly filter?: FilterContribution;
  }
  | { readonly ok: false; readonly reason: string };

/**
 * Descripteur sérialisable d'une rule, exposé via `system.list()`.
 * Le frontend matrix UI route ses pickers/toggles à partir de `kind`.
 *
 * Champs standardisés :
 *   - `kind` : identifiant de famille de rule
 *   - `source` : id de la resource si needs.length === 1
 *   - `sources` : ids des resources si needs.length > 1 (cross-resource)
 *   - `flag` : nom du flag d'opt-in (si la rule a un flag)
 *   - tout extra champs renvoyé par `describe()` est préservé tel quel
 */
export type RuleDescriptor = {
  readonly kind: string;
  readonly source?: string;
  readonly sources?: readonly string[];
  readonly flag?: string;
  readonly [extra: string]: unknown;
};

/**
 * Une rule = unité atomique de validation. Toujours produite par
 * `defineRule({...})` ou par les méthodes resource (sucre).
 */
export interface Rule {
  /** Métadonnée sérialisable pour matrix UI / introspection. */
  readonly descriptor: RuleDescriptor;
  /**
   * Resources que la rule consomme. L'orchestrateur les fetche en parallèle
   * et les passe à `check`. Vide pour les rules pures (ex: requireSelf).
   */
  readonly needs: readonly Resource<unknown>[];
  /**
   * Si défini et retourne false pour le grant courant, la rule est skip
   * silencieusement (et ses needs ne sont pas fetchées).
   * Mutuellement exclusif avec `flag` au niveau de defineRule (le flag est
   * du sucre qui produit un activeWhen).
   */
  readonly activeWhen?: (grant: Grant) => boolean;
  /**
   * Logique d'évaluation. `data` est un tuple aligné sur `needs` (1 entrée
   * par need, dans l'ordre).
   */
  readonly check: (
    data: readonly unknown[],
    ctx: FetchCtx,
  ) => RuleResult;
}

/**
 * Une Resource = source de donnée fetchable, dédupliquée par contexte.
 * Réutilisable entre toutes les permissions d'un domaine.
 */
export interface Resource<T> {
  readonly id: string;
  /** Fetch la donnée à partir du contexte (subject, target, grant). */
  readonly fetcher: (ctx: FetchCtx) => T | Promise<T>;
  /** Si défini, la resource est skip si l'activator retourne false. */
  readonly activator?: (grant: Grant) => boolean;
  /**
   * Calcule la clé de dedup. Par défaut : hash de tous les inputs.
   * Le développeur explicite cette clé pour optimiser le dedup partiel
   * (ex: target[0..1] pour programOf qui ignore target[2]).
   */
  readonly dedupKey?: (ctx: FetchCtx) => string;
  /**
   * Calcule la cache key pour un target donné (sans subject ni grant).
   * Utilisé par `CanContext.preseed()` pour injecter une valeur déjà
   * chargée dans le cache du context. Le caller passe les segments
   * target attendus, l'engine reconstruit le même key qu'aurait produit
   * `computeDedupKey({ target, subject, grant })`.
   *
   * Par défaut, dérive de `dedupKey` en utilisant un subject minimal.
   */
  cacheKeyForTarget(target: readonly unknown[]): string;

  /**
   * Vrai si la resource doit être fetchée pour ce grant. Dérive d'`activator`.
   */
  isActiveFor(grant: Grant): boolean;
  /**
   * Calcule la clé de dedup effective pour ce contexte (préfixée par l'id).
   */
  computeDedupKey(ctx: FetchCtx): string;

  // === Méthodes de sucre — produisent des Rule via defineRule ===

  /** Always-active. Silent-pass si `grant.with[id]` est undefined. */
  match(extractor?: (data: T) => unknown): Rule;

  /** Always-active. Retourne le resource entier si `grant.filter` absent. */
  filter(extractor?: (data: T) => unknown): Rule;

  /** Lazy : skip si `grant.with[grantField]` absent. */
  includes(
    grantField: string,
    extractor: (data: T) => readonly unknown[],
  ): Rule;

  /** Always-active. Échoue si `data` est falsy (ex: lookup retourne null). */
  requireTruthy(): Rule;

  /** Opt-in via flag : active si `grant.flags[opts.flag] === true`. */
  requireOwner(
    getter: (data: T) => string | undefined,
    opts: { readonly flag: string },
  ): Rule;

  /** Opt-in via flag : active si `grant.flags[opts.flag] === true`. */
  requireMembership(
    getter: (data: T) => readonly string[],
    opts: { readonly flag: string },
  ): Rule;

  /**
   * Escape hatch : prédicat custom. Active si `grant.flags[opts.flag] === true`.
   * Le `descriptor` permet de transmettre des métadonnées au matrix UI.
   */
  requireCustom(
    predicate: (data: T, ctx: FetchCtx) => boolean,
    opts: {
      readonly flag: string;
      readonly descriptor?: Readonly<Record<string, unknown>>;
    },
  ): Rule;
}

/**
 * Helper d'inférence : extrait T depuis un Resource<T>.
 */
export type ResourceData<R> = R extends Resource<infer T> ? T : never;

/**
 * Helper d'inférence : transforme un tuple de Resource en tuple de données T.
 */
export type ResourcesData<RS extends readonly Resource<unknown>[]> = {
  [K in keyof RS]: ResourceData<RS[K]>;
};

/**
 * Forme stockée d'une permission après `permission().rules([...])`.
 */
export interface Permission<TMeta = unknown> {
  readonly metadata?: TMeta;
  readonly target: AnyTarget;
  readonly rules: readonly Rule[];
  /**
   * Pour les permissions intermediates : fonction qui expand un grant en
   * grants sur les enfants. Si défini, la permission est traitée comme
   * un macro pendant l'expansion.
   */
  readonly expandsTo?: (grant: Grant) => readonly Grant[];
}

/**
 * Résultat de `system.list()` : un entry plat par permission.
 *
 * `expandsTo` — pour les intermediates uniquement, contient la liste plate
 * (leaves-only) des clés effectivement octroyées par cette macro, calculée
 * par BFS transitive sur le schéma au moment du `list()`. Undefined pour
 * `kind === "permission"` (les leaves n'expandent pas). Voir `system.ts:
 * computeDescendants` pour la sémantique exacte (déduplication, cycle
 * detection, leaves-only, sampling par stub wildcard).
 */
export type ListEntry<TMeta = unknown> = {
  readonly key: string;
  readonly kind: "permission" | "intermediate";
  readonly metadata: TMeta | undefined;
  readonly target: SerializableTarget;
  readonly rules: readonly RuleDescriptor[];
  readonly expandsTo?: readonly string[];
};

/**
 * Nœud de l'arbre exposé par `system.tree()`. Un nœud est soit un leaf
 * (permission/intermediate) avec ses metadata + target + rules, soit un
 * groupe synthétique avec des enfants (groupé par préfixe dotted-key).
 */
export type TreeNode<TMeta = unknown> =
  | {
    readonly kind: "permission" | "intermediate";
    readonly key: string;
    readonly metadata: TMeta | undefined;
    readonly target: SerializableTarget;
    readonly rules: readonly RuleDescriptor[];
    readonly expandsTo?: readonly string[];
  }
  | {
    readonly kind: "group";
    readonly metadata: undefined;
    readonly children: Readonly<Record<string, TreeNode<TMeta>>>;
  };

export type SerializableSegment = {
  readonly name: string;
  readonly types: string | readonly string[];
};

/**
 * Serialized form of an `IndirectResource` — function fields stripped
 * (`fetcher`, `cacheKeyForTarget`, `match` are runtime-only). Returned
 * by `System.indirectResources()` and `System.indirectsUsedBy(key)` so
 * matrix UIs / catalog endpoints can introspect joins without walking
 * every permission's rules manually.
 */
export type IndirectResourceInfo = {
  readonly id: string;
  readonly kind: "indirect";
  readonly from: { readonly id: string; readonly kind: "direct" | "indirect" };
  readonly on: {
    readonly localField: string;
    readonly foreignField: string;
    readonly foreignCollection?: string;
  };
  readonly to?: { readonly _type?: string };
  readonly cardinality: "one" | "many";
};

export type SerializableTarget =
  | { readonly kind: "none" }
  | { readonly kind: "optional"; readonly segment: SerializableSegment }
  | { readonly kind: "required"; readonly segment: SerializableSegment }
  | {
    readonly kind: "path";
    readonly segments: readonly SerializableSegment[];
  };

/**
 * Résultat d'un `can()` call.
 *
 * `constraints` est l'expression Mongo unifiée des grants qui ont passé —
 * utile pour le pushdown DB (`collection.find(constraints)`). Sémantique :
 *  - 0 grant matched → `ok: false`
 *  - 1 grant matched → `constraints` = la spec de ce grant (ou `{}` si pas de spec)
 *  - N grants matched → `constraints` = `{ $or: [spec1, spec2, ...] }`
 *  - Au moins 1 grant sans spec / sans constraint → `constraints` = `{}` (= "any",
 *    le filtre n'apporte aucune restriction au pushdown)
 */
export type CanResult =
  | {
    readonly ok: true;
    readonly data?: unknown;
    readonly constraints?: Record<string, unknown>;
    /**
     * Pipeline d'aggregation MongoDB produit quand au moins une
     * `IndirectResource` est référencée dans les rules de la permission.
     * Le consommateur (adapter mongodbee côté appli) choisit entre
     * `find(constraints)` et `aggregate(stages)` selon la présence de
     * `stages`. Cf. `indirect-aggregation.ts`.
     */
    readonly stages?: readonly Record<string, unknown>[];
    readonly matchedGrants?: readonly string[];
  }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * PoC types-only pour l'API déclarative proposée.
 * Voir docs/rfc-declarative-api.md
 *
 * RÉSULTAT : single-call ne marche pas (limitation TS sur l'inférence
 * higher-order quand R doit s'inférer depuis fetch ET être utilisé dans
 * rules simultanément). On bascule sur **two-call** :
 *
 *   permission({ metadata, target, fetch, payload }).rules([...])
 *
 * La première étape résout T, R, P. La seconde type-check les rules
 * contre ces types maintenant connus.
 */

// =============================================================================
// PRIMITIVES
// =============================================================================

type SegmentSpec<N extends string = string, T = unknown> = {
  readonly name: N;
  readonly types: T;
};

type AnySegment = SegmentSpec<string, unknown>;

type SpecToSegment<S> = S extends string
  ? SegmentSpec<S, S>
  : S extends AnySegment
    ? S
    : never;

// =============================================================================
// TARGET SHAPES
// =============================================================================

type TargetNone = { readonly kind: "none"; readonly segments: readonly [] };

type TargetOptional<S extends AnySegment> = {
  readonly kind: "optional";
  readonly segments: readonly [S];
};

type TargetRequired<S extends AnySegment> = {
  readonly kind: "required";
  readonly segments: readonly [S];
};

type TargetPath<Ss extends readonly AnySegment[]> = {
  readonly kind: "path";
  readonly segments: Ss;
};

type AnyTarget =
  | TargetNone
  | TargetOptional<AnySegment>
  | TargetRequired<AnySegment>
  | TargetPath<readonly AnySegment[]>;

type SegmentNames<T extends AnyTarget> =
  T extends TargetNone ? never
  : T extends TargetOptional<infer S> ? S["name"]
  : T extends TargetRequired<infer S> ? S["name"]
  : T extends TargetPath<infer Ss>
    ? Ss extends readonly AnySegment[]
      ? Ss[number]["name"]
      : never
    : never;

type TargetArgs<T extends AnyTarget> =
  T extends TargetNone ? readonly []
  : T extends TargetOptional<AnySegment> ? readonly [string?]
  : T extends TargetRequired<AnySegment> ? readonly [string]
  : T extends TargetPath<infer Ss>
    ? Ss extends readonly AnySegment[]
      ? { -readonly [K in keyof Ss]: string }
      : never
    : never;

// =============================================================================
// SEGMENT BUILDER
// =============================================================================

export function seg<const N extends string, const T extends string | readonly string[] | "*">(
  name: N,
  type: T,
  _opts?: { validate?: (s: unknown) => boolean },
): SegmentSpec<N, T> {
  return { name, types: type } as SegmentSpec<N, T>;
}

// =============================================================================
// TARGET BUILDERS
// =============================================================================

export const target = {
  none(): TargetNone {
    return { kind: "none", segments: [] as const };
  },

  optional<const Spec extends string | AnySegment>(
    _spec: Spec,
  ): TargetOptional<SpecToSegment<Spec>> {
    return null as unknown as TargetOptional<SpecToSegment<Spec>>;
  },

  required<const Spec extends string | AnySegment>(
    _spec: Spec,
  ): TargetRequired<SpecToSegment<Spec>> {
    return null as unknown as TargetRequired<SpecToSegment<Spec>>;
  },

  path<const Specs extends readonly (string | AnySegment)[]>(
    ..._specs: Specs
  ): TargetPath<{ -readonly [K in keyof Specs]: SpecToSegment<Specs[K]> }> {
    return null as unknown as TargetPath<
      { -readonly [K in keyof Specs]: SpecToSegment<Specs[K]> }
    >;
  },
};

// =============================================================================
// PAYLOAD
// =============================================================================

declare const __payloadBrand: unique symbol;
type PayloadSpec<P> = { readonly [__payloadBrand]: P };

export function payload<P>(): PayloadSpec<P> {
  return null as unknown as PayloadSpec<P>;
}

// =============================================================================
// RULES
// =============================================================================

type MatchRule<S extends string, R> = {
  readonly kind: "match";
  readonly segment: S;
  readonly extractor: (v: R) => unknown;
};

type FilterRule<R> = {
  readonly kind: "filter";
  readonly extractor: (v: R) => unknown;
};

type CustomCtx<R, P> = {
  resource: R;
  payload: P;
  subject: unknown;
  target: readonly unknown[];
};

type CustomRule<R, P> = {
  readonly kind: "custom";
  readonly check: (ctx: CustomCtx<R, P>) => boolean;
};

type TimeRule = { readonly kind: "time" };
type IpRule = { readonly kind: "ip" };

type Rule<S extends string, R, P> =
  | MatchRule<S, R>
  | FilterRule<R>
  | CustomRule<R, P>
  | TimeRule
  | IpRule;

// =============================================================================
// RULE HELPERS (would live in @diister/quick-permission/rules)
// =============================================================================

export function match<S extends string, R>(
  segment: S,
  extractor: (v: R) => unknown,
): MatchRule<S, R> {
  return { kind: "match", segment, extractor };
}

export function filter<R>(extractor: (v: R) => unknown): FilterRule<R> {
  return { kind: "filter", extractor };
}

export function custom<R, P>(
  check: (ctx: CustomCtx<R, P>) => boolean,
): CustomRule<R, P> {
  return { kind: "custom", check };
}

export function time(): TimeRule {
  return { kind: "time" };
}

export function ip(): IpRule {
  return { kind: "ip" };
}

// =============================================================================
// PERMISSION (two-call form)
// =============================================================================

type Permission<TMeta, T extends AnyTarget, R, P> = {
  readonly __meta: TMeta;
  readonly __target: T;
  readonly __resource: R;
  readonly __payload: P;
};

type PermissionBuilder<TMeta, T extends AnyTarget, R, P> =
  & Permission<TMeta, T, R, P>
  & {
    /** Attache des rules typées contre target, fetch, payload. */
    rules: (
      rules: readonly Rule<SegmentNames<T>, R, P>[],
    ) => Permission<TMeta, T, R, P>;
  };

export function permission<
  TMeta,
  T extends AnyTarget,
  R = unknown,
  P = unknown,
>(_config: {
  metadata?: TMeta;
  target: T;
  fetch?: (args: TargetArgs<T>) => Promise<R>;
  payload?: PayloadSpec<P>;
}): PermissionBuilder<TMeta, T, R, P> {
  return null as unknown as PermissionBuilder<TMeta, T, R, P>;
}

// =============================================================================
// FACTORY (typed metadata)
// =============================================================================

type DiiventoMeta = {
  description: string;
  group?: string;
  icon?: string;
};

export function permissionD<
  T extends AnyTarget,
  R = unknown,
  P = unknown,
>(_config: {
  metadata: DiiventoMeta;
  target: T;
  fetch?: (args: TargetArgs<T>) => Promise<R>;
  payload?: PayloadSpec<P>;
}): PermissionBuilder<DiiventoMeta, T, R, P> {
  return null as unknown as PermissionBuilder<DiiventoMeta, T, R, P>;
}

// =============================================================================
// STUB DATA
// =============================================================================

type Exposition = { readonly _id: string; readonly name: string };
type Badge = { readonly _id: string; readonly expositionId: string };
type User = { readonly _id: string; readonly email: string };
type Collaborator = { readonly _id: string; readonly exhibitorId: string };

declare function getUserById(id: string): Promise<User>;
declare function getBadgeWithExposition(
  expoId: string,
  badgeId: string,
): Promise<{ exposition: Exposition; badge: Badge }>;
declare function getCollaboratorWithExposition(
  expoId: string,
  collabId: string,
): Promise<{ exposition: Exposition; collaborator: Collaborator }>;

// =============================================================================
// TEST CASES
// =============================================================================

// -----------------------------------------------------------------------------
// CASE 1 ✅ — tuple target, pattern dominant Diivento
// -----------------------------------------------------------------------------

const case1_ok = permissionD({
  metadata: { description: "Lire un badge d'exposition" },
  target: target.path("exposition", "badge"),
  fetch: ([e, b]) => getBadgeWithExposition(e, b),
}).rules([
  match("exposition", (v) => v.exposition._id),
  match("badge", (v) => v.badge._id),
  filter((v) => v.badge),
]);

// -----------------------------------------------------------------------------
// CASE 2 ❌ — "foo" pas dans les segments
// -----------------------------------------------------------------------------

permissionD({
  metadata: { description: "Cas erreur segment inconnu" },
  target: target.path("exposition", "badge"),
  fetch: ([e, b]) => getBadgeWithExposition(e, b),
}).rules([
  // @ts-expect-error — "foo" n'est pas un segment du target
  match("foo", (v) => v.exposition._id),
]);

// -----------------------------------------------------------------------------
// CASE 3 ❌ — fetch arity mismatch (variante détectable)
//
// LIMITE TS : `fetch: ([e]) => ...` est accepté car le destructuring d'un
// tuple [string, string] peut prendre juste le premier élément. Idem pour
// `fetch: () => ...` (contravariance des paramètres). L'arity n'est détectée
// QUE si l'utilisateur annote explicitement le tuple.
// -----------------------------------------------------------------------------

permissionD({
  metadata: { description: "Cas erreur arity (annotation explicite)" },
  target: target.path("exposition", "badge"),
  // @ts-expect-error — annotation explicite [string] alors que [string, string] attendu
  fetch: (args: [string]) => Promise.resolve({ x: args[0] }),
}).rules([]);

// -----------------------------------------------------------------------------
// CASE 4 ✅ — custom avec ctx.payload typé
// -----------------------------------------------------------------------------

const case4_ok = permissionD({
  metadata: { description: "Gérer un collaborateur" },
  target: target.path("exposition", "collaborator"),
  fetch: ([e, c]) => getCollaboratorWithExposition(e, c),
  payload: payload<{ exhibitorId: string }>(),
}).rules([
  match("exposition", (v) => v.exposition._id),
  match("collaborator", (v) => v.collaborator._id),
  filter((v) => v.collaborator),
  custom((ctx) => ctx.payload.exhibitorId.toUpperCase().length > 0),
]);

// -----------------------------------------------------------------------------
// CASE 5 ❌ — champ inconnu sur payload
// -----------------------------------------------------------------------------

permissionD({
  metadata: { description: "Cas erreur payload field" },
  target: target.required("collaborator"),
  fetch: ([id]) => Promise.resolve({ id, exhibitorId: "ex:1" }),
  payload: payload<{ exhibitorId: string }>(),
}).rules([
  // @ts-expect-error — "foo" n'existe pas sur le payload
  custom((ctx) => ctx.payload.foo === "bar"),
]);

// -----------------------------------------------------------------------------
// BONUS — sans target, sans rules
// -----------------------------------------------------------------------------

const bonusGlobal = permissionD({
  metadata: { description: "Créer un utilisateur" },
  target: target.none(),
}).rules([]);

// -----------------------------------------------------------------------------
// BONUS — mono-segment, rules typées
// -----------------------------------------------------------------------------

const bonusMono = permissionD({
  metadata: { description: "Lire le profil utilisateur" },
  target: target.optional("user"),
  fetch: ([id]) => getUserById(id ?? ""),
}).rules([
  match("user", (v) => v._id),
  filter((v) => v),
]);

// =============================================================================
// EXPORTS pour éviter les warnings "unused"
// =============================================================================

export const _all = {
  case1_ok,
  case4_ok,
  bonusGlobal,
  bonusMono,
};

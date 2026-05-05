export type MatchRule<S extends string, R> = {
  readonly kind: "match";
  readonly segment: S;
  readonly extractor: (v: R) => unknown;
};

export type FilterRule<R> = {
  readonly kind: "filter";
  readonly extractor: (v: R) => unknown;
};

export type CustomCtx<R, P> = {
  resource: R;
  payload: P;
  subject: unknown;
  target: readonly unknown[];
};

export type CustomRule<R, P> = {
  readonly kind: "custom";
  readonly check: (ctx: CustomCtx<R, P>) => boolean;
};

export type TimeRule = { readonly kind: "time" };
export type IpRule = { readonly kind: "ip" };

export type Rule<S extends string, R, P> =
  | MatchRule<S, R>
  | FilterRule<R>
  | CustomRule<R, P>
  | TimeRule
  | IpRule;

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

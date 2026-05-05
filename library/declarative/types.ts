export type SegmentSpec<N extends string = string, T = unknown> = {
  readonly name: N;
  readonly types: T;
  readonly validate?: (value: unknown) => boolean;
};

export type AnySegment = SegmentSpec<string, unknown>;

export type SpecToSegment<S> = S extends string
  ? SegmentSpec<S, S>
  : S extends AnySegment
    ? S
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
    ? Ss extends readonly AnySegment[]
      ? { -readonly [K in keyof Ss]: string }
    : never
  : never;

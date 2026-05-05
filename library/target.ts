/**
 * Target builders : `seg(...)` pour décrire un segment et `target.{none,
 * optional, required, path}` pour assembler un target.
 */

import type {
  AnySegment,
  SegmentSpec,
  SpecToSegment,
  TargetNone,
  TargetOptional,
  TargetPath,
  TargetRequired,
} from "./types.ts";

export function seg<
  const N extends string,
  const T extends string | readonly string[] | "*",
>(
  name: N,
  type: T,
  opts?: { validate?: (value: unknown) => boolean },
): SegmentSpec<N, T> {
  return {
    name,
    types: type,
    ...(opts?.validate ? { validate: opts.validate } : {}),
  } as SegmentSpec<N, T>;
}

function normalize<S extends string | AnySegment>(spec: S): SpecToSegment<S> {
  if (typeof spec === "string") {
    return { name: spec, types: spec } as SpecToSegment<S>;
  }
  return spec as SpecToSegment<S>;
}

export const target = {
  none(): TargetNone {
    return { kind: "none", segments: [] as const };
  },

  optional<const Spec extends string | AnySegment>(
    spec: Spec,
  ): TargetOptional<SpecToSegment<Spec>> {
    return {
      kind: "optional",
      segments: [normalize(spec)] as const,
    } as TargetOptional<SpecToSegment<Spec>>;
  },

  required<const Spec extends string | AnySegment>(
    spec: Spec,
  ): TargetRequired<SpecToSegment<Spec>> {
    return {
      kind: "required",
      segments: [normalize(spec)] as const,
    } as TargetRequired<SpecToSegment<Spec>>;
  },

  path<const Specs extends readonly (string | AnySegment)[]>(
    ...specs: Specs
  ): TargetPath<{ -readonly [K in keyof Specs]: SpecToSegment<Specs[K]> }> {
    return {
      kind: "path",
      segments: specs.map(normalize) as unknown as {
        -readonly [K in keyof Specs]: SpecToSegment<Specs[K]>;
      },
    } as TargetPath<{ -readonly [K in keyof Specs]: SpecToSegment<Specs[K]> }>;
  },
};

import type { AnyTarget } from "./types.ts";
import type { PayloadSpec } from "./payload.ts";
import type { TargetArgs } from "./types.ts";
import {
  intermediate as baseIntermediate,
  permission as basePermission,
} from "./permission.ts";
import type {
  GrantState,
  IntermediateBuilder,
  Permission,
  PermissionBuilder,
} from "./permission.ts";

export type PermissionFactory<TMeta> = {
  permission: <T extends AnyTarget, R = unknown, P = unknown>(config: {
    metadata?: TMeta;
    target: T;
    fetch?: (args: TargetArgs<T>) => Promise<R>;
    payload?: PayloadSpec<P>;
  }) => PermissionBuilder<TMeta, T, R, P>;

  intermediate: <T extends AnyTarget, R = unknown, P = unknown>(config: {
    metadata?: TMeta;
    target: T;
    fetch?: (args: TargetArgs<T>) => Promise<R>;
    payload?: PayloadSpec<P>;
    expandsTo: (grant: GrantState) => readonly GrantState[];
  }) => IntermediateBuilder<TMeta, T, R, P>;
};

export function createPermissionFactory<
  TMeta = Record<string, unknown>,
>(): PermissionFactory<TMeta> {
  return {
    permission: ((config: unknown) =>
      basePermission(
        config as Parameters<
          typeof basePermission<TMeta, AnyTarget, unknown, unknown>
        >[0],
      )) as PermissionFactory<TMeta>["permission"],

    intermediate: ((config: unknown) =>
      baseIntermediate(
        config as Parameters<
          typeof baseIntermediate<TMeta, AnyTarget, unknown, unknown>
        >[0],
      )) as PermissionFactory<TMeta>["intermediate"],
  };
}

export type { Permission };

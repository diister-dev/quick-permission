import { Rule } from "./rule.ts";
import { Schema } from "./schema.ts";

export type Permission<
    S extends Schema<any, any>[],
    R extends Rule<any, any>[],
    C extends Record<string, Permission<any, any, any>> | undefined
> = {
    schemas: S,
    rules: R,
    children: C,
}

export type PermissionNames<T extends Record<string, Permission<any, any, any>>> = {
    [K in keyof T]: PermissionKey<T[K], K>
}[keyof T];

type MergePath<A extends string, B extends string> = A extends '' ? B : B extends '' ? A : `${A}.${B}`;

export type PermissionKey<P, K = ''> = K extends string ?
    P extends Permission<any, any, any> ?
        P['children'] extends Record<string, Permission<any, any, any>> ?
            K | MergePath<K, PermissionNames<P['children']>>
            : K
        : never
    : never;
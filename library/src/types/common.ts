import { Rule } from "./rule.ts";
import { Schema } from "./schema.ts";

export type PermissionHierarchy<H extends Hierarchy> = {
    type: 'hierarchy',
    hierarchy: H,
}

export type Hierarchy = {
    [key: string]: Hierarchy | Permission<any, any, any>;
}

export type Permission<
    S extends Schema<any, any>[],
    R extends Rule<any, any>[],
    C extends Hierarchy | undefined
> = {
    type: 'permission',
    schemas: S,
    rules: R,
    children?: C,
}

export type PermissionNames<T extends Record<string, Permission<any, any, any>>> = {
    [K in keyof T]: PermissionKey<T[K], K>
}[keyof T];

export type HierarchyNames<T extends Hierarchy> = {
    [K in keyof T]: T[K] extends Permission<any, any, any> ? PermissionKey<T[K], K> : T[K] extends Hierarchy ? HierarchyNames<T[K]> : never
}[keyof T]

type MergePath<A extends string, B extends string> = A extends '' ? B : B extends '' ? A : `${A}.${B}`;

export type PermissionKey<P, K = ''> = K extends string ?
    P extends PermissionHierarchy<infer H> ?
        PermissionKey<H, K>
    : P extends Permission<any, any, any> ?
        P['children'] extends Record<string, Permission<any, any, any>> ?
            K | MergePath<K, PermissionNames<P['children']>>
        : K
    : P extends Hierarchy ?
        K | MergePath<K, HierarchyNames<P>>
    : never
: never
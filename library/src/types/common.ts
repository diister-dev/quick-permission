import { Rule } from "./rule.ts";
import { Schema, SchemasRequests, SchemasStates } from "./schema.ts";

type TODO = any; // TODO: Replace with actual type

export type PermissionHierarchy<H extends Hierarchy> = {
    type: 'hierarchy',
    hierarchy: H,
    flat: TODO,
    keys: TODO,
}

export type Hierarchy = {
    [key: string]: Hierarchy | Permission<Schema<any, any>[] | undefined, Rule<any>[] | undefined, Hierarchy | undefined> | undefined;
}

export type Permission<
    S extends Schema<any, any>[] | undefined,
    R extends Rule<any>[] | undefined,
    C extends Hierarchy | undefined,
> = {
    type: 'permission',
    schemas: PermissionSchemas<S, R>,  // Schemas derived from rules
    rules: R,
    children: C,
}

export type PermissionSchemas<S, R> = S extends Schema<any, any>[] ?
    R extends Rule<any>[] ?
        [...S, ...ExtractSchemasFromRules<R>]
    : S
: R extends Rule<any>[] ?
    ExtractSchemasFromRules<R>
: never

// Utility type to extract all unique schemas from rules
export type ExtractSchemasFromRules<R extends Rule<any>[]> = R extends [infer First, ...infer Rest]
    ? First extends Rule<infer S>
        ? S extends Schema<any, any>[] 
            ? Rest extends Rule<any>[]
                ? [...S, ...ExtractSchemasFromRules<Rest>]
                : S
            : []
        : []
    : [];

type FlatHierarchy<
    H,
    K extends string = '',
    Depth extends string = '0123456789' // Prevent infinite recursion
> = H extends Hierarchy ? {
        [key in keyof H]: key extends string ?
            H[key] extends Permission<infer S, infer R, infer C> ?
                { path: `${K}${key}`, value: H[key] } | (C extends Hierarchy ?
                    FlatHierarchy<C, `${K}${key}.`>
                : never)
            : H[key] extends infer E ?
                E extends Hierarchy ?
                    Depth extends `${infer H}${infer R}` ?
                        FlatHierarchy<E, `${K}${key}.`, R>
                    : never
                : never
            : never
        : never
    }[keyof H]
: never

export type PermissionElement<H, K extends PermissionKey<H>> = H extends PermissionHierarchy<infer H> ?
    FlatHierarchy<H> extends infer F ?
        F extends { path: K, value: infer V } ?
            F
        : never
    : never
: never

export type PermissionStates<H, K extends PermissionKey<H>> = PermissionElement<H, K> extends infer E ?
    E extends { value: Permission<infer S, infer R, any> } ?
        SchemasStates<PermissionSchemas<S, R>>
    : never
: never

export type PermissionRequests<H, K extends PermissionKey<H>> = PermissionElement<H, K> extends infer E ?
    E extends { value: Permission<infer S, infer R, any> } ?
        R extends Rule<infer S>[] ?
            SchemasRequests<PermissionSchemas<S, R>>
        : never
    : never
: never

export type PermissionKey<P> = P extends PermissionHierarchy<infer H> ?
    FlatHierarchy<H>['path']
: never

export type PermissionStateSet<H> = {
    [K in PermissionKey<H>]?: PermissionStates<H, K>;
}
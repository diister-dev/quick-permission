import type { Permission } from "../types/common.ts";
import type { Rule } from "../types/rule.ts";
import type { Schema, SchemasRequests, SchemasStates } from "../types/schema.ts";

export type PermissionContent<
    S extends Schema<any, any>[],
> = {
    schemas: S,
    rules: Rule<
        SchemasStates<S>,
        SchemasRequests<S>
    >[],
    children?: Record<string, Permission<any, any, any>>,
}

export function permission<
    const S extends Schema<any, any>[],
    const R extends Rule<
        SchemasStates<S>,
        SchemasRequests<S>
    >[],
    const C extends Record<string, Permission<any, any, any>> | undefined,
>(content: Permission<S, R, C>): Permission<S, R, C> {
    return {
        ...content,
    }
}
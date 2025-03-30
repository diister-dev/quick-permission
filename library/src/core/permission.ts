import type { Hierarchy, Permission, PermissionHierarchy } from "../types/common.ts";
import type { Rule } from "../types/rule.ts";
import type { Schema, SchemasRequests, SchemasStates } from "../types/schema.ts";

export function permission<
    const S extends Schema<any, any>[],
    const R extends Rule<
        SchemasStates<S>,
        SchemasRequests<S>
    >[],
    const C extends Hierarchy | undefined,
>(content: Partial<Omit<Permission<S, R, C>, "type">>): Permission<S, R, C> {
    return {
        type: "permission",
        schemas: content.schemas ?? [] as unknown as S,
        rules: content.rules ?? [] as unknown as R,
        children: content.children,
    }
}

function flatHierarchy(hierarchy: Hierarchy) {
    const flat: any = {};
    const toTraverse: any[] = [{
        path: "",
        element: hierarchy,
    }];
    // This is a safety check to prevent infinite loops in case of circular references
    let maxDepth = 1_000_000;
    while (toTraverse.length > 0 && maxDepth-- >= 0) {
        const current = toTraverse.pop();
        const element = current.element;

        if (element.type === "permission") {
            const key = current.path;
            flat[key] = {
                schemas: element.schemas ?? [],
                rules: element.rules ?? [],
            };

            if (element.children) {
                for (const key in element.children) {
                    const child = element.children[key];
                    const path = current.path ? `${current.path}.${key}` : key;
                    toTraverse.push({
                        element: child,
                        path,
                    });
                }
            }
        } else if (typeof element === "object") {
            for (const key in element) {
                const child = element[key];
                const path = current.path ? `${current.path}.${key}` : key;
                toTraverse.push({
                    element: child,
                    path,
                });
            }
        }
        else {
            throw new Error(`Invalid element in hierarchy: ${element}`);
        }
    }

    if (maxDepth <= 0) {
        throw new Error("Max depth reached while traversing hierarchy. Possible circular reference detected.");
    }

    return flat;
}

export function hierarchy<const H extends Hierarchy>(hierarchy: H) {
    const flat = flatHierarchy(hierarchy);
    const keys = Object.keys(flat);

    return {
        hierarchy,
        flat,
        keys,
    };
}

export function satisfiedBy(
    key: string,
    hierarchy: any,
) {
    const matching: string[] = [];
    let traverseKey = key;
    let seperatorIndex = traverseKey.lastIndexOf(".");

    if (seperatorIndex < 0) {
        if(traverseKey in hierarchy.flat) {
            matching.push(traverseKey);
        }
        return matching;
    }

    while(seperatorIndex >= 0) {
        if(!(traverseKey in hierarchy.flat)) break;
        matching.unshift(traverseKey);
        
        seperatorIndex = traverseKey.lastIndexOf(".");
        traverseKey = traverseKey.substring(0, seperatorIndex);
    }

    return matching;
}

function allow(schemas: any[], rules: any[], state: any, request: any) {
    for (const rule of schemas) {
        if (rule.state && !rule.state(state)) throw new Error(`State validation failed for rule ${rule.name}`);
        if (rule.request && !rule.request(request)) throw new Error(`Request validation failed for rule ${rule.name}`);
    }

    let anyExplicitAllow = undefined;
    for (const rule of rules) {
        const result = rule.check(state, request);
        if (result === false) return false;
        if (result === true) anyExplicitAllow = true;
    }

    return anyExplicitAllow;
}

function mergeValidations(validations: (boolean | undefined)[]) {
    const merged = validations.reduce((acc, cur) => {
        if (cur === undefined) return acc;
        if (acc === undefined) return cur;
        return acc && cur;
    }, undefined);

    return merged;
}

export function validate(states: any[], hierarchy: any, key: string, request: any) {
    const satisfier = satisfiedBy(key, hierarchy);
    const stateValidations: (boolean | undefined)[] = [];

    for (const state of states) {
        const chainValidation: (boolean | undefined)[] = [];
        for (const permKey of satisfier) {
            const permission = hierarchy.flat[permKey];
            const permissionState = state[permKey];
            if (!permissionState) {
                chainValidation.push(undefined);
                continue;
            }
            const result = allow(permission.schemas, permission.rules, permissionState, request);
            chainValidation.push(result);
        }

        const chainMerge = mergeValidations(chainValidation);
        console.log({ chainValidation, chainMerge });

        stateValidations.push(chainMerge);
    }

    console.log({ stateValidations });
    const result = mergeValidations(stateValidations);

    return result;
}
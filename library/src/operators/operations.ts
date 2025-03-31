import { rule } from "../core/rule.ts";
import type { Rule } from "../types/rule.ts";
import type { Schema } from "../types/schema.ts";

export function and(...rules: Array<Rule<any>>): Rule<any> {
    // Merge schemas from all rules
    const schemas = mergeSchemas(rules);
    
    return rule(
        "and",
        schemas,
        (state, request) => {
            let allTrue = true;
            for (const rule of rules) {
                const result = rule.check(state, request);
                if (result === false) return false;
                if (result === undefined) allTrue = false;
            }
            return allTrue ? true : undefined;
        }
    );
}

export function or(...rules: Array<Rule<any>>): Rule<any> {
    // Merge schemas from all rules
    const schemas = mergeSchemas(rules);
    
    return rule(
        "or",
        schemas,
        (state, request) => {
            for (const rule of rules) {
                const result = rule.check(state, request);
                if (result === true) return true;
            }
            return undefined;
        }
    );
}

export function not(inputRule: Rule<any>): Rule<any> {
    return rule(
        "not",
        inputRule.schemas,
        (state, request) => {
            const result = inputRule.check(state, request);
            if (result === true) return false;
            if (result === false) return true;
            return undefined;
        }
    );
}

/**
 * Merges schemas from multiple rules, avoiding duplications (by name)
 */
function mergeSchemas(rules: Array<Rule<any>>): Schema<any, any>[] {
    const schemas: Schema<any, any>[] = [];
    
    // Collect all unique schemas
    for (const rule of rules) {
        for (const schema of rule.schemas) {
            // Add only if a schema with the same name doesn't already exist
            const exists = schemas.some(s => s.name === schema.name);
            if (!exists) {
                schemas.push(schema);
            }
        }
    }
    
    return schemas;
}
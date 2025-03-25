import type { Rule } from "../../types/rule.ts";

type AllowTargetState = {
    target: string[];
}

type AllowTargetRequest = {
    target: string;
}

export interface AllowTargetOptions {
    /**
     * Enable wildcard matching support using '*' character
     * For example: "user:*" will match "user:123", "user:456", etc.
     */
    wildcards?: boolean;
    
    /**
     * The wildcard character to use in patterns
     * @default "*"
     */
    wildcardChar?: string;
}

export function allowTarget(options: AllowTargetOptions = {}): Rule<AllowTargetState, AllowTargetRequest> {
    const wildcards = options.wildcards ?? false;
    const wildcardChar = options.wildcardChar ?? "*";
    
    return {
        name: "allowTarget",
        check(state, request) {
            if (!state.target || !Array.isArray(state.target)) {
                return undefined;
            }

            // Direct match without wildcards
            if (state.target.includes(request.target)) {
                return true;
            }

            // Wildcard matching if enabled
            if (wildcards) {
                for (const pattern of state.target) {
                    if (matchWildcard(pattern, request.target, wildcardChar)) {
                        return true;
                    }
                }
            }

            // Not handled by this validation
            return undefined;
        }
    }
}

/**
 * Match a string against a pattern with wildcard support
 */
function matchWildcard(pattern: string, value: string, wildcardChar: string): boolean {
    // Convert the pattern to a regex
    const regexPattern = pattern
        .split(wildcardChar)
        .map(segment => escapeRegExp(segment))
        .join('.*');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(value);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

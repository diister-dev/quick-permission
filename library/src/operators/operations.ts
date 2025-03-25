import type { Rule } from "../types/rule.ts";

export function and<State, Request>(
    ...rules: Array<Rule<State, Request>>
): Rule<State, Request> {
    return {
        name: `and`,
        check(state, request) {
            let allTrue = true;
            for (const rule of rules) {
                const result = rule.check(state, request);
                if (result === false) return false;
                if (result === undefined) allTrue = false;
            }
            return allTrue ? true : undefined;
        }
    };
}

export function or<State, Request>(
    ...rules: Array<Rule<State, Request>>
): Rule<State, Request> {
    return {
        name: `or`,
        check(state, request) {
            for (const rule of rules) {
                const result = rule.check(state, request);
                if (result === true) return true;
            }
            return undefined;
        }
    };
}

export function not<State, Request>(
    rule: Rule<State, Request>
): Rule<State, Request> {
    return {
        name: `not`,
        check(state, request) {
            const result = rule.check(state, request);
            if (result === true) return false;
            if (result === false) return true;
            return undefined;
        }
    };
}
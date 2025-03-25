import type { Rule } from "../../types/rule.ts";

type AllowSelfRequest = {
    from: string;
    target: string;
}

export function allowSelf() : Rule<unknown, AllowSelfRequest> {
    return {
        name: "allowSelf",
        check(_state, request) {
            if (request.from === request.target) {
                return true;
            }

            // Not handled by this validation
            return undefined;
        }
    }
}
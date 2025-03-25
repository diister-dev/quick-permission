import type { Rule } from "../../types/rule.ts";

type DenySelfRequest = {
    from: string;
    target: string;
}

export function denySelf() : Rule<unknown, DenySelfRequest> {
    return {
        name: "denySelf",
        check(_state, request) {
            if (request.from === request.target) {
                return false;
            }

            // Not handled by this validation
            return undefined;
        }
    }
}
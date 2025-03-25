import type { Rule } from "../../types/rule.ts";

type AllowOwnerRequest = {
    from: string;
    owner: string;
}

export function allowOwner() : Rule<unknown, AllowOwnerRequest> {
    return {
        name: "allowOwner",
        check(_state, request) {
            if (request.from === request.owner) {
                return true;
            }

            // Not handled by this validation
            return undefined;
        }
    }
}
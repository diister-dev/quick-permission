import type { TargetRequest } from "../../schemas/target/target.ts";
import type { Rule } from "../../types/rule.ts";

export function denySelf(): Rule<unknown, TargetRequest> {
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
import type { Rule } from "../../types/rule.ts";
import type { TimeState } from "../../schemas/time/time.ts";

type EnsureTimeRequest = {
    date?: Date;
}

export function ensureTime(): Rule<TimeState, EnsureTimeRequest> {
    return {
        name: "ensureTime",
        check(state, request) {
            const date = request.date ?? new Date();
            if(state.dateStart && date < state.dateStart) {
                return false;
            }

            if(state.dateEnd && date > state.dateEnd) {
                return false;
            }

            // Not handled by this validation
            return undefined;
        }
    }
}
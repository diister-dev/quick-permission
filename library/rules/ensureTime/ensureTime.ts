import { rule } from "../../core/rule.ts";
import { time } from "../../schemas/time/time.ts";
import type { Rule } from "../../types/rule.ts";

/**
 * Creates a rule that validates time constraints
 *
 * This rule checks that the current time or a specified time in the request
 * is within the allowed time window specified in the state.
 *
 * - Returns "neutral" when no time constraints exist in the state
 * - Returns "rejected" when the time is outside the allowed window
 * - Returns "neutral" when the time is within the allowed window
 *
 * @returns A rule that validates time constraints
 */
export function ensureTime(): Rule<[ReturnType<typeof time>]> {
  return rule(
    "ensureTime",
    [time()],
    (state, request) => {
      const date = request.date ?? new Date();
      if (state.dateStart && date < state.dateStart) {
        return "rejected";
      }

      if (state.dateEnd && date > state.dateEnd) {
        return "rejected";
      }

      // Not handled by this validation
      return "neutral";
    },
  );
}

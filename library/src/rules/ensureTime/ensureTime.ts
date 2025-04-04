import { rule } from "../../core/rule.ts";
import { time } from "../../schemas/time/time.ts";
import type { Rule } from "../../types/rule.ts";

export function ensureTime(): Rule<[ReturnType<typeof time>]> {
  return rule(
    "ensureTime",
    [time()],
    (state, request) => {
      const date = request.date ?? new Date();
      if (state.dateStart && date < state.dateStart) {
        return false;
      }

      if (state.dateEnd && date > state.dateEnd) {
        return false;
      }

      // Not handled by this validation
      return undefined;
    },
  );
}

import type { PermissionRule } from "../core/types.ts";

/**
 * Rule that validates time-based permissions
 *
 * Checks if current time is within the allowed time window
 *
 * @example
 * TimeRule()
 * // State: { startDate: new Date("2024-01-01"), endDate: new Date("2024-12-31") }
 * // Request: { checkDate: new Date() }
 */
export function TimeRule(): PermissionRule<
  { startDate?: Date; endDate?: Date },
  { checkDate: Date }
> {
  return {
    name: "time",
    check: (state, request) => {
      const start = state.startDate;
      const end = state.endDate;
      if (start && request.checkDate < start) return {
        ok: false,
        reason: "Current date is before the allowed start date",
      };
      if (end && request.checkDate > end) return {
        ok: false,
        reason: "Current date is after the allowed end date",
      };
      return {
        ok: true
      };
    },
    default: () => ({ checkDate: new Date() }),
  };
}

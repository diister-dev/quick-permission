/**
 * Rule that enforces time-based permission constraints.
 *
 * This rule checks if the current time or a specified time in the request
 * falls within the permitted time window defined in the permission state.
 * It returns false (denying permission) if the time is outside the allowed range.
 *
 * The rule uses the time schema to enforce the correct structure for state and request.
 *
 * ## Usage Example
 *
 * ```typescript
 * import { ensureTime } from "@diister/quick-permission/rules/ensureTime";
 * import { permission } from "@diister/quick-permission";
 *
 * // Create a time-limited permission
 * const timedAccessPermission = permission({
 *   rules: [ensureTime()],
 *   defaultState: {
 *     dateStart: new Date("2025-01-01T00:00:00Z"),
 *     dateEnd: new Date("2025-12-31T23:59:59Z")
 *   }
 * });
 *
 * // When validating:
 * // - If current time is before dateStart -> permission denied
 * // - If current time is after dateEnd -> permission denied
 * // - Otherwise -> rule returns undefined (no opinion)
 * //
 * // The request can also specify a date to check:
 * validate(permissions, states, "resource.access", {
 *   from: "user:123",
 *   target: "resource:A",
 *   date: new Date("2025-06-15") // Specific date to check
 * });
 * ```
 *
 * @returns A rule that validates time-based permissions
 */
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

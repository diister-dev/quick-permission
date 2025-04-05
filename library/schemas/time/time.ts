/**
 * Schema for time-based permission validation.
 *
 * This schema provides structure and type safety for time-based checks in permission rules.
 * It allows defining time windows during which permissions are valid through `dateStart`
 * and `dateEnd` properties in the state. The request can optionally specify a custom date
 * to check against instead of using the current time.
 *
 * Time-based permissions are useful for temporary access, scheduled permissions, or
 * permissions with expiration dates.
 *
 * ## Usage Example
 *
 * ```typescript
 * import { rule } from "@diister/quick-permission";
 * import { time } from "@diister/quick-permission/schemas/time";
 *
 * // Create a custom time-based rule
 * const customTimeRule = rule(
 *   "customTimeRule",
 *   [time()],
 *   (state, request) => {
 *     const currentDate = request.date ?? new Date();
 *
 *     // Check if the current date is within the allowed window
 *     if (state.dateStart && currentDate < state.dateStart) {
 *       return false; // Too early, permission not yet valid
 *     }
 *
 *     if (state.dateEnd && currentDate > state.dateEnd) {
 *       return false; // Too late, permission expired
 *     }
 *
 *     return true; // Date is within the valid window
 *   }
 * );
 *
 * // Example state and request that use time schema
 * const state = {
 *   dateStart: new Date("2025-01-01T00:00:00Z"),
 *   dateEnd: new Date("2025-12-31T23:59:59Z")
 * };
 *
 * const request = {
 *   from: "user:123",
 *   target: "resource:1",
 *   // Optional custom date to check instead of current time
 *   date: new Date("2025-06-15T14:30:00Z")
 * };
 * ```
 *
 * @returns A time schema definition
 */
import type { Schema } from "../../types/schema.ts";

/**
 * State type for time schema
 * Optional start and end dates for the permission time window
 */
export type TimeState = {
  dateStart?: Date;
  dateEnd?: Date;
};

/**
 * Request type for time schema
 * Optional date to check instead of using current time
 */
export type TimeRequest = {
  date?: Date;
};

/**
 * Creates a time schema for permission validation
 *
 * @returns A schema for time-based validation
 */
export function time(): Schema<TimeState, TimeRequest> {
  return {
    name: "time",
    state(obj: unknown): obj is TimeState {
      if (typeof obj !== "object" || !obj) return false;
      const dateStart = (obj as TimeState).dateStart;
      const dateEnd = (obj as TimeState).dateEnd;
      if (dateStart !== undefined && !(dateStart instanceof Date)) return false;
      if (dateEnd !== undefined && !(dateEnd instanceof Date)) return false;
      return true;
    },
    request(obj: unknown): obj is TimeRequest {
      if (typeof obj !== "object" || !obj) return false;
      const date = (obj as TimeRequest).date;
      if (date !== undefined && !(date instanceof Date)) return false;
      return true;
    },
    defaultState(): TimeState {
      // By default, no time limits are defined
      return {};
    },
  };
}

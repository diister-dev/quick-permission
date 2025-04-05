/**
 * Schema for target-based permission validation.
 *
 * This schema provides structure and type safety for target checks in permission rules.
 * It ensures that state contains a list of allowed targets and that a request contains
 * both the entity making the request (`from`) and the target resource (`target`).
 *
 * The target schema is commonly used for permission checks that verify if a user
 * has access to specific resources identified by target strings.
 *
 * ## Usage Example
 *
 * ```typescript
 * import { rule } from "@diister/quick-permission";
 * import { target } from "@diister/quick-permission/schemas/target";
 *
 * // Create a custom target-based rule
 * const customTargetRule = rule(
 *   "customTargetRule",
 *   [target()],
 *   (state, request) => {
 *     // Access typed state and request properties safely
 *     if (state.target.includes(request.target)) {
 *       return true;
 *     }
 *     return undefined;
 *   }
 * );
 *
 * // Example state and request that use target schema
 * const state = {
 *   target: ["resource:1", "resource:2", "folder:projects/*"]
 * };
 *
 * const request = {
 *   from: "user:123",
 *   target: "resource:1"
 * };
 * ```
 *
 * @returns A target schema definition
 */
import type { Schema } from "../../types/schema.ts";

/**
 * State type for target schema
 * Requires an array of target strings
 */
export type TargetState = {
  target: string[];
};

/**
 * Request type for target schema
 * Requires both 'from' and 'target' properties as strings
 */
export type TargetRequest = {
  from: string;
  target: string;
};

/**
 * Creates a target schema for permission validation
 *
 * @returns A schema for target-based validation
 */
export function target(): Schema<TargetState, TargetRequest> {
  return {
    name: "target",
    state(obj: unknown): obj is TargetState {
      if (typeof obj !== "object" || !obj) return false;
      const target = (obj as TargetState).target;
      if (!Array.isArray(target)) return false;
      return true;
    },
    request(obj: unknown): obj is TargetRequest {
      if (typeof obj !== "object" || !obj) return false;
      if (typeof (obj as TargetRequest).from !== "string") return false;
      if (typeof (obj as TargetRequest).target !== "string") return false;
      return true;
    },
    defaultState(): TargetState {
      return {
        target: [],
      };
    },
  };
}

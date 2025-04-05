/**
 * Schema for ownership-based permission validation.
 *
 * This schema provides structure and type safety for ownership checks in permission rules.
 * It ensures that a request contains both the entity making the request (`from`) and
 * the entity that owns the resource (`owner`).
 *
 * No specific state structure is required, as the ownership information is typically
 * part of the request context.
 *
 * ## Usage Example
 *
 * ```typescript
 * import { rule } from "@diister/quick-permission";
 * import { owner } from "@diister/quick-permission/schemas/owner";
 *
 * // Create a custom ownership-based rule
 * const customOwnerRule = rule(
 *   "customOwnerRule",
 *   [owner()],
 *   (state, request) => {
 *     // Access typed properties safely
 *     if (request.from === request.owner) {
 *       return true;
 *     }
 *     return undefined;
 *   }
 * );
 *
 * // Example request that uses owner schema
 * const request = {
 *   from: "user:123",   // Entity making the request
 *   owner: "user:123",  // Entity that owns the resource
 *   target: "document:456"
 * };
 * ```
 *
 * @returns An ownership schema definition
 */
import type { Schema } from "../../types/schema.ts";

/**
 * State type for ownership schema
 * No specific state structure is required
 */
export type OwnerState = object;

/**
 * Request type for ownership schema
 * Requires both 'from' and 'owner' properties as strings
 */
export type OwnerRequest = {
  from: string;
  owner: string;
};

/**
 * Creates an owner schema for permission validation
 *
 * @returns A schema for ownership validation
 */
export function owner(): Schema<OwnerState, OwnerRequest> {
  return {
    name: "owner",
    request(obj: unknown): obj is OwnerRequest {
      if (typeof obj !== "object" || !obj) return false;
      if (typeof (obj as OwnerRequest).from !== "string") return false;
      if (typeof (obj as OwnerRequest).owner !== "string") return false;
      return true;
    },
    defaultState(): OwnerState {
      return {};
    },
  };
}

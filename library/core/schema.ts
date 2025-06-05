/**
 * Core Schema Module
 *
 * This module provides utilities for creating permission schemas in the Quick Permission
 * system. Schemas define the structure and validation of state and request data.
 */

import type { Schema } from "../types/schema.ts";

/**
 * Schema creation options interface
 *
 * @template State The type of state this schema defines
 * @template Request The type of request this schema defines
 */
export interface SchemaOptions<
  State extends object,
  Request extends object,
> {
  /** Identifier for the schema, used in error messages and deduplication */
  name: string;
  /** Type guard function that validates state structure */
  state?: (obj: unknown) => obj is State;
  /** Type guard function that validates request structure */
  request?: (obj: unknown) => obj is Request;
  /** Function that generates a default state when none is provided */
  defaultState?: () => State;
}

/**
 * Creates a typed permission schema with validation and default state generation.
 *
 * This utility function makes it easy to create properly typed schemas while providing
 * a clean interface for defining state and request validation.
 *
 * ## Example Usage
 *
 * ```typescript
 * import { schema } from "@diister/quick-permission";
 *
 * // Define types for your schema
 * type InvitationState = {
 *   invitations: string[];
 * };
 *
 * type InvitationRequest = {
 *   from: string;
 *   invitation: string;
 * };
 *
 * // Create a schema using the utility
 * export const invitation = () => schema<InvitationState, InvitationRequest>({
 *   name: "invitation",
 *   state(obj: unknown): obj is InvitationState {
 *     if (typeof obj !== "object" || !obj) return false;
 *     const invitations = (obj as InvitationState).invitations;
 *     return Array.isArray(invitations) &&
 *            invitations.every(inv => typeof inv === "string");
 *   },
 *   request(obj: unknown): obj is InvitationRequest {
 *     if (typeof obj !== "object" || !obj) return false;
 *     const req = obj as InvitationRequest;
 *     return typeof req.from === "string" && typeof req.invitation === "string";
 *   },
 *   defaultState(): InvitationState {
 *     return { invitations: [] };
 *   },
 * });
 * ```
 *
 * ## Simplified Schema Creation
 *
 * For basic schemas without complex validation, you can omit the type guards:
 *
 * ```typescript
 * const simpleSchema = () => schema<{ value: string }, { input: string }>({
 *   name: "simple",
 *   defaultState: () => ({ value: "" }),
 * });
 * ```
 *
 * @param options Configuration object for the schema
 * @returns A schema object with proper typing
 */
export function schema<
  const State extends object,
  const Request extends object,
>(options: SchemaOptions<State, Request>): Schema<State, Request> {
  return {
    name: options.name,
    state: options.state,
    request: options.request,
    defaultState: options.defaultState,
  };
}

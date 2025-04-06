/**
 * Rule that checks if the requester is the owner of the resource.
 *
 * This rule passes when `request.from === request.owner`, meaning that the requesting entity
 * is identified as the owner of the resource. It's commonly used for ownership-based
 * permissions (e.g., a user editing content they own).
 *
 * The rule uses the owner schema to enforce the correct structure for state and request.
 *
 * ## Usage Example
 *
 * ```typescript
 * import { allowOwner } from "@diister/quick-permission/rules/allowOwner";
 * import { permission } from "@diister/quick-permission";
 *
 * const editPermission = permission({
 *   rules: [allowOwner()], // Only the resource owner can edit
 * });
 *
 * // When validating:
 * // If request.from === request.owner -> permission granted
 * // Otherwise -> rule returns "neutral" (no opinion)
 * ```
 *
 * @returns A rule that validates ownership-based permissions
 */
import { rule } from "../../core/rule.ts";
import { owner } from "../../schemas/owner/owner.ts";
import type { Rule } from "../../types/rule.ts";

export function allowOwner(): Rule<[ReturnType<typeof owner>]> {
  return rule(
    "allowOwner",
    [owner()],
    (_state, request) => {
      if (request.from === request.owner) {
        return "granted";
      }

      // Not handled by this validation
      return "neutral";
    },
  );
}

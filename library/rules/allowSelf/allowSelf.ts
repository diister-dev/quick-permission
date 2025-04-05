/**
 * Rule that checks if the requester is acting on themselves.
 *
 * This rule passes when `request.from === request.target`, meaning the entity making
 * the request is the same as the target of the request. It's commonly used for
 * self-referential permissions (e.g., a user editing their own profile).
 *
 * The rule uses the target schema to enforce the correct structure for state and request.
 *
 * ## Usage Example
 *
 * ```typescript
 * import { allowSelf } from "@diister/quick-permission/rules/allowSelf";
 * import { permission } from "@diister/quick-permission";
 *
 * const editProfilePermission = permission({
 *   rules: [allowSelf()], // Users can edit their own profile
 * });
 *
 * // When validating:
 * // If request.from === request.target -> permission granted
 * // Otherwise -> rule returns undefined (no opinion)
 * ```
 *
 * @returns A rule that validates self-referential permissions
 */
import { rule } from "../../core/rule.ts";
import { target } from "../../schemas/target/target.ts";
import type { Rule } from "../../types/rule.ts";

export function allowSelf(): Rule<[ReturnType<typeof target>]> {
  return rule(
    "allowSelf",
    [target()],
    (_state, request) => {
      if (request.from === request.target) {
        return true;
      }

      // Not handled by this validation
      return undefined;
    },
  );
}

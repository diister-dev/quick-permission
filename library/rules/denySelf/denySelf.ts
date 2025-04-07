/**
 * Rule that prevents an entity from acting on itself.
 *
 * This rule is the inverse of `allowSelf` and explicitly denies permission when
 * `request.from === request.target`, meaning the entity making the request is the
 * same as the target of the request. It's useful for preventing self-actions in
 * scenarios like approvals, moderation, or escalations.
 *
 * Note that when this rule returns "rejected", it short-circuits validation and
 * immediately denies the permission.
 *
 * The rule uses the target schema to enforce the correct structure for state and request.
 *
 * ## Usage Example
 *
 * ```typescript
 * import { denySelf } from "@diister/quick-permission/rules/denySelf";
 * import { allowTarget } from "@diister/quick-permission/rules/allowTarget";
 * import { permission } from "@diister/quick-permission";
 *
 * const approvalPermission = permission({
 *   rules: [
 *     // Users cannot approve their own requests
 *     denySelf(),
 *     // But users with the right permissions can approve others' requests
 *     allowTarget({ wildcards: true })
 *   ],
 *   defaultState: { target: ["request:*"] }
 * });
 *
 * // When validating:
 * // If request.from === request.target -> permission denied
 * // Otherwise -> rule returns "neutral" (no opinion)
 * ```
 *
 * @returns A rule that denies self-referential permissions
 */
import { rule } from "../../core/rule.ts";
import { target } from "../../schemas/target/target.ts";
import type { Rule } from "../../types/rule.ts";

export function denySelf(): Rule<[ReturnType<typeof target>]> {
  return rule(
    "denySelf",
    [target()],
    (_state, request) => {
      if (request.from === request.target) {
        return "rejected";
      }

      // Not handled by this validation
      return "neutral";
    },
  );
}

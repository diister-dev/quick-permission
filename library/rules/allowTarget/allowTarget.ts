/**
 * Rule that validates target-based permissions using pattern matching.
 *
 * This rule checks if the target of the request is included in the permission's
 * list of allowed targets. It supports exact matching and optional wildcard pattern
 * matching for more flexible permission structures.
 *
 * The rule uses the target schema to enforce the correct structure for state and request.
 *
 * ## Usage Example
 *
 * ```typescript
 * import { allowTarget } from "@diister/quick-permission/rules/allowTarget";
 * import { permission } from "@diister/quick-permission";
 *
 * // Basic exact matching
 * const exactPermission = permission({
 *   rules: [allowTarget()],
 *   defaultState: { target: ["resource:1", "resource:2"] }
 * });
 *
 * // With wildcard matching enabled
 * const wildcardPermission = permission({
 *   rules: [allowTarget({ wildcards: true })],
 *   defaultState: { target: ["resource:*", "folder:projects/*"] }
 * });
 * ```
 *
 * @param options Configuration options for target matching behavior
 * @returns A rule that validates target-based permissions
 */
import { rule } from "../../core/rule.ts";
import { target } from "../../schemas/target/target.ts";
import type { Rule } from "../../types/rule.ts";

export interface AllowTargetOptions {
  /**
   * Enable wildcard matching support using '*' character
   * For example: "user:*" will match "user:123", "user:456", etc.
   */
  wildcards?: boolean;

  /**
   * The wildcard character to use in patterns
   * @default "*"
   */
  wildcardChar?: string;
}

/**
 * Creates a rule that validates target-based permissions
 *
 * @param options Configuration options for the rule
 * @returns A rule that validates if the request target matches allowed targets
 */
export function allowTarget(
  options: AllowTargetOptions = {},
): Rule<[ReturnType<typeof target>]> {
  const wildcards = options.wildcards ?? false;
  const wildcardChar = options.wildcardChar ?? "*";

  return rule(
    "allowTarget",
    [target()],
    (state, request) => {
      if (!state.target || !Array.isArray(state.target)) {
        return undefined;
      }

      // Direct match without wildcards
      if (state.target.includes(request.target)) {
        return true;
      }

      // Wildcard matching if enabled
      if (wildcards) {
        for (const pattern of state.target) {
          if (matchWildcard(pattern, request.target, wildcardChar)) {
            return true;
          }
        }
      }

      // Not handled by this validation
      return undefined;
    },
  );
}

/**
 * Match a string against a pattern with wildcard support
 *
 * @param pattern Pattern string potentially containing wildcards
 * @param value Value to match against the pattern
 * @param wildcardChar Character used as wildcard
 * @returns Boolean indicating if the value matches the pattern
 */
function matchWildcard(
  pattern: string,
  value: string,
  wildcardChar: string,
): boolean {
  // Convert the pattern to a regex
  const regexPattern = pattern
    .split(wildcardChar)
    .map((segment) => escapeRegExp(segment))
    .join(".*");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(value);
}

/**
 * Escape special regex characters in a string
 *
 * @param string String to escape
 * @returns Escaped string safe for regex construction
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * FilterRule - Applies field-level filtering to resources
 */

import { applyFilter } from "../core/filtering.ts";
import { mergeFilters } from "../core/merging.ts";
import type { OutputRule } from "../core/types.ts";

/**
 * Creates a filter rule that applies field-level permissions
 *
 * The rule merges filter specs from all matching permissions and applies
 * the combined filter to the fetched resource.
 *
 * @example
 * // In permission definition
 * permission<ArticleId>(getArticle, [FilterRule()])
 *
 * // In provider
 * {
 *   subject: user,
 *   key: "article.read",
 *   filter: { _id: true, title: true, body: true }
 * }
 *
 * // Result
 * const result = await permSystem.can(user, "article.read", "article:1");
 * // result.output.data = { _id: "article:1", title: "Hello", body: "World" }
 */
export function FilterRule(): OutputRule<
  { filter?: Record<string, boolean> },
  { filter?: Record<string, boolean>; data?: any }
> {
  return {
    name: "filter",
    output: async ({ state, resource, currentOutput }) => {
      const filterSpec = state.filter;

      if (!filterSpec) {
        // No filter on this permission, return current output
        return currentOutput || {};
      }

      // Merge with accumulated filter
      const existingFilter = currentOutput?.filter;
      const mergedFilter = mergeFilters(existingFilter, filterSpec);

      // Apply merged filter to resource
      if (resource !== undefined && resource !== null) {
        const filtered = applyFilter(resource, mergedFilter);
        return {
          filter: mergedFilter,  // For inspection/debugging
          data: filtered
        };
      }

      // No resource to filter, just return the filter spec
      return { filter: mergedFilter };
    },
    defaultState: () => ({ filter: undefined })
  };
}

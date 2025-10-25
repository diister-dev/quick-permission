/**
 * FilterRule - Applies field-level filtering to resources
 */

import { applyFilter } from "../core/filtering.ts";
import { mergeFilters } from "../core/merging.ts";
import type { RuleRequest } from "../core/types.ts";
import { FilterSpec, PermissionRule } from "../mod.ts";

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
export function FilterRule(): PermissionRule<
  { filter?: FilterSpec },
  RuleRequest,
  { filter?: FilterSpec; data?: any }
> {
  return {
    name: "filter",
    check: async (state, request, ctx) => {
      const { target } = request;
      const { filter } = state;

      let resource = null;

      const { fetchTarget } = ctx.permission;
      if (fetchTarget && target !== undefined) {
        resource = await fetchTarget(target);
      }

      if (!filter) {
        // No filter on this permission, return current output
        return {
          ok: true,
          output: {
            data: resource ?? ctx.output?.data,
            filter: {} as FilterSpec,
          }
        };
      }

      // Merge with accumulated filter
      const existingFilter = ctx.output?.filter;
      const mergedFilter = mergeFilters(existingFilter, filter);

      if (resource !== null) {
        const filtered = applyFilter(resource, mergedFilter);
        return {
          ok: true,
          output: {
            data: filtered,
            filter: mergedFilter,
          }
        };
      }

      // No resource to filter, just return the filter spec
      return {
        ok: true,
        output: {
          filter: mergedFilter
        }
      };
    },
    // Default request
    default: () => ({ filter: undefined })
  };
}

/**
 * Filtering utilities for applying field-level permissions
 */

import type { FilterSpec } from "./merging.ts";

/**
 * Apply a filter specification to an object
 *
 * @param obj The object to filter
 * @param filterSpec The filter specification (field: true/false)
 * @returns The filtered object
 *
 * @example
 * applyFilter(
 *   { _id: 1, name: "John", email: "john@example.com", password: "secret" },
 *   { _id: true, name: true, email: true }
 * )
 * // → { _id: 1, name: "John", email: "john@example.com" }
 *
 * // Nested filtering
 * applyFilter(
 *   { user: { name: "John", password: "secret" } },
 *   { user: { name: true } }
 * )
 * // → { user: { name: "John" } }
 */
export function applyFilter(obj: any, filterSpec: FilterSpec): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => applyFilter(item, filterSpec));
  }

  const result: any = {};

  for (const [key, spec] of Object.entries(filterSpec)) {
    if (!(key in obj)) continue;

    if (spec === true) {
      // Include field as-is
      result[key] = obj[key];
    } else if (spec === false) {
      // Exclude field
      continue;
    } else if (typeof spec === 'object') {
      // Nested filter
      result[key] = applyFilter(obj[key], spec);
    }
  }

  return result;
}

/**
 * Pick specific fields from an object
 *
 * @param obj The source object
 * @param fields The fields to pick
 * @returns A new object with only the specified fields
 */
export function pickFields<T extends Record<string, any>>(
  obj: T,
  fields: Record<string, boolean>
): Partial<T> {
  return applyFilter(obj, fields);
}

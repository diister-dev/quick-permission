/**
 * Merging utilities for combining outputs from multiple permissions
 */

// Use interface instead of type alias to avoid circular reference error
export interface FilterSpec {
  [key: string]: boolean | FilterSpec;
}

/**
 * Merge two filter specs using union strategy (more permissive)
 *
 * @example
 * mergeFilters(
 *   { _id: true, name: true },
 *   { name: true, email: true }
 * )
 * // → { _id: true, name: true, email: true }
 */
export function mergeFilters(
  current: FilterSpec | undefined,
  incoming: FilterSpec | undefined,
): FilterSpec {
  if (!current) return incoming || {};
  if (!incoming) return current;

  const result: FilterSpec = { ...current };

  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === "boolean" && typeof result[key] === "boolean") {
      // Union: if either says true, it's true
      result[key] = result[key] || value;
    } else if (typeof value === "object" && typeof result[key] === "object") {
      // Recursive merge for nested filters
      result[key] = mergeFilters(
        result[key] as FilterSpec,
        value as FilterSpec,
      );
    } else if (!(key in result)) {
      // New key, add it
      result[key] = value;
    } else {
      // Type mismatch or other case: incoming wins
      result[key] = value;
    }
  }

  return result;
}

/**
 * Merge two values using the "most permissive" strategy, recursing down to
 * the leaves of nested structures.
 *
 * Strategies (applied at each leaf):
 * - filter / updateFilter / writeFilter: union via mergeFilters
 * - arrays: concat + dedup (set union)
 * - numbers: Math.max (largest grant wins)
 * - booleans: OR (true wins)
 * - Date: latest wins
 * - plain objects: recurse field-by-field with the same strategy
 * - everything else (string, mismatched types, null): incoming wins
 *
 * Recursive object handling fixes the previous `{ ...current, ...incoming }`
 * shortcut which made nested merges depend on insertion order rather than
 * value semantics.
 */
function mergeValue(key: string, current: any, incoming: any): any {
  // Filter-style fields are unions of allowed fields, regardless of nesting depth
  if (key === "filter" || key === "updateFilter" || key === "writeFilter") {
    return mergeFilters(current, incoming);
  }

  // Arrays: union with dedup
  if (Array.isArray(current) && Array.isArray(incoming)) {
    return [...new Set([...current, ...incoming])];
  }

  // Numbers: most permissive = largest
  if (typeof current === "number" && typeof incoming === "number") {
    return Math.max(current, incoming);
  }

  // Booleans: most permissive = OR
  if (typeof current === "boolean" && typeof incoming === "boolean") {
    return current || incoming;
  }

  // Dates: most permissive = latest
  if (current instanceof Date && incoming instanceof Date) {
    return new Date(Math.max(current.getTime(), incoming.getTime()));
  }

  // Plain objects: recurse field-by-field
  if (
    typeof current === "object" &&
    typeof incoming === "object" &&
    current !== null &&
    incoming !== null &&
    !Array.isArray(current) &&
    !Array.isArray(incoming) &&
    !(current instanceof Date) &&
    !(incoming instanceof Date)
  ) {
    const result: Record<string, any> = { ...current };
    for (const [k, v] of Object.entries(incoming)) {
      result[k] = k in current ? mergeValue(k, current[k], v) : v;
    }
    return result;
  }

  // Type mismatch or primitive: incoming wins
  return incoming;
}

/**
 * Merge two outputs intelligently based on the key
 *
 * @example
 * mergeOutputs(
 *   { filter: { _id: true }, data: { _id: 1 } },
 *   { filter: { name: true }, data: { name: "John" } }
 * )
 * // → { filter: { _id: true, name: true }, data: { _id: 1, name: "John" } }
 */
export function mergeOutputs(current: any, incoming: any): any {
  if (!current) return incoming;
  if (!incoming) return current;

  const result = { ...current };

  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in result)) {
      // New key, add it
      result[key] = value;
    } else {
      // Existing key, merge intelligently
      result[key] = mergeValue(key, result[key], value);
    }
  }

  return result;
}

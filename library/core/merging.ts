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
  incoming: FilterSpec | undefined
): FilterSpec {
  if (!current) return incoming || {};
  if (!incoming) return current;

  const result: FilterSpec = { ...current };

  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === 'boolean' && typeof result[key] === 'boolean') {
      // Union: if either says true, it's true
      result[key] = result[key] || value;
    } else if (typeof value === 'object' && typeof result[key] === 'object') {
      // Recursive merge for nested filters
      result[key] = mergeFilters(result[key] as FilterSpec, value as FilterSpec);
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
 * Merge two values based on the key type
 */
function mergeValue(key: string, current: any, incoming: any): any {
  // For "filter" and "updateFilter": Union (more permissive)
  if (key === 'filter' || key === 'updateFilter') {
    return mergeFilters(current, incoming);
  }

  // For "data": Deep merge of objects
  if (key === 'data') {
    if (typeof current === 'object' && typeof incoming === 'object' &&
        !Array.isArray(current) && !Array.isArray(incoming)) {
      return { ...current, ...incoming };
    }
    return incoming; // Replace if different types
  }

  // For arrays: Concat and deduplicate
  if (Array.isArray(current) && Array.isArray(incoming)) {
    return [...new Set([...current, ...incoming])];
  }

  // For numbers: Max (more permissive)
  if (typeof current === 'number' && typeof incoming === 'number') {
    return Math.max(current, incoming);
  }

  // For objects: Deep merge
  if (typeof current === 'object' && typeof incoming === 'object' &&
      current !== null && incoming !== null &&
      !Array.isArray(current) && !Array.isArray(incoming)) {
    return { ...current, ...incoming };
  }

  // Default: incoming wins (last wins)
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

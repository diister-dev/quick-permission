/**
 * Hierarchy management for the permission system
 * @module hierarchy
 */
import type {
  FlatHierarchy,
  Hierarchy,
  PermissionHierarchy,
  PermissionKey,
  PermissionStateSet,
} from "../types/common.ts";

/**
 * Creates a flat representation of a permission hierarchy
 * @param hierarchy The permission hierarchy to flatten
 * @returns A flattened representation of the hierarchy
 * @throws Error if a circular reference is detected
 */
export function flatHierarchy<H extends Hierarchy>(
  hierarchy: H,
): FlatHierarchy<H> {
  const flat: any = {};
  const toTraverse: any[] = [{
    path: "",
    element: hierarchy,
  }];

  // Use a Set to keep track of objects we've already seen to detect circular references
  const visited = new WeakSet();

  // Keep the maxDepth check as an additional safety mechanism
  let maxDepth = 1_000_000;

  while (toTraverse.length > 0 && maxDepth-- >= 0) {
    const current = toTraverse.pop();
    const element = current.element;

    // Check for circular reference
    if (typeof element === "object" && element !== null) {
      if (visited.has(element)) {
        throw new Error("Circular reference detected in hierarchy");
      }
      visited.add(element);
    }

    if (element.type === "permission") {
      const key = current.path;
      flat[key] = {
        schemas: element.schemas ?? [],
        rules: element.rules ?? [],
        defaultState: element.defaultState,
      };

      if (element.children) {
        for (const key in element.children) {
          const child = element.children[key];
          const path = current.path ? `${current.path}.${key}` : key;
          toTraverse.push({
            element: child,
            path,
          });
        }
      }
    } else if (typeof element === "object") {
      for (const key in element) {
        const child = element[key];
        const path = current.path ? `${current.path}.${key}` : key;
        toTraverse.push({
          element: child,
          path,
        });
      }
    } else {
      throw new Error(`Invalid element in hierarchy: ${element}`);
    }
  }

  if (maxDepth <= 0) {
    throw new Error(
      "Max depth reached while traversing hierarchy. Possible circular reference detected.",
    );
  }

  return flat;
}

/**
 * Creates a permission hierarchy object
 * @param hierarchy The raw hierarchy of permissions
 * @returns A structured permission hierarchy with flattened views
 */
export function hierarchy<const H extends Hierarchy>(
  hierarchy: H,
): PermissionHierarchy<H> {
  const flat = flatHierarchy(hierarchy);
  const keys = Object.keys(flat);

  return {
    type: "hierarchy",
    hierarchy,
    flat,
    keys,
  };
}

/**
 * Finds all permissions that are satisfied by a given key in the hierarchy
 * @param hierarchy The permission hierarchy
 * @param key The permission key to check
 * @returns An array of permission keys that are satisfied by the given key
 */
export function satisfiedBy<
  H extends PermissionHierarchy<any>,
  K extends PermissionKey<H>,
>(
  hierarchy: H,
  key: K,
): PermissionKey<H>[] {
  const matching: PermissionKey<H>[] = [];
  let traverseKey = key;
  let seperatorIndex = traverseKey.lastIndexOf(".");

  if (seperatorIndex < 0) {
    if (traverseKey in hierarchy.flat) {
      matching.push(traverseKey);
    }
    return matching;
  }

  while (seperatorIndex >= 0) {
    if (!(traverseKey in hierarchy.flat)) break;
    matching.unshift(traverseKey);

    seperatorIndex = traverseKey.lastIndexOf(".");
    traverseKey = traverseKey.substring(0, seperatorIndex) as K;
  }

  return matching;
}

/**
 * Creates a state set with default values for all permissions in a hierarchy
 *
 * @param hierarchy Permission hierarchy
 * @returns A state set with default values for all permissions
 */
export function createDefaultStateSet<H extends PermissionHierarchy<any>>(
  hierarchy: H,
): PermissionStateSet<H> {
  const stateSet: PermissionStateSet<H> = {};

  // Iterate through all keys in the hierarchy
  for (const key of hierarchy.keys) {
    const permission = hierarchy.flat[key];
    let defaultState: any = {};

    // First, collect default states from all schemas
    if (permission.schemas && permission.schemas.length > 0) {
      for (const schema of permission.schemas) {
        if (schema.defaultState) {
          defaultState = {
            ...defaultState,
            ...schema.defaultState(),
          };
        }
      }
    }

    // Override with custom default state if specified in the permission
    if (permission.defaultState) {
      defaultState = {
        ...defaultState,
        ...permission.defaultState,
      };
    }

    stateSet[key as PermissionKey<H>] = defaultState as any;
  }

  return stateSet;
}

/**
 * Core permission module for creating and configuring permissions
 * @module permission
 */
import type {
  ExtractSchemasFromRules,
  Hierarchy,
  Permission,
  PermissionSchemas,
} from "../types/common.ts";
import type { Rule } from "../types/rule.ts";
import type { Schema } from "../types/schema.ts";

/**
 * Creates a permission object with schemas, rules, optional children and default state
 *
 * @param content The permission configuration
 * @returns A configured permission object
 */
export function permission<
  const S extends Schema<any, any>[] | undefined = undefined,
  const R extends Rule<any>[] | undefined = undefined,
  const C extends Hierarchy | undefined = undefined,
>(content: {
  schemas?: S;
  rules?: R;
  children?: C;
  defaultState?: object;
}) {
  // Extract rules and explicit schemas
  const rules = (content.rules ?? []) as R;
  const explicitSchemas = content.schemas ?? [];

  // Extract schemas from rules
  const ruleSchemas = rules!.flatMap((rule) => rule.schemas || []);

  // Merge explicit schemas and those extracted from rules, eliminating duplicates
  const allSchemas = [...explicitSchemas];

  // Add only schemas that aren't already present (comparing by name)
  for (const schema of ruleSchemas) {
    const exists = allSchemas.some((s) => s.name === schema.name);
    if (!exists) {
      allSchemas.push(schema);
    }
  }

  // Generate default state from schemas if they have defaultState method
  let defaultState: object | undefined = undefined;
  if (allSchemas.length > 0) {
    defaultState = {};
    for (const schema of allSchemas) {
      if (schema.defaultState) {
        defaultState = {
          ...defaultState,
          ...schema.defaultState(),
        };
      }
    }
  }

  // Override with user-provided default state if any
  if (content.defaultState) {
    defaultState = {
      ...defaultState,
      ...content.defaultState,
    };
  }

  return {
    type: "permission",
    schemas: allSchemas as PermissionSchemas<S, R>,
    rules: rules,
    children: content.children as C,
    defaultState,
  } as Permission<S, R, C>;
}

// Re-export hierarchy and validate from their respective modules
export { hierarchy } from "./hierarchy.ts";
export { validate } from "./validation.ts";

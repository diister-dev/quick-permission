import { assertEquals } from "jsr:@std/assert";
import { createPermissionHierarchy, type PermissionHierarchy } from "../mod.ts";

// Define a test permission hierarchy
const hierarchy = {
  admin: {
    allowed: (request: undefined, state: boolean) => state === true
  },
  user: {
    allowed: (request: undefined, state: boolean) => {
        return state === true;
    },
    intercept: ({ key, request, state }, localState) => {
        if (key === "view") {
            return localState === true;
        }
        return false;
    },
    children: {
        view: {
            allowed: (request?: boolean, state?: boolean) => state === true
        },
        update: {
            allowed: (request?: boolean, state?: boolean) => state === true
        }
    }
  }
} satisfies PermissionHierarchy;

// Create permission handler
const permissions = createPermissionHierarchy(hierarchy);

// Check if a permission is allowed
Deno.test("basic", () => {
  assertEquals(permissions.can("admin", { admin: true }, undefined), true);
  assertEquals(permissions.can("admin", { admin: false }, undefined), false);
});

Deno.test("user", () => {
    assertEquals(permissions.can("user", {}, undefined), false);
    assertEquals(permissions.can("user", { user: true }, undefined), true);
    assertEquals(permissions.can("user", { "user.view": true }, undefined), false);

    // View
    assertEquals(permissions.can("user.view", { "user.view": true }, undefined), true);
    assertEquals(permissions.can("user.view", { user: true }, undefined), true);
    assertEquals(permissions.can("user.view", { user: false }, undefined), false);
    assertEquals(permissions.can("user.view", { user: true, "user.view": false }, undefined), true);
    assertEquals(permissions.can("user.view", { user: true, "user.view": true }, undefined), true);

    // Update
    assertEquals(permissions.can("user.update", { "user.update": true }, undefined), true);
    assertEquals(permissions.can("user.update", { "user.view": true }, undefined), false);
    assertEquals(permissions.can("user.update", { user: true }, undefined), false);
});
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { createPermissionHierarchy, type PermissionHierarchy } from "../mod.ts";

// Define a test permission hierarchy with validation
const hierarchy = {
    admin: {
        checkState: (state: unknown) => {
            return typeof state === "boolean";
        }
    },
    user: {
        checkRequest: (request: unknown) => {
            return typeof request === "string";
        },
        allowed: (request: string, state: boolean) => state === true,
        children: {
            profile: {
                checkState: (state: { level: number }) => {
                    if(!state) return false;
                    return typeof state.level === "number" && state.level >= 0 && state.level <= 3;
                },
                allowed: (request: undefined, state: { level: number }) => state.level >= 2
            },
            settings: {
                checkRequest: (request: { action: string }) => {
                    return ["read", "write"].includes(request.action);
                },
                allowed: (request: { action: string }, state: boolean) => state === true
            }
        }
    }
} satisfies PermissionHierarchy;

const permissions = createPermissionHierarchy(hierarchy);

// Test checkState validation
Deno.test("checkState validation", () => {
    // Test admin boolean state validation
    assertEquals(permissions.checkState("admin", true), true);
    assertEquals(permissions.checkState("admin", false), true);
    assertEquals(permissions.checkState("admin", "invalid" as any), false);

    // Test profile level validation
    assertEquals(permissions.checkState("user.profile", { level: 2 }), true);
    assertEquals(permissions.checkState("user.profile", { level: 4 }), false);
    assertEquals(permissions.checkState("user.profile", { level: -1 }), false);
    assertEquals(permissions.checkState("user.profile", { wrongProp: 2 } as any), false);
});

// Test request validation through can() method
Deno.test("checkRequest validation", () => {
    // Test user string request validation
    assertThrows(
        () => permissions.can("user", { user: true }, 123 as any),
        Error,
        "Invalid request"
    );
    
    assertEquals(permissions.can("user", { user: true }, "valid-request"), true);

    // Test settings action validation
    assertThrows(
        () => permissions.can("user.settings", { "user.settings": true }, { action: "invalid" }),
        Error,
        "Invalid request"
    );

    assertEquals(
        permissions.can("user.settings", { "user.settings": true }, { action: "read" }),
        true
    );
});

// Test invalid permission keys
Deno.test("invalid permission keys", () => {
    assertThrows(
        () => permissions.checkState("invalid-key" as any, true),
        Error,
        "Invalid key request"
    );

    assertThrows(
        () => permissions.can("invalid-key" as any, {}, undefined),
        Error,
        "Invalid key request"
    );
});

// Test combined validations
Deno.test("combined validations", () => {
    // Invalid state should only throw when checkState is defined
    assertEquals(
        permissions.can("user.settings", { "user.settings": "invalid" as any }, { action: "read" }),
        false
    );

    // Invalid request should always throw
    assertThrows(
        () => permissions.can("user.settings", { "user.settings": true }, { action: "invalid" }),
        Error,
        "Invalid request"
    );

    // Both valid
    assertEquals(
        permissions.can("user.settings", { "user.settings": true }, { action: "write" }),
        true
    );
});

// Add specific test for checkState behavior
Deno.test("checkState behavior", () => {
    // For a permission without checkState, any state should be accepted
    assertThrows(
        () => permissions.can("admin", { admin: "any value" as any }),
        Error,
        "Invalid state"
    );

    // For a permission with checkState, invalid state should throw
    assertThrows(
        () => permissions.can("user.profile", { "user.profile": "invalid" as any }, undefined),
        Error,
        "Invalid state"
    );
});

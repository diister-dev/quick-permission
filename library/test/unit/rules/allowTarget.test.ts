/**
 * Tests for allowTarget rule
 */
import { allowTarget } from "../../../rules/allowTarget/allowTarget.ts";
import { assertEquals, assertThrows } from "jsr:@std/assert";

Deno.test('allowTarget - should return "granted" when target is in the allowed list', () => {
  // Arrange
  const rule = allowTarget();
  const state = { target: ["user:123", "group:admins"] };
  const request = { target: "user:123" };

  // Act
  const result = rule.check(state, request as any); // Cast to any to bypass TypeScript error

  // Assert
  assertEquals(result, "granted");
});

Deno.test('allowTarget - should return "neutral" when target is not in the allowed list', () => {
  // Arrange
  const rule = allowTarget();
  const state = { target: ["user:456", "group:admins"] };
  const request = { target: "user:123" };

  // Act
  const result = rule.check(state, request as any); // Cast to any to bypass TypeScript error

  // Assert
  assertEquals(result, "neutral");
});

Deno.test("allowTarget - should handle missing or invalid state/target properly", () => {
  // Arrange
  const rule = allowTarget();

  // Act & Assert - Undefined state should throw TypeError
  assertThrows(
    () => rule.check(undefined as any, { target: "user:123" } as any),
    TypeError,
  );

  // Act & Assert - Missing target in state
  assertEquals(rule.check({} as any, { target: "user:123" } as any), "neutral");

  // Act & Assert - Non-array target in state
  assertEquals(
    rule.check({ target: "not-an-array" } as any, {
      target: "user:123",
      from: "user:any",
    }),
    "neutral",
  );

  // Act & Assert - Missing target in request
  assertEquals(rule.check({ target: ["user:123"] }, {} as any), "neutral");

  // Act & Assert - Null state
  assertThrows(
    () => rule.check(null as any, { target: "user:123" } as any),
    TypeError,
  );
});

Deno.test("allowTarget - should support wildcards when enabled", () => {
  // Arrange
  const rule = allowTarget({ wildcards: true });
  const state = { target: ["user:*", "group:admin.*"] };

  // Act & Assert - User wildcard
  assertEquals(
    rule.check(state, { target: "user:123", from: "user:any" }),
    "granted",
  );
  assertEquals(
    rule.check(state, { target: "user:abc", from: "user:any" }),
    "granted",
  );

  // Act & Assert - Specific group wildcard
  assertEquals(
    rule.check(state, { target: "group:admin.users", from: "user:any" }),
    "granted",
  );
  assertEquals(
    rule.check(state, { target: "group:admin.roles", from: "user:any" }),
    "granted",
  );

  // Act & Assert - Non-matching patterns
  assertEquals(
    rule.check(state, { target: "team:123", from: "user:any" }),
    "neutral",
  );
  assertEquals(
    rule.check(state, { target: "group:users", from: "user:any" }),
    "neutral",
  );
});

Deno.test("allowTarget - should not use wildcards when disabled", () => {
  // Arrange
  const rule = allowTarget({ wildcards: false });
  const state = { target: ["user:*", "group:admin.*"] };

  // Act & Assert - Literal matches should work
  assertEquals(
    rule.check(state, { target: "user:*", from: "user:any" }),
    "granted",
  );
  assertEquals(
    rule.check(state, { target: "group:admin.*", from: "user:any" }),
    "granted",
  );

  // Act & Assert - Pattern matches should not work
  assertEquals(
    rule.check(state, { target: "user:123", from: "user:any" }),
    "neutral",
  );
  assertEquals(
    rule.check(state, { target: "group:admin.users", from: "user:any" }),
    "neutral",
  );
});

Deno.test("allowTarget - should handle multiple wildcard patterns", () => {
  // Arrange
  const rule = allowTarget({ wildcards: true });
  const state = { target: ["org:*.users.*", "project:app-*-dev"] };

  // Act & Assert - Org pattern matches
  assertEquals(
    rule.check(state, { target: "org:example.users.admin", from: "user:any" }),
    "granted",
  );
  assertEquals(
    rule.check(state, { target: "org:acme.users.member", from: "user:any" }),
    "granted",
  );

  // Act & Assert - Project pattern matches
  assertEquals(
    rule.check(state, { target: "project:app-frontend-dev", from: "user:any" }),
    "granted",
  );
  assertEquals(
    rule.check(state, { target: "project:app-backend-dev", from: "user:any" }),
    "granted",
  );

  // Act & Assert - Non-matching patterns
  assertEquals(
    rule.check(state, { target: "org:example.admins", from: "user:any" }),
    "neutral",
  );
  assertEquals(
    rule.check(state, {
      target: "project:app-frontend-prod",
      from: "user:any",
    }),
    "neutral",
  );
});

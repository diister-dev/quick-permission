/**
 * Tests for allowTarget rule
 */
import { allowTarget } from "../../../rules/allowTarget/allowTarget.ts";
import { assertEquals, assertThrows } from "jsr:@std/assert";

Deno.test("allowTarget - should return true when target is in the allowed list", () => {
  // Arrange
  const rule = allowTarget();
  const state = { target: ["user:123", "group:admins"] };
  const request = { target: "user:123" };

  // Act
  const result = rule.check(state, request);

  // Assert
  assertEquals(result, true);
});

Deno.test("allowTarget - should return undefined when target is not in the allowed list", () => {
  // Arrange
  const rule = allowTarget();
  const state = { target: ["user:456", "group:admins"] };
  const request = { target: "user:123" };

  // Act
  const result = rule.check(state, request);

  // Assert
  assertEquals(result, undefined);
});

Deno.test("allowTarget - should handle missing or invalid state/target properly", () => {
  // Arrange
  const rule = allowTarget();

  // Act & Assert - Undefined state should throw TypeError
  assertThrows(
    () => rule.check(undefined, { target: "user:123" }),
    TypeError,
  );

  // Act & Assert - Missing target in state
  assertEquals(rule.check({}, { target: "user:123" }), undefined);

  // Act & Assert - Non-array target in state
  assertEquals(
    rule.check({ target: "not-an-array" }, { target: "user:123" }),
    undefined,
  );

  // Act & Assert - Missing target in request
  assertEquals(rule.check({ target: ["user:123"] }, {}), undefined);

  // Act & Assert - Null state
  assertThrows(
    () => rule.check(null, { target: "user:123" }),
    TypeError,
  );
});

Deno.test("allowTarget - should support wildcards when enabled", () => {
  // Arrange
  const rule = allowTarget({ wildcards: true });
  const state = { target: ["user:*", "group:admin.*"] };

  // Act & Assert - User wildcard
  assertEquals(rule.check(state, { target: "user:123" }), true);
  assertEquals(rule.check(state, { target: "user:abc" }), true);

  // Act & Assert - Specific group wildcard
  assertEquals(rule.check(state, { target: "group:admin.users" }), true);
  assertEquals(rule.check(state, { target: "group:admin.roles" }), true);

  // Act & Assert - Non-matching patterns
  assertEquals(rule.check(state, { target: "team:123" }), undefined);
  assertEquals(rule.check(state, { target: "group:users" }), undefined);
});

Deno.test("allowTarget - should not use wildcards when disabled", () => {
  // Arrange
  const rule = allowTarget({ wildcards: false });
  const state = { target: ["user:*", "group:admin.*"] };

  // Act & Assert - Literal matches should work
  assertEquals(rule.check(state, { target: "user:*" }), true);
  assertEquals(rule.check(state, { target: "group:admin.*" }), true);

  // Act & Assert - Pattern matches should not work
  assertEquals(rule.check(state, { target: "user:123" }), undefined);
  assertEquals(rule.check(state, { target: "group:admin.users" }), undefined);
});

Deno.test("allowTarget - should handle multiple wildcard patterns", () => {
  // Arrange
  const rule = allowTarget({ wildcards: true });
  const state = { target: ["org:*.users.*", "project:app-*-dev"] };

  // Act & Assert - Org pattern matches
  assertEquals(rule.check(state, { target: "org:example.users.admin" }), true);
  assertEquals(rule.check(state, { target: "org:acme.users.member" }), true);

  // Act & Assert - Project pattern matches
  assertEquals(rule.check(state, { target: "project:app-frontend-dev" }), true);
  assertEquals(rule.check(state, { target: "project:app-backend-dev" }), true);

  // Act & Assert - Non-matching patterns
  assertEquals(rule.check(state, { target: "org:example.admins" }), undefined);
  assertEquals(
    rule.check(state, { target: "project:app-frontend-prod" }),
    undefined,
  );
});

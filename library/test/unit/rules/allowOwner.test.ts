/**
 * Tests for allowOwner rule
 *
 * allowOwner() implements the ownership check concept:
 * It verifies if the entity making the request (from) is the owner of the resource.
 * This is used for ownership-based permissions like "can a user edit a document they own?"
 */
import { allowOwner } from "../../../rules/allowOwner/allowOwner.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test('allowOwner - should return "granted" when ownership check passes (requester is owner)', () => {
  // Arrange
  const rule = allowOwner();
  const state = {};
  const request = {
    from: "user:alice", // The user making the request
    owner: "user:alice", // The owner of the resource (same as requester)
    target: "document:123", // The resource being accessed (not used in this rule)
  };

  // Act
  const result = rule.check(state, request);

  // Assert
  assertEquals(result, "granted");
});

Deno.test('allowOwner - should return "neutral" when ownership check fails (requester is not owner)', () => {
  // Arrange
  const rule = allowOwner();
  const state = {};
  const request = {
    from: "user:alice", // The user making the request
    owner: "user:bob", // The owner of the resource (different from requester)
    target: "document:123", // The resource being accessed (not used in this rule)
  };

  // Act
  const result = rule.check(state, request);

  // Assert
  assertEquals(result, "neutral");
});

Deno.test('allowOwner - should return "neutral" when owner is missing (cannot perform ownership check)', () => {
  // Arrange
  const rule = allowOwner();
  const state = {};
  const request = {
    from: "user:alice",
    target: "document:123", // The owner field is missing
  };

  // Act
  const result = rule.check(state, request as any); // Cast to any to bypass TypeScript error

  // Assert
  assertEquals(result, "neutral");
});

Deno.test("allowOwner - should check ownership equality strictly", () => {
  // Arrange
  const rule = allowOwner();
  const state = {};

  // Test with different representations that should be treated as different owners
  const testCases = [
    {
      from: "user:alice",
      owner: "USER:alice",
      target: "document:123",
      expected: "neutral",
    },
    {
      from: "user:alice",
      owner: "user:Alice",
      target: "document:123",
      expected: "neutral",
    },
    {
      from: "user:alice",
      owner: "user:alice ",
      target: "document:123",
      expected: "neutral",
    },
    {
      from: "user:alice",
      owner: " user:alice",
      target: "document:123",
      expected: "neutral",
    },
  ];

  // Act & Assert
  for (const testCase of testCases) {
    const result = rule.check(state, testCase);
    assertEquals(result, testCase.expected);
  }
});

/**
 * Tests for allowSelf rule
 * 
 * allowSelf() implements the identity check concept:
 * It verifies if the entity making the request (from) is the same as the target entity.
 * This is used for self-referential permissions like "can a user edit their own profile?"
 */
import { allowSelf } from "../../../rules/allowSelf/allowSelf.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("allowSelf - should return true when identity check passes (from equals target)", () => {
  // Arrange
  const rule = allowSelf();
  const state = {
    target: [],
  };
  const request = { 
    from: "user:alice",  // The user making the request
    target: "user:alice" // The entity being targeted (same as requester)
  };
  
  // Act
  const result = rule.check(state, request);
  
  // Assert
  assertEquals(result, true);
});

Deno.test("allowSelf - should return undefined when identity check fails (from differs from target)", () => {
  // Arrange
  const rule = allowSelf();
  const state = {
    target: [],
  };
  const request = { 
    from: "user:alice",  // The user making the request
    target: "user:bob"   // The entity being targeted (different from requester)
  };
  
  // Act
  const result = rule.check(state, request);
  
  // Assert
  assertEquals(result, undefined);
});

Deno.test("allowSelf - should return undefined when target is missing (cannot perform identity check)", () => {
  // Arrange
  const rule = allowSelf();
  const state = {
    target: [],
  };
  const request = { from: "user:alice" };
  
  // Act
  const result = rule.check(state, request as any); // Cast to any to bypass TypeScript error
  
  // Assert
  assertEquals(result, undefined);
});

Deno.test("allowSelf - should check identity equality strictly", () => {
  // Arrange
  const rule = allowSelf();
  const state = {
    target: [],
  };
  
  // Test with different representations that should be treated as different identities
  const testCases = [
    { from: "user:alice", target: "USER:alice", expected: undefined },
    { from: "user:alice", target: "user:Alice", expected: undefined },
    { from: "user:alice", target: "user:alice ", expected: undefined },
    { from: "user:alice", target: " user:alice", expected: undefined },
  ];
  
  // Act & Assert
  for (const testCase of testCases) {
    const result = rule.check(state, testCase);
    assertEquals(result, testCase.expected);
  }
});
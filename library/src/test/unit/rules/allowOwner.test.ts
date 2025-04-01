/**
 * Tests for allowOwner rule
 */
import { allowOwner } from "../../../rules/allowOwner/allowOwner.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("allowOwner - should return true when from equals owner", () => {
  // Arrange
  const rule = allowOwner();
  const state = {};
  const request = { from: "user:123", owner: "user:123" };
  
  // Act
  const result = rule.check(state, request);
  
  // Assert
  assertEquals(result, true);
});

Deno.test("allowOwner - should return undefined when from does not equal owner", () => {
  // Arrange
  const rule = allowOwner();
  const state = {};
  const request = { from: "user:123", owner: "user:456" };
  
  // Act
  const result = rule.check(state, request);
  
  // Assert
  assertEquals(result, undefined);
});

Deno.test("allowOwner - should return undefined when owner is missing", () => {
  // Arrange
  const rule = allowOwner();
  const state = {};
  const request = { from: "user:123" };
  
  // Act
  const result = rule.check(state, request);
  
  // Assert
  assertEquals(result, undefined);
});

Deno.test("allowOwner - should check equality strictly", () => {
  // Arrange
  const rule = allowOwner();
  const state = {};
  
  // Test with different representations that should be treated as different
  const testCases = [
    { from: "user:123", owner: "USER:123", expected: undefined },
    { from: "user:123", owner: "user:0123", expected: undefined },
    { from: "user:123", owner: "user:123 ", expected: undefined },
    { from: "user:123", owner: " user:123", expected: undefined },
  ];
  
  // Act & Assert
  for (const testCase of testCases) {
    const result = rule.check(state, testCase);
    assertEquals(result, testCase.expected);
  }
});
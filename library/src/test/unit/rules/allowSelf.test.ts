/**
 * Tests for allowSelf rule
 */
import { allowSelf } from "../../../rules/allowSelf/allowSelf.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("allowSelf - should return true when from equals target", () => {
  // Arrange
  const rule = allowSelf();
  const state = {};
  const request = { from: "user:123", target: "user:123" };
  
  // Act
  const result = rule.check(state, request);
  
  // Assert
  assertEquals(result, true);
});

Deno.test("allowSelf - should return undefined when from does not equal target", () => {
  // Arrange
  const rule = allowSelf();
  const state = {};
  const request = { from: "user:123", target: "user:456" };
  
  // Act
  const result = rule.check(state, request);
  
  // Assert
  assertEquals(result, undefined);
});

Deno.test("allowSelf - should return undefined when target is missing", () => {
  // Arrange
  const rule = allowSelf();
  const state = {};
  const request = { from: "user:123" };
  
  // Act
  const result = rule.check(state, request);
  
  // Assert
  assertEquals(result, undefined);
});

Deno.test("allowSelf - should check equality strictly", () => {
  // Arrange
  const rule = allowSelf();
  const state = {};
  
  // Test with different representations that should be treated as different
  const testCases = [
    { from: "user:123", target: "USER:123", expected: undefined },
    { from: "user:123", target: "user:0123", expected: undefined },
    { from: "user:123", target: "user:123 ", expected: undefined },
    { from: "user:123", target: " user:123", expected: undefined },
  ];
  
  // Act & Assert
  for (const testCase of testCases) {
    const result = rule.check(state, testCase);
    assertEquals(result, testCase.expected);
  }
});
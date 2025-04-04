/**
 * Tests for denySelf rule
 */
import { denySelf } from "../../../rules/denySelf/denySelf.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("denySelf - should return false when from equals target", () => {
  // Arrange
  const rule = denySelf();
  const state = { target: [] };
  const request = { from: "user:123", target: "user:123" };

  // Act
  const result = rule.check(state, request);

  // Assert
  assertEquals(result, false);
});

Deno.test("denySelf - should return undefined when from does not equal target", () => {
  // Arrange
  const rule = denySelf();
  const state = { target: [] };
  const request = { from: "user:123", target: "user:456" };

  // Act
  const result = rule.check(state, request);

  // Assert
  assertEquals(result, undefined);
});

Deno.test("denySelf - should return undefined when target is missing", () => {
  // Arrange
  const rule = denySelf();
  const state = { target: [] };
  const request = { from: "user:123" };

  // Act
  const result = rule.check(state, request as any); // Cast to any to bypass TypeScript error

  // Assert
  assertEquals(result, undefined);
});

Deno.test("denySelf - should check equality strictly", () => {
  // Arrange
  const rule = denySelf();
  const state = { target: [] };

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

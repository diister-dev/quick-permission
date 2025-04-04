/**
 * Tests for operations (AND, OR, NOT, merge) functionality
 */
import { and, merge, not, or } from "../../../operators/operations.ts";
import { rule } from "../../../core/rule.ts";
import { assertEquals } from "jsr:@std/assert";
import { Schema } from "../../../types/schema.ts";

// Mock schemas for testing
const schema1 = {
  name: "schema1",
  state: (_obj: unknown): _obj is unknown => true,
  request: (_obj: unknown): _obj is unknown => true,
};

const schema2 = {
  name: "schema2",
  state: (_obj: unknown): _obj is unknown => true,
  request: (_obj: unknown): _obj is unknown => true,
};

// Create test rules
const trueRule = rule("trueRule", [schema1], () => true);
const falseRule = rule("falseRule", [schema2], () => false);
const undefinedRule = rule("undefinedRule", [], () => undefined);
const stateCheckRule = rule(
  "stateCheckRule",
  [],
  (state: any) => state?.value === true,
);

// Test state and request objects
const state = { value: true } as never;
const request = {} as never;

Deno.test("merge - should return true when any rule returns true", () => {
  // Arrange
  const mergedRule = merge([trueRule, undefinedRule]);

  // Act
  const result = mergedRule.check(state, request);

  // Assert
  assertEquals(result, true);
});

Deno.test("merge - should return false when any rule returns false", () => {
  // Arrange
  const mergedRule = merge([trueRule, falseRule, undefinedRule]);

  // Act
  const result = mergedRule.check(state, request);

  // Assert
  assertEquals(result, false);
});

Deno.test("merge - should return undefined when no rule returns true but none return false", () => {
  // Arrange
  const mergedRule = merge([undefinedRule, undefinedRule]);

  // Act
  const result = mergedRule.check(state, request);

  // Assert
  assertEquals(result, undefined);
});

Deno.test("merge - should merge schemas correctly", () => {
  // Arrange
  const rule1 = rule("rule1", [schema1], () => true);
  const rule2 = rule("rule2", [schema2], () => true);
  const rule3 = rule("rule3", [schema1], () => true); // Duplicate schema

  // Act
  const mergedRule = merge([rule1, rule2, rule3]);

  // Assert
  assertEquals(mergedRule.schemas.length, 2); // Should deduplicate schemas
  assertEquals(mergedRule.schemas[0].name, schema1.name);
  assertEquals(mergedRule.schemas[1].name, schema2.name);
});

Deno.test("and - should return true when all rules return true", () => {
  // Arrange
  const andRule = and([trueRule, trueRule]);

  // Act
  const result = andRule.check(state, request);

  // Assert
  assertEquals(result, true);
});

Deno.test("and - should return false when any rule returns false", () => {
  // Arrange
  const andRule = and([trueRule, falseRule]);

  // Act
  const result = andRule.check(state, request);

  // Assert
  assertEquals(result, false);
});

Deno.test("and - should return undefined when no rule returns false but at least one is undefined", () => {
  // Arrange
  const andRule = and([trueRule, undefinedRule]);

  // Act
  const result = andRule.check(state, request);

  // Assert
  assertEquals(result, undefined);
});

Deno.test("or - should return true when any rule returns true", () => {
  // Arrange
  const orRule = or([falseRule, trueRule]);

  // Act
  const result = orRule.check(state, request);

  // Assert
  assertEquals(result, true);
});

Deno.test("or - should return undefined when no rule returns true", () => {
  // Arrange
  const orRule = or([falseRule, undefinedRule]);

  // Act
  const result = orRule.check(state, request);

  // Assert
  assertEquals(result, undefined);
});

Deno.test("not - should invert true to false", () => {
  // Arrange
  const notRule = not(trueRule);

  // Act
  const result = notRule.check(state, request);

  // Assert
  assertEquals(result, false);
});

Deno.test("not - should invert false to true", () => {
  // Arrange
  const notRule = not(falseRule);

  // Act
  const result = notRule.check(state, request);

  // Assert
  assertEquals(result, true);
});

Deno.test("not - should leave undefined as undefined", () => {
  // Arrange
  const notRule = not(undefinedRule);

  // Act
  const result = notRule.check(state, request);

  // Assert
  assertEquals(result, undefined);
});

Deno.test("operators - should work with rules that use state", () => {
  // Arrange
  const trueState = { value: true } as never;
  const falseState = { value: false } as never;

  // Act
  const result1 = stateCheckRule.check(trueState, request);
  const result2 = stateCheckRule.check(falseState, request);

  // Assert
  assertEquals(result1, true);
  assertEquals(result2, false);
});

Deno.test("operators - should work with complex combinations", () => {
  // Arrange
  const complexRule = and([
    or([stateCheckRule, falseRule]),
    not(falseRule),
  ]);

  // Act
  const resultTrue = complexRule.check(state, request);
  const resultFalse = complexRule.check({ value: false } as never, request);

  // Assert
  assertEquals(resultTrue, true); // stateCheckRule is true, and not(falseRule) is true
  assertEquals(resultFalse, undefined); // or([stateCheckRule, falseRule]) is undefined with value: false
});

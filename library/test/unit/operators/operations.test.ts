/**
 * Tests for operations (AND, OR, NOT, merge) functionality
 */
import { and, merge, not, or } from "../../../operators/operations.ts";
import { rule } from "../../../core/rule.ts";
import { assertEquals } from "jsr:@std/assert";
import { Schema } from "../../../types/schema.ts";
import {
  VALIDATION_RESULT,
  ValidationResultType,
} from "../../../types/common.ts";

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
const grantedRule = rule(
  "grantedRule",
  [schema1],
  () => VALIDATION_RESULT.GRANTED,
);
const rejectedRule = rule(
  "rejectedRule",
  [schema2],
  () => VALIDATION_RESULT.REJECTED,
);
const neutralRule = rule("neutralRule", [], () => VALIDATION_RESULT.NEUTRAL);
const blockedRule = rule("blockedRule", [], () => VALIDATION_RESULT.BLOCKED);
const stateCheckRule = rule(
  "stateCheckRule",
  [],
  (state: any) =>
    state?.value === true
      ? VALIDATION_RESULT.GRANTED
      : VALIDATION_RESULT.NEUTRAL,
);

// Test state and request objects
const state = { value: true } as never;
const request = {} as never;

Deno.test("merge - should return granted when any rule returns granted", () => {
  // Arrange
  const mergedRule = merge([grantedRule, neutralRule]);

  // Act
  const result = mergedRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.GRANTED);
});

Deno.test("merge - should return rejected when any rule returns rejected", () => {
  // Arrange
  const mergedRule = merge([grantedRule, rejectedRule, neutralRule]);

  // Act
  const result = mergedRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.REJECTED);
});

Deno.test("merge - should return blocked when any rule returns blocked", () => {
  // Arrange
  const mergedRule = merge([grantedRule, blockedRule, neutralRule]);

  // Act
  const result = mergedRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.BLOCKED);
});

Deno.test("merge - should return neutral when no rule returns granted, rejected or blocked", () => {
  // Arrange
  const mergedRule = merge([neutralRule, neutralRule]);

  // Act
  const result = mergedRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.NEUTRAL);
});

Deno.test("merge - should merge schemas correctly", () => {
  // Arrange
  const rule1 = rule("rule1", [schema1], () => VALIDATION_RESULT.GRANTED);
  const rule2 = rule("rule2", [schema2], () => VALIDATION_RESULT.GRANTED);
  const rule3 = rule("rule3", [schema1], () => VALIDATION_RESULT.GRANTED); // Duplicate schema

  // Act
  const mergedRule = merge([rule1, rule2, rule3]);

  // Assert
  assertEquals(mergedRule.schemas.length, 2); // Should deduplicate schemas
  assertEquals(mergedRule.schemas[0].name, schema1.name);
  assertEquals(mergedRule.schemas[1].name, schema2.name);
});

Deno.test("and - should return granted when all rules return granted", () => {
  // Arrange
  const andRule = and([grantedRule, grantedRule]);

  // Act
  const result = andRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.GRANTED);
});

Deno.test("and - should return rejected when any rule returns rejected", () => {
  // Arrange
  const andRule = and([grantedRule, rejectedRule]);

  // Act
  const result = andRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.REJECTED);
});

Deno.test("and - should return blocked when any rule returns blocked", () => {
  // Arrange
  const andRule = and([grantedRule, blockedRule]);

  // Act
  const result = andRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.BLOCKED);
});

Deno.test("and - should return neutral when no rule returns rejected or blocked but at least one is neutral", () => {
  // Arrange
  const andRule = and([grantedRule, neutralRule]);

  // Act
  const result = andRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.NEUTRAL);
});

Deno.test("or - should return granted when any rule returns granted", () => {
  // Arrange
  const orRule = or([rejectedRule, grantedRule]);

  // Act
  const result = orRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.GRANTED);
});

Deno.test("or - should return neutral when no rule returns granted", () => {
  // Arrange
  const orRule = or([rejectedRule, neutralRule]);

  // Act
  const result = orRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.NEUTRAL);
});

Deno.test("not - should invert granted to rejected", () => {
  // Arrange
  const notRule = not(grantedRule);

  // Act
  const result = notRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.REJECTED);
});

Deno.test("not - should invert rejected to granted", () => {
  // Arrange
  const notRule = not(rejectedRule);

  // Act
  const result = notRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.GRANTED);
});

Deno.test("not - should invert blocked to granted", () => {
  // Arrange
  const notRule = not(blockedRule);

  // Act
  const result = notRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.GRANTED);
});

Deno.test("not - should leave neutral as neutral", () => {
  // Arrange
  const notRule = not(neutralRule);

  // Act
  const result = notRule.check(state, request);

  // Assert
  assertEquals(result, VALIDATION_RESULT.NEUTRAL);
});

Deno.test("operators - should work with rules that use state", () => {
  // Arrange
  const trueState = { value: true } as never;
  const falseState = { value: false } as never;

  // Act
  const result1 = stateCheckRule.check(trueState, request);
  const result2 = stateCheckRule.check(falseState, request);

  // Assert
  assertEquals(result1, VALIDATION_RESULT.GRANTED);
  assertEquals(result2, VALIDATION_RESULT.NEUTRAL);
});

Deno.test("operators - should work with complex combinations", () => {
  // Arrange
  const complexRule = and([
    or([stateCheckRule, rejectedRule]),
    not(rejectedRule),
  ]);

  // Act
  const resultGranted = complexRule.check(state, request);
  const resultNeutral = complexRule.check({ value: false } as never, request);

  // Assert
  assertEquals(resultGranted, VALIDATION_RESULT.GRANTED); // stateCheckRule is granted, and not(rejectedRule) is granted
  assertEquals(resultNeutral, VALIDATION_RESULT.NEUTRAL); // or([stateCheckRule, rejectedRule]) is neutral with value: false
});

/**
 * Tests for ensureTime rule
 */
import { ensureTime } from "../../../rules/ensureTime/ensureTime.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("ensureTime - should return undefined when no time constraints exist", () => {
  // Arrange
  const rule = ensureTime();
  const state = {};
  const request = {};

  // Act
  const result = rule.check(state, request);

  // Assert
  assertEquals(result, undefined);
});

Deno.test("ensureTime - should return false when current date is before dateStart", () => {
  // Arrange
  const rule = ensureTime();
  const now = new Date();
  const futureDate = new Date(now.getTime() + 1000 * 60 * 60 * 24); // 1 day in future
  const state = { dateStart: futureDate };

  // Act - Using default current time
  const result = rule.check(state, {});

  // Assert
  assertEquals(result, false);
});

Deno.test("ensureTime - should return undefined when current date is after dateStart", () => {
  // Arrange
  const rule = ensureTime();
  const now = new Date();
  const pastDate = new Date(now.getTime() - 1000 * 60 * 60 * 24); // 1 day in past
  const state = { dateStart: pastDate };

  // Act - Using default current time
  const result = rule.check(state, {});

  // Assert
  assertEquals(result, undefined);
});

Deno.test("ensureTime - should return false when current date is after dateEnd", () => {
  // Arrange
  const rule = ensureTime();
  const now = new Date();
  const pastDate = new Date(now.getTime() - 1000 * 60 * 60 * 24); // 1 day in past
  const state = { dateEnd: pastDate };

  // Act - Using default current time
  const result = rule.check(state, {});

  // Assert
  assertEquals(result, false);
});

Deno.test("ensureTime - should return undefined when current date is before dateEnd", () => {
  // Arrange
  const rule = ensureTime();
  const now = new Date();
  const futureDate = new Date(now.getTime() + 1000 * 60 * 60 * 24); // 1 day in future
  const state = { dateEnd: futureDate };

  // Act - Using default current time
  const result = rule.check(state, {});

  // Assert
  assertEquals(result, undefined);
});

Deno.test("ensureTime - should consider both dateStart and dateEnd constraints", () => {
  // Arrange
  const rule = ensureTime();
  const now = new Date();
  const pastDate = new Date(now.getTime() - 1000 * 60 * 60 * 24); // 1 day in past
  const futureDate = new Date(now.getTime() + 1000 * 60 * 60 * 24); // 1 day in future

  // State with valid range (past to future)
  const validState = {
    dateStart: pastDate,
    dateEnd: futureDate,
  };

  // State with invalid range (future to further future)
  const invalidStateStart = {
    dateStart: futureDate,
    dateEnd: new Date(now.getTime() + 1000 * 60 * 60 * 48), // 2 days in future
  };

  // State with invalid range (past to further past)
  const invalidStateEnd = {
    dateStart: new Date(now.getTime() - 1000 * 60 * 60 * 48), // 2 days in past
    dateEnd: pastDate,
  };

  // Act
  const resultValid = rule.check(validState, {});
  const resultInvalidStart = rule.check(invalidStateStart, {});
  const resultInvalidEnd = rule.check(invalidStateEnd, {});

  // Assert
  assertEquals(resultValid, undefined);
  assertEquals(resultInvalidStart, false);
  assertEquals(resultInvalidEnd, false);
});

Deno.test("ensureTime - should use request date when provided", () => {
  // Arrange
  const rule = ensureTime();
  const baseDate = new Date(2023, 0, 15); // Jan 15, 2023
  const earlierDate = new Date(2023, 0, 10); // Jan 10, 2023
  const laterDate = new Date(2023, 0, 20); // Jan 20, 2023

  const state = {
    dateStart: baseDate,
    dateEnd: laterDate,
  };

  // Act
  const resultBefore = rule.check(state, { date: earlierDate });
  const resultDuring = rule.check(state, { date: new Date(2023, 0, 17) }); // Jan 17, 2023
  const resultAfter = rule.check(state, { date: new Date(2023, 0, 25) }); // Jan 25, 2023

  // Assert
  assertEquals(resultBefore, false); // Before start date
  assertEquals(resultDuring, undefined); // Within range
  assertEquals(resultAfter, false); // After end date
});

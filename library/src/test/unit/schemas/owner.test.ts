/**
 * Tests for owner schema
 */
import { owner } from "../../../schemas/owner/owner.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("owner schema - should validate correct request structure", () => {
  // Arrange
  const schema = owner();
  const validRequest = {
    from: "user:123",
    owner: "user:456",
  };

  // Act
  const result = schema.request?.(validRequest);

  // Assert
  assertEquals(result, true);
});

Deno.test("owner schema - should invalidate incorrect request structure", () => {
  // Arrange
  const schema = owner();

  // Act & Assert - Not an object
  assertEquals(schema.request?.(null), false);
  assertEquals(schema.request?.(undefined), false);
  assertEquals(schema.request?.("string"), false);

  // Act & Assert - Missing properties
  assertEquals(schema.request?.({}), false);
  assertEquals(schema.request?.({ from: "user:123" }), false);
  assertEquals(schema.request?.({ owner: "user:456" }), false);

  // Act & Assert - Incorrect property types
  assertEquals(schema.request?.({ from: 123, owner: "user:456" }), false);
  assertEquals(schema.request?.({ from: "user:123", owner: 456 }), false);
  assertEquals(
    schema.request?.({ from: ["user:123"], owner: "user:456" }),
    false,
  );
});

Deno.test("owner schema - should have correct name", () => {
  // Arrange
  const schema = owner();

  // Act & Assert
  assertEquals(schema.name, "owner");
});

Deno.test("owner schema - should not validate state", () => {
  // Arrange
  const schema = owner();

  // Act & Assert - state method should not be defined
  assertEquals(typeof schema.state, "undefined");
});

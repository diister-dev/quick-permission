/**
 * Tests for target schema
 */
import {
  target,
  TargetRequest,
  TargetState,
} from "../../../schemas/target/target.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("target schema - should validate correct state structure", () => {
  // Arrange
  const schema = target();
  const validState: TargetState = { target: ["user:123", "group:admins"] };

  // Act
  const result = schema.state?.(validState);

  // Assert
  assertEquals(result, true);
});

Deno.test("target schema - should invalidate incorrect state structure", () => {
  // Arrange
  const schema = target();

  // Act & Assert - Not an object
  assertEquals(schema.state?.(null), false);
  assertEquals(schema.state?.(undefined), false);
  assertEquals(schema.state?.("string"), false);

  // Act & Assert - Missing target property
  assertEquals(schema.state?.({}), false);

  // Act & Assert - Target is not an array
  assertEquals(schema.state?.({ target: "user:123" }), false);
  assertEquals(schema.state?.({ target: 123 }), false);
  assertEquals(schema.state?.({ target: { value: "user:123" } }), false);
});

Deno.test("target schema - should validate correct request structure", () => {
  // Arrange
  const schema = target();
  const validRequest: TargetRequest = {
    from: "user:123",
    target: "resource:456",
  };

  // Act
  const result = schema.request?.(validRequest);

  // Assert
  assertEquals(result, true);
});

Deno.test("target schema - should invalidate incorrect request structure", () => {
  // Arrange
  const schema = target();

  // Act & Assert - Not an object
  assertEquals(schema.request?.(null), false);
  assertEquals(schema.request?.(undefined), false);
  assertEquals(schema.request?.("string"), false);

  // Act & Assert - Missing properties
  assertEquals(schema.request?.({}), false);
  assertEquals(schema.request?.({ from: "user:123" }), false);
  assertEquals(schema.request?.({ target: "resource:456" }), false);

  // Act & Assert - Incorrect property types
  assertEquals(schema.request?.({ from: 123, target: "resource:456" }), false);
  assertEquals(schema.request?.({ from: "user:123", target: 456 }), false);
  assertEquals(
    schema.request?.({ from: ["user:123"], target: "resource:456" }),
    false,
  );
});

Deno.test("target schema - should have correct name", () => {
  // Arrange
  const schema = target();

  // Act & Assert
  assertEquals(schema.name, "target");
});

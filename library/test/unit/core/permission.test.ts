/**
 * Tests for permission functionality
 */
import { permission } from "../../../core/permission.ts";
import { assertEquals } from "jsr:@std/assert";
import { VALIDATION_RESULT } from "../../../types/common.ts";

// Create a mock schema
const mockSchema1 = {
  name: "schema1",
  validate: () => ({ valid: true, reasons: [] }),
};

// Create a mock schema with the same name (for duplicate testing)
const mockSchema1Duplicate = {
  name: "schema1",
  validate: () => ({ valid: true, reasons: [] }),
};

// Create another mock schema
const mockSchema2 = {
  name: "schema2",
  validate: () => ({ valid: true, reasons: [] }),
};

// Create a mock rule with schemas
const mockRule1 = {
  name: "rule1",
  schemas: [mockSchema1],
  check: () => VALIDATION_RESULT.GRANTED,
};

// Create a mock rule with schema2
const mockRule2 = {
  name: "rule2",
  schemas: [mockSchema2],
  check: () => VALIDATION_RESULT.GRANTED,
};

// Create a mock rule without schemas
const mockRuleNoSchema = {
  name: "ruleNoSchema",
  schemas: [],
  check: () => VALIDATION_RESULT.GRANTED,
};

Deno.test("permission - should create a permission object with correct type", () => {
  // Arrange & Act
  const perm = permission({ rules: [] });

  // Assert
  assertEquals(perm.type, "permission");
  assertEquals(perm.rules, []);
  assertEquals(perm.schemas, []);
  assertEquals(perm.children, undefined);
});

Deno.test("permission - should accept explicit schemas", () => {
  // Arrange & Act
  const perm = permission({
    schemas: [mockSchema1],
    rules: [],
  });

  // Assert
  assertEquals(perm.schemas.length, 1);
  assertEquals(perm.schemas[0], mockSchema1);
});

Deno.test("permission - should extract schemas from rules", () => {
  // Arrange & Act
  const perm = permission({
    rules: [mockRule1],
  });

  // Assert
  assertEquals(perm.schemas.length, 1);
  assertEquals(perm.schemas[0], mockSchema1);
});

Deno.test("permission - should merge explicit schemas and rule schemas without duplicates", () => {
  // Arrange & Act
  const perm = permission({
    schemas: [mockSchema1],
    rules: [mockRule1, mockRule2], // mockRule1 has mockSchema1, which would be a duplicate
  });

  // Assert
  assertEquals(perm.schemas.length, 2); // Should only have 2 unique schemas
  assertEquals(perm.schemas[0], mockSchema1);
  assertEquals(perm.schemas[1], mockSchema2);
});

Deno.test("permission - should handle rules without schemas", () => {
  // Arrange & Act
  const perm = permission({
    rules: [mockRuleNoSchema],
  });

  // Assert
  assertEquals(perm.schemas.length, 0);
  assertEquals(perm.rules?.length, 1);
  assertEquals(perm.rules?.[0], mockRuleNoSchema);
});

Deno.test("permission - should preserve children hierarchy", () => {
  // Arrange
  const childPerm = permission({ rules: [] });

  // Act
  const perm = permission({
    rules: [],
    children: {
      child: childPerm,
    },
  });

  // Assert
  assertEquals(perm.children?.child, childPerm);
});

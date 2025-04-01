/**
 * Tests for validation functionality
 */
import { validation, validate } from "../../../core/permission.ts";
import { hierarchy } from "../../../core/hierarchy.ts";
import { permission } from "../../../core/permission.ts";
import { assertEquals } from "jsr:@std/assert";
import { assertValidationSuccess, assertValidationFailure } from "../../helpers/test_utils.ts";

// Mock schema that always validates successfully
const validSchema = {
  name: "validSchema",
  state: () => true,
  request: () => true
};

// Mock schema that fails state validation
const invalidStateSchema = {
  name: "invalidStateSchema",
  state: () => false,
  request: () => true
};

// Mock schema that fails request validation
const invalidRequestSchema = {
  name: "invalidRequestSchema",
  state: () => true,
  request: () => false
};

// Mock schema that throws an error during validation
const errorSchema = {
  name: "errorSchema",
  state: () => { throw new Error("Schema state error"); },
  request: () => true
};

// Mock rules
const allowRule = {
  name: "allowRule",
  check: () => true
};

const denyRule = {
  name: "denyRule",
  check: () => false
};

const neutralRule = {
  name: "neutralRule",
  check: () => undefined
};

const errorRule = {
  name: "errorRule",
  check: () => { throw new Error("Rule check error"); }
};

Deno.test("validate - should validate successfully with valid schemas and rules", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [validSchema],
      rules: [allowRule],
    }),
  });

  const states = [
    {
      "resource": { someState: "value" }
    }
  ];

  // Act
  const result = validate(testPermissions, states, "resource", { someRequest: "value" });

  // Assert
  assertValidationSuccess(result);
});

Deno.test("validate - should fail when schema state validation fails", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [invalidStateSchema],
      rules: [allowRule],
    }),
  });

  const states = [
    {
      "resource": { someState: "value" }
    }
  ];

  // Act
  const result = validate(testPermissions, states, "resource", { someRequest: "value" });

  // Assert
  assertValidationFailure(result, ["schema"], ["invalidStateSchema"]);
  assertEquals(result.reasons[0].message, "Invalid state for schema invalidStateSchema");
});

Deno.test("validate - should fail when schema request validation fails", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [invalidRequestSchema],
      rules: [allowRule],
    }),
  });

  const states = [
    {
      "resource": { someState: "value" }
    }
  ];

  // Act
  const result = validate(testPermissions, states, "resource", { someRequest: "value" });

  // Assert
  assertValidationFailure(result, ["schema"], ["invalidRequestSchema"]);
  assertEquals(result.reasons[0].message, "Invalid request for schema invalidRequestSchema");
});

Deno.test("validate - should fail when a schema throws an error", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [errorSchema],
      rules: [allowRule],
    }),
  });

  const states = [
    {
      "resource": { someState: "value" }
    }
  ];

  // Act
  const result = validate(testPermissions, states, "resource", { someRequest: "value" });

  // Assert
  assertValidationFailure(result, ["schema"], ["errorSchema"]);
  assertEquals(result.reasons[0].message, "Schema state error");
});

Deno.test("validate - should fail when a rule returns false", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [validSchema],
      rules: [denyRule],
    }),
  });

  const states = [
    {
      "resource": { someState: "value" }
    }
  ];

  // Act
  const result = validate(testPermissions, states, "resource", { someRequest: "value" });

  // Assert
  assertValidationFailure(result, ["rule"], ["denyRule"]);
  assertEquals(result.reasons[0].message, "Rule not satisfied: denyRule");
});

Deno.test("validate - should fail when a rule throws an error", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [validSchema],
      rules: [errorRule],
    }),
  });

  const states = [
    {
      "resource": { someState: "value" }
    }
  ];

  // Act
  const result = validate(testPermissions, states, "resource", { someRequest: "value" });

  // Assert
  assertValidationFailure(result, ["rule"], ["errorRule"]);
  assertEquals(result.reasons[0].message, "Rule check error");
});

Deno.test("validate - should return undefined validity with only neutral rules", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [validSchema],
      rules: [neutralRule],
    }),
  });

  const states = [
    {
      "resource": { someState: "value" }
    }
  ];

  // Act
  const result = validate(testPermissions, states, "resource", { someRequest: "value" });

  // Assert
  assertEquals(result.valid, false);  // The default is false when no explicit allow
  assertEquals(result.reasons.length, 0);
});

Deno.test("validate - should handle permission hierarchies (parent-child)", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [validSchema],
      rules: [allowRule],
      children: {
        read: permission({
          schemas: [validSchema],
          rules: [allowRule],
        })
      }
    }),
  });

  const states = [
    {
      "resource": { parentState: "value" },
      "resource.read": { childState: "value" }
    }
  ];

  // Act
  const result = validate(testPermissions, states, "resource.read", { someRequest: "value" });

  // Assert
  assertValidationSuccess(result);
});

Deno.test("validate - should fail if any permission in the hierarchy fails", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [validSchema],
      rules: [denyRule],  // Parent denies
      children: {
        read: permission({
          schemas: [validSchema],
          rules: [allowRule],  // Child allows
        })
      }
    }),
  });

  const states = [
    {
      "resource": { parentState: "value" },
      "resource.read": { childState: "value" }
    }
  ];

  // Act
  const result = validate(testPermissions, states, "resource.read", { someRequest: "value" });

  // Assert
  assertValidationFailure(result, ["rule"], ["denyRule"]);
});

Deno.test("validate - should consider multiple states with OR logic", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [validSchema],
      rules: [denyRule],  // This state denies
    }),
  });

  const states = [
    {
      "resource": { state: "denying" }
    },
    {
      "resource": { state: "allowing" }
    }
  ];

  // Create a special rule that checks state value
  const stateSpecificRule = {
    name: "stateSpecificRule",
    check: (state: any) => state.state === "allowing"
  };

  // Override the rules for the test
  testPermissions.flat.resource.rules = [stateSpecificRule];

  // Act
  const result = validate(testPermissions, states, "resource", { someRequest: "value" });

  // Assert
  assertValidationSuccess(result);
});
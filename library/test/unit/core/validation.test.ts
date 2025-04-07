/**
 * Tests for validation functionality
 */
import { validate } from "../../../core/permission.ts";
import { hierarchy } from "../../../core/hierarchy.ts";
import { permission } from "../../../core/permission.ts";
import { assertEquals } from "jsr:@std/assert";
import {
  assertValidationFailure,
  assertValidationSuccess,
} from "../../helpers/test_utils.ts";
import {
  VALIDATION_RESULT,
  ValidationResultType,
} from "../../../types/common.ts";

// Mock schema that always validates successfully
const validSchema = {
  name: "validSchema",
  state: (_obj: unknown): _obj is unknown => true,
  request: (_obj: unknown): _obj is unknown => true,
};

// Mock schema that fails state validation
const invalidStateSchema = {
  name: "invalidStateSchema",
  state: (_obj: unknown): _obj is unknown => false,
  request: (_obj: unknown): _obj is unknown => true,
};

// Mock schema that fails request validation
const invalidRequestSchema = {
  name: "invalidRequestSchema",
  state: (_obj: unknown): _obj is unknown => true,
  request: (_obj: unknown): _obj is unknown => false,
};

// Mock schema that throws an error during validation
const errorSchema = {
  name: "errorSchema",
  state: (_obj: unknown): _obj is unknown => {
    throw new Error("Schema state error");
  },
  request: (_obj: unknown): _obj is unknown => true,
};

// Mock rules
const allowRule = {
  name: "allowRule",
  schemas: [validSchema],
  check: () => VALIDATION_RESULT.GRANTED,
};

const denyRule = {
  name: "denyRule",
  schemas: [validSchema],
  check: () => VALIDATION_RESULT.REJECTED,
};

const neutralRule = {
  name: "neutralRule",
  schemas: [validSchema],
  check: () => VALIDATION_RESULT.NEUTRAL,
};

const blockedRule = {
  name: "blockedRule",
  schemas: [validSchema],
  check: () => VALIDATION_RESULT.BLOCKED,
};

const errorRule = {
  name: "errorRule",
  schemas: [validSchema],
  check: () => {
    throw new Error("Rule check error");
  },
};

Deno.test("validate - should validate successfully with valid schemas and rules", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      rules: [allowRule],
    }),
  });

  const states = [
    {
      "resource": { someState: "value" },
    },
  ];

  // Act
  const result = validate(testPermissions, states as any, "resource", {
    someRequest: "value",
  } as never);

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
      "resource": { someState: "value" },
    },
  ];

  // Act
  const result = validate(testPermissions, states as any, "resource", {
    someRequest: "value",
  } as never);

  // Assert
  assertValidationFailure(result, ["schema"], ["invalidStateSchema"]);
  assertEquals(
    result.reasons[0].message,
    "Invalid state for schema invalidStateSchema",
  );
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
      "resource": { someState: "value" },
    },
  ];

  // Act
  const result = validate(testPermissions, states as any, "resource", {
    someRequest: "value",
  } as never);

  // Assert
  assertValidationFailure(result, ["schema"], ["invalidRequestSchema"]);
  assertEquals(
    result.reasons[0].message,
    "Invalid request for schema invalidRequestSchema",
  );
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
      "resource": { someState: "value" },
    },
  ];

  // Act
  const result = validate(testPermissions, states as any, "resource", {
    someRequest: "value",
  } as never);

  // Assert
  assertValidationFailure(result, ["schema"], ["errorSchema"]);
  assertEquals(result.reasons[0].message, "Schema state error");
});

Deno.test("validate - should fail when a rule returns rejected", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [validSchema],
      rules: [denyRule],
    }),
  });

  const states = [
    {
      "resource": { someState: "value" },
    },
  ];

  // Act
  const result = validate(testPermissions, states as any, "resource", {
    someRequest: "value",
  } as never);

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
      "resource": { someState: "value" },
    },
  ];

  // Act
  const result = validate(testPermissions, states as any, "resource", {
    someRequest: "value",
  } as never);

  // Assert
  assertValidationFailure(result, ["rule"], ["errorRule"]);
  assertEquals(result.reasons[0].message, "Rule check error");
});

Deno.test("validate - should return invalid with only neutral rules", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [validSchema],
      rules: [neutralRule],
    }),
  });

  const states = [
    {
      "resource": { someState: "value" },
    },
  ];

  // Act
  const result = validate(testPermissions, states as any, "resource", {
    someRequest: "value",
  } as never);

  // Assert
  assertEquals(result.valid, false); // The default is false when no explicit allow
  assertEquals(result.reasons.length, 0);
});

Deno.test("validate - should fail when a rule returns blocked", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [validSchema],
      rules: [blockedRule],
    }),
  });

  const states = [
    {
      "resource": { someState: "value" },
    },
  ];

  // Act
  const result = validate(testPermissions, states as any, "resource", {
    someRequest: "value",
  } as never);

  // Assert
  assertValidationFailure(result, ["rule"], ["blockedRule"]);
  assertEquals(result.reasons[0].message, "Access blocked: blockedRule");
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
        }),
      },
    }),
  });

  const states = [
    {
      "resource": { parentState: "value" },
      "resource.read": { childState: "value" },
    },
  ];

  // Act
  const result = validate(testPermissions, states as any, "resource.read", {
    someRequest: "value",
  } as never);

  // Assert
  assertValidationSuccess(result);
});

Deno.test("validate - should handle permission hierarchies (parent-child) with deny rule", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      // Parent with denyRule
      rules: [denyRule],
      children: {
        read: permission({
          // Child with allowRule
          rules: [allowRule],
        }),
      },
    }),
  });

  const states = [
    {
      "resource": { someState: "value" },
      "resource.read": { childState: "value" },
    },
  ];

  // Act
  const result = validate(testPermissions, states as any, "resource.read", {
    someRequest: "value",
  } as never);

  // Assert
  assertValidationSuccess(result);
});

Deno.test("validate - should consider multiple states with OR logic", () => {
  // Arrange
  const testPermissions = hierarchy({
    resource: permission({
      schemas: [validSchema],
      rules: [denyRule], // This state denies
    }),
  });

  const states = [
    {
      "resource": { state: "denying" },
    },
    {
      "resource": { state: "allowing" },
    },
  ];

  // Create a special rule that checks state value
  const stateSpecificRule = {
    name: "stateSpecificRule",
    schemas: [],
    check: (state: any) =>
      state.state === "allowing"
        ? VALIDATION_RESULT.GRANTED
        : VALIDATION_RESULT.REJECTED,
  };

  // Override the rules for the test
  testPermissions.flat.resource.rules = [stateSpecificRule];

  // Act
  const result = validate(testPermissions, states as any, "resource", {
    someRequest: "value",
  } as never);

  // Assert
  assertValidationSuccess(result);
});

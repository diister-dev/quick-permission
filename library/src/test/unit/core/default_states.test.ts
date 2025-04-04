/**
 * Tests for default state generation functionality
 *
 * These tests demonstrate how to use default states to avoid issues
 * with missing permission states in hierarchical validation.
 */
import { hierarchy, permission, validate } from "../../../core/permission.ts";
import { allowOwner } from "../../../rules/allowOwner/allowOwner.ts";
import { allowTarget } from "../../../rules/allowTarget/allowTarget.ts";
import { assertEquals } from "jsr:@std/assert";
import {
  assertValidationFailure,
  assertValidationSuccess,
} from "../../helpers/test_utils.ts";
import { createDefaultStateSet } from "../../../core/hierarchy.ts";

Deno.test("Default States - Using createDefaultStateSet to avoid hierarchy fallback issues", () => {
  // Arrange - Create a permission hierarchy that demonstrates the issue
  const userPermissions = hierarchy({
    user: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        content: permission({
          rules: [allowTarget({ wildcards: true })],
          children: {
            edit: permission({
              // This rule requires owner validation
              rules: [allowOwner()],
            }),
          },
        }),
      },
    }),
  });

  // Scenario 1: Problematic state (missing user.content.edit)
  const problematicStates = [
    {
      "user": { target: ["user:*"] },
      "user.content": { target: ["content:*"] },
      // Notice user.content.edit is missing - this causes validation to fall back to user.content
    },
  ];

  // Scenario 2: Fixed state using createDefaultStateSet
  // Generate complete default states - these are restrictive by default (empty target arrays)
  // No additional permissions needed - we just need the state to exist
  const defaultStates = createDefaultStateSet(userPermissions);

  // Use the default states without adding any permissions
  // This ensures that all states exist but are restrictive
  const completeStates = [
    {
      ...defaultStates,
      // No additional permissions needed - the presence of user.content.edit
      // with empty/restrictive default values is sufficient to trigger
      // proper rule evaluation
    },
  ];

  // CASE 1: Incorrect behavior with missing states
  // -------------------------------------------------

  // Test 1A: This succeeds incorrectly with problematicStates because
  // it falls back to the parent rule allowTarget instead of using allowOwner
  const problematicResult = validate(
    userPermissions,
    problematicStates,
    "user.content.edit",
    {
      from: "user:alice",
      target: "content:doc-123", // This matches the target pattern in user.content
      owner: "user:bob", // Alice is not the owner, but this is ignored because allowOwner isn't used
    },
  );

  // This succeeds incorrectly because it's using the parent rule allowTarget
  // instead of the child rule allowOwner
  assertEquals(
    problematicResult.valid,
    true,
    "This should pass (but incorrectly so) when allowOwner is bypassed due to missing state",
  );

  // CASE 2: Correct behavior with explicit states
  // --------------------------------------------

  // Test 2A: With proper states, the ownership check correctly runs
  const correctOwnerResult = validate(
    userPermissions,
    completeStates,
    "user.content.edit",
    {
      from: "user:alice",
      target: "content:doc-123",
      owner: "user:alice", // Alice is the owner
    },
  );

  // This passes correctly because the owner check is performed and passes
  assertValidationSuccess(correctOwnerResult);

  // Test 2B: With proper states, the ownership check correctly fails for non-owners
  const nonOwnerResult = validate(
    userPermissions,
    completeStates,
    "user.content.edit",
    {
      from: "user:alice",
      target: "content:doc-123",
      owner: "user:bob", // Alice is not the owner
    },
  );

  // This fails correctly because allowOwner rule is used and ownership check fails
  assertValidationFailure(nonOwnerResult);
});

Deno.test("Default States - Schema default states get applied correctly", () => {
  // Arrange - Create a permission hierarchy using all schemas with default states
  const permissionWithAllSchemas = hierarchy({
    resource: permission({
      rules: [allowTarget({ wildcards: true })],
    }),
  });

  // Generate default states
  const defaultStates = createDefaultStateSet(permissionWithAllSchemas);

  // Test - Default state for target schema should have empty target array
  assertEquals(Array.isArray(defaultStates.resource?.target), true);
  assertEquals(defaultStates.resource?.target.length, 0);

  // Override with customized states
  const customStates = {
    ...defaultStates,
    resource: {
      target: ["custom:value"],
    },
  };

  // Test - Custom values should override defaults
  assertEquals(customStates.resource.target.length, 1);
  assertEquals(customStates.resource.target[0], "custom:value");
});

Deno.test("Default States - Permission with custom defaultState", () => {
  // Arrange - Create a permission with custom defaultState
  const customDefaultPermissions = hierarchy({
    custom: permission({
      rules: [allowTarget({ wildcards: true })],
      defaultState: {
        target: ["default:target"],
        customValue: "test",
      },
    }),
  });

  // Generate default states
  const defaultStates = createDefaultStateSet(customDefaultPermissions);

  // Test - Default state should incorporate custom values
  assertEquals(Array.isArray(defaultStates.custom?.target), true);
  assertEquals(defaultStates.custom?.target.length, 1);
  assertEquals(defaultStates.custom?.target[0], "default:target");
  assertEquals((defaultStates.custom as any).customValue, "test");
});

Deno.test("Default States - Automatic application of default states in validate()", () => {
  // Arrange - Create a permission hierarchy that demonstrates the automatic defaults
  const userPermissions = hierarchy({
    user: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        content: permission({
          rules: [allowTarget({ wildcards: true })],
          children: {
            edit: permission({
              // This rule requires owner validation
              rules: [allowTarget({ wildcards: true }), allowOwner()],
            }),
          },
        }),
      },
    }),
  });

  // Create a minimal state without explicit permission states
  const minimalStates = [
    {
      // No states defined - the system will use defaults automatically
    },
  ];

  // We don't need to call createDefaultStateSet() explicitly anymore
  // The validate() function will automatically apply defaults

  // Test 1: With automatic defaults, ownership check correctly runs and passes for owner
  const ownerResult = validate(
    userPermissions,
    minimalStates,
    "user.content.edit",
    {
      from: "user:alice",
      target: "content:doc-123",
      owner: "user:alice", // Alice is the owner
    },
  );

  // This passes correctly because allowOwner check is applied with default states
  assertValidationSuccess(ownerResult);

  // Test 2: With automatic defaults, ownership check fails for non-owners
  const nonOwnerResult = validate(
    userPermissions,
    minimalStates,
    "user.content.edit",
    {
      from: "user:alice",
      target: "content:doc-123",
      owner: "user:bob", // Alice is not the owner
    },
  );

  // This fails correctly because allowOwner rule is used with default states
  assertValidationFailure(nonOwnerResult);

  // Test 3: We can still override defaults with explicit states when needed
  const explicitStates = [
    {
      "user.content.edit": {
        // Override the default empty target list to grant specific permissions
        target: ["content:special-doc"],
      },
    },
  ];

  const specialDocResult = validate(
    userPermissions,
    explicitStates,
    "user.content.edit",
    {
      from: "user:alice",
      target: "content:special-doc",
      owner: "user:bob",
    },
  );

  assertValidationSuccess(specialDocResult);
});

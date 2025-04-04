# GitHub Copilot Instructions for quick-permission

This document provides instructions for contributors using GitHub Copilot with
this project. It helps ensure consistent code style and practices.

## Project Overview

`quick-permission` is a TypeScript library that provides a flexible, type-safe
permission system. It uses a hierarchical structure to define permissions with
rules and schemas that can be composed together.

## Key Concepts

- **Hierarchy**: A tree structure of permissions.
- **Permission**: A node in the hierarchy with associated rules and schemas.
- **Rule**: A function that checks if a permission is granted based on state and
  request.
- **Schema**: A definition of the structure of state and request data.
- **States Array**: Multiple permission state sources that are evaluated with OR
  logic (permission granted if any state allows it).

### Hierarchical Resolution of Missing States

When validating permissions, the system exhibits an important behavior when
states are missing:

- If a specific permission key has no state defined in any state source, the
  system will "fall back" to checking parent permissions in the hierarchy.
- This means that permissions defined at higher levels may apply to child
  permissions if the child has no explicit state.
- This behavior can lead to unexpected results if not properly understood or
  documented.

For example:

```typescript
const hierarchy = {
  "user": {
    // Has allowTarget rule
    "content": {
      // Also has allowTarget rule
      "edit": {
        // Has allowOwner rule
      },
    },
  },
};

// State with missing user.content.edit
const state = {
  "user.content": { target: ["user:*"] },
  // Notice user.content.edit is not defined
};

// This will check user.content.edit first (not found),
// then fall back to user.content which only has allowTarget,
// potentially bypassing the allowOwner check
```

To ensure explicit permissions checks, always define states for all permission
keys that will be validated.

### Default States

The system provides a mechanism to handle missing states through default states:

- Each permission can define a `defaultState` property that provides the minimal
  state structure needed by its rules
- Default states are automatically generated and applied by the `validate`
  function - you don't need to call `createDefaultStateSet` explicitly
- The default states are used when a specific state is not found in any state
  source
- Default states are particularly important for rules like `allowOwner` that
  need minimal context to validate

For example:

```typescript
// A permission with default state
const userPermission = permission({
  rules: [allowOwner()],
  defaultState: {/* minimal state for allowOwner */},
});

// The default state ensures allowOwner can run its validation
// even when no explicit state is provided
```

When using default states:

- They are applied before checking rules but after looking for explicit states
- They can be overridden by explicit states in the state sources
- They should provide the minimal information needed for rule validation
- Each schema can also contribute to default states via its `defaultState`
  method

### Identity and Ownership Rules

- **allowSelf()**: Checks if the entity making the request (`from`) is the same
  as the target entity (`target`). Used for verifying self-referential
  permissions (e.g., a user editing their own profile).
  ```typescript
  // allowSelf() passes when:
  request.from === request.target;
  ```

- **allowOwner()**: Checks if the entity making the request (`from`) is the
  owner of the resource (`owner`). Used for verifying ownership-based
  permissions (e.g., a user editing a document they own).
  ```typescript
  // allowOwner() passes when:
  request.from === request.owner;
  ```

The main difference:

- `allowSelf()` checks identity between requester and target
- `allowOwner()` checks ownership of a resource by the requester

## Multiple Permission States

The system can evaluate permissions against multiple state sources
simultaneously, collected in a states array:

```typescript
// Example of multiple permission states from different sources
const states = [
  {
    // States from direct user grants
    "resource.view": { target: ["resource:A", "resource:B"] },
  },
  {
    // States from user's group membership
    "resource.view": { target: ["resource:C", "resource:D"] },
  },
];
```

Important implementation details:

- Each object in the states array represents a different source of permissions
  (not different users or roles)
- Permission is granted if ANY state source allows the request (OR logic)
- Rules can be designed to check across multiple state objects
- When testing, your states array should reflect this architecture

## Rule Return Values and Logic

Rules can return three possible values with specific meanings:

- `true`: Explicitly grants permission
- `false`: Explicitly denies permission
- `undefined`: No opinion (neutral)

The validation logic works as follows:

- A rule returning `false` immediately denies permission (short-circuit)
- A rule must explicitly return `true` to grant permission
- If all rules return `undefined`, permission is denied by default
- You can combine rules with operators like `and`, `or`, and `not` to create
  complex logic

```typescript
// Return true explicitly to allow
check: ((state, request) => {
  if (conditionMet) return true;
  return undefined; // No opinion
});
```

## Code Style Guidelines

1. **Type Safety**: Always maintain strict TypeScript typing. Avoid using `any`
   unless absolutely necessary.
2. **Documentation**: Add JSDoc comments to exported functions, classes, and
   types.
3. **Error Handling**: Use the `ValidationResult` pattern for returning detailed
   error information.
4. **Testing**: Write comprehensive tests for all new features.

## English Documentation

All code documentation, comments, and error messages should be written in
English for international accessibility.

## Validation Error Structure

When implementing new rules or schemas, follow this error reporting pattern:

```typescript
errors.push({
  type: "rule", // or 'schema'
  name: ruleName,
  permissionKey: permissionKey,
  message: `Clear explanation of the error`,
});
```

## Common Development Tasks

### Adding a New Rule

1. Create a new directory under `src/rules/[ruleName]/`
2. Implement the rule following the `Rule` interface pattern
3. Export the rule in the module's entry point
4. Add tests for the rule

### Adding a New Schema

1. Create a new directory under `src/schemas/[schemaName]/`
2. Define the state and request types
3. Implement validation functions
4. Export the schema in the module's entry point

## Example Implementation

When implementing new features, follow this typical pattern:

```typescript
// Define types
export type MyRuleState = {
  // state properties
};

// Implement the rule
export function myRule(options?: MyRuleOptions): Rule<[Schema1, Schema2]> {
  return {
    name: "myRule",
    schemas: [schema1(), schema2()],
    check: (state, request) => {
      // Implementation
      // Return true/false or undefined
    },
  };
}
```

## Best Practices for Testing Permissions

### Explicit Permission States

When writing tests, always define explicit states for all permission keys that
will be validated:

```typescript
// GOOD: Define all permission states explicitly
const states = [
  {
    "user.view": { target: ["user:*"] },
    "user.edit": { target: [] }, // Even if empty, define it explicitly
    "user.delete": { target: ["user:*"] },
  },
];

// BAD: Missing states might cause validation to use parent rules
const incompleteStates = [
  {
    "user.view": { target: ["user:*"] },
    // Missing user.edit might cause validation to check parent rules
    "user.delete": { target: ["user:*"] },
  },
];
```

### Testing with Default States

When testing permissions that use default states:

```typescript
// You don't need to call createDefaultStateSet explicitly
// as it is handled automatically by the validate function
const states = [
  {
    "user.edit": {/* minimal required state if needed */},
  },
];

// With default states, allowOwner can work without explicit state
// as long as the request includes owner information
const result = validate(permissions, states, "article.edit", {
  from: "user:123",
  owner: "user:123",
});
```

### Multiple States Sources

When writing tests that use multiple permission states:

```typescript
// CORRECT way to structure test states (different permission sources)
const states = [
  {
    // First source of permissions (e.g. direct grants)
    "user.view": { target: ["user:*"] },
  },
  {
    // Second source of permissions (e.g. from roles)
    "user.delete": { target: ["user:*"] },
  },
];

// INCORRECT - don't structure tests like this (misrepresenting states as different roles)
const adminStates = { "user.view": { target: ["user:*"] } };
const regularUserStates = { "user.view": { target: ["user:self"] } };
```

## Error Feedback Improvements

When reporting errors, provide as much context as possible:

1. Which permission failed
2. Which rule or schema caused the failure
3. Clear explanation of why it failed
4. Any relevant state or context information

## Debugging Validation

Use the `printValidationResults` helper function to understand validation
failures:

```typescript
const result = validate(permissions, states, "permission.key", request);
printValidationResults(result);
```

When debugging issues with rules returning `undefined`:

```typescript
// You can create a debugging rule that logs the state and request
const debugRule = rule(
  "debug",
  [],
  (state, request) => {
    console.log("State:", state);
    console.log("Request:", request);
    return undefined; // Neutral, won't affect validation
  },
);

// Add this rule to your permission
const debuggablePermission = permission({
  rules: [yourOriginalRule, debugRule],
});
```

## Performance Considerations

Based on benchmark testing:

- Prefer deeper hierarchies over wide ones: A hierarchy with depth 1000 performs
  better (validation ~1ms) than one with width 1000 (validation ~192μs)
- Multiple state sources scale well, validating against 1000 state sources takes
  ~52μs
- Validation operations scale linearly with the number of checks (10 validations
  = ~13μs, 100 = ~124μs, 1000 = ~1.2ms)
- Most common operations are fast enough for typical applications without
  needing optimization

## Benchmarking

When adding significant changes to core validation or hierarchy handling logic,
consider running the benchmark suite to verify performance impact:

```bash
# Run the standard benchmark suite
deno bench library/src/test/benchmarks/validation_benchmark.ts --no-check

# Run the progressive scaling tests
deno bench library/src/test/benchmarks/scaling_benchmark.ts --no-check
```

## Best Practices from Implementation Experience

1. **Default States Management**:
   - Remember that the `validate` function automatically applies default
     states - explicit calls to `createDefaultStateSet` are not needed
   - When creating new rules, consider contributing default state values through
     schemas to ensure proper operation

2. **Testing Complex Hierarchies**:
   - For large hierarchical structures, test both parent and leaf node
     permissions explicitly
   - Verify that permission inheritance behaves as expected across multiple
     levels

3. **Rule Composition Strategy**:
   - When creating complex rule combinations, prefer functional composition with
     `and`, `or`, and `not` operators
   - For optimal performance, structure rules to perform the most restrictive
     checks first (to take advantage of short-circuiting)

4. **Debugging Permissions**:
   - Use the pattern of console logging rules for complex debugging scenarios
   - Consider implementing a debug mode that provides detailed validation paths
     through the hierarchy

## Improvements and Suggestions

If you change code, you should update this document to reflect the changes. Edit
the `.github/copilot-instructions.md` file to add new instructions or modify
existing ones.

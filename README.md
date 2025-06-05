# Quick Permission

[![JSR Latest](https://img.shields.io/jsr/v/@diister/quick-permission)](https://jsr.io/@diister/quick-permission)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A flexible and type-safe permission system for TypeScript/JavaScript
applications.

## Table of Contents

- [Introduction](#introduction)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Basic Usage](#basic-usage)
- [Advanced Usage](#advanced-usage)
- [API Reference](#api-reference)
- [Performance](#performance)
- [Contributing](#contributing)
- [License](#license)

## Introduction

Quick Permission is a TypeScript library that provides a flexible, hierarchical
permission system with strong type safety. It allows you to define complex
permission rules that can be composed together and validated against multiple
permission sources.

### Key Features

- **Hierarchical Structure**: Organize permissions in an intuitive tree
  structure
- **Strong Type Safety**: Full TypeScript support for permission requests and
  states
- **Rule Composition**: Combine rules with AND, OR, and NOT operators
- **Multiple Permission Sources**: Validate against multiple state sources
  simultaneously
- **Performance Focused**: Optimized for efficient validation in large
  applications

## Installation

```bash
# Install via JSR
npx jsr add @diister/quick-permission
```

## Core Concepts

### Permission Structure

A permission system in Quick Permission consists of three key components:

1. **Hierarchy**: A tree structure of permissions organized in parent-child
   relationships
2. **Rules**: Functions that determine if a permission is granted based on state
   and request
3. **Schemas**: Definitions of the structure and validation of state and request
   data

### Rules and Validation

Rules evaluate permission requests against permission states and can return:

- `true`: Explicitly grants permission
- `false`: Explicitly denies permission (short-circuits validation)
- `undefined`: No opinion (neutral)

The validation logic combines these results to determine if access is granted.

### States Array

The system can check permissions against multiple state sources at once:

```typescript
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

Permission is granted if ANY state source allows the request (OR logic).

## Basic Usage

Here's a simple example implementing file system permissions:

```typescript
import { hierarchy, permission, validate } from "@diister/quick-permission";
import { allowTarget } from "@diister/quick-permission/rules/allowTarget";
import { allowOwner } from "@diister/quick-permission/rules/allowOwner";

// Create a permission hierarchy
const filePermissions = hierarchy({
  files: permission({
    rules: [allowTarget({ wildcards: true })],
    children: {
      read: permission({
        rules: [allowTarget()],
      }),
      write: permission({
        rules: [allowOwner()],
      }),
    },
  }),
});

// Define permission states
const states = [
  {
    "files.read": { target: ["file:public/*", "file:user/123/*"] },
    "files.write": { target: ["file:user/123/*"] },
  },
];

// Check a permission request
const request = {
  from: "user:123",
  target: "file:public/document.txt",
};

const result = validate(filePermissions, states, "files.read", request);
console.log(result.allowed); // true
```

## Advanced Usage

### Built-in Rules

Quick Permission provides several built-in rules that can be composed together:

- `allowSelf()`: Grants permission when the requester and target are the same
- `allowOwner()`: Grants permission when the requester is the resource owner
- `allowTarget()`: Grants permission based on target patterns
- `denySelf()`: Denies permission when requester and target are the same
- `ensureTime()`: Validates time-based permissions

### Creating Custom Schemas and Rules

Quick Permission provides utility functions to easily create custom schemas and
rules:

```typescript
import { rule, schema } from "@diister/quick-permission";

// Define types for your custom schema
type BlogState = {
  authorId: string;
  published: boolean;
};

type BlogRequest = {
  from: string;
  action: "read" | "edit";
};

// Create a custom schema using the schema utility
const blogSchema = () =>
  schema<BlogState, BlogRequest>({
    name: "blog",
    state(obj: unknown): obj is BlogState {
      if (typeof obj !== "object" || !obj) return false;
      const state = obj as BlogState;
      return typeof state.authorId === "string" &&
        typeof state.published === "boolean";
    },
    request(obj: unknown): obj is BlogRequest {
      if (typeof obj !== "object" || !obj) return false;
      const req = obj as BlogRequest;
      return typeof req.from === "string" &&
        (req.action === "read" || req.action === "edit");
    },
    defaultState(): BlogState {
      return { authorId: "", published: false };
    },
  });

// Create a custom rule using the rule utility
const allowBlogAccess = () =>
  rule(
    "allowBlogAccess",
    [blogSchema()],
    (state, request) => {
      // Anyone can read published posts
      if (request.action === "read" && state.published) {
        return "granted";
      }
      // Only author can edit
      if (request.action === "edit" && request.from === state.authorId) {
        return "granted";
      }
      return "neutral";
    },
  );

// Use your custom rule in a permission
const blogPermission = permission({
  rules: [allowBlogAccess()],
});
```

### Rule Composition

You can compose rules using logical operators:

```typescript
import { and, not, or } from "@diister/quick-permission/operators";

const complexPermission = permission({
  rules: [
    and([
      allowTarget(),
      or([
        allowOwner(),
        not(denySelf()),
      ]),
    ]),
  ],
});
```

### Default States

For rules that need state context to function, you can define default states:

```typescript
const articlePermission = permission({
  rules: [allowOwner()],
  defaultState: { owner: null }, // Minimal required state
});

// The validate function automatically applies the default state
// when no explicit state is provided
```

### Hierarchical Resolution

When a specific permission state is missing, the system will check parent
permissions:

```typescript
const hierarchy = {
  "user": {
    "content": {
      "edit": {/* specific rules */},
    },
  },
};

// If "user.content.edit" state is missing, the system will check "user.content"
// This allows for inheritance of permissions from parents to children
```

## API Reference

### Core Functions

- `hierarchy(config)`: Creates a permission hierarchy
- `permission(options)`: Creates a permission node
- `validate(hierarchy, states, permissionKey, request)`: Validates a permission
- `schema(options)`: Creates a custom schema with type safety
- `rule(name, schemas, checkFn)`: Creates a custom rule

### Built-in Rules

```typescript
// Identity and ownership
allowSelf(); // Checks if request.from === request.target
allowOwner(); // Checks if request.from === request.owner
denySelf(); // Inverse of allowSelf()

// Target-based permissions
allowTarget({ wildcards: true }); // Pattern matching for targets

// Time-based permissions
ensureTime(); // Validates time constraints
```

### Logical Operators

```typescript
and([rule1, rule2]); // All rules must return true
or([rule1, rule2]); // At least one rule must return true
not(rule); // Inverts the result of a rule
```

## Performance

Quick Permission is optimized for performance:

- **Hierarchical Structure**: Deeper hierarchies perform better than wide ones
- **Multiple State Sources**: Efficiently scales with many state sources
- **Rule Short-Circuiting**: Validation stops when a rule returns false

Performance tips:

1. Place the most restrictive rules first in your rule array
2. Define explicit states for permissions that will be checked
3. Use default states for common validation patterns

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Follow TypeScript best practices and maintain type safety
2. Add tests for new features or bug fixes
3. Update documentation to reflect changes
4. Run the test suite to verify your changes

```bash
# Run tests
deno test

# Run benchmarks to verify performance impact
deno bench library/test/benchmarks/validation_benchmark.ts --no-check
```

## License

MIT License

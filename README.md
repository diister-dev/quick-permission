# Quick Permission

A flexible and type-safe permission system for TypeScript/JavaScript applications.

## Introduction

Quick Permission is a lightweight library that helps you implement complex permission systems with ease. It provides a hierarchical permission structure with strong TypeScript support, allowing you to define custom permission logic while maintaining type safety.

## Installation

```bash
npx jsr add @diister/quick-permission
```

## Core Concepts

### Permission Structure

A permission system consists of three main components:

1. **Request**: The context of the permission check (what is being requested)
2. **State**: The permission configuration (what is allowed)
3. **Validation Logic**: The rules that determine if a request is allowed given a state

### Request & State Pattern

Each permission defines its own Request and State types:

```typescript
type FileRequest = {
    user: string;
    path: string[];
};

type FileState = {
    paths: string[][];
};
```

The `allowed` function then uses these types to validate permissions:
```typescript
allowed(request: FileRequest, state?: FileState): boolean | Promise<boolean>
```

- **Request**: Contains all the information needed to make a decision (who, what, when, etc.)
- **State**: Defines the permission configuration (rules, scopes, limits, etc.)
- **Return**: Boolean indicating if the request is allowed given the state

## Basic Usage

Let's implement a file system permissions example:

```typescript
import { createPermissionHierarchy, PermissionHierarchy } from "@diister/quick-permission";

// Define types for our permission system
type FileRequest = {
    user: string;
    path: string[];
};

type FileState = {
    paths: string[][];
};

// Utility function to check paths
const isPathAllowed = (requestPath: string[], allowedPaths: string[][]) => {
    const requestString = requestPath.join('/');
    return allowedPaths.some(path => requestString.startsWith(path.join('/')));
};

// Define your permission hierarchy
const filePermissions = {
    read: {
        allowed(request: FileRequest, state?: FileState) {
            if(!state?.paths) return false;
            return isPathAllowed(request.path, state.paths);
        }
    },
    write: {
        allowed(request: FileRequest, state?: FileState) {
            if(!state?.paths) return false;
            return isPathAllowed(request.path, state.paths);
        }
    }
} satisfies PermissionHierarchy;

// Create the permission checker
const permissions = createPermissionHierarchy({ file: { children: filePermissions } });

// Define permission set for a user
const userPermissions = {
    'file.read': { paths: [['home', 'user1'], ['tmp']] },
    'file.write': { paths: [['home', 'user1']] }
};

// Check permissions
permissions.can(
    "file.read", 
    userPermissions, 
    { user: 'user1', path: ['home', 'user1', 'document.txt'] }
); // returns true
```

## Advanced Usage

### Complex State and Request Example

Here's an example of an article management system with more complex permissions:

```typescript
type Article = {
    id: string;
    title: string;
    content: string;
    owner: string;
};

type ArticleRequest = {
    from?: string;
    article?: Article;
};

type ArticleState = {
    scope: string;
};

const articlesPermissions = {
    read: {
        allowed(request: ArticleRequest, state?: ArticleState) {
            if(state?.scope === '*') return true;
            if(request?.from === request?.article?.owner) return true;
            if(request?.article?.id && state?.scope.includes(request.article.id)) return true;
            return false;
        },
        // Optional: validate state structure
        check(state: ArticleState) {
            return typeof state.scope === 'string';
        }
    },
    write: {
        allowed(request: ArticleRequest, state?: ArticleState) {
            if(state?.scope === '*') return true;
            if(request?.from === request?.article?.owner) return true;
            if(request?.article?.id && state?.scope.includes(request.article.id)) return true;
            return false;
        }
    }
} satisfies PermissionHierarchy;
```

### Understanding Request & State

1. **Request Object**
   - Contains the context needed for permission validation
   - Can include user information, resource details, timestamps, etc.
   - Passed when checking permissions with `can()`
   ```typescript
   const request = { 
       from: 'user1',
       article: { id: 'article1', owner: 'user1', title: 'Hello', content: 'World' }
   };
   ```

2. **State Object**
   - Defines the permission configuration
   - Stored in permission sets
   - Can be as simple or complex as needed
   ```typescript
   const permissionSet = {
       'articles.read': { scope: '*' },              // Global read access
       'articles.write': { scope: 'article1,article2' } // Limited write access
   };
   ```

3. **Multiple Permission States**
   - The system can evaluate permissions against multiple state sources simultaneously
   - Permission is granted if ANY state source allows the request (OR logic)
   - This enables permissions to come from different sources (direct grants, role-based, group-based, etc.)
   ```typescript
   // Example: States from different sources for the same permission check
   const states = [
     {
       // Permission states from direct user grants
       'resource.view': { target: ['resource:A', 'resource:B'] }
     },
     {
       // Permission states from user's group membership
       'resource.view': { target: ['resource:C', 'resource:D'] }
     },
     {
       // Permission states from system-wide roles
       'resource.view': { target: ['resource:public.*'] }
     }
   ];
   
   // The permission check will succeed if ANY of these states grants access
   validate(permissionHierarchy, states, 'resource.view', { 
     from: 'user:alice', 
     target: 'resource:B' 
   }); // returns success
   ```

4. **Default Permissions**
   - When state is undefined, the `allowed` function can implement default behavior
   - Useful for implementing "owner always has access" patterns
   ```typescript
   allowed(request: ArticleRequest, state?: ArticleState) {
       // Owner always has access, even without explicit permissions
       if(request?.from === request?.article?.owner) return true;
       // Otherwise, require state
       if(!state) return false;
       // ... rest of permission logic
   }
   ```

### Hierarchical Permissions

Permission sets can define permissions at different levels:

```typescript
const permissionSet = {
    // Root level permission
    'articles': { scope: '*' },
    // Specific permission
    'articles.read': { scope: 'article1' }
};
```

The validation process:
1. Checks the exact permission first ('articles.read')
2. Falls back to parent permissions if needed ('articles')
3. Uses default permission logic if no permissions match

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
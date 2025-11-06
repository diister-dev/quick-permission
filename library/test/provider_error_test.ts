import {
  createPermissionSystem,
  permission,
  type PermissionSchemas,
  type Subject,
  type PermissionProvider,
} from "../mod.ts";

// Define the schema for testing
const testSchemas = {
  "article.read": permission(),
} satisfies PermissionSchemas;

// Create test subject
const alice: Subject = { id: "alice" };

// Helper for assertions
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

Deno.test("onProviderError - should be called when provider throws error", async () => {
  let errorCalled = false;
  let capturedError: unknown;
  let capturedIndex: number | undefined;

  // Create a provider that throws an error
  const failingProvider: PermissionProvider = {
    provide: () => {
      throw new Error("Provider error!");
    }
  };

  // Create a working provider
  const workingProvider: PermissionProvider = {
    provide: () => [
      { subject: alice, key: "article.read" }
    ]
  };

  const permSystem = createPermissionSystem({
    schemas: testSchemas,
    sources: [failingProvider, workingProvider],
    rules: [],
    onProviderError: (error, index) => {
      errorCalled = true;
      capturedError = error;
      capturedIndex = index;
    }
  });

  const result = await permSystem.can(alice, "article.read");

  // Error handler should have been called
  assert(errorCalled, "onProviderError should have been called");
  assert(capturedError instanceof Error, "Error should be an Error instance");
  assert((capturedError as Error).message === "Provider error!", "Error message should match");
  assert(capturedIndex === 0, "Provider index should be 0");

  // Permission should still work from the working provider
  assert(result.ok === true, "Permission should be granted from working provider");
});

Deno.test("onProviderError - should continue with other providers when one fails", async () => {
  const errors: Array<{ error: unknown; index: number }> = [];

  // Create providers: failing, working, failing
  const failingProvider1: PermissionProvider = {
    provide: () => {
      throw new Error("Provider 1 error");
    }
  };

  const workingProvider: PermissionProvider = {
    provide: () => [
      { subject: alice, key: "article.read" }
    ]
  };

  const failingProvider2: PermissionProvider = {
    provide: () => {
      throw new Error("Provider 2 error");
    }
  };

  const permSystem = createPermissionSystem({
    schemas: testSchemas,
    sources: [failingProvider1, workingProvider, failingProvider2],
    rules: [],
    onProviderError: (error, index) => {
      errors.push({ error, index });
    }
  });

  const result = await permSystem.can(alice, "article.read");

  // Should have captured 2 errors
  assert(errors.length === 2, `Should have 2 errors, got ${errors.length}`);
  assert(errors[0].index === 0, "First error should be from provider 0");
  assert(errors[1].index === 2, "Second error should be from provider 2");

  // Permission should still work
  assert(result.ok === true, "Permission should be granted from working provider");
});

Deno.test("onProviderError - should work without error handler", async () => {
  // Create a provider that throws an error
  const failingProvider: PermissionProvider = {
    provide: () => {
      throw new Error("Provider error!");
    }
  };

  const permSystem = createPermissionSystem({
    schemas: testSchemas,
    sources: [failingProvider],
    rules: [],
    // No onProviderError callback
  });

  // Should not throw, just return no permissions
  const result = await permSystem.can(alice, "article.read");
  assert(result.ok === false, "Permission should be denied when provider fails");
});

Deno.test("onProviderError - should work with collectPermissions", async () => {
  let errorCalled = false;

  const failingProvider: PermissionProvider = {
    provide: () => {
      throw new Error("Provider error!");
    }
  };

  const permSystem = createPermissionSystem({
    schemas: testSchemas,
    sources: [failingProvider],
    rules: [],
    onProviderError: () => {
      errorCalled = true;
    }
  });

  const permissions = await permSystem.collectPermissions({
    subject: alice,
    key: "article.read"
  });

  assert(errorCalled, "onProviderError should have been called");
  assert(permissions.length === 0, "Should have no permissions when provider fails");
});

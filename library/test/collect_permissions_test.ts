import {
  createPermissionSystem,
  directProvider,
  permission,
  intermediate,
  type PermissionSchemas,
  type Subject,
} from "../mod.ts";

// Define the schema for testing collectPermissions
const testSchemas = {
  "article.read": permission(),
  "article.write": permission(),
  "article.delete": permission(),
  "admin": intermediate((perm) => [
    { key: "article.read", subject: perm.subject },
    { key: "article.write", subject: perm.subject },
    { key: "article.delete", subject: perm.subject },
  ]),
} satisfies PermissionSchemas;

// Create test subjects
const alice: Subject = { id: "alice" };
const bob: Subject = { id: "bob" };
const charlie: Subject = { id: "charlie" };

// Create permission states
const testPermissions = [
  // Alice has direct read and write permissions
  {
    subject: alice,
    key: "article.read",
  },
  {
    subject: alice,
    key: "article.write",
  },
  // Bob has only read permission
  {
    subject: bob,
    key: "article.read",
  },
  // Charlie has admin (intermediate permission that expands to all permissions)
  {
    subject: charlie,
    key: "admin",
  },
];

// Create the permission system
const permSystem = createPermissionSystem({
  schemas: testSchemas,
  sources: [directProvider(testPermissions)],
  rules: [],
});

// Helper for assertions
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

Deno.test("collectPermissions - Alice should have 2 permissions collected", async () => {
  const permissions = await permSystem.collectPermissions({ subject: alice, key: "article.read" });
  assert(permissions.length === 1, `Expected 1 permission, got ${permissions.length}`);
  assert(permissions[0].key === "article.read", "Permission key should be article.read");
});

Deno.test("collectPermissions - Bob should have 1 read permission", async () => {
  const permissions = await permSystem.collectPermissions({ subject: bob, key: "article.read" });
  assert(permissions.length === 1, `Expected 1 permission, got ${permissions.length}`);
  assert(permissions[0].key === "article.read", "Permission key should be article.read");
});

Deno.test("collectPermissions - Bob should have 0 write permissions", async () => {
  const permissions = await permSystem.collectPermissions({ subject: bob, key: "article.write" });
  assert(permissions.length === 0, `Expected 0 permissions, got ${permissions.length}`);
});

Deno.test("collectPermissions - Charlie with admin should see expanded permissions for read", async () => {
  const permissions = await permSystem.collectPermissions({ subject: charlie, key: "article.read" });
  // Charlie has admin, which expands to article.read, article.write, article.delete
  // When filtering by "article.read", we should get 1 permission
  assert(permissions.length === 1, `Expected 1 permission, got ${permissions.length}`);
  assert(permissions[0].key === "article.read", "Permission key should be article.read");
});

Deno.test("collectPermissions - Charlie with admin should see expanded permissions for write", async () => {
  const permissions = await permSystem.collectPermissions({ subject: charlie, key: "article.write" });
  assert(permissions.length === 1, `Expected 1 permission, got ${permissions.length}`);
  assert(permissions[0].key === "article.write", "Permission key should be article.write");
});

Deno.test("collectPermissions - Charlie with admin should see expanded permissions for delete", async () => {
  const permissions = await permSystem.collectPermissions({ subject: charlie, key: "article.delete" });
  assert(permissions.length === 1, `Expected 1 permission, got ${permissions.length}`);
  assert(permissions[0].key === "article.delete", "Permission key should be article.delete");
});

Deno.test("collectPermissions - withContext should work", async () => {
  const permissions = await permSystem.withContext({}).collectPermissions({
    subject: alice,
    key: "article.read",
  });
  assert(permissions.length === 1, `Expected 1 permission, got ${permissions.length}`);
  assert(permissions[0].key === "article.read", "Permission key should be article.read");
});

Deno.test("collectPermissions - context() should work", async () => {
  const checker = permSystem.context({ subject: alice });
  const permissions = await checker.collectPermissions({ key: "article.read" });
  assert(permissions.length === 1, `Expected 1 permission, got ${permissions.length}`);
  assert(permissions[0].key === "article.read", "Permission key should be article.read");
});

// Test with target parameter
const targetSchemas = {
  "article.read": permission(),
} satisfies PermissionSchemas;

const targetPermissions = [
  {
    subject: alice,
    key: "article.read",
    target: "article:1",
  },
  {
    subject: alice,
    key: "article.read",
    target: "article:2",
  },
];

const targetPermSystem = createPermissionSystem({
  schemas: targetSchemas,
  sources: [directProvider(targetPermissions)],
  rules: [],
});

Deno.test("collectPermissions - should collect all permissions with targets", async () => {
  const permissions = await targetPermSystem.collectPermissions({ subject: alice, key: "article.read" });
  // collectPermissions returns all permissions for the key
  assert(permissions.length === 2, `Expected 2 permissions, got ${permissions.length}`);
  assert(permissions[0].target === "article:1", "First permission target should be article:1");
  assert(permissions[1].target === "article:2", "Second permission target should be article:2");
});

// Test includeAllKeys option
Deno.test("collectPermissions - includeAllKeys should return all permissions", async () => {
  const allPermissions = await permSystem.collectPermissions(
    { subject: alice, key: "article.read" },
    { includeAllKeys: true }
  );
  // Alice has article.read and article.write
  assert(allPermissions.length === 2, `Expected 2 permissions, got ${allPermissions.length}`);
  const keys = allPermissions.map(p => p.key).sort();
  assert(keys.includes("article.read"), "Should include article.read");
  assert(keys.includes("article.write"), "Should include article.write");
});

Deno.test("collectPermissions - includeAllKeys with Charlie's admin permission", async () => {
  const allPermissions = await permSystem.collectPermissions(
    { subject: charlie, key: "article.read" },
    { includeAllKeys: true }
  );
  // Charlie has admin which expands to article.read, article.write, article.delete + the admin permission itself
  assert(allPermissions.length >= 3, `Expected at least 3 permissions, got ${allPermissions.length}`);
  const keys = allPermissions.map(p => p.key).sort();
  assert(keys.includes("article.read"), "Should include article.read");
  assert(keys.includes("article.write"), "Should include article.write");
  assert(keys.includes("article.delete"), "Should include article.delete");
});

Deno.test("collectPermissions - includeAllKeys with withContext", async () => {
  const allPermissions = await permSystem.withContext({}).collectPermissions(
    { subject: alice, key: "article.read" },
    { includeAllKeys: true }
  );
  assert(allPermissions.length === 2, `Expected 2 permissions, got ${allPermissions.length}`);
});

Deno.test("collectPermissions - includeAllKeys with context()", async () => {
  const checker = permSystem.context({ subject: alice });
  const allPermissions = await checker.collectPermissions(
    { key: "article.read" },
    { includeAllKeys: true }
  );
  assert(allPermissions.length === 2, `Expected 2 permissions, got ${allPermissions.length}`);
});

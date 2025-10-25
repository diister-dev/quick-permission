import {
  createPermissionSystem,
  directProvider,
  permission,
  type PermissionSchemas,
  type Subject,
} from "../mod.ts";

// Define the schema for article permissions
const articleSchemas = {
  "article.read": permission(),
  "article.write": permission(),
  "article.delete": permission(),
} satisfies PermissionSchemas;

// Create test subjects
const alice: Subject = { id: "alice" };
const bob: Subject = { id: "bob" };

// Create permission states
const articlePermissions = [
  {
    subject: alice,
    key: "article.read",
  },
  {
    subject: alice,
    key: "article.write",
  },
  {
    subject: bob,
    key: "article.read",
  },
];

// Create the permission system
const permSystem = createPermissionSystem({
  schemas: articleSchemas,
  sources: [directProvider(articlePermissions)],
  rules: [],
});

// Helper for assertions
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

Deno.test("article.read - Alice should have read permission", async () => {
  const result = await permSystem.can(alice, "article.read");
  assert(result.ok === true, "Alice should have read permission");
});

Deno.test("article.write - Alice should have write permission", async () => {
  const result = await permSystem.can(alice, "article.write");
  assert(result.ok === true, "Alice should have write permission");
});

Deno.test("article.delete - Alice should NOT have delete permission", async () => {
  const result = await permSystem.can(alice, "article.delete");
  assert(result.ok === false, "Alice should NOT have delete permission");
});

Deno.test("article.write - Bob should NOT have write permission", async () => {
  const result = await permSystem.can(bob, "article.write");
  assert(result.ok === false, "Bob should NOT have write permission");
});

Deno.test("article.read - Bob should have read permission", async () => {
  const result = await permSystem.can(bob, "article.read");
  assert(result.ok === true, "Bob should have read permission");
});

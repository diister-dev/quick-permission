/**
 * Test AsyncContext with shared resource cache
 */

import {
  createPermissionSystem,
  permission,
  FilterRule,
  ownerProvider,
} from "../library_2/mod.ts";
import type { Subject } from "../library_2/mod.ts";

// ============================================================================
// Data Models
// ============================================================================

type ArticleId = string;

type Article = {
  _id: string;
  title: string;
  body: string;
  owner: string;
};

const articles: Article[] = [
  { _id: "article:1", title: "Hello World", body: "Content 1", owner: "user:1" },
  { _id: "article:2", title: "Article Two", body: "Content 2", owner: "user:2" },
];

// ============================================================================
// Resource Fetcher with Logging
// ============================================================================

let fetchCount = 0;

function getArticle(id: ArticleId): Promise<Article | undefined> {
  fetchCount++;
  console.log(`  [FETCH #${fetchCount}] article:${id}`);
  return Promise.resolve(articles.find(a => a._id === id));
}

// ============================================================================
// Permission System
// ============================================================================

const permissionsSchemas = {
  "article.read": permission(getArticle, [FilterRule()] as const),
  "article.update": permission(getArticle, [FilterRule()] as const),
  "article.delete": permission(getArticle),
};

const permSystem = createPermissionSystem({
  schemas: permissionsSchemas,
  sources: [
    ownerProvider(
      ["article.read", "article.update", "article.delete"],
      "article:*",
      { filter: { _id: true, title: true, body: true, owner: true } }
    ),
  ],
});

const user1: Subject = { id: "user:1" };

// ============================================================================
// Tests
// ============================================================================

console.log("\n=== Test 1: Without run() - Multiple Fetches ===\n");
fetchCount = 0;

await permSystem.can(user1, "article.read", "article:1");
await permSystem.can(user1, "article.update", "article:1");
await permSystem.can(user1, "article.delete", "article:1");

console.log(`Total fetches: ${fetchCount} (expected: 3 - no cache sharing)\n`);

console.log("=== Test 2: With context() - Shared Cache ===\n");
fetchCount = 0;

const checker1 = permSystem.context({ subject: user1 });
await checker1.can("article.read", "article:1");
await checker1.can("article.update", "article:1");
await checker1.can("article.delete", "article:1");

console.log(`Total fetches: ${fetchCount} (expected: 1 - cache shared!)\n`);

console.log("=== Test 3: Nested Function Calls with Shared Checker ===\n");
fetchCount = 0;

const checker2 = permSystem.context({ subject: user1 });

async function checkArticlePermissions(checker: typeof checker2, articleId: string) {
  console.log("  Checking read permission...");
  const canRead = await checker.can("article.read", articleId);

  console.log("  Checking update permission...");
  const canUpdate = await checker.can("article.update", articleId);

  return { canRead: canRead.ok, canUpdate: canUpdate.ok };
}

const perms = await checkArticlePermissions(checker2, "article:1");
console.log("  Permissions:", perms);

console.log(`Total fetches: ${fetchCount} (expected: 1 - cache works in nested calls!)\n`);

console.log("=== Test 4: Multiple Articles with Same Checker ===\n");
fetchCount = 0;

const checker3 = permSystem.context({ subject: user1 });
await checker3.can("article.read", "article:1");
await checker3.can("article.read", "article:2");
await checker3.can("article.update", "article:1");  // Cache hit for article:1
await checker3.can("article.update", "article:2");  // Cache hit for article:2

console.log(`Total fetches: ${fetchCount} (expected: 2 - one per article)\n`);

console.log("=== Test 5: context() with Custom Context ===\n");
fetchCount = 0;

const checker4 = permSystem.context({
  subject: user1,
  checkDate: new Date("2024-01-01"),
});

const r1 = await checker4.can("article.read", "article:1");
const r2 = await checker4.can("article.update", "article:1");

console.log("  Read OK:", r1.ok);
console.log("  Update OK:", r2.ok);
console.log("  Data:", r1.output?.data);

console.log(`Total fetches: ${fetchCount} (expected: 1)\n`);

console.log("✅ All tests complete!\n");

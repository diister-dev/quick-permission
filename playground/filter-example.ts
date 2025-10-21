/**
 * Example demonstrating field-level permissions with filter accumulation
 */

import {
  createPermissionSystem,
  permission,
  ownerProvider,
  FilterRule,
  WithRule,
} from "../library_2/mod.ts";
import type { Subject, PermissionProvider } from "../library_2/mod.ts";

// ============================================================================
// Data Models
// ============================================================================

type ArticleId = string;

type Article = {
  _id: string;
  title: string;
  body: string;
  owner: string;
  salary?: number;
  secret?: string;
  public?: boolean;
  views?: number;
};

const articles: Article[] = [
  {
    _id: "article:1",
    title: "Hello World",
    body: "This is a public article",
    owner: "user:1",
    salary: 50000,
    secret: "admin-only-secret",
    public: true,
    views: 100,
  },
  {
    _id: "article:2",
    title: "Private Article",
    body: "This is private",
    owner: "user:2",
    salary: 75000,
    secret: "super-secret",
    public: false,
    views: 10,
  },
];

// ============================================================================
// Resource Fetcher
// ============================================================================

function getArticle(id: ArticleId): Promise<Article | undefined> {
  console.log(`  [Fetching article: ${id}]`);
  return Promise.resolve(articles.find(a => a._id === id));
}

// ============================================================================
// Permission Schemas with FilterRule
// ============================================================================

const permissionsSchemas = {
  "article.read": permission(getArticle, [FilterRule()] as const),
};

// ============================================================================
// Custom Providers
// ============================================================================

function publicArticleProvider(): PermissionProvider {
  return {
    provide: (subject, _key, _target) => {
      return Promise.resolve([
        {
          key: "article.read",
          subject,
          target: "*",
          with: { public: true },
          filter: { _id: true, title: true, body: true },  // Public fields only
        },
      ]);
    }
  };
}

function contributorProvider(): PermissionProvider {
  return {
    provide: (subject, _key, _target) => {
      // Contributors can see view stats on public articles only
      return Promise.resolve([
        {
          key: "article.read",
          subject,
          target: "*",
          with: { public: true },  // Only on public articles
          filter: { views: true },  // Can see views
        },
      ]);
    }
  };
}

function adminProvider(adminId: string): PermissionProvider {
  return {
    provide: (subject, _key, _target) => {
      if (subject.id !== adminId) return Promise.resolve([]);

      return Promise.resolve([
        {
          key: "article.read",
          subject,
          target: "*",
          filter: { secret: true, salary: true },  // Admin sees everything
        },
      ]);
    }
  };
}

// ============================================================================
// Users
// ============================================================================

const publicUser: Subject = { id: "user:public" };
const user1: Subject = { id: "user:1" };  // Owner of article:1, contributor
const user2: Subject = { id: "user:2" };  // Owner of article:2
const adminUser: Subject = { id: "user:admin" };  // Admin

// ============================================================================
// Permission System Setup
// ============================================================================

const permSystem = createPermissionSystem({
  schemas: permissionsSchemas,
  sources: [
    publicArticleProvider(),
    ownerProvider(["article.read"], "article:*", {
      filter: { _id: true, title: true, body: true, owner: true, salary: true }
    }),
    contributorProvider(),
    adminProvider("user:admin"),
  ],
  rules: [WithRule()] as const,
});

// ============================================================================
// Tests
// ============================================================================

console.log("\n=== Field-Level Permissions with Filter Accumulation ===\n");

// Test 1: Public user reading public article
console.log("--- Test 1: Public user reading article:1 (public) ---");
const test1 = await permSystem.can(publicUser, "article.read", "article:1");
console.log("OK:", test1.ok);
console.log("Data:", test1.output?.data);
console.log("Filter:", test1.output?.filter);
console.log();

// Test 2: Owner reading their own article (accumulates owner + public + contributor)
console.log("--- Test 2: user:1 (owner + contributor) reading article:1 ---");
const test2 = await permSystem.can(user1, "article.read", "article:1");
console.log("OK:", test2.ok);
console.log("Data:", test2.output?.data);
console.log("Filter:", test2.output?.filter);
console.log("Expected: _id, title, body, owner, salary, views (accumulated from owner + contributor)");
console.log();

// Test 3: Admin reading any article (gets EVERYTHING)
console.log("--- Test 3: Admin reading article:1 ---");
const test3 = await permSystem.can(adminUser, "article.read", "article:1");
console.log("OK:", test3.ok);
console.log("Data:", test3.output?.data);
console.log("Filter:", test3.output?.filter);
console.log("Expected: ALL fields including secret and salary");
console.log();

// Test 4: user:2 reading article:1 (public + contributor, not owner)
console.log("--- Test 4: user:2 reading article:1 (not owner, but public + contributor) ---");
const test4 = await permSystem.can(user2, "article.read", "article:1");
console.log("OK:", test4.ok);
console.log("Data:", test4.output?.data);
console.log("Filter:", test4.output?.filter);
console.log("Expected: _id, title, body, views (public + contributor, no owner fields)");
console.log();

// Test 5: Public user trying to read private article (should fail)
console.log("--- Test 5: Public user reading article:2 (private) ---");
const test5 = await permSystem.can(publicUser, "article.read", "article:2");
console.log("OK:", test5.ok);
console.log("Expected: false (not public)");
console.log();

// Test 6: owner:2 reading their private article
console.log("--- Test 6: user:2 (owner) reading article:2 (private) ---");
const test6 = await permSystem.can(user2, "article.read", "article:2");
console.log("OK:", test6.ok);
console.log("Data:", test6.output?.data);
console.log("Filter:", test6.output?.filter);
console.log("Expected: _id, title, body, owner, salary, views (owner + contributor)");
console.log();

console.log("=== All Tests Complete ===\n");

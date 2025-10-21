/**
 * Working example of the permission system
 * Based on toy8.ts but with complete implementation
 */

import { createPermissionSystem, permission, intermediate, directProvider, ownerProvider, TimeRule, IpRule, WithRule } from "../library_2/mod.ts";
import type { Subject, PermissionProvider } from "../library_2/mod.ts";

// ============================================================================
// Data Models
// ============================================================================

type ArticleId = string;

type Article = {
  id: string;
  owner: string;
  public?: boolean;
}

type Comment = {
  id: string;
  articleId: string;
  owner: string;
}

const articles: Article[] = [
  { id: "article:1", owner: "user:1" },
  { id: "article:2", owner: "user:2", public: true },
  { id: "article:3", owner: "user:3" },
];

const articlesComments: Comment[] = [
  { id: "comment:1", articleId: "article:1", owner: "user:2" },
  { id: "comment:2", articleId: "article:1", owner: "user:3" },
  { id: "comment:3", articleId: "article:2", owner: "user:1" },
];

// ============================================================================
// Resource Fetchers
// ============================================================================

async function getArticle(id: ArticleId): Promise<Article | undefined> {
  return articles.find(a => a.id === id);
}

async function getArticleComment(ids: [ArticleId, string]): Promise<Comment | undefined> {
  const [articleId, commentId] = ids;
  return articlesComments.find(c => c.id === commentId && c.articleId === articleId);
}

// ============================================================================
// Permission Schemas
// ============================================================================

const permissionsSchemas = {
  "article.create": permission(),
  "article.read": permission<ArticleId>(getArticle),
  "article.update": permission<ArticleId>(getArticle),
  "article.delete": permission<ArticleId>(getArticle),
  "article.manage": intermediate<ArticleId>((ctx) => {
    return [
      { subject: ctx.subject, key: "article.read", target: ctx.target },
      { subject: ctx.subject, key: "article.update", target: ctx.target },
      { subject: ctx.subject, key: "article.delete", target: ctx.target },
      { subject: ctx.subject, key: "article.comment.manage", target: [ctx.target, "*"] }
    ];
  }, getArticle),
  "article.comment.create": permission<[ArticleId, string]>(getArticleComment),
  "article.comment.delete": permission<[ArticleId, string]>(getArticleComment),
  "article.comment.manage": intermediate<[ArticleId, string]>((ctx) => {
    return [
      { subject: ctx.subject, key: "article.comment.create", target: ctx.target },
      { subject: ctx.subject, key: "article.comment.delete", target: ctx.target },
    ];
  }, getArticleComment),
};

// ============================================================================
// Custom Providers
// ============================================================================

function publicArticleProvider(): PermissionProvider {
  return {
    provide: async (subject, _key, _target) => {
      return [
        { key: "article.read", subject, target: "*", with: { public: true } },
        { key: "article.comment.create", subject, target: "*", with: { public: true } },
      ];
    }
  };
}

// ============================================================================
// Permission System Setup
// ============================================================================

const user1: Subject = {
  id: "user:1",
};

const user2: Subject = {
  id: "user:2",
};

const permSource0 = [
  {
    subject: user1,
    key: "article.create",
  },
  {
    subject: user1,
    key: "article.manage",
    target: "article:1",
  }
];

const permSystem = createPermissionSystem({
  schemas: permissionsSchemas,
  sources: [
    directProvider(permSource0),
    ownerProvider(["article.read", "article.update"], "article:*"),
    ownerProvider(["article.comment.delete"], ["article:*", "comment:*"]),
    publicArticleProvider(),
  ],
  rules: [
    TimeRule(),
    IpRule(),
    WithRule(),
  ] as const,
});

// ============================================================================
// Examples
// ============================================================================

console.log("\n=== Permission System Tests ===\n");

// Test 1: user1 can create articles (direct permission)
const test1 = await permSystem.can(user1, "article.create");
console.log("✓ user1 can create article:", test1.ok); // Should be true

// Test 2: user1 can manage article:1 (direct permission)
const test2 = await permSystem.can(user1, "article.manage", "article:1");
console.log("✓ user1 can manage article:1:", test2.ok); // Should be true

// Test 3: user1 can read article:1 (via intermediate "article.manage")
const test3 = await permSystem.can(user1, "article.read", "article:1");
console.log("✓ user1 can read article:1 (via manage):", test3.ok); // Should be true

// Test 4: user1 can update article:1 (via intermediate + owner)
const test4 = await permSystem.can(user1, "article.update", "article:1");
console.log("✓ user1 can update article:1 (via manage + owner):", test4.ok); // Should be true

// Test 5: user1 CANNOT manage article:2 (not owner, not granted)
const test5 = await permSystem.can(user1, "article.manage", "article:2");
console.log("✓ user1 CANNOT manage article:2:", !test5.ok); // Should be false

// Test 6: user2 can read article:2 (public article)
const test6 = await permSystem.can(user2, "article.read", "article:2");
console.log("✓ user2 can read article:2 (public):", test6.ok); // Should be true

// Test 7: user2 can read article:1 (not public, not owner)
const test7 = await permSystem.can(user2, "article.read", "article:1");
console.log("✓ user2 CANNOT read article:1 (not public):", !test7.ok); // Should be false

// Test 8: user1 can delete comment:1 on article:1 (via article.manage)
const test8 = await permSystem.can(user1, "article.comment.delete", ["article:1", "comment:1"]);
console.log("✓ user1 can delete comment on article:1:", test8.ok); // Should be true

// Test 9: user2 can delete their own comment (owner)
const test9 = await permSystem.can(user2, "article.comment.delete", ["article:1", "comment:1"]);
console.log("✓ user2 can delete own comment:", test9.ok); // Should be true

// Test 10: With custom context (time-based)
const checkerPast = permSystem.withContext({
  checkDate: new Date("2020-01-01"),
});

const test10 = await checkerPast.can(user1, "article.create");
console.log("✓ user1 can create article in 2020:", test10.ok); // Should be true (no time restrictions)

console.log("\n=== All Tests Complete ===\n");

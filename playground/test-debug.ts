/**
 * Debug test to verify permission system works correctly
 */

import { createPermissionSystem, permission, directProvider, ownerProvider, WithRule } from "../library_2/mod.ts";
import type { Subject } from "../library_2/mod.ts";

type ArticleId = string;

type Article = {
  id: string;
  owner: string;
  public?: boolean;
}

const articles: Article[] = [
  { id: "article:1", owner: "user:1" },
  { id: "article:2", owner: "user:2", public: true },
  { id: "article:3", owner: "user:3" },
];

async function getArticle(id: ArticleId): Promise<Article | undefined> {
  console.log(`  [fetchTarget] Getting article: ${id}`);
  return articles.find(a => a.id === id);
}

const permissionsSchemas = {
  "article.read": permission<ArticleId>(getArticle),
};

const user1: Subject = { id: "user:1" };
const user2: Subject = { id: "user:2" };

const permSystem = createPermissionSystem({
  schemas: permissionsSchemas,
  sources: [
    ownerProvider(["article.read"], "article:*"),
  ],
  rules: [WithRule()] as const,
});

console.log("\n=== Test 1: user1 reading article:1 (owner) ===");
const test1 = await permSystem.can(user1, "article.read", "article:1");
console.log("Result:", test1.ok, "(should be TRUE - user1 owns article:1)\n");

console.log("=== Test 2: user2 reading article:1 (not owner) ===");
const test2 = await permSystem.can(user2, "article.read", "article:1");
console.log("Result:", test2.ok, "(should be FALSE - user2 doesn't own article:1)\n");

console.log("=== Test 3: user2 reading article:2 (owner) ===");
const test3 = await permSystem.can(user2, "article.read", "article:2");
console.log("Result:", test3.ok, "(should be TRUE - user2 owns article:2)\n");

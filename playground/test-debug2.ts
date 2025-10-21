/**
 * More detailed debug to understand what's happening
 */

import { createPermissionSystem, permission, directProvider, ownerProvider, WithRule } from "../library_2/mod.ts";
import type { Subject, PermissionProvider } from "../library_2/mod.ts";

type ArticleId = string;

type Article = {
  id: string;
  owner: string;
  public?: boolean;
}

const articles: Article[] = [
  { id: "article:1", owner: "user:1" },
  { id: "article:2", owner: "user:2", public: true },
];

async function getArticle(id: ArticleId): Promise<Article | undefined> {
  return articles.find(a => a.id === id);
}

const permissionsSchemas = {
  "article.read": permission<ArticleId>(getArticle),
};

const user2: Subject = { id: "user:2" };

function publicArticleProvider(): PermissionProvider {
  return {
    provide: async (subject, _key, _target) => {
      console.log(`  [publicProvider] Called for subject ${subject.id}`);
      return [
        { key: "article.read", subject, target: "*", with: { public: true } },
      ];
    }
  };
}

const permSystem = createPermissionSystem({
  schemas: permissionsSchemas,
  sources: [
    publicArticleProvider(),
  ],
  rules: [WithRule()] as const,
});

console.log("\n=== Test: user2 reading article:2 (public) ===");
const test1 = await permSystem.can(user2, "article.read", "article:2");
console.log("Result:", test1.ok, "(should be TRUE - article:2 is public)\n");

console.log("=== Test: user2 reading article:1 (not public) ===");
const test2 = await permSystem.can(user2, "article.read", "article:1");
console.log("Result:", test2.ok, "(should be FALSE - article:1 is not public)\n");

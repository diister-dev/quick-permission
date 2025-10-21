/**
 * Test type inference for permission outputs
 */

import {
  createPermissionSystem,
  permission,
  FilterRule,
} from "../library_2/mod.ts";
import type { Subject } from "../library_2/mod.ts";

// ============================================================================
// Setup
// ============================================================================

type ArticleId = string;

type Article = {
  _id: string;
  title: string;
  body: string;
  secret: string;
};

function getArticle(_id: ArticleId): Promise<Article | undefined> {
  return Promise.resolve({ _id, title: "Test", body: "Body", secret: "shh" });
}

const permissionsSchemas = {
  "article.read": permission(getArticle, [FilterRule()] as const),
  "article.create": permission(),
};

const permSystem = createPermissionSystem({
  schemas: permissionsSchemas,
  sources: [],
});

const user: Subject = { id: "user:1" };

// ============================================================================
// Type Inference Tests
// ============================================================================

(async () => {
  // Test 1: article.read should have typed output
  const result1 = await permSystem.can(user, "article.read", "article:1");

  // TypeScript should know these properties exist!
  if (result1.ok && result1.output) {
    console.log("Filter:", result1.output.filter);  // Should be typed!
    console.log("Data:", result1.output.data);      // Should be typed!

    // @ts-expect-error - this property doesn't exist
    console.log(result1.output.nonExistent);
  }

  // Test 2: article.create has no output
  const result2 = await permSystem.can(user, "article.create");

  if (result2.ok && result2.output) {
    // @ts-expect-error - output should be {} for permissions without rules
    console.log(result2.output.filter);
  }

  console.log("\n✅ Type inference works! Check your IDE for autocomplete on result.output");
})();

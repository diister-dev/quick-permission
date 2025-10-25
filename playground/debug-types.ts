import { permission, FilterRule } from "../library_2/mod.ts";
import type { ExtractPermissionOutput } from "../library_2/mod.ts";

type ArticleId = string;
function getArticle(id: ArticleId): Promise<any> {
  return Promise.resolve(undefined);
}

// Define the schemas exactly like in filter-example
const permissionsSchemas = {
  "article.read": permission(getArticle, [FilterRule()] as const),
  "article.create": permission(),
};

// Extract types
type ArticleReadPerm = typeof permissionsSchemas["article.read"];
type ArticleCreatePerm = typeof permissionsSchemas["article.create"];

type ArticleReadOutput = ExtractPermissionOutput<ArticleReadPerm>;
type ArticleCreateOutput = ExtractPermissionOutput<ArticleCreatePerm>;

// Test: these should show what types are being inferred
const _testRead: ArticleReadOutput = {} as any;
const _testCreate: ArticleCreateOutput = {} as any;

console.log("Types compiled");

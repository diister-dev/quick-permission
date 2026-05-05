import { createSystem } from "../system.ts";
import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";
import { filter } from "../rules.ts";
import type { Provider } from "../system.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

type Article = {
  _id: string;
  title: string;
  body: string;
  owner: string;
  salary: number;
  views: number;
};

type Meta = { description: string };
const { permission } = createPermissionFactory<Meta>();

const articleRead = permission({
  metadata: { description: "Read article" },
  target: target.required("article"),
  fetch: ([id]): Promise<Article> =>
    Promise.resolve({
      _id: id,
      title: "Hello",
      body: "lorem",
      owner: "alice",
      salary: 1000,
      views: 42,
    }),
}).rules([filter((v) => v)]);

Deno.test("filter accumulation — owner+public+contributor unions data fields", async () => {
  const ownerProvider: Provider = () => [{
    key: "article.read",
    target: ["article:1"],
    filter: { _id: true, title: true, owner: true, salary: true },
  }];
  const publicProvider: Provider = () => [{
    key: "article.read",
    target: ["article:1"],
    filter: { _id: true, title: true, body: true },
  }];
  const contribProvider: Provider = () => [{
    key: "article.read",
    target: ["article:1"],
    filter: { views: true },
  }];

  const sys = createSystem<Meta>({
    schema: { "article.read": articleRead },
    providers: [ownerProvider, publicProvider, contribProvider],
  });

  const r = await sys.can({ id: "alice" }, "article.read", ["article:1"]);
  assertEq(r.ok, true);
  if (r.ok) {
    const merged = r.output?.filter ?? {};
    const keys = Object.keys(merged).sort();
    // Union of all granted fields
    assertEq(keys, ["_id", "body", "owner", "salary", "title", "views"]);
  }
});

Deno.test("filter accumulation — single grant exposes only its fields", async () => {
  const provider: Provider = () => [{
    key: "article.read",
    target: ["article:1"],
    filter: { _id: true, title: true },
  }];

  const sys = createSystem<Meta>({
    schema: { "article.read": articleRead },
    providers: [provider],
  });

  const r = await sys.can({ id: "alice" }, "article.read", ["article:1"]);
  assertEq(r.ok, true);
  if (r.ok) {
    assertEq(Object.keys(r.output?.filter ?? {}).sort(), ["_id", "title"]);
  }
});

Deno.test("filter accumulation — grant without filter leaves output undefined", async () => {
  const provider: Provider = () => [{
    key: "article.read",
    target: ["article:1"],
    // no filter
  }];

  const sys = createSystem<Meta>({
    schema: { "article.read": articleRead },
    providers: [provider],
  });

  const r = await sys.can({ id: "alice" }, "article.read", ["article:1"]);
  assertEq(r.ok, true);
  if (r.ok) {
    // No filter accumulator — output.filter is undefined or empty
    const filterKeys = Object.keys(r.output?.filter ?? {});
    assertEq(filterKeys.length, 0);
  }
});

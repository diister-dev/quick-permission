import { directProvider, ownerProvider } from "../providers.ts";
import { createSystem } from "../system.ts";
import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";
import { match } from "../rules.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

type Meta = { description: string };
const { permission } = createPermissionFactory<Meta>();

const articleRead = permission({
  metadata: { description: "Read article" },
  target: target.required("article"),
  fetch: ([id]) => Promise.resolve({ _id: id, owner: "user:1", title: "x" }),
}).rules([match("article", (v) => v)]);

const articleCreate = permission({
  metadata: { description: "Create article" },
  target: target.none(),
}).rules([]);

const schema = {
  "article.read": articleRead,
  "article.create": articleCreate,
};

// ─── directProvider ──────────────────────────────────────────────────────────

Deno.test("directProvider — filters grants by subject.id", async () => {
  const provider = directProvider([
    { subject: { id: "alice" }, key: "article.create" },
    { subject: { id: "bob" }, key: "article.read", target: ["article:1"] },
  ]);
  const sys = createSystem<Meta>({ schema, providers: [provider] });

  assertEq((await sys.can({ id: "alice" }, "article.create")).ok, true);
  assertEq((await sys.can({ id: "bob" }, "article.create")).ok, false);
  assertEq((await sys.can({ id: "bob" }, "article.read", ["article:1"])).ok, true);
});

Deno.test("directProvider — empty list grants nothing", async () => {
  const provider = directProvider([]);
  const sys = createSystem<Meta>({ schema, providers: [provider] });
  assertEq((await sys.can({ id: "any" }, "article.create")).ok, false);
});

// ─── ownerProvider ───────────────────────────────────────────────────────────

Deno.test("ownerProvider — grants with implicit { owner: subject.id } constraint", async () => {
  const provider = ownerProvider({
    keys: ["article.read"],
    target: ["article:*"],
    segment: "article",
  });
  const sys = createSystem<Meta>({ schema, providers: [provider] });

  // The fetched article has owner = "user:1". Subject "user:1" matches.
  const r = await sys.can({ id: "user:1" }, "article.read", ["article:42"]);
  assertEq(r.ok, true);

  // Different subject → match constraint fails.
  const r2 = await sys.can({ id: "user:2" }, "article.read", ["article:42"]);
  assertEq(r2.ok, false);
});

Deno.test("ownerProvider — multiple keys grants each", async () => {
  const articleUpdate = permission({
    metadata: { description: "Update article" },
    target: target.required("article"),
    fetch: ([id]) => Promise.resolve({ _id: id, owner: "user:1" }),
  }).rules([match("article", (v) => v)]);

  const sys = createSystem<Meta>({
    schema: { ...schema, "article.update": articleUpdate },
    providers: [ownerProvider({
      keys: ["article.read", "article.update"],
      target: ["article:*"],
      segment: "article",
    })],
  });

  assertEq((await sys.can({ id: "user:1" }, "article.read", ["article:1"])).ok, true);
  assertEq((await sys.can({ id: "user:1" }, "article.update", ["article:1"])).ok, true);
});

// ─── system.context({}) curried ──────────────────────────────────────────────

Deno.test("system.context({ subject }).can(key, target) — curried form", async () => {
  const provider = directProvider([
    { subject: { id: "alice" }, key: "article.create" },
  ]);
  const sys = createSystem<Meta>({ schema, providers: [provider] });

  const checker = sys.context({ subject: { id: "alice" } });
  const r = await checker.can("article.create");
  assertEq(r.ok, true);
});

Deno.test("system.context({ subject, checkDate }) — context flows through", async () => {
  // No time rule on this perm, just verify the context shape works.
  const provider = directProvider([
    { subject: { id: "u" }, key: "article.create" },
  ]);
  const sys = createSystem<Meta>({ schema, providers: [provider] });

  const checker = sys.context({
    subject: { id: "u" },
    checkDate: new Date("2025-06-01"),
  });
  const r = await checker.can("article.create");
  assertEq(r.ok, true);
});

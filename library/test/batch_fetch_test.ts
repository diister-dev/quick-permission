import { test } from "node:test";
import { ALL, action, createSystem, entity, permissions } from "../mod.ts";
import { assertEquals } from "./+assert.ts";

type Doc = { readonly _id: string; readonly owner: string };

function setup(options: { readonly failBatch?: boolean } = {}) {
  const calls: { single: number; readonly batches: string[][] } = {
    single: 0,
    batches: [],
  };
  const store = new Map<string, Doc>([
    ["doc:1", { _id: "doc:1", owner: "user:me" }],
    ["doc:2", { _id: "doc:2", owner: "user:other" }],
    ["doc:3", { _id: "doc:3", owner: "user:me" }],
  ]);
  const doc = entity<Doc, never, "owner">("doc", {
    load: (id) => {
      calls.single++;
      return store.get(id) ?? null;
    },
    loadMany: (paths) => {
      const ids = paths.map(([id]) => id);
      calls.batches.push(ids);
      if (options.failBatch) throw new Error("db down");
      return ids.map((id) => store.get(id) ?? null);
    },
    conditions: { owner: { owner: "owner" } },
  });
  const docs = permissions(doc, "docs", { update: action() });
  const system = createSystem({
    permissions: [docs],
    providers: [() => [docs.grant("update", { on: ALL, when: ["owner"] })]],
  });
  return { calls, context: system.context({ subject: { id: "user:me" } }) };
}

test("concurrent checks share one loadMany call", async () => {
  const { calls, context } = setup();
  const results = await Promise.all(
    ["doc:1", "doc:2", "doc:3", "doc:404"].map((id) =>
      context.check("docs.update", id),
    ),
  );
  assertEquals(
    results.map((result) => result.ok),
    [true, false, true, false],
  );
  assertEquals(calls.batches, [["doc:1", "doc:2", "doc:3", "doc:404"]]);
  assertEquals(calls.single, 0);
});

test("a target requested twice in the same tick is loaded once", async () => {
  const { calls, context } = setup();
  await Promise.all([
    context.check("docs.update", "doc:1"),
    context.check("docs.update", "doc:1"),
    context.check("docs.update", "doc:2"),
  ]);
  assertEquals(calls.batches, [["doc:1", "doc:2"]]);
});

test("sequential checks reuse the context cache and batch only new targets", async () => {
  const { calls, context } = setup();
  await context.check("docs.update", "doc:1");
  await Promise.all([
    context.check("docs.update", "doc:1"),
    context.check("docs.update", "doc:3"),
  ]);
  assertEquals(calls.batches, [["doc:1"], ["doc:3"]]);
});

test("a failing loadMany denies every check of the batch", async () => {
  const { context } = setup({ failBatch: true });
  const results = await Promise.all(
    ["doc:1", "doc:3"].map((id) => context.check("docs.update", id)),
  );
  assertEquals(
    results.map((result) => result.ok),
    [false, false],
  );
});

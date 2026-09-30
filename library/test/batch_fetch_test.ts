import { test } from "node:test";
import { assertEquals } from "./+assert.ts";
import {
  createSystem,
  type FetchCtx,
  permission,
  resource,
  target,
} from "../mod.ts";

type Doc = { _id: string; owner: string };

function setup(options: { failBatch?: boolean } = {}) {
  const calls = { single: 0, batches: [] as string[][] };
  const docs = new Map<string, Doc>([
    ["doc:1", { _id: "doc:1", owner: "user:me" }],
    ["doc:2", { _id: "doc:2", owner: "user:other" }],
    ["doc:3", { _id: "doc:3", owner: "user:me" }],
  ]);
  const docOf = resource<Doc | null>({
    id: "doc",
    fetch: ({ target }) => {
      calls.single++;
      return docs.get(target[0] as string) ?? null;
    },
    fetchMany: (ctxs: readonly FetchCtx[]) => {
      const ids = ctxs.map((ctx) => ctx.target[0] as string);
      calls.batches.push(ids);
      if (options.failBatch) throw new Error("db down");
      return ids.map((id) => docs.get(id) ?? null);
    },
    dedupKey: ({ target }) => target[0] as string,
  });
  const system = createSystem({
    schema: {
      "docs.update": permission({ target: target.required("doc") }).rules([
        docOf.match((doc) => doc?.owner),
      ]),
    },
    providers: [
      (subject) => [
        { key: "docs.update", target: ["doc:*"], with: { doc: subject.id } },
      ],
    ],
  });
  return { calls, context: system.context({ subject: { id: "user:me" } }) };
}

test("concurrent checks share one fetchMany call", async () => {
  const { calls, context } = setup();
  const results = await Promise.all(
    ["doc:1", "doc:2", "doc:3", "doc:404"].map((id) =>
      context.can("docs.update", [id]),
    ),
  );
  assertEquals(
    results.map((r) => r.ok),
    [true, false, true, false],
  );
  assertEquals(calls.batches, [["doc:1", "doc:2", "doc:3", "doc:404"]]);
  assertEquals(calls.single, 0);
});

test("a target requested twice in the same tick is loaded once", async () => {
  const { calls, context } = setup();
  await Promise.all([
    context.can("docs.update", ["doc:1"]),
    context.can("docs.update", ["doc:1"]),
    context.can("docs.update", ["doc:2"]),
  ]);
  assertEquals(calls.batches, [["doc:1", "doc:2"]]);
});

test("sequential checks reuse the context cache and batch only new targets", async () => {
  const { calls, context } = setup();
  await context.can("docs.update", ["doc:1"]);
  await Promise.all([
    context.can("docs.update", ["doc:1"]),
    context.can("docs.update", ["doc:3"]),
  ]);
  assertEquals(calls.batches, [["doc:1"], ["doc:3"]]);
});

test("a failing fetchMany denies every check of the batch", async () => {
  const { context } = setup({ failBatch: true });
  const results = await Promise.all(
    ["doc:1", "doc:3"].map((id) => context.can("docs.update", [id])),
  );
  assertEquals(
    results.map((r) => r.ok),
    [false, false],
  );
});

test("without a context, fetch is used per check", async () => {
  const { calls } = setup();
  const docOf = resource<Doc>({
    id: "doc",
    fetch: () => {
      calls.single++;
      return { _id: "doc:1", owner: "user:me" };
    },
    fetchMany: () => {
      throw new Error("not expected");
    },
    dedupKey: ({ target }) => target[0] as string,
  });
  const system = createSystem({
    schema: {
      "docs.update": permission({ target: target.required("doc") }).rules([
        docOf.match((doc) => doc.owner),
      ]),
    },
    providers: [
      (subject) => [
        { key: "docs.update", target: ["doc:*"], with: { doc: subject.id } },
      ],
    ],
  });
  const result = await system.can({ id: "user:me" }, "docs.update", ["doc:1"]);
  assertEquals(result.ok, true);
  assertEquals(calls.single, 1);
});

import { test } from "node:test";
import { assertEquals } from "./+assert.ts";
import {
  createSystem,
  permission,
  requireSelf,
  resource,
  target,
} from "../mod.ts";

const userOf = resource({
  id: "user",
  fetch: ({ target }) => ({
    _id: target[0] as string,
    name: "test",
    roles: ["role:editor"],
  }),
  dedupKey: ({ target }) => target[0] as string,
});

const articleOf = resource({
  id: "article",
  fetch: ({ target }) => ({
    _id: target[0] as string,
    title: "test",
    authorId: target[0] === "article:mine" ? "user:editor" : "user:other",
  }),
  dedupKey: ({ target }) => target[0] as string,
});

test("requireSelf : flag activé + target match subject = OK", async () => {
  const sys = createSystem({
    schema: {
      "users.update": permission({ target: target.required("user") }).rules([
        userOf.match(),
        requireSelf({ flag: "selfOnly" }),
      ]),
    },
    providers: [
      () => [
        {
          key: "users.update",
          target: ["user:*"],
          flags: { selfOnly: true },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:editor" } })
    .can("users.update", ["user:editor"]);
  assertEquals(r.ok, true);
});

test("requireSelf : flag activé + target ≠ subject = DENY", async () => {
  const sys = createSystem({
    schema: {
      "users.update": permission({ target: target.required("user") }).rules([
        userOf.match(),
        requireSelf({ flag: "selfOnly" }),
      ]),
    },
    providers: [
      () => [
        {
          key: "users.update",
          target: ["user:*"],
          flags: { selfOnly: true },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:editor" } })
    .can("users.update", ["user:other"]);
  assertEquals(r.ok, false);
});

test("requireSelf : flag absent = silent pass = grant valide partout", async () => {
  const sys = createSystem({
    schema: {
      "users.update": permission({ target: target.required("user") }).rules([
        userOf.match(),
        requireSelf({ flag: "selfOnly" }),
      ]),
    },
    // Grant admin sans flag → requireSelf est skip
    providers: [() => [{ key: "users.update", target: ["user:*"] }]],
  });

  const r = await sys
    .context({ subject: { id: "user:editor" } })
    .can("users.update", ["user:other"]);
  assertEquals(r.ok, true);
});

test("requireOwner : flag activé + subject est owner = OK", async () => {
  const sys = createSystem({
    schema: {
      "articles.update": permission({
        target: target.required("article"),
      }).rules([
        articleOf.match(),
        articleOf.requireOwner((a) => a.authorId, { flag: "ownerOnly" }),
      ]),
    },
    providers: [
      () => [
        {
          key: "articles.update",
          target: ["article:*"],
          flags: { ownerOnly: true },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:editor" } })
    .can("articles.update", ["article:mine"]);
  assertEquals(r.ok, true);
});

test("requireOwner : flag activé + subject n'est pas owner = DENY", async () => {
  const sys = createSystem({
    schema: {
      "articles.update": permission({
        target: target.required("article"),
      }).rules([
        articleOf.match(),
        articleOf.requireOwner((a) => a.authorId, { flag: "ownerOnly" }),
      ]),
    },
    providers: [
      () => [
        {
          key: "articles.update",
          target: ["article:*"],
          flags: { ownerOnly: true },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:editor" } })
    .can("articles.update", ["article:other"]);
  assertEquals(r.ok, false);
});

test("requireOwner : admin grant (no flag) bypass + owner grant (flag) coexistent", async () => {
  const sys = createSystem({
    schema: {
      "articles.update": permission({
        target: target.required("article"),
      }).rules([
        articleOf.match(),
        articleOf.requireOwner((a) => a.authorId, { flag: "ownerOnly" }),
      ]),
    },
    providers: [
      () => [
        { id: "g-admin", key: "articles.update", target: ["article:*"] },
        {
          id: "g-author",
          key: "articles.update",
          target: ["article:*"],
          flags: { ownerOnly: true },
        },
      ],
    ],
  });

  // user:editor sur article:other : owner grant fail mais admin passe → OK
  const r = await sys
    .context({ subject: { id: "user:editor" } })
    .can("articles.update", ["article:other"]);
  assertEquals(r.ok, true);
});

test("requireMembership : flag activé + subject in list = OK", async () => {
  const groupOf = resource({
    id: "group",
    fetch: () => ({
      _id: "group:hr",
      memberIds: ["user:editor", "user:viewer"],
    }),
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "groups.read": permission({ target: target.required("group") }).rules([
        groupOf.match(),
        groupOf.requireMembership((g) => g.memberIds, { flag: "memberOnly" }),
      ]),
    },
    providers: [
      () => [
        {
          key: "groups.read",
          target: ["group:*"],
          flags: { memberOnly: true },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:editor" } })
    .can("groups.read", ["group:hr"]);
  assertEquals(r.ok, true);
});

test("requireMembership : flag activé + subject pas in list = DENY", async () => {
  const groupOf = resource({
    id: "group",
    fetch: () => ({ _id: "group:hr", memberIds: ["user:other"] }),
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "groups.read": permission({ target: target.required("group") }).rules([
        groupOf.match(),
        groupOf.requireMembership((g) => g.memberIds, { flag: "memberOnly" }),
      ]),
    },
    providers: [
      () => [
        {
          key: "groups.read",
          target: ["group:*"],
          flags: { memberOnly: true },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:editor" } })
    .can("groups.read", ["group:hr"]);
  assertEquals(r.ok, false);
});

test("requireCustom : prédicat passe = OK", async () => {
  const expenseOf = resource({
    id: "expense",
    fetch: () => ({ _id: "expense:e1", amount: 250 }),
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "expenses.validate": permission({
        target: target.required("expense"),
      }).rules([
        expenseOf.match(),
        expenseOf.requireCustom(
          (expense, ctx) => {
            const max = (ctx.grant.payload as { maxAmount?: number })
              ?.maxAmount;
            return max === undefined || expense.amount <= max;
          },
          { flag: "amountLimit", descriptor: { payloadField: "maxAmount" } },
        ),
      ]),
    },
    providers: [
      () => [
        {
          key: "expenses.validate",
          target: ["expense:*"],
          flags: { amountLimit: true },
          payload: { maxAmount: 500 },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("expenses.validate", ["expense:e1"]);
  assertEquals(r.ok, true);
});

test("requireCustom : prédicat échoue = DENY", async () => {
  const expenseOf = resource({
    id: "expense",
    fetch: () => ({ _id: "expense:e1", amount: 1200 }),
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "expenses.validate": permission({
        target: target.required("expense"),
      }).rules([
        expenseOf.match(),
        expenseOf.requireCustom(
          (expense, ctx) => {
            const max = (ctx.grant.payload as { maxAmount?: number })
              ?.maxAmount;
            return max === undefined || expense.amount <= max;
          },
          { flag: "amountLimit", descriptor: { payloadField: "maxAmount" } },
        ),
      ]),
    },
    providers: [
      () => [
        {
          key: "expenses.validate",
          target: ["expense:*"],
          flags: { amountLimit: true },
          payload: { maxAmount: 500 },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("expenses.validate", ["expense:e1"]);
  assertEquals(r.ok, false);
});

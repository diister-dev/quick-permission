import { test } from "node:test";
import {
  ALL,
  action,
  createSystem,
  entity,
  type Grant,
  permissions,
} from "../mod.ts";
import { assertEquals } from "./+assert.ts";

type UserDoc = {
  readonly _id: string;
  readonly name: string;
  readonly roles: readonly string[];
};

type ArticleDoc = {
  readonly _id: string;
  readonly title: string;
  readonly authorId: string;
};

type GroupDoc = { readonly _id: string; readonly memberIds: readonly string[] };

type ExpenseDoc = { readonly _id: string; readonly amount: number };

function usersSet() {
  const user = entity("user", {
    load: (id): UserDoc => ({ _id: id, name: "test", roles: ["role:editor"] }),
    conditions: { selfOnly: { self: true } },
  });
  return permissions(user, "users", { update: action() });
}

function articlesSet() {
  const article = entity("article", {
    load: (id): ArticleDoc => ({
      _id: id,
      title: "test",
      authorId: id === "article:mine" ? "user:editor" : "user:other",
    }),
    conditions: { ownerOnly: { owner: (doc) => doc.authorId } },
  });
  return permissions(article, "articles", { update: action() });
}

function groupsSet(memberIds: readonly string[]) {
  const group = entity("group", {
    load: (): GroupDoc => ({ _id: "group:hr", memberIds }),
    conditions: { memberOnly: { member: (doc) => doc.memberIds } },
  });
  return permissions(group, "groups", { read: action() });
}

function maxAmountOf(payload: unknown): number | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  if (!("maxAmount" in payload)) return undefined;
  return typeof payload.maxAmount === "number" ? payload.maxAmount : undefined;
}

function expensesSet(amount: number) {
  const expense = entity("expense", {
    load: (): ExpenseDoc => ({ _id: "expense:e1", amount }),
    conditions: {
      amountLimit: {
        test: (doc, ctx) => {
          const max = maxAmountOf(ctx.grant.payload);
          return max === undefined || doc.amount <= max;
        },
      },
    },
  });
  return permissions(expense, "expenses", { validate: action() });
}

function readGroup(
  groups: ReturnType<typeof groupsSet>,
  grants: readonly Grant[],
) {
  return createSystem({ permissions: [groups], providers: [() => grants] })
    .context({ subject: { id: "user:editor" } })
    .check("groups.read", "group:hr");
}

function validateExpense(
  expenses: ReturnType<typeof expensesSet>,
  grants: readonly Grant[],
) {
  return createSystem({ permissions: [expenses], providers: [() => grants] })
    .context({ subject: { id: "user:1" } })
    .check("expenses.validate", "expense:e1");
}

test("self condition: switched on and target is the subject = OK", async () => {
  const users = usersSet();
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("update", { on: ALL, when: ["selfOnly"] })]],
  });
  const result = await system
    .context({ subject: { id: "user:editor" } })
    .check("users.update", "user:editor");
  assertEquals(result.ok, true);
});

test("self condition: switched on and target is not the subject = DENY", async () => {
  const users = usersSet();
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("update", { on: ALL, when: ["selfOnly"] })]],
  });
  const result = await system
    .context({ subject: { id: "user:editor" } })
    .check("users.update", "user:other");
  assertEquals(result.ok, false);
});

test("self condition: not switched on = the grant is valid everywhere", async () => {
  const users = usersSet();
  const system = createSystem({
    permissions: [users],
    providers: [() => [users.grant("update", { on: ALL })]],
  });
  const result = await system
    .context({ subject: { id: "user:editor" } })
    .check("users.update", "user:other");
  assertEquals(result.ok, true);
});

test("owner condition: switched on and subject is the owner = OK", async () => {
  const articles = articlesSet();
  const system = createSystem({
    permissions: [articles],
    providers: [
      () => [articles.grant("update", { on: ALL, when: ["ownerOnly"] })],
    ],
  });
  const result = await system
    .context({ subject: { id: "user:editor" } })
    .check("articles.update", "article:mine");
  assertEquals(result.ok, true);
});

test("owner condition: switched on and subject is not the owner = DENY", async () => {
  const articles = articlesSet();
  const system = createSystem({
    permissions: [articles],
    providers: [
      () => [articles.grant("update", { on: ALL, when: ["ownerOnly"] })],
    ],
  });
  const result = await system
    .context({ subject: { id: "user:editor" } })
    .check("articles.update", "article:other");
  assertEquals(result.ok, false);
});

test("owner condition: an admin grant without it and an owner grant with it coexist", async () => {
  const articles = articlesSet();
  const system = createSystem({
    permissions: [articles],
    providers: [
      () => [
        articles.grant("update", { id: "g-admin", on: ALL }),
        articles.grant("update", {
          id: "g-author",
          on: ALL,
          when: ["ownerOnly"],
        }),
      ],
    ],
  });
  const result = await system
    .context({ subject: { id: "user:editor" } })
    .check("articles.update", "article:other");
  assertEquals(result.ok, true);
});

test("member condition: switched on and subject in the list = OK", async () => {
  const groups = groupsSet(["user:editor", "user:viewer"]);
  const result = await readGroup(groups, [
    groups.grant("read", { on: ALL, when: ["memberOnly"] }),
  ]);
  assertEquals(result.ok, true);
});

test("member condition: switched on and subject not in the list = DENY", async () => {
  const groups = groupsSet(["user:other"]);
  const result = await readGroup(groups, [
    groups.grant("read", { on: ALL, when: ["memberOnly"] }),
  ]);
  assertEquals(result.ok, false);
});

test("custom condition: predicate holds = OK", async () => {
  const expenses = expensesSet(250);
  const result = await validateExpense(expenses, [
    expenses.grant("validate", {
      on: ALL,
      when: ["amountLimit"],
      payload: { maxAmount: 500 },
    }),
  ]);
  assertEquals(result.ok, true);
});

test("custom condition: predicate fails = DENY", async () => {
  const expenses = expensesSet(1200);
  const result = await validateExpense(expenses, [
    expenses.grant("validate", {
      on: ALL,
      when: ["amountLimit"],
      payload: { maxAmount: 500 },
    }),
  ]);
  assertEquals(result.ok, false);
});

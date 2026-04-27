/**
 * Tests for the built-in rules: TimeRule, IpRule, WithRule, FilterRule.
 * These were entirely uncovered before — they are where every authorization
 * decision lives.
 */
import {
  createPermissionSystem,
  directProvider,
  permission,
  TimeRule,
  IpRule,
  WithRule,
  FilterRule,
  type PermissionSchemas,
  type Subject,
} from "../mod.ts";

const alice: Subject = { id: "alice" };

function assert(condition: boolean, message: string = "") {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ─── TimeRule ─────────────────────────────────────────────────────────────────

const timeSchemas = {
  "thing.do": permission(),
} satisfies PermissionSchemas;

Deno.test("TimeRule - grant inside window passes", async () => {
  const system = createPermissionSystem({
    schemas: timeSchemas,
    sources: [directProvider([{
      subject: alice,
      key: "thing.do",
      startDate: new Date("2020-01-01"),
      endDate: new Date("2099-12-31"),
    }])],
    rules: [TimeRule()],
  });
  const r = await system.can(alice, "thing.do");
  assert(r.ok === true, "current date is inside [2020, 2099]");
});

Deno.test("TimeRule - grant before startDate is rejected", async () => {
  const system = createPermissionSystem({
    schemas: timeSchemas,
    sources: [directProvider([{
      subject: alice,
      key: "thing.do",
      startDate: new Date("2099-01-01"),
    }])],
    rules: [TimeRule()],
  });
  const r = await system.can(alice, "thing.do");
  assert(r.ok === false, "now is before 2099");
  if (!r.ok) {
    assert(r.reasons.some((s) => s.includes("start")), "reason mentions start");
  }
});

Deno.test("TimeRule - grant after endDate is rejected", async () => {
  const system = createPermissionSystem({
    schemas: timeSchemas,
    sources: [directProvider([{
      subject: alice,
      key: "thing.do",
      endDate: new Date("2000-01-01"),
    }])],
    rules: [TimeRule()],
  });
  const r = await system.can(alice, "thing.do");
  assert(r.ok === false, "now is after 2000");
});

Deno.test("TimeRule - no start/end means always valid", async () => {
  const system = createPermissionSystem({
    schemas: timeSchemas,
    sources: [directProvider([{ subject: alice, key: "thing.do" }])],
    rules: [TimeRule()],
  });
  const r = await system.can(alice, "thing.do");
  assert(r.ok === true);
});

Deno.test("TimeRule - context().checkDate overrides 'now'", async () => {
  // Grant valid only in 2025; we ask "what about Jan 2025?" via checkDate.
  const system = createPermissionSystem({
    schemas: timeSchemas,
    sources: [directProvider([{
      subject: alice,
      key: "thing.do",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-12-31"),
    }])],
    rules: [TimeRule()],
  });
  const checker = system.context({ subject: alice, checkDate: new Date("2025-06-01") });
  const r = await checker.can("thing.do");
  assert(r.ok === true, "checkDate places us inside the window");

  const checker2 = system.context({ subject: alice, checkDate: new Date("2030-01-01") });
  const r2 = await checker2.can("thing.do");
  assert(r2.ok === false, "checkDate after window");
});

// ─── IpRule ───────────────────────────────────────────────────────────────────

Deno.test("IpRule - no allowedIps means no IP restriction", async () => {
  const system = createPermissionSystem({
    schemas: timeSchemas,
    sources: [directProvider([{ subject: alice, key: "thing.do" }])],
    rules: [IpRule()],
  });
  const r = await system.can(alice, "thing.do");
  assert(r.ok === true, "grant has no allowedIps → always passes");
});

Deno.test("IpRule - allowed IP in request passes", async () => {
  const system = createPermissionSystem({
    schemas: timeSchemas,
    sources: [directProvider([{
      subject: alice,
      key: "thing.do",
      allowedIps: ["10.0.0.1", "10.0.0.2"],
    }])],
    rules: [IpRule()],
  });
  const checker = system.context({ subject: alice, ips: ["10.0.0.2"] });
  const r = await checker.can("thing.do");
  assert(r.ok === true);
});

Deno.test("IpRule - request IP not in allowed set is rejected", async () => {
  const system = createPermissionSystem({
    schemas: timeSchemas,
    sources: [directProvider([{
      subject: alice,
      key: "thing.do",
      allowedIps: ["10.0.0.1"],
    }])],
    rules: [IpRule()],
  });
  const checker = system.context({ subject: alice, ips: ["192.168.0.1"] });
  const r = await checker.can("thing.do");
  assert(r.ok === false);
});

Deno.test("IpRule - empty ips array is rejected when grant restricts", async () => {
  const system = createPermissionSystem({
    schemas: timeSchemas,
    sources: [directProvider([{
      subject: alice,
      key: "thing.do",
      allowedIps: ["10.0.0.1"],
    }])],
    rules: [IpRule()],
  });
  // Default ips is [] — should not satisfy any allowed list
  const r = await system.can(alice, "thing.do");
  assert(r.ok === false);
});

// ─── WithRule ─────────────────────────────────────────────────────────────────

type Article = { _id: string; owner: string; published: boolean };

async function getArticle([id]: readonly [string]): Promise<Article | undefined> {
  const fixtures: Record<string, Article> = {
    "a:1": { _id: "a:1", owner: "alice", published: true },
    "a:2": { _id: "a:2", owner: "bob", published: false },
  };
  return fixtures[id];
}

const articleSchemas = {
  "article.read": permission(getArticle, [WithRule()]),
} satisfies PermissionSchemas;

Deno.test("WithRule - all constraints satisfied passes", async () => {
  const system = createPermissionSystem({
    schemas: articleSchemas,
    sources: [directProvider([{
      subject: alice,
      key: "article.read",
      target: ["a:1"],
      with: { owner: "alice", published: true },
    }])],
  });
  const r = await system.can(alice, "article.read", ["a:1"]);
  assert(r.ok === true);
});

Deno.test("WithRule - one mismatched constraint rejects", async () => {
  const system = createPermissionSystem({
    schemas: articleSchemas,
    sources: [directProvider([{
      subject: alice,
      key: "article.read",
      target: ["a:2"],
      with: { owner: "alice" }, // a:2 owner is bob
    }])],
  });
  const r = await system.can(alice, "article.read", ["a:2"]);
  assert(r.ok === false);
});

Deno.test("WithRule - missing 'with' on grant always passes", async () => {
  const system = createPermissionSystem({
    schemas: articleSchemas,
    sources: [directProvider([{
      subject: alice,
      key: "article.read",
      target: ["a:1"],
    }])],
  });
  const r = await system.can(alice, "article.read", ["a:1"]);
  assert(r.ok === true);
});

Deno.test("WithRule - custom withKey + extractor scopes constraints to a sub-resource", async () => {
  type BadgeBundle = { exposition: { open: boolean }; badge: { _id: string; ownerId: string } };
  async function getBadgeBundle([_expoId, _badgeId]: readonly [string, string]): Promise<BadgeBundle> {
    return { exposition: { open: true }, badge: { _id: "b:1", ownerId: "alice" } };
  }

  const schemas = {
    "exp.badge.read": permission(getBadgeBundle, [
      WithRule("withExposition", (_t, v) => (v as BadgeBundle).exposition),
      WithRule("withBadge", (_t, v) => (v as BadgeBundle).badge),
    ]),
  } satisfies PermissionSchemas;

  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{
      subject: alice,
      key: "exp.badge.read",
      target: ["expo:1", "b:1"],
      withExposition: { open: true },
      withBadge: { ownerId: "alice" },
    }])],
  });
  const r = await system.can(alice, "exp.badge.read", ["expo:1", "b:1"]);
  assert(r.ok === true, "both nested with-clauses satisfied");
});

Deno.test("WithRule - fetchTarget that fails is treated as denial", async () => {
  async function broken(_id: readonly [string]): Promise<Article> {
    throw new Error("DB down");
  }
  const schemas = {
    "article.read": permission(broken, [WithRule()]),
  } satisfies PermissionSchemas;

  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{
      subject: alice,
      key: "article.read",
      target: ["a:1"],
      with: { owner: "alice" },
    }])],
  });
  const r = await system.can(alice, "article.read", ["a:1"]);
  assert(r.ok === false, "fetcher error → denial");
});

// ─── FilterRule ───────────────────────────────────────────────────────────────

Deno.test("FilterRule - applies the filter to the fetched resource", async () => {
  const schemas = {
    "article.read": permission(getArticle, [FilterRule()]),
  } satisfies PermissionSchemas;

  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{
      subject: alice,
      key: "article.read",
      target: ["a:1"],
      filter: { _id: true, owner: true },
    }])],
  });
  const r = await system.can(alice, "article.read", ["a:1"]);
  assert(r.ok === true);
  if (r.ok) {
    const data = (r.output as { data: any }).data;
    assert(data._id === "a:1");
    assert(data.owner === "alice");
    assert(data.published === undefined, "filtered out");
  }
});

Deno.test("FilterRule - merges filters from multiple matching grants (union)", async () => {
  const schemas = {
    "article.read": permission(getArticle, [FilterRule()]),
  } satisfies PermissionSchemas;

  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([
      { subject: alice, key: "article.read", target: ["a:1"], filter: { _id: true, owner: true } },
      { subject: alice, key: "article.read", target: ["a:1"], filter: { _id: true, published: true } },
    ])],
  });
  const r = await system.can(alice, "article.read", ["a:1"]);
  assert(r.ok === true);
  if (r.ok) {
    const data = (r.output as { data: any; filter: any }).data;
    assert(data._id === "a:1");
    assert(data.owner === "alice");
    assert(data.published === true, "both filters union'd");
  }
});

Deno.test("FilterRule - no filter on grant returns the unfiltered resource as data", async () => {
  const schemas = {
    "article.read": permission(getArticle, [FilterRule()]),
  } satisfies PermissionSchemas;

  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{
      subject: alice,
      key: "article.read",
      target: ["a:1"],
    }])],
  });
  const r = await system.can(alice, "article.read", ["a:1"]);
  assert(r.ok === true);
  if (r.ok) {
    const data = (r.output as { data: any }).data;
    assert(data._id === "a:1" && data.owner === "alice" && data.published === true, "all fields present");
  }
});

Deno.test("FilterRule - filterOn extractor lets you filter a sub-resource", async () => {
  type Bundle = { wrapper: { unrelated: string }; article: Article };
  async function getBundle([id]: readonly [string]): Promise<Bundle> {
    return {
      wrapper: { unrelated: "ignored" },
      article: { _id: id, owner: "alice", published: true },
    };
  }
  const schemas = {
    "wrapped.read": permission(getBundle, [
      FilterRule((_t, v) => (v as Bundle).article),
    ]),
  } satisfies PermissionSchemas;

  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{
      subject: alice,
      key: "wrapped.read",
      target: ["a:1"],
      filter: { _id: true, owner: true },
    }])],
  });
  const r = await system.can(alice, "wrapped.read", ["a:1"]);
  assert(r.ok === true);
  if (r.ok) {
    const data = (r.output as { data: any }).data;
    // Only the article subset, filtered to _id+owner
    assert(data._id === "a:1");
    assert(data.owner === "alice");
    assert(data.published === undefined);
    assert(data.wrapper === undefined, "wrapper not exposed");
  }
});

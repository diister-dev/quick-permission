/**
 * Tests for onBeforeCheck / onCheck callbacks: observability, audit trail,
 * and short-circuit support for tests/mocks.
 */
import {
  createPermissionSystem,
  directProvider,
  permission,
  type CheckEvent,
  type BeforeCheckEvent,
  type PermissionSchemas,
  type Subject,
} from "../mod.ts";

const alice: Subject = { id: "alice" };

const schemas = {
  "article.read": permission<readonly string[]>(),
  "article.create": permission(),
} satisfies PermissionSchemas;

function assert(condition: boolean, message: string = "") {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ─── onCheck fires after a check ──────────────────────────────────────────────

Deno.test("onCheck - fires for a granted check with ok=true", async () => {
  const events: CheckEvent[] = [];
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.read", target: ["a:1"] }])],
    onCheck: (e) => { events.push(e); },
  });

  await system.can(alice, "article.read", ["a:1"]);

  assert(events.length === 1, `expected 1 event, got ${events.length}`);
  assert(events[0].ok === true, "ok=true");
  assert(events[0].mode === "can", "mode=can");
  assert(events[0].key === "article.read");
  assert(events[0].shortCircuited === false);
  assert(typeof events[0].durationMs === "number" && events[0].durationMs >= 0);
  assert(typeof events[0].checkId === "string" && events[0].checkId.length > 0);
});

Deno.test("onCheck - fires for a denied check with reasons", async () => {
  const events: CheckEvent[] = [];
  const system = createPermissionSystem({
    schemas,
    sources: [],
    onCheck: (e) => { events.push(e); },
  });

  await system.can(alice, "article.create");

  assert(events.length === 1);
  assert(events[0].ok === false, "ok=false");
  assert(Array.isArray(events[0].reasons) && events[0].reasons!.length > 0, "reasons populated");
  assert(events[0].output === undefined, "no output on denial");
});

Deno.test("onCheck - mode reflects canDynamic call", async () => {
  const events: CheckEvent[] = [];
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.create" }])],
    onCheck: (e) => { events.push(e); },
  });

  await system.canDynamic(alice, "article.create");
  assert(events[0].mode === "canDynamic", `expected canDynamic, got ${events[0].mode}`);
});

Deno.test("onCheck - mode reflects canBroadMatch call", async () => {
  const events: CheckEvent[] = [];
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.read", target: ["a:1"] }])],
    onCheck: (e) => { events.push(e); },
  });

  await system.canBroadMatch(alice, "article.read", ["*"]);
  assert(events[0].mode === "canBroadMatch", `expected canBroadMatch, got ${events[0].mode}`);
});

Deno.test("onCheck - unknown_key from canDynamic does NOT call onCheck (rejected before check)", async () => {
  const events: CheckEvent[] = [];
  const system = createPermissionSystem({
    schemas,
    sources: [],
    onCheck: (e) => { events.push(e); },
  });

  const r = await system.canDynamic(alice, "totally.fake");
  assert(r.ok === false);
  assert(events.length === 0, "no event fired for unknown_key (key validated upstream)");
});

// ─── onBeforeCheck fires and can short-circuit ────────────────────────────────

Deno.test("onBeforeCheck - fires before each check", async () => {
  const beforeEvents: BeforeCheckEvent[] = [];
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.create" }])],
    onBeforeCheck: (e) => { beforeEvents.push(e); },
  });

  await system.can(alice, "article.create");
  assert(beforeEvents.length === 1);
  assert(beforeEvents[0].subject.id === "alice");
  assert(beforeEvents[0].key === "article.create");
});

Deno.test("onBeforeCheck - returning { skip: result } short-circuits", async () => {
  const checkEvents: CheckEvent[] = [];
  const system = createPermissionSystem({
    schemas,
    sources: [], // no real grant — would normally be denied
    onBeforeCheck: (_e) => ({ skip: { ok: true, output: { mocked: true } } }),
    onCheck: (e) => { checkEvents.push(e); },
  });

  const r = await system.can(alice, "article.create");
  assert(r.ok === true, "short-circuit returns the mocked ok");
  assert(checkEvents.length === 1, "onCheck still fires for short-circuited checks");
  assert(checkEvents[0].shortCircuited === true);
});

Deno.test("onBeforeCheck - returning nothing falls through to the real check", async () => {
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.create" }])],
    onBeforeCheck: () => undefined,
  });

  const r = await system.can(alice, "article.create");
  assert(r.ok === true, "real check still ran");
});

Deno.test("checkId - is shared between before and after callbacks", async () => {
  const checkIds: { before?: string; after?: string } = {};
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.create" }])],
    onBeforeCheck: (e) => { checkIds.before = e.checkId; },
    onCheck: (e) => { checkIds.after = e.checkId; },
  });

  await system.can(alice, "article.create");
  assert(checkIds.before !== undefined && checkIds.before === checkIds.after, "matching checkId");
});

Deno.test("checkId - is unique across calls", async () => {
  const ids = new Set<string>();
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.create" }])],
    onCheck: (e) => { ids.add(e.checkId); },
  });

  await system.can(alice, "article.create");
  await system.can(alice, "article.create");
  await system.can(alice, "article.create");
  assert(ids.size === 3, `expected 3 unique ids, got ${ids.size}`);
});

// ─── async callbacks are awaited ──────────────────────────────────────────────

Deno.test("onCheck - awaits async callback before resolving", async () => {
  const flag = { done: false };
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.create" }])],
    onCheck: async () => {
      await new Promise((r) => setTimeout(r, 10));
      flag.done = true;
    },
  });

  await system.can(alice, "article.create");
  assert(flag.done === true, "async onCheck completed before can() resolved");
});

// ─── context() also propagates events ─────────────────────────────────────────

Deno.test("events fire from context().can() too", async () => {
  const events: CheckEvent[] = [];
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.create" }])],
    onCheck: (e) => { events.push(e); },
  });

  const ctx = system.context({ subject: alice });
  await ctx.can("article.create");
  await ctx.canDynamic("article.create");
  await ctx.canBroadMatch("article.create");

  assert(events.length === 3, `expected 3 events, got ${events.length}`);
  assert(events[0].mode === "can");
  assert(events[1].mode === "canDynamic");
  assert(events[2].mode === "canBroadMatch");
});

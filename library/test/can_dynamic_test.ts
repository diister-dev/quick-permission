/**
 * Tests for `canDynamic` — checking permissions whose key is only known at
 * runtime (e.g. coming from an HTTP request body).
 */
import {
  createPermissionSystem,
  directProvider,
  permission,
  type PermissionSchemas,
  type Subject,
} from "../mod.ts";

const schemas = {
  "article.read": permission<readonly string[]>(),
  "article.create": permission(),
} satisfies PermissionSchemas;

const alice: Subject = { id: "alice" };

const system = createPermissionSystem({
  schemas,
  sources: [
    directProvider([
      { subject: alice, key: "article.read", target: ["article:1"] },
      { subject: alice, key: "article.create" },
    ]),
  ],
});

function assert(condition: boolean, message: string = "") {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

Deno.test("canDynamic - granted permission returns ok: true", async () => {
  const r = await system.canDynamic(alice, "article.read", ["article:1"]);
  assert(r.ok === true, "should be granted");
});

Deno.test("canDynamic - missing permission returns ok: false without code", async () => {
  // Alice has article.read on article:1 only — article:99 should be denied.
  const r = await system.canDynamic(alice, "article.read", ["article:99"]);
  assert(r.ok === false, "should be denied");
  if (r.ok === false) {
    assert(r.code === undefined, "denial does NOT carry a code");
    assert(r.reasons.length > 0, "should have a reason");
  }
});

Deno.test("canDynamic - unknown key returns code 'unknown_key'", async () => {
  const r = await system.canDynamic(alice, "totally.fake.permission");
  assert(r.ok === false, "should be denied");
  if (r.ok === false) {
    assert(r.code === "unknown_key", `expected code 'unknown_key', got ${r.code}`);
    assert(
      r.reasons[0].includes("totally.fake.permission"),
      "reason should mention the unknown key",
    );
  }
});

Deno.test("canDynamic - works without target (targetless schema)", async () => {
  const r = await system.canDynamic(alice, "article.create");
  assert(r.ok === true, "targetless dynamic check works");
});

Deno.test("canDynamic - exposed on withContext", async () => {
  const checker = system.withContext({ subject: alice });
  const r = await checker.canDynamic("article.read", ["article:1"]);
  assert(r.ok === true);

  const unknown = await checker.canDynamic("nope.nope");
  assert(unknown.ok === false);
  if (unknown.ok === false) {
    assert(unknown.code === "unknown_key");
  }
});

Deno.test("canDynamic - exposed on context() with shared cache", async () => {
  const ctx = system.context({ subject: alice });
  const r1 = await ctx.canDynamic("article.read", ["article:1"]);
  assert(r1.ok === true);

  const r2 = await ctx.canDynamic("article.read", ["article:1"]);
  assert(r2.ok === true, "second call hits the same cache, still ok");
});

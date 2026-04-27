/**
 * Tests for parent-state inheritance in intermediates.
 * Children automatically inherit subject, target, with, dates, etc. from the
 * parent unless they explicitly override (or erase via undefined).
 */
import {
  createPermissionSystem,
  directProvider,
  permission,
  intermediate,
  TimeRule,
  type PermissionSchemas,
  type Subject,
} from "../mod.ts";

const schemas = {
  "doc.read": permission<readonly string[]>(),
  "doc.update": permission<readonly string[]>(),
  "doc.delete": permission<readonly string[]>(),
  "doc.manage": intermediate<readonly string[]>((parent) => [
    { key: "doc.read" },
    { key: "doc.update" },
    { key: "doc.delete" },
  ]),
} satisfies PermissionSchemas;

const alice: Subject = { id: "alice" };

function assert(condition: boolean, message: string = "") {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

Deno.test("intermediate: child inherits target from parent", async () => {
  const system = createPermissionSystem({
    schemas,
    sources: [
      directProvider([
        { subject: alice, key: "doc.manage", target: ["doc:42"] },
      ]),
    ],
  });

  const r1 = await system.can(alice, "doc.read", ["doc:42"]);
  assert(r1.ok === true, "child inherits parent target");

  const r2 = await system.can(alice, "doc.read", ["doc:other"]);
  assert(r2.ok === false, "child does not match different target");
});

Deno.test("intermediate: child inherits subject from parent", async () => {
  const system = createPermissionSystem({
    schemas,
    sources: [
      directProvider([{ subject: alice, key: "doc.manage", target: ["doc:42"] }]),
    ],
  });

  const r = await system.can(alice, "doc.update", ["doc:42"]);
  assert(r.ok === true, "child inherits subject");
});

Deno.test("intermediate: child inherits endDate from parent (TimeRule)", async () => {
  // Parent has a temporary grant; children must respect the same time window.
  const futurePast: Subject = { id: "future-past-user" };

  const system = createPermissionSystem({
    schemas,
    sources: [
      directProvider([
        {
          subject: futurePast,
          key: "doc.manage",
          target: ["doc:42"],
          endDate: new Date("2000-01-01"), // already expired
        },
      ]),
    ],
    rules: [TimeRule()],
  });

  const r = await system.can(futurePast, "doc.read", ["doc:42"]);
  assert(r.ok === false, "expired parent contraint propagates to child");
});

Deno.test("intermediate: child can override target", async () => {
  const childOverrideSchemas = {
    "doc.read": permission<readonly string[]>(),
    "doc.manage": intermediate<readonly string[]>((parent) => [
      { key: "doc.read", target: [...parent.target, "comment:*"] as readonly string[] },
    ]),
  } satisfies PermissionSchemas;

  const system = createPermissionSystem({
    schemas: childOverrideSchemas,
    sources: [
      directProvider([{ subject: alice, key: "doc.manage", target: ["doc:42"] }]),
    ],
  });

  const r1 = await system.can(alice, "doc.read", ["doc:42", "comment:99"]);
  assert(r1.ok === true, "overridden composite target matches");

  const r2 = await system.can(alice, "doc.read", ["doc:42"]);
  assert(r2.ok === false, "raw parent target does not match the composite override");
});

Deno.test("intermediate: child can erase a parent field with undefined", async () => {
  // Parent has a `with: { public: true }`. Child explicitly erases it.
  const eraseSchemas = {
    "doc.read": permission<readonly string[]>(),
    "doc.public.read": permission<readonly string[]>(),
    "doc.manage": intermediate<readonly string[]>((parent) => [
      { key: "doc.read" },                                      // inherits with: {...}
      { key: "doc.public.read", with: undefined },              // erases with
    ]),
  } satisfies PermissionSchemas;

  const system = createPermissionSystem({
    schemas: eraseSchemas,
    sources: [
      directProvider([
        {
          subject: alice,
          key: "doc.manage",
          target: ["doc:42"],
          with: { public: true },
        },
      ]),
    ],
  });

  // The "doc.read" child inherits `with: { public: true }`. Since there's no
  // fetchTarget on this schema, WithRule short-circuits and approves — that's
  // a separate bug, but the inheritance shape is the test target.
  // We use collectPermissions to verify child shape directly.
  const collected = await system.collectPermissions(
    { subject: alice, key: "doc.read", target: ["doc:42"] },
  );
  assert(collected.length === 1, `expected 1 child, got ${collected.length}`);
  assert(
    JSON.stringify((collected[0] as any).with) === JSON.stringify({ public: true }),
    "doc.read inherits with from parent",
  );

  const collectedPub = await system.collectPermissions(
    { subject: alice, key: "doc.public.read", target: ["doc:42"] },
  );
  assert(collectedPub.length === 1, `expected 1 child, got ${collectedPub.length}`);
  assert(
    (collectedPub[0] as any).with === undefined,
    "doc.public.read had with erased",
  );
});

Deno.test("intermediate: parent permission itself is also matched", async () => {
  // The intermediate "doc.manage" can be checked directly (not just via expansion).
  const system = createPermissionSystem({
    schemas,
    sources: [
      directProvider([{ subject: alice, key: "doc.manage", target: ["doc:42"] }]),
    ],
  });

  const r = await system.can(alice, "doc.manage", ["doc:42"]);
  assert(r.ok === true, "parent permission is checkable directly");
});

Deno.test("intermediate: nested inheritance through two levels", async () => {
  const nestedSchemas = {
    "doc.read": permission<readonly string[]>(),
    "doc.write": permission<readonly string[]>(),
    "doc.manage": intermediate<readonly string[]>((_parent) => [
      { key: "doc.read" },
      { key: "doc.write" },
    ]),
    "admin": intermediate<readonly string[]>((_parent) => [
      { key: "doc.manage" },
    ]),
  } satisfies PermissionSchemas;

  const system = createPermissionSystem({
    schemas: nestedSchemas,
    sources: [
      directProvider([{ subject: alice, key: "admin", target: ["doc:42"] }]),
    ],
  });

  const r = await system.can(alice, "doc.read", ["doc:42"]);
  assert(r.ok === true, "two-level inheritance: admin → doc.manage → doc.read");
});

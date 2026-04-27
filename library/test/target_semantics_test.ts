/**
 * Tests for target semantics after the array migration.
 * - perm.target undefined: applies to any target.
 * - perm.target defined: must match the request target as a path.
 * - request target undefined: only matches perms with no target.
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
  "article.update": permission<readonly string[]>(),
} satisfies PermissionSchemas;

const alice: Subject = { id: "alice" };

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

Deno.test("target undefined on perm: applies to any request target", async () => {
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.read" }])],
  });

  const r1 = await system.can(alice, "article.read", ["article:1"]);
  assert(r1.ok === true, "any target accepted");

  const r2 = await system.can(alice, "article.read", ["article:99"]);
  assert(r2.ok === true, "any target accepted (2)");
});

Deno.test("target defined on perm: must match request target", async () => {
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.read", target: ["article:1"] }])],
  });

  const r1 = await system.can(alice, "article.read", ["article:1"]);
  assert(r1.ok === true, "exact target matches");

  const r2 = await system.can(alice, "article.read", ["article:2"]);
  assert(r2.ok === false, "different target rejected");
});

Deno.test("targetless schema rejects perm with target when called without target", async () => {
  // Schema with no target type — call site cannot pass a target.
  const targetlessSchemas = {
    "article.create": permission(),
  } satisfies PermissionSchemas;

  const system = createPermissionSystem({
    schemas: targetlessSchemas,
    // A grant carries a target, but the call site cannot specify one — so it
    // never matches the request (which has target undefined).
    sources: [
      directProvider([
        { subject: alice, key: "article.create", target: ["article:1"] },
      ]),
    ],
  });

  const r = await system.can(alice, "article.create");
  assert(r.ok === false, "targeted grant cannot satisfy a targetless request");
});

Deno.test("targetless grants match a targetless request", async () => {
  const targetlessSchemas = {
    "article.create": permission(),
  } satisfies PermissionSchemas;

  const system = createPermissionSystem({
    schemas: targetlessSchemas,
    sources: [directProvider([{ subject: alice, key: "article.create" }])],
  });

  const r = await system.can(alice, "article.create");
  assert(r.ok === true, "targetless grant satisfies targetless request");
});

Deno.test("wildcard pattern in perm target", async () => {
  const system = createPermissionSystem({
    schemas,
    sources: [directProvider([{ subject: alice, key: "article.read", target: ["article:*"] }])],
  });

  const r1 = await system.can(alice, "article.read", ["article:1"]);
  assert(r1.ok === true, "expected ok=true");

  const r2 = await system.can(alice, "article.read", ["article:42"]);
  assert(r2.ok === true, "expected ok=true");

  const r3 = await system.can(alice, "article.read", ["other:1"]);
  assert(r3.ok === false, "different prefix rejected");
});

Deno.test("composite target paths", async () => {
  const system = createPermissionSystem({
    schemas,
    sources: [
      directProvider([
        { subject: alice, key: "article.read", target: ["expo:1", "badge:*"] },
      ]),
    ],
  });

  const r1 = await system.can(alice, "article.read", ["expo:1", "badge:42"]);
  assert(r1.ok === true, "expected ok=true");

  const r2 = await system.can(alice, "article.read", ["expo:2", "badge:42"]);
  assert(r2.ok === false, "first segment mismatch");

  const r3 = await system.can(alice, "article.read", ["expo:1"]);
  assert(r3.ok === false, "arity mismatch");
});

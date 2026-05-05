import { createSystem } from "../system.ts";
import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";
import { match, filter } from "../rules.ts";
import type { Provider } from "../system.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

type Meta = { description: string };
const { permission } = createPermissionFactory<Meta>();

const usersCreate = permission({
  metadata: { description: "Create user" },
  target: target.none(),
}).rules([]);

const usersRead = permission({
  metadata: { description: "Read user" },
  target: target.required("user"),
  fetch: ([id]) => Promise.resolve({ id }),
}).rules([
  match("user", (v) => v),
  filter((v) => v),
]);

const badgeRead = permission({
  metadata: { description: "Read badge" },
  target: target.path("exposition", "badge"),
  fetch: ([e, b]) => Promise.resolve({ exposition: e, badge: b }),
}).rules([
  match("exposition", (v) => v.exposition),
  match("badge", (v) => v.badge),
]);

const schema = {
  "users.create": usersCreate,
  "users.read": usersRead,
  "expositions.badges.read": badgeRead,
};

async function granted(sys: ReturnType<typeof createSystem<Meta>>, ...args: Parameters<ReturnType<typeof createSystem<Meta>>["can"]>): Promise<boolean> {
  const r = await sys.can(...args);
  return r.ok;
}

Deno.test("can() — no provider denies everything", async () => {
  const sys = createSystem<Meta>({ schema });
  assertEq(await granted(sys, { id: "user:1" }, "users.create"), false);
});

Deno.test("can() — direct grant from provider", async () => {
  const provider: Provider = () => [{ key: "users.create" }];
  const sys = createSystem<Meta>({ schema, providers: [provider] });
  assertEq(await granted(sys, { id: "user:1" }, "users.create"), true);
});

Deno.test("can() — grant with specific target", async () => {
  const provider: Provider = () => [
    { key: "users.read", target: ["user:42"] },
  ];
  const sys = createSystem<Meta>({ schema, providers: [provider] });
  assertEq(await granted(sys, { id: "user:1" }, "users.read", ["user:42"]), true);
  assertEq(await granted(sys, { id: "user:1" }, "users.read", ["user:99"]), false);
});

Deno.test("can() — grant without target = implicit wildcard", async () => {
  const provider: Provider = () => [{ key: "users.read" }];
  const sys = createSystem<Meta>({ schema, providers: [provider] });
  assertEq(await granted(sys, { id: "user:1" }, "users.read", ["user:99"]), true);
});

Deno.test("can() — wildcard 'user:*' in grant target", async () => {
  const provider: Provider = () => [
    { key: "users.read", target: ["user:*"] },
  ];
  const sys = createSystem<Meta>({ schema, providers: [provider] });
  assertEq(await granted(sys, { id: "user:1" }, "users.read", ["user:42"]), true);
  assertEq(await granted(sys, { id: "user:1" }, "users.read", ["badge:42"]), false);
});

Deno.test("can() — tuple target match", async () => {
  const provider: Provider = () => [
    { key: "expositions.badges.read", target: ["exposition:1", "badge:*"] },
  ];
  const sys = createSystem<Meta>({ schema, providers: [provider] });
  assertEq(
    await granted(sys, { id: "user:1" }, "expositions.badges.read", [
      "exposition:1",
      "badge:42",
    ]),
    true,
  );
  assertEq(
    await granted(sys, { id: "user:1" }, "expositions.badges.read", [
      "exposition:2",
      "badge:42",
    ]),
    false,
  );
});

Deno.test("can() — multiple providers OR-combined", async () => {
  const p1: Provider = () => [];
  const p2: Provider = () => [{ key: "users.create" }];
  const sys = createSystem<Meta>({ schema, providers: [p1, p2] });
  assertEq(await granted(sys, { id: "user:1" }, "users.create"), true);
});

Deno.test("can() — unknown key denies", async () => {
  const provider: Provider = () => [{ key: "nope.nope" }];
  const sys = createSystem<Meta>({ schema, providers: [provider] });
  assertEq(await granted(sys, { id: "user:1" }, "nope.nope"), false);
});

Deno.test("can() — provider receives subject + key + target", async () => {
  let received: unknown;
  const provider: Provider = (subject, key, target) => {
    received = { subject, key, target };
    return [];
  };
  const sys = createSystem<Meta>({ schema, providers: [provider] });
  await sys.can({ id: "user:1" }, "users.read", ["user:42"]);
  assertEq(received, {
    subject: { id: "user:1" },
    key: "users.read",
    target: ["user:42"],
  });
});

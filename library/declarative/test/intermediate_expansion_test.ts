import { createSystem } from "../system.ts";
import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";
import type { Provider } from "../system.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

type Meta = { description: string };
const { permission, intermediate } = createPermissionFactory<Meta>();

const userRead = permission({
  metadata: { description: "Read" },
  target: target.none(),
}).rules([]);

const userCreate = permission({
  metadata: { description: "Create" },
  target: target.none(),
}).rules([]);

const userDelete = permission({
  metadata: { description: "Delete" },
  target: target.none(),
}).rules([]);

const usersManage = intermediate({
  metadata: { description: "Manage users" },
  target: target.none(),
  expandsTo: (grant) => [
    { ...grant, key: "users.read" },
    { ...grant, key: "users.create" },
    { ...grant, key: "users.delete" },
  ],
}).rules([]);

const schema = {
  "users.read": userRead,
  "users.create": userCreate,
  "users.delete": userDelete,
  "users.manage": usersManage,
};

Deno.test("intermediate grant — `users.manage` grants all keys it expands to", async () => {
  const provider: Provider = () => [{ id: "g", key: "users.manage" }];
  const sys = createSystem<Meta>({ schema, providers: [provider] });

  assertEq((await sys.can({ id: "u" }, "users.read")).ok, true);
  assertEq((await sys.can({ id: "u" }, "users.create")).ok, true);
  assertEq((await sys.can({ id: "u" }, "users.delete")).ok, true);
});

Deno.test("intermediate grant — direct check on the intermediate key works", async () => {
  const provider: Provider = () => [{ id: "g", key: "users.manage" }];
  const sys = createSystem<Meta>({ schema, providers: [provider] });

  assertEq((await sys.can({ id: "u" }, "users.manage")).ok, true);
});

Deno.test("intermediate grant — does NOT grant unrelated keys", async () => {
  const otherKey = permission({ metadata: { description: "" }, target: target.none() }).rules([]);
  const provider: Provider = () => [{ id: "g", key: "users.manage" }];
  const sys = createSystem<Meta>({
    schema: { ...schema, "other.thing": otherKey },
    providers: [provider],
  });
  assertEq((await sys.can({ id: "u" }, "other.thing")).ok, false);
});

Deno.test("intermediate grant — leaf grants still work alongside", async () => {
  const provider: Provider = () => [{ id: "leaf", key: "users.read" }];
  const sys = createSystem<Meta>({ schema, providers: [provider] });
  assertEq((await sys.can({ id: "u" }, "users.read")).ok, true);
  assertEq((await sys.can({ id: "u" }, "users.create")).ok, false);
});

Deno.test("intermediate expandsTo target rewrite — covers tuple children", async () => {
  const expoRead = permission({
    metadata: { description: "Read expo" },
    target: target.required("exposition"),
  }).rules([]);
  const badgeRead = permission({
    metadata: { description: "Read badge" },
    target: target.path("exposition", "badge"),
  }).rules([]);

  const expoManage = intermediate({
    metadata: { description: "Manage expo" },
    target: target.required("exposition"),
    expandsTo: (grant) => {
      const expoTarget = Array.isArray(grant.target) ? grant.target : [grant.target];
      const expoId = expoTarget[0] ?? "exposition:*";
      return [
        { ...grant, key: "expositions.read", target: [expoId] },
        { ...grant, key: "expositions.badges.read", target: [expoId, "badge:*"] },
      ];
    },
  }).rules([]);

  const provider: Provider = () => [
    { id: "g", key: "expositions.manage", target: ["exposition:1"] },
  ];

  const sys = createSystem<Meta>({
    schema: {
      "expositions.read": expoRead,
      "expositions.badges.read": badgeRead,
      "expositions.manage": expoManage,
    },
    providers: [provider],
  });

  assertEq(
    (await sys.can({ id: "u" }, "expositions.read", ["exposition:1"])).ok,
    true,
  );
  assertEq(
    (await sys.can(
      { id: "u" },
      "expositions.badges.read",
      ["exposition:1", "badge:42"],
    )).ok,
    true,
  );
  assertEq(
    (await sys.can(
      { id: "u" },
      "expositions.badges.read",
      ["exposition:2", "badge:42"],
    )).ok,
    false,
  );
});

import { test } from "node:test";
import {
  ALL,
  action,
  createSystem,
  entity,
  type Grant,
  permissions,
} from "../mod.ts";
import { assert, assertEquals } from "./+assert.ts";

type UserDoc = {
  readonly _id: string;
  readonly firstname: string;
  readonly lastname: string;
  readonly email: string;
  readonly phone: string;
};

const romain: UserDoc = {
  _id: "user:romain",
  firstname: "Romain",
  lastname: "Doe",
  email: "romain@example.com",
  phone: "0600",
};

function usersSet() {
  const user = entity("user", { load: (): UserDoc => ({ ...romain }) });
  return permissions(user, "users", { read: action({ fields: "doc" }) });
}

type UsersSet = ReturnType<typeof usersSet>;

function readAs(users: UsersSet, grants: readonly Grant[]) {
  const system = createSystem({
    permissions: [users],
    providers: [() => grants],
  });
  return system
    .context({ subject: { id: "s" } })
    .check("users.read", "user:romain");
}

test("filter union: any grant without fields exposes all fields", async () => {
  const users = usersSet();
  const result = await readAs(users, [
    users.grant("read", { id: "self", on: "user:romain" }),
    users.grant("read", {
      id: "manage",
      on: ALL,
      fields: { _id: true, firstname: true },
    }),
  ]);
  assert(result.ok);
  assertEquals(result.doc, romain);
});

test("filter union: all grants with fields give the union of fields", async () => {
  const users = usersSet();
  const result = await readAs(users, [
    users.grant("read", {
      id: "g1",
      on: ALL,
      fields: { _id: true, firstname: true },
    }),
    users.grant("read", {
      id: "g2",
      on: ALL,
      fields: { lastname: true, email: true },
    }),
  ]);
  assert(result.ok);
  assertEquals(result.doc, {
    _id: "user:romain",
    firstname: "Romain",
    lastname: "Doe",
    email: "romain@example.com",
  });
});

test("filter union: a single grant with fields projects normally", async () => {
  const users = usersSet();
  const result = await readAs(users, [
    users.grant("read", {
      id: "g",
      on: ALL,
      fields: { firstname: true, lastname: true },
    }),
  ]);
  assert(result.ok);
  assertEquals(result.doc, { firstname: "Romain", lastname: "Doe" });
});

test("filter union: order-independent, manage-then-self vs self-then-manage", async () => {
  const orders: readonly (readonly ["self" | "manage", "self" | "manage"])[] = [
    ["self", "manage"],
    ["manage", "self"],
  ];
  for (const order of orders) {
    const users = usersSet();
    const grants = order.map((kind) =>
      kind === "self"
        ? users.grant("read", { id: "self", on: "user:romain" })
        : users.grant("read", {
            id: "manage",
            on: ALL,
            fields: { _id: true, firstname: true },
          }),
    );
    const result = await readAs(users, grants);
    assert(result.ok);
    assertEquals(
      result.doc,
      romain,
      `Order ${order.join(" then ")} should yield the full user`,
    );
  }
});

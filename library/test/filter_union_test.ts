/**
 * Cross-grant filter union: when multiple grants match the same doc, the
 * user must see the most permissive projection. The system unions every
 * matched grant's `filterSpec`. Any grant without a `filter` collapses
 * the union to "all fields".
 */

import { assertEquals } from "jsr:@std/assert";
import {
  createSystem,
  permission,
  type Provider,
  resource,
  target,
} from "../mod.ts";

const userOf = resource({
  id: "user",
  fetch: () => ({
    _id: "user:romain",
    firstname: "Romain",
    lastname: "Doe",
    email: "romain@example.com",
    phone: "0600",
  }),
  dedupKey: ({ target }) => target[0] as string,
});

Deno.test("filter union: any unfiltered grant exposes all fields", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
        userOf.filter(),
      ]),
    },
    providers: [() => [
      // Self grant: no filter (full access).
      { id: "self", key: "users.read", target: ["user:romain"] },
      // Manage grant: filter restricts to {_id, firstname}.
      {
        id: "manage",
        key: "users.read",
        target: ["user:*"],
        filter: { _id: true, firstname: true } as Record<string, boolean>,
      },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:romain"],
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.data, {
      _id: "user:romain",
      firstname: "Romain",
      lastname: "Doe",
      email: "romain@example.com",
      phone: "0600",
    });
  }
});

Deno.test("filter union: all grants filtered → union of fields", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
        userOf.filter(),
      ]),
    },
    providers: [() => [
      {
        id: "g1",
        key: "users.read",
        target: ["user:*"],
        filter: { _id: true, firstname: true } as Record<string, boolean>,
      },
      {
        id: "g2",
        key: "users.read",
        target: ["user:*"],
        filter: { lastname: true, email: true } as Record<string, boolean>,
      },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:romain"],
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.data, {
      _id: "user:romain",
      firstname: "Romain",
      lastname: "Doe",
      email: "romain@example.com",
    });
  }
});

Deno.test("filter union: single filtered grant projects normally", async () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
        userOf.filter(),
      ]),
    },
    providers: [() => [
      {
        id: "g",
        key: "users.read",
        target: ["user:*"],
        filter: { firstname: true, lastname: true } as Record<string, boolean>,
      },
    ]],
  });
  const r = await sys.context({ subject: { id: "s" } }).can(
    "users.read",
    ["user:romain"],
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.data, { firstname: "Romain", lastname: "Doe" });
  }
});

Deno.test("filter union: order-independent — manage-then-self vs self-then-manage", async () => {
  const buildProviders = (
    order: ["self" | "manage", "self" | "manage"],
  ): Provider[] =>
    [() => order.map((kind) =>
      kind === "self"
        ? { id: "self", key: "users.read", target: ["user:romain"] }
        : {
          id: "manage",
          key: "users.read",
          target: ["user:*"],
          filter: { _id: true, firstname: true } as Record<string, boolean>,
        }
    )];

  const orders: Array<["self" | "manage", "self" | "manage"]> = [
    ["self", "manage"],
    ["manage", "self"],
  ];
  for (const order of orders) {
    const sys = createSystem({
      schema: {
        "users.read": permission({ target: target.required("user") }).rules([
          userOf.match(),
          userOf.filter(),
        ]),
      },
      providers: buildProviders(order),
    });
    const r = await sys.context({ subject: { id: "s" } }).can(
      "users.read",
      ["user:romain"],
    );
    assertEquals(r.ok, true);
    if (r.ok) {
      // Same result regardless of grant order: all fields visible.
      assertEquals(
        r.data,
        {
          _id: "user:romain",
          firstname: "Romain",
          lastname: "Doe",
          email: "romain@example.com",
          phone: "0600",
        },
        `Order ${order.join("→")} should yield full user`,
      );
    }
  }
});

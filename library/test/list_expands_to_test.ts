/**
 * `system.list()` and `system.tree()` expose `expandsTo: string[]` on
 * intermediate entries — the transitive set of leaf keys an intermediate
 * grant effectively unlocks. This test pins the public contract :
 *
 *  - leaves : no `expandsTo` field
 *  - intermediates : `expandsTo` listing only leaves (sub-intermediates
 *    are flattened through)
 *  - cycles : broken via `visited` set (no infinite loop)
 *  - stub-throw : silently dropped, rest of the tree still resolves
 *  - deduplication : same leaf via two paths appears once
 */

import { assertEquals } from "jsr:@std/assert";
import { createSystem } from "../system.ts";
import { intermediate, permission } from "../permission.ts";
import { target } from "../target.ts";

Deno.test("list().expandsTo : flattens sub-intermediates to leaves only", () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([]),
      "users.update": permission({ target: target.required("user") }).rules([]),
      "users.delete": permission({ target: target.required("user") }).rules([]),
      "users.list": intermediate({
        target: target.required("user"),
        expandsTo: (g) => [{ ...g, key: "users.read" }],
      }).rules([]),
      "users.manage": intermediate({
        target: target.required("user"),
        expandsTo: (g) => [
          { ...g, key: "users.list" },     // → users.read via expansion
          { ...g, key: "users.update" },
          { ...g, key: "users.delete" },
        ],
      }).rules([]),
    },
  });

  const entries = sys.list();
  const byKey = new Map(entries.map((e) => [e.key, e]));

  // Leaves : no expandsTo field at all
  assertEquals(byKey.get("users.read")!.expandsTo, undefined);
  assertEquals(byKey.get("users.update")!.expandsTo, undefined);

  // users.list : 1-hop, just users.read
  assertEquals(
    [...(byKey.get("users.list")!.expandsTo ?? [])].sort(),
    ["users.read"],
  );

  // users.manage : 2-hop transitive — users.list flattens to users.read,
  // and intermediates themselves are NOT in the descendants list (leaves only).
  assertEquals(
    [...(byKey.get("users.manage")!.expandsTo ?? [])].sort(),
    ["users.delete", "users.read", "users.update"],
  );
});

Deno.test("list().expandsTo : cycle detection", () => {
  // Pathological loop: A.bundle expandsTo B.bundle which expandsTo A.bundle.
  // The `visited` set must break the cycle. Both should resolve their
  // leaf `endpoint.read`.
  const sys = createSystem({
    schema: {
      "endpoint.read": permission({ target: target.required("endpoint") })
        .rules([]),
      "a.bundle": intermediate({
        target: target.required("endpoint"),
        expandsTo: (g) => [
          { ...g, key: "b.bundle" },
          { ...g, key: "endpoint.read" },
        ],
      }).rules([]),
      "b.bundle": intermediate({
        target: target.required("endpoint"),
        expandsTo: (g) => [
          { ...g, key: "a.bundle" },
          { ...g, key: "endpoint.read" },
        ],
      }).rules([]),
    },
  });

  const entries = sys.list();
  const byKey = new Map(entries.map((e) => [e.key, e]));
  assertEquals([...(byKey.get("a.bundle")!.expandsTo ?? [])].sort(), [
    "endpoint.read",
  ]);
  assertEquals([...(byKey.get("b.bundle")!.expandsTo ?? [])].sort(), [
    "endpoint.read",
  ]);
});

Deno.test("list().expandsTo : deduplicates leaves reached via multiple paths", () => {
  const sys = createSystem({
    schema: {
      "leaf.x": permission({ target: target.required("x") }).rules([]),
      "mid.a": intermediate({
        target: target.required("x"),
        expandsTo: (g) => [{ ...g, key: "leaf.x" }],
      }).rules([]),
      "mid.b": intermediate({
        target: target.required("x"),
        expandsTo: (g) => [{ ...g, key: "leaf.x" }],
      }).rules([]),
      "root": intermediate({
        target: target.required("x"),
        expandsTo: (g) => [
          { ...g, key: "mid.a" },
          { ...g, key: "mid.b" },
          { ...g, key: "leaf.x" },
        ],
      }).rules([]),
    },
  });

  const root = sys.list().find((e) => e.key === "root")!;
  // leaf.x reachable via 3 paths — emitted exactly once.
  assertEquals([...(root.expandsTo ?? [])], ["leaf.x"]);
});

Deno.test("list().expandsTo : path-targets get arity-matched wildcard stub", () => {
  // Without arity-matched stubs, an `expandsTo` that synthesizes a child
  // target via `grant.target![0]` would crash. The lib's `stubTargetFor`
  // emits ["*", "*"] for a 2-segment path so callbacks work as-is.
  const sys = createSystem({
    schema: {
      "expo.entity.read": permission({
        target: target.path("expo", "entity"),
      }).rules([]),
      "expo.manage": intermediate({
        target: target.required("expo"),
        expandsTo: (g) => [
          {
            ...g,
            key: "expo.entity.read",
            target: [g.target![0], "entity:*"],
          },
        ],
      }).rules([]),
    },
  });

  const root = sys.list().find((e) => e.key === "expo.manage")!;
  assertEquals([...(root.expandsTo ?? [])], ["expo.entity.read"]);
});

Deno.test("tree() : intermediate leaves carry expandsTo, groups do not", () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([]),
      "users.manage": intermediate({
        target: target.required("user"),
        expandsTo: (g) => [{ ...g, key: "users.read" }],
      }).rules([]),
    },
  });

  const tree = sys.tree();
  const usersGroup = tree.children["users"];
  if (usersGroup.kind !== "group") throw new Error("users should be a group");
  const manage = usersGroup.children["manage"];
  if (manage.kind !== "intermediate") {
    throw new Error("users.manage should be intermediate");
  }
  assertEquals([...(manage.expandsTo ?? [])], ["users.read"]);

  const read = usersGroup.children["read"];
  if (read.kind !== "permission") throw new Error("users.read should be leaf");
  assertEquals(read.expandsTo, undefined);
});

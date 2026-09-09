/**
 * Capability query : la request target contient des wildcards
 * (`["role:*"]`, `["expo:*", "badge:*"]`, etc.). Dans ce mode, la
 * resource ne peut pas être fetchée (id concret manquant), donc
 * le système skip les fetches et les rules fail-deny les contraintes
 * non-vérifiables. Sémantique : "ai-je au moins un grant en principe ?"
 */

import { test } from "node:test";
import { assertEquals } from "./+assert.ts";
import { createSystem, permission, resource, target } from "../mod.ts";

test("capability query : ne déclenche PAS le fetch (wildcard target)", async () => {
  let fetches = 0;
  const roleOf = resource({
    id: "role",
    fetch: ({ target }) => {
      fetches++;
      const id = target[0] as string;
      // Simule un repo qui throw si id n'existe pas — exactement le
      // scénario qui crashait dans Diivento.
      if (id === "role:*") throw new Error(`Role not found: ${id}`);
      return { _id: id };
    },
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "roles.read": permission({ target: target.required("role") }).rules([
        roleOf.match(),
        roleOf.filter(),
      ]),
    },
    providers: [() => [{ key: "roles.read", target: ["role:*"] }]],
  });

  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("roles.read", ["role:*"]);
  assertEquals(r.ok, true);
  assertEquals(fetches, 0);
});

test("capability query : match avec spec → ok + constraint exposed for pushdown", async () => {
  const roleOf = resource({
    id: "role",
    fetch: () => ({ _id: "role:concrete", level: "admin" }),
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "roles.read": permission({ target: target.required("role") }).rules([
        roleOf.match(),
      ]),
    },
    providers: [
      () => [
        {
          key: "roles.read",
          target: ["role:*"],
          with: { role: { level: "admin" } },
        },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("roles.read", ["role:*"]);
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.constraints, { level: "admin" });
  }
});

test("capability query : grant sans contraintes ⇒ ok (matrix UI use-case)", async () => {
  const roleOf = resource({
    id: "role",
    fetch: () => {
      throw new Error("should not be called in capability mode");
    },
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "roles.update": permission({ target: target.required("role") }).rules([
        roleOf.match(),
        roleOf.filter(),
      ]),
    },
    providers: [
      () => [
        // Grant simple, sans with/flags → match passe silent, filter passe silent
        { key: "roles.update", target: ["role:*"] },
      ],
    ],
  });

  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("roles.update", ["role:*"]);
  assertEquals(r.ok, true);
});

test("capability query : require* DENY (need de la ressource)", async () => {
  const articleOf = resource({
    id: "article",
    fetch: () => ({ _id: "a", authorId: "user:1" }),
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "articles.update": permission({
        target: target.required("article"),
      }).rules([
        articleOf.match(),
        articleOf.requireOwner((a) => a.authorId, { flag: "ownerOnly" }),
      ]),
    },
    providers: [
      () => [
        {
          key: "articles.update",
          target: ["article:*"],
          flags: { ownerOnly: true },
        },
      ],
    ],
  });

  // Capability query avec un grant qui exige owner → DENY (cannot verify)
  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("articles.update", ["article:*"]);
  assertEquals(r.ok, false);
});

test("non-capability query : fetch et match marchent normalement", async () => {
  let fetches = 0;
  const roleOf = resource({
    id: "role",
    fetch: ({ target }) => {
      fetches++;
      return { _id: target[0], level: "admin" };
    },
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "roles.read": permission({ target: target.required("role") }).rules([
        roleOf.match(),
      ]),
    },
    providers: [
      () => [
        {
          key: "roles.read",
          target: ["role:*"],
          with: { role: { level: "admin" } },
        },
      ],
    ],
  });

  // Target concret (pas wildcard) → fetch + check normal
  const r = await sys
    .context({ subject: { id: "user:1" } })
    .can("roles.read", ["role:r1"]);
  assertEquals(r.ok, true);
  assertEquals(fetches, 1);
});

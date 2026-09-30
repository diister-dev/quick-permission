/**
 * Tests for the catalog introspection API : `System.indirectResources()`
 * and `System.indirectsUsedBy(key)`. These methods exist so consumers
 * (matrix UI / catalog endpoints) can enumerate indirect resources without
 * walking every permission's rules manually.
 */

import { test } from "node:test";
import { assertEquals } from "./+assert.ts";
import {
  createSystem,
  indirectResource,
  intermediate,
  permission,
  resource,
  target,
} from "../mod.ts";

const participantOf = resource({
  id: "participant",
  fetch: () => ({ _id: "stub" }),
  dedupKey: ({ target }) => target.join("::"),
});

const userOf = resource({
  id: "user",
  fetch: () => ({ _id: "stub" }),
  dedupKey: ({ target }) => target.join("::"),
});

const membershipsOfParticipant = indirectResource({
  id: "memberships_of_participant",
  from: participantOf,
  on: { localField: "_id", foreignField: "participantId" },
  to: { _type: "org_membership" },
  cardinality: "many",
});

const usersOfParticipant = indirectResource({
  id: "users_of_participant",
  from: participantOf,
  on: {
    localField: "userId",
    foreignField: "_id",
    foreignCollection: "users",
  },
  to: { _type: "user" },
  cardinality: "one",
});

test("indirectResources : empty when no indirect rule", () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
  });
  assertEquals(sys.indirectResources(), []);
});

test("indirectResources : returns serialized info", () => {
  const sys = createSystem({
    schema: {
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([participantOf.match(), membershipsOfParticipant.match()]),
    },
  });

  const indirects = sys.indirectResources();
  assertEquals(indirects.length, 1);
  assertEquals(indirects[0], {
    id: "memberships_of_participant",
    kind: "indirect",
    from: { id: "participant", kind: "direct" },
    on: { localField: "_id", foreignField: "participantId" },
    to: { _type: "org_membership" },
    cardinality: "many",
  });
});

test("indirectResources : deduplicates across permissions", () => {
  const sys = createSystem({
    schema: {
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([membershipsOfParticipant.match()]),
      "expositions.participants.read": permission({
        target: target.path("exposition", "participant"),
      }).rules([membershipsOfParticipant.match()]),
    },
  });

  // Same `id` referenced twice → one entry, not two.
  assertEquals(sys.indirectResources().length, 1);
});

test("indirectResources : preserves foreignCollection when set", () => {
  const sys = createSystem({
    schema: {
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([usersOfParticipant.match()]),
    },
  });

  const [info] = sys.indirectResources();
  assertEquals(info.on.foreignCollection, "users");
});

test("indirectResources : reports both when multiple distinct ids", () => {
  const sys = createSystem({
    schema: {
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([membershipsOfParticipant.match(), usersOfParticipant.match()]),
    },
  });

  const ids = sys
    .indirectResources()
    .map((r) => r.id)
    .sort();
  assertEquals(ids, ["memberships_of_participant", "users_of_participant"]);
});

test("indirectsUsedBy : empty for unknown key", () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
  });
  assertEquals(sys.indirectsUsedBy("nope.unknown"), []);
});

test("indirectsUsedBy : empty when permission has no indirect rule", () => {
  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
  });
  assertEquals(sys.indirectsUsedBy("users.read"), []);
});

test("indirectsUsedBy : scoped per permission", () => {
  const sys = createSystem({
    schema: {
      "expositions.participants.list": permission({
        target: target.path("exposition", "participant"),
      }).rules([membershipsOfParticipant.match()]),
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
  });

  assertEquals(
    sys.indirectsUsedBy("expositions.participants.list").map((r) => r.id),
    ["memberships_of_participant"],
  );
  assertEquals(sys.indirectsUsedBy("users.read"), []);
});

test("indirectsUsedBy : includes indirect from `intermediate` rules", () => {
  // Rules on an intermediate are evaluated only when the macro itself is
  // checked. The introspection should still surface them — the matrix UI
  // shows editors based on what the key declares, regardless of how a
  // grant actually flows through.
  const sys = createSystem({
    schema: {
      "expositions.participants.read": permission({
        target: target.path("exposition", "participant"),
      }).rules([]),
      "expositions.participants.list": intermediate({
        target: target.path("exposition", "participant"),
        expandsTo: (g) => [{ ...g, key: "expositions.participants.read" }],
      }).rules([membershipsOfParticipant.match()]),
    },
  });

  assertEquals(
    sys.indirectsUsedBy("expositions.participants.list").map((r) => r.id),
    ["memberships_of_participant"],
  );
});

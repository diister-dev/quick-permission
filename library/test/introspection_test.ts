import { test } from "node:test";
import {
  type AnyPermissionSet,
  action,
  createSystem,
  entity,
  list,
  permissions,
} from "../mod.ts";
import { assertEquals } from "./+assert.ts";

const membershipsRelation = {
  id: "memberships_of_participant",
  localField: "_id",
  foreignField: "participantId",
  only: { _type: "org_membership" },
  load: (): readonly unknown[] => [],
};

const usersRelation = {
  id: "users_of_participant",
  localField: "userId",
  foreignField: "_id",
  foreignCollection: "users",
  only: { _type: "user" },
  load: (): readonly unknown[] => [],
};

const user = entity("user", { load: (): { _id: string } => ({ _id: "stub" }) });
const users = permissions(user, "users", { read: action() });

const exposition = entity("exposition", {});

function relatedOf(sets: readonly AnyPermissionSet[], key: string) {
  const entry = createSystem({ permissions: sets })
    .catalog()
    .find((item) => item.key === key);
  return entry?.accepts.related ?? [];
}

function relationsUsedBy(
  sets: readonly AnyPermissionSet[],
  key: string,
): readonly string[] {
  return relatedOf(sets, key).map((relation) => relation.id);
}

function relationsOf(sets: readonly AnyPermissionSet[]): readonly string[] {
  const ids = new Set<string>();
  for (const entry of createSystem({ permissions: sets }).catalog()) {
    for (const relation of entry.accepts.related) ids.add(relation.id);
  }
  return [...ids];
}

test("relations: empty when no entity declares one", () => {
  assertEquals(relationsOf([users]), []);
});

test("relations: returns serialized info", () => {
  const participant = exposition.child("participant", {
    load: (): { _id: string } => ({ _id: "stub" }),
    relations: { memberships: membershipsRelation },
  });
  const participants = permissions(participant, "expositions.participants", {
    list: action(),
  });
  const related = relatedOf([participants], "expositions.participants.list");
  assertEquals(related.length, 1);
  assertEquals(related[0], {
    name: "memberships",
    id: "memberships_of_participant",
    localField: "_id",
    foreignField: "participantId",
    only: { _type: "org_membership" },
  });
});

test("relations: deduplicated across keys", () => {
  const participant = exposition.child("participant", {
    load: (): { _id: string } => ({ _id: "stub" }),
    relations: { memberships: membershipsRelation },
  });
  const participants = permissions(participant, "expositions.participants", {
    read: action(),
    list: list("read"),
  });
  assertEquals(relationsOf([participants]).length, 1);
});

test("relations: preserves foreignCollection when set", () => {
  const participant = exposition.child("participant", {
    load: (): { _id: string; userId: string } => ({
      _id: "stub",
      userId: "user:stub",
    }),
    relations: { users: usersRelation },
  });
  const participants = permissions(participant, "expositions.participants", {
    list: action(),
  });
  const [info] = relatedOf([participants], "expositions.participants.list");
  assertEquals(info.collection, "users");
});

test("relations: reports both when an entity declares two", () => {
  const participant = exposition.child("participant", {
    load: (): { _id: string; userId: string } => ({
      _id: "stub",
      userId: "user:stub",
    }),
    relations: { memberships: membershipsRelation, users: usersRelation },
  });
  const participants = permissions(participant, "expositions.participants", {
    list: action(),
  });
  assertEquals([...relationsOf([participants])].sort(), [
    "memberships_of_participant",
    "users_of_participant",
  ]);
});

test("relations used by a key: empty for an unknown key", () => {
  assertEquals(relationsUsedBy([users], "nope.unknown"), []);
});

test("relations used by a key: empty when the key's entity has no relation", () => {
  assertEquals(relationsUsedBy([users], "users.read"), []);
});

test("relations used by a key: scoped per key", () => {
  const participant = exposition.child("participant", {
    load: (): { _id: string } => ({ _id: "stub" }),
    relations: { memberships: membershipsRelation },
  });
  const participants = permissions(participant, "expositions.participants", {
    list: action(),
  });
  const sets = [participants, users];
  assertEquals(relationsUsedBy(sets, "expositions.participants.list"), [
    "memberships_of_participant",
  ]);
  assertEquals(relationsUsedBy(sets, "users.read"), []);
});

test("relations used by a key: a list key reports the relations of its entity", () => {
  const participant = exposition.child("participant", {
    load: (): { _id: string } => ({ _id: "stub" }),
    relations: { memberships: membershipsRelation },
  });
  const participants = permissions(participant, "expositions.participants", {
    read: action(),
    list: list("read"),
  });
  assertEquals(
    relationsUsedBy([participants], "expositions.participants.list"),
    ["memberships_of_participant"],
  );
});

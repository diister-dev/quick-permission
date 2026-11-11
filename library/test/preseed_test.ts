import { test } from "node:test";
import { ALL, action, createSystem, entity, permissions } from "../mod.ts";
import { assertEquals } from "./+assert.ts";

type UserDoc = { readonly _id: string; readonly role: string };

type MembershipDoc = {
  readonly _id: string;
  readonly orgId: string;
  readonly status: string;
};

function userSystem() {
  let fetchCount = 0;
  const user = entity<UserDoc>("user", {
    load: (id) => {
      fetchCount += 1;
      return { _id: id, role: "admin" };
    },
  });
  const users = permissions(user, "users", { read: action() });
  const sys = createSystem({
    permissions: [users],
    providers: [
      () => [
        users.grant("read", { id: "g", on: ALL, where: { role: "admin" } }),
      ],
    ],
  });
  return { user, sys, fetches: () => fetchCount };
}

test("seed: a seeded document is not loaded again", async () => {
  const { user, sys, fetches } = userSystem();
  const ctx = sys.context({ subject: { id: "user:s" } });
  const preloaded: UserDoc[] = [
    { _id: "user:1", role: "admin" },
    { _id: "user:2", role: "admin" },
    { _id: "user:3", role: "admin" },
  ];
  ctx.seed(user, preloaded);

  for (const doc of preloaded) {
    const result = await ctx.check("users.read", doc._id);
    assertEquals(result.ok, true);
  }

  assertEquals(fetches(), 0, "no load should happen when seeded");
});

test("seed: a seeded document under another id does not answer for the asked one", async () => {
  const { user, sys, fetches } = userSystem();
  const ctx = sys.context({ subject: { id: "user:s" } });
  ctx.seed(user, [{ _id: "wrong-prefix:1", role: "admin" }]);

  await ctx.check("users.read", "user:1");
  assertEquals(fetches(), 1, "seed missed, load happened");
});

test("seed: a relation denies a single read when no joined document matches", async () => {
  const participant = entity<{ readonly _id: string }, "memberships">(
    "participant",
    {
      load: (id) => ({ _id: id }),
      relations: {
        memberships: {
          localField: "_id",
          foreignField: "participantId",
          load: (): MembershipDoc[] => [
            { _id: "om:1", orgId: "org:globex", status: "active" },
          ],
        },
      },
    },
  );
  const participants = permissions(participant, "participants", {
    read: action(),
  });
  const sys = createSystem({
    permissions: [participants],
    providers: [
      () => [
        participants.grant("read", {
          id: "g",
          on: ALL,
          related: { memberships: { orgId: "org:beta", status: "active" } },
        }),
      ],
    ],
  });

  const result = await sys
    .context({ subject: { id: "user:s" } })
    .check("participants.read", "participant:p1");
  assertEquals(result.ok, false, "grant denied, no membership matches Beta");
});

test("seedRelated: seeded joined rows are not loaded again", async () => {
  let participantLoads = 0;
  let relatedLoads = 0;
  const participant = entity<{ readonly _id: string }, "memberships">(
    "participant",
    {
      load: (id) => {
        participantLoads += 1;
        return { _id: id };
      },
      relations: {
        memberships: {
          localField: "_id",
          foreignField: "participantId",
          load: (): MembershipDoc[] => {
            relatedLoads += 1;
            return [{ _id: "om:1", orgId: "org:beta", status: "active" }];
          },
        },
      },
    },
  );
  const participants = permissions(participant, "participants", {
    read: action(),
  });
  const sys = createSystem({
    permissions: [participants],
    providers: [
      () => [
        participants.grant("read", {
          id: "g",
          on: ALL,
          related: { memberships: { orgId: "org:beta", status: "active" } },
        }),
      ],
    ],
  });

  const ctx = sys.context({ subject: { id: "user:s" } });
  const docs = [
    {
      _id: "participant:p1",
      _memberships_of_participant: [
        { _id: "om:1", orgId: "org:beta", status: "active" },
      ],
    },
  ];
  for (const doc of docs) {
    ctx.seedRelated(
      participant,
      "memberships",
      doc._memberships_of_participant,
      doc._id,
    );
  }
  ctx.seed(
    participant,
    docs.map((doc) => ({ _id: doc._id })),
  );

  const result = await ctx.check("participants.read", "participant:p1");
  assertEquals(result.ok, true);
  assertEquals(relatedLoads, 0, "related load skipped via seedRelated");
  assertEquals(participantLoads, 0, "document load skipped via seed");
});

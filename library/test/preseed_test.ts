/**
 * Tests for `CanContext.preseed()` — inject pre-loaded docs into the
 * resource cache to avoid N+1 fetches during paginated projection
 * (`listWithPermission` pattern).
 *
 * Covers :
 *  - Direct resource preseed (single doc per cache key)
 *  - Indirect resource preseed (with `value` extractor for joined docs)
 *  - Mixed scenario : direct + indirect preseed together
 *  - Cache miss when `dedupKey` doesn't match the resource's runtime
 *    dedupKey (silently, by design — caller mistake)
 *  - Indirect concrete-mode evaluation with fetcher
 */

import { assertEquals } from "jsr:@std/assert";
import {
  createSystem,
  indirectResource,
  permission,
  resource,
  target,
} from "../mod.ts";

interface UserDoc {
  readonly _id: string;
  readonly role: string;
}

interface MembershipDoc {
  readonly _id: string;
  readonly userId: string;
  readonly orgId: string;
  readonly status: string;
}

Deno.test("preseed: direct resource skips fetch when cache is hit", async () => {
  let fetchCount = 0;
  const userOf = resource({
    id: "user",
    fetch: ({ target }) => {
      fetchCount += 1;
      return { _id: target[0] as string, role: "admin" };
    },
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [
      {
        id: "g",
        key: "users.read",
        target: ["user:*"],
        with: { user: { role: "admin" } },
      },
    ]],
  });

  const ctx = sys.context({ subject: { id: "user:s" } });
  const preloaded: UserDoc[] = [
    { _id: "user:1", role: "admin" },
    { _id: "user:2", role: "admin" },
    { _id: "user:3", role: "admin" },
  ];
  ctx.preseed(userOf, preloaded, { dedupKey: (d) => [d._id] });

  for (const u of preloaded) {
    const r = await ctx.can("users.read", [u._id]);
    assertEquals(r.ok, true);
  }

  assertEquals(fetchCount, 0, "no DB fetch should happen when preseeded");
});

Deno.test("preseed: cache miss when dedupKey doesn't match runtime shape", async () => {
  let fetchCount = 0;
  const userOf = resource({
    id: "user",
    fetch: ({ target }) => {
      fetchCount += 1;
      return { _id: target[0] as string, role: "admin" };
    },
    dedupKey: ({ target }) => target[0] as string,
  });

  const sys = createSystem({
    schema: {
      "users.read": permission({ target: target.required("user") }).rules([
        userOf.match(),
      ]),
    },
    providers: [() => [
      {
        id: "g",
        key: "users.read",
        target: ["user:*"],
        with: { user: { role: "admin" } },
      },
    ]],
  });

  const ctx = sys.context({ subject: { id: "user:s" } });
  // Caller mistake : provides `wrong-prefix:1` instead of the actual
  // dedup target. Cache key won't match the runtime one → fetch happens.
  ctx.preseed(userOf, [{ _id: "user:1", role: "admin" }], {
    dedupKey: (d) => [`wrong-prefix:${d._id.split(":")[1]}`],
  });

  await ctx.can("users.read", ["user:1"]);
  assertEquals(fetchCount, 1, "preseed missed, fetch happened");
});

Deno.test("preseed: indirect resource with `value` extractor stores joined docs", async () => {
  let indirectFetchCount = 0;
  const participantOf = resource({
    id: "participant",
    fetch: ({ target }) => ({ _id: target[0] as string }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const membershipsOf = indirectResource({
    id: "memberships_of_participant",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    cardinality: "many",
    fetch: (sourceDoc) => {
      indirectFetchCount += 1;
      return [{
        _id: "om:1",
        userId: "user:1",
        orgId: "org:beta",
        status: "active",
      }];
    },
  });

  const sys = createSystem({
    schema: {
      "participants.read": permission({
        target: target.required("participant"),
      }).rules([participantOf.match(), membershipsOf.match()]),
    },
    providers: [() => [
      {
        id: "g",
        key: "participants.read",
        target: ["participant:*"],
        with: {
          memberships_of_participant: { orgId: "org:beta", status: "active" },
        },
      },
    ]],
  });

  const ctx = sys.context({ subject: { id: "user:s" } });
  // Simulate the shape of docs returned by a cap-mode list with $lookup :
  // each doc carries `_memberships_of_participant` as an array of joined docs.
  const docs = [
    {
      _id: "participant:p1",
      _memberships_of_participant: [
        { _id: "om:1", userId: "user:1", orgId: "org:beta", status: "active" },
      ],
    },
  ];
  ctx.preseed(membershipsOf, docs, {
    dedupKey: (d) => [d._id],
    value: (d) => d._memberships_of_participant,
  });
  // Also preseed the direct participant resource (otherwise it would be
  // fetched in concrete mode).
  ctx.preseed(participantOf, docs.map((d) => ({ _id: d._id })), {
    dedupKey: (d) => [d._id],
  });

  const r = await ctx.can("participants.read", ["participant:p1"]);
  assertEquals(r.ok, true);
  assertEquals(indirectFetchCount, 0, "indirect fetch skipped via preseed");
});

Deno.test("preseed: indirect concrete-mode deny when no joined doc matches spec", async () => {
  // Symmetric to cap-mode pipeline `$elemMatch` : the rule must reject
  // the grant when none of the joined docs satisfies the spec — so a
  // by-id `read` is consistent with the listing's scope.
  const participantOf = resource({
    id: "participant",
    fetch: ({ target }) => ({ _id: target[0] as string }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const membershipsOf = indirectResource({
    id: "memberships_of_participant",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    cardinality: "many",
    fetch: () => [
      { _id: "om:1", orgId: "org:globex", status: "active" }, // ← wrong org
    ],
  });

  const sys = createSystem({
    schema: {
      "participants.read": permission({
        target: target.required("participant"),
      }).rules([participantOf.match(), membershipsOf.match()]),
    },
    providers: [() => [
      {
        id: "g",
        key: "participants.read",
        target: ["participant:*"],
        with: {
          memberships_of_participant: { orgId: "org:beta", status: "active" },
        },
      },
    ]],
  });

  const r = await sys.context({ subject: { id: "user:s" } }).can(
    "participants.read",
    ["participant:p1"],
  );
  assertEquals(r.ok, false, "grant denied — no membership matches Beta");
});


Deno.test("preseed: indirect WITHOUT fetcher stays sentinel in concrete mode (legacy)", async () => {
  // Backward-compat : an indirect without a `fetch` keeps its sentinel
  // behaviour even in concrete mode. The rule passes silently — useful
  // for indirects that exist only for the cap-mode pipeline.
  const participantOf = resource({
    id: "participant",
    fetch: ({ target }) => ({ _id: target[0] as string }),
    dedupKey: ({ target }) => target[0] as string,
  });
  const membershipsOf = indirectResource({
    id: "memberships_of_participant",
    from: participantOf,
    on: { localField: "_id", foreignField: "participantId" },
    cardinality: "many",
    // no fetch !
  });

  const sys = createSystem({
    schema: {
      "participants.read": permission({
        target: target.required("participant"),
      }).rules([participantOf.match(), membershipsOf.match()]),
    },
    providers: [() => [
      {
        id: "g",
        key: "participants.read",
        target: ["participant:*"],
        with: {
          memberships_of_participant: { orgId: "org:beta" }, // ignored without fetcher
        },
      },
    ]],
  });

  const r = await sys.context({ subject: { id: "user:s" } }).can(
    "participants.read",
    ["participant:p1"],
  );
  // Sentinel → ok regardless of with content (legacy / opt-in concrete mode).
  assertEquals(r.ok, true);
});

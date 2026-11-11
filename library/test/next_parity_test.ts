import { test } from "node:test";
import {
  createSystem as createEngine,
  intermediate,
  matchPath,
  permission,
  target,
} from "../mod.ts";
import { createSystem, inputFilter } from "../next/mod.ts";
import type { CanResult, Grant } from "../types.ts";
import { assert, assertEquals } from "./+assert.ts";
import { createFixture } from "./+next_fixture.ts";

function legacySchema(fixture: ReturnType<typeof createFixture>) {
  const userOf = fixture.entities.user.resource;
  const tenantsOf = fixture.entities.user.relations.get("tenants")?.indirect;
  const expositionOf = fixture.entities.exposition.resource;
  const participantOf = fixture.entities.participant.resource;
  const membershipsOf =
    fixture.entities.participant.relations.get("memberships")?.indirect;
  assert(tenantsOf && membershipsOf);
  const participantTarget = target.path("exposition", "participant");
  return {
    "users.read": permission({ target: target.required("user") }).rules([
      userOf.match(),
      tenantsOf.match(),
      matchPath(),
      userOf.filter(),
    ]),
    "users.list": intermediate({
      target: target.required("user"),
      expandsTo: (grant) => [{ ...grant, key: "users.read" }],
    }).rules([userOf.match(), tenantsOf.match(), userOf.filter()]),
    "users.update": permission({ target: target.required("user") }).rules([
      userOf.match(),
      matchPath(),
      inputFilter(),
    ]),
    "users.delete": permission({ target: target.required("user") }).rules([
      userOf.match(),
      matchPath(),
    ]),
    "users.manage": intermediate({
      target: target.required("user"),
      expandsTo: (grant) => [
        { ...grant, key: "users.list" },
        { ...grant, key: "users.update" },
        { ...grant, key: "users.delete" },
      ],
    }).rules([userOf.match(), userOf.filter()]),
    "expositions.participants.read": permission({
      target: participantTarget,
    }).rules([
      expositionOf.match(),
      participantOf.match(),
      matchPath({ segment: 1 }),
      participantOf.filter(),
      membershipsOf.match(),
    ]),
    "expositions.participants.list": intermediate({
      target: participantTarget,
      expandsTo: (grant) => [
        { ...grant, key: "expositions.participants.read" },
      ],
    }).rules([
      expositionOf.match(),
      participantOf.match(),
      participantOf.filter(),
      membershipsOf.match(),
    ]),
    "expositions.participants.delete": permission({
      target: participantTarget,
    }).rules([
      expositionOf.match(),
      participantOf.match(),
      matchPath({ segment: 1 }),
    ]),
  };
}

type Shape = Omit<Grant, "key" | "target">;

const USER_SHAPES: Shape[] = [
  {},
  { with: { user: { tenant: "t1" } } },
  { with: { user: { tenant: "none" } } },
  { filter: { _id: true, firstname: true } },
  { with: { user: { tenant: "t1" } }, filter: { _id: true } },
  { with: { tenant_memberships_of_user: { status: "active" } } },
];
const USER_TARGETS = [["user:*"], ["*"], ["user:1"], ["user:2"]];
const USER_REQUESTS = [["user:1"], ["user:2"], ["user:3"], ["user:*"]];

const PARTICIPANT_SHAPES: Shape[] = [
  {},
  { with: { participant: { status: "active" } } },
  { with: { exposition: { entrepriseId: "entreprise:e1" } } },
  { filter: { _id: true, email: true } },
  {
    with: {
      memberships_of_participant: { organizationId: "expo_organization:o1" },
    },
  },
];
const PARTICIPANT_TARGETS = [
  ["exposition:*", "participant:*"],
  ["exposition:1", "participant:*"],
  ["exposition:1", "participant:p1"],
  ["exposition:2", "participant:p3"],
];
const PARTICIPANT_REQUESTS = [
  ["exposition:1", "participant:p1"],
  ["exposition:1", "participant:p2"],
  ["exposition:2", "participant:p3"],
  ["exposition:1", "participant:*"],
  ["exposition:*", "participant:*"],
];

const PLANS = [
  {
    keys: [
      "users.read",
      "users.list",
      "users.update",
      "users.delete",
      "users.manage",
    ],
    shapes: USER_SHAPES,
    targets: USER_TARGETS,
    requests: USER_REQUESTS,
  },
  {
    keys: [
      "expositions.participants.read",
      "expositions.participants.list",
      "expositions.participants.delete",
    ],
    shapes: PARTICIPANT_SHAPES,
    targets: PARTICIPANT_TARGETS,
    requests: PARTICIPANT_REQUESTS,
  },
];

function normalise(result: CanResult) {
  if (!result.ok) return { ok: false };
  return {
    ok: true,
    data: result.data,
    constraints: result.constraints,
    stages: result.stages,
  };
}

test("parity: the entity layer decides like the hand-written schema", async () => {
  const fixture = createFixture();
  const holder: { grants: Grant[] } = { grants: [] };
  const provider = () => holder.grants;
  const legacy = createEngine({
    schema: legacySchema(fixture),
    providers: [provider],
  });
  const next = createSystem({
    permissions: fixture.all,
    providers: [provider],
  }).engine;

  const RELATION_SLOTS = [
    "tenant_memberships_of_user",
    "memberships_of_participant",
  ];
  const LEGACY_KEYS_WITHOUT_RELATION_RULE = [
    "users.update",
    "users.delete",
    "users.manage",
    "expositions.participants.delete",
  ];
  const isEnumeration = (key: string) => /\.(list|manage)$/.test(key);

  let compared = 0;
  const counts = { identical: 0, listScope: 0, relation: 0, fieldList: 0 };
  const unexpected: string[] = [];
  const widened: string[] = [];

  for (const plan of PLANS) {
    for (const grantKey of plan.keys) {
      for (const shape of plan.shapes) {
        for (const grantTarget of plan.targets) {
          holder.grants = [
            { id: "g", key: grantKey, target: grantTarget, ...shape },
          ];
          const concreteGrant = !String(grantTarget.at(-1)).endsWith("*");
          const carriesRelation = RELATION_SLOTS.some(
            (slot) => shape.with?.[slot] !== undefined,
          );
          const fieldListOnDelete =
            shape.filter !== undefined && grantKey.endsWith(".delete");

          for (const asked of plan.keys) {
            for (const request of plan.requests) {
              const context =
                asked === "users.update"
                  ? { input: { firstname: "Z", email: "e" } }
                  : undefined;
              const subject = { id: "user:9" };
              const before = normalise(
                await legacy.can(subject, asked, request, context),
              );
              const after = normalise(
                await next.can(subject, asked, request, context),
              );
              compared++;
              const label = `${grantKey}@${grantTarget.join("/")} ${JSON.stringify(shape)} ? ${asked}@${request.join("/")}`;
              if (!before.ok && after.ok) widened.push(label);
              if (JSON.stringify(before) === JSON.stringify(after)) {
                counts.identical++;
                continue;
              }
              const detail = `${label}\n   legacy ${JSON.stringify(before)}\n   next   ${JSON.stringify(after)}`;
              if (fieldListOnDelete) {
                counts.fieldList++;
                if (after.ok) unexpected.push(detail);
                continue;
              }
              if (
                carriesRelation &&
                LEGACY_KEYS_WITHOUT_RELATION_RULE.includes(asked)
              ) {
                counts.relation++;
                continue;
              }
              if (
                concreteGrant &&
                isEnumeration(grantKey) &&
                isEnumeration(asked)
              ) {
                counts.listScope++;
                const sameVerdict =
                  before.ok === after.ok &&
                  JSON.stringify(before.data) === JSON.stringify(after.data);
                if (!sameVerdict) unexpected.push(detail);
                continue;
              }
              unexpected.push(detail);
            }
          }
        }
      }
    }
  }

  assertEquals(widened, []);
  assertEquals(unexpected, []);
  assert(compared > 2000, `only ${compared} comparisons`);
  assert(counts.identical > compared * 0.9, JSON.stringify(counts));
  assert(counts.listScope > 0 && counts.relation > 0 && counts.fieldList > 0);
  console.log(`parity: ${compared} comparisons ${JSON.stringify(counts)}`);
});

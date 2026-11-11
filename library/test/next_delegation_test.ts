import { test } from "node:test";
import { ALL, createSystem, type Tenant } from "../next/mod.ts";
import type { Grant } from "../types.ts";
import { assertEquals } from "./+assert.ts";
import { createFixture } from "./+next_fixture.ts";

const EXPO = "exposition:1";
const OTHER_EXPO = "exposition:2";
const ORG = "expo_organization:o1";
const OTHER_ORG = "expo_organization:o2";

function setup() {
  const fixture = createFixture();
  const system = createSystem({ permissions: fixture.all });
  const { sets, entities } = fixture;
  const expoTenant: Tenant = [{ entity: entities.exposition, path: [EXPO] }];
  const orgTenant: Tenant = [
    { entity: entities.organization, path: [EXPO, ORG] },
  ];
  const organizer: Grant[] = [sets.expositions.grant("manage", { on: EXPO })];
  const orgAdmin: Grant[] = [
    sets.orgRoles.grant("manage", { on: [EXPO, ORG, ALL] }),
    sets.organizations.grant("manage", { on: [EXPO, ORG] }),
  ];
  const code = (
    held: readonly Grant[],
    asked: Grant,
    within?: Tenant,
    reserved?: (key: string) => boolean,
  ) =>
    system.delegationRefusal(held, asked, { within, reserved })?.code ?? "ok";
  return {
    system,
    sets,
    entities,
    expoTenant,
    orgTenant,
    organizer,
    orgAdmin,
    code,
  };
}

test("delegation: what the delegator holds, narrowed, passes", () => {
  const { sets, expoTenant, orgTenant, organizer, orgAdmin, code } = setup();
  assertEquals(
    code(
      organizer,
      sets.participants.grant("read", { on: [EXPO, ALL] }),
      expoTenant,
    ),
    "ok",
  );
  assertEquals(
    code(
      organizer,
      sets.participants.grant("manage", {
        on: [EXPO, ALL],
        where: { status: "active" },
      }),
      expoTenant,
    ),
    "ok",
  );
  assertEquals(
    code(
      orgAdmin,
      sets.orgRoles.grant("read", { on: [EXPO, ORG, ALL] }),
      orgTenant,
    ),
    "ok",
  );
});

test("delegation: a key the delegator lacks is refused", () => {
  const { sets, orgTenant, orgAdmin, code } = setup();
  assertEquals(
    code(orgAdmin, sets.participants.grant("read", { on: [EXPO, ALL] })),
    "not-held",
  );
  assertEquals(
    code(orgAdmin, sets.expositions.grant("manage", { on: EXPO })),
    "not-held",
  );
  assertEquals(
    code(orgAdmin, sets.expositions.grant("manage", { on: EXPO }), orgTenant),
    "outside-tenant",
  );
});

test("delegation: widening the target is refused", () => {
  const { sets, expoTenant, orgTenant, organizer, orgAdmin, code } = setup();
  assertEquals(
    code(organizer, sets.expositions.grant("manage", { on: ALL })),
    "not-held",
  );
  assertEquals(
    code(organizer, sets.participants.grant("read", { on: [ALL, ALL] })),
    "not-held",
  );
  assertEquals(
    code(organizer, sets.participants.grant("read", { on: [OTHER_EXPO, ALL] })),
    "not-held",
  );
  assertEquals(
    code(
      organizer,
      sets.participants.grant("read", { on: [OTHER_EXPO, ALL] }),
      expoTenant,
    ),
    "outside-tenant",
  );
  assertEquals(
    code(
      orgAdmin,
      sets.orgRoles.grant("update", { on: [EXPO, OTHER_ORG, ALL] }),
      orgTenant,
    ),
    "outside-tenant",
  );
  assertEquals(
    code(
      orgAdmin,
      sets.orgRoles.grant("update", { on: [EXPO, ALL, ALL] }),
      orgTenant,
    ),
    "outside-tenant",
  );
  assertEquals(
    code(orgAdmin, sets.orgRoles.grant("update", { on: [EXPO, ALL, ALL] })),
    "not-held",
  );
});

test("delegation: a tenant role never carries a key from another tree", () => {
  const { sets, expoTenant, organizer, code, system } = setup();
  const platformAdmin: Grant[] = system.wildcardGrants("admin") as Grant[];
  assertEquals(
    code(
      platformAdmin,
      sets.platform.grant("analytics.manage", {}),
      expoTenant,
    ),
    "outside-tenant",
  );
  assertEquals(
    code(platformAdmin, sets.users.grant("manage", { on: ALL }), expoTenant),
    "outside-tenant",
  );
  assertEquals(
    code(
      platformAdmin,
      sets.expositions.grant("manage", { on: ALL }),
      expoTenant,
    ),
    "outside-tenant",
  );
  assertEquals(
    code(organizer, sets.expositions.grant("create", {}), expoTenant),
    "outside-tenant",
  );
});

test("delegation: dropping or loosening a restriction is refused", () => {
  const { sets, expoTenant, code } = setup();
  const limited: Grant[] = [
    sets.participants.grant("read", {
      on: [EXPO, ALL],
      where: { status: { $in: ["active", "pending"] } },
      fields: ["_id", "email"],
    }),
  ];
  type ReadOptions = Parameters<typeof sets.participants.grant<"read">>[1];
  const ask = (options: Pick<ReadOptions, "where" | "fields">) =>
    code(
      limited,
      sets.participants.grant("read", { on: [EXPO, ALL], ...options }),
      expoTenant,
    );

  assertEquals(
    ask({ where: { status: { $in: ["active", "pending"] } }, fields: ["_id"] }),
    "ok",
  );
  assertEquals(ask({ where: { status: "active" }, fields: ["email"] }), "ok");
  assertEquals(
    ask({
      where: { $and: [{ status: { $in: ["active"] } }, { badgeCode: "B1" }] },
      fields: ["_id"],
    }),
    "ok",
  );

  assertEquals(ask({ fields: ["_id"] }), "not-held");
  assertEquals(ask({ where: { status: "active" } }), "not-held");
  assertEquals(
    ask({ where: { status: "active" }, fields: ["_id", "badgeCode"] }),
    "not-held",
  );
  assertEquals(ask({ where: { status: "left" }, fields: ["_id"] }), "not-held");
  assertEquals(
    ask({
      where: { status: { $in: ["active", "pending", "left"] } },
      fields: ["_id"],
    }),
    "not-held",
  );
  assertEquals(
    ask({ where: { status: { $ne: "left" } }, fields: ["_id"] }),
    "not-held",
  );
  assertEquals(
    ask({
      where: { $or: [{ status: "active" }, { badgeCode: "B1" }] },
      fields: ["_id"],
    }),
    "not-held",
  );
  assertEquals(
    ask({ where: { badgeCode: "B1" }, fields: ["_id"] }),
    "not-held",
  );
});

test("delegation: a condition or a payload the delegator is bound by must be kept", () => {
  const { system, sets } = setup();
  const bound: Grant[] = [
    sets.notes.grant("update", { on: ALL, when: ["author"] }),
    sets.notes.grant("read", { on: ALL, payload: { until: "2027-01-01" } }),
  ];
  const code = (asked: Grant) =>
    system.delegationRefusal(bound, asked)?.code ?? "ok";
  assertEquals(
    code(sets.notes.grant("update", { on: ALL, when: ["author"] })),
    "ok",
  );
  assertEquals(code(sets.notes.grant("update", { on: ALL })), "not-held");
  assertEquals(code(sets.notes.grant("update", { on: "note:n1" })), "not-held");
  assertEquals(
    code(
      sets.notes.grant("read", { on: ALL, payload: { until: "2027-01-01" } }),
    ),
    "ok",
  );
  assertEquals(code(sets.notes.grant("read", { on: ALL })), "not-held");
  assertEquals(
    code(
      sets.notes.grant("read", { on: ALL, payload: { until: "2099-01-01" } }),
    ),
    "not-held",
  );
});

test("delegation: a bundle cannot be assembled from its parts", () => {
  const { sets, expoTenant, code } = setup();
  const parts: Grant[] = [
    sets.participants.grant("list", { on: [EXPO, ALL] }),
    sets.participants.grant("read", { on: [EXPO, ALL] }),
    sets.participants.grant("update", { on: [EXPO, ALL] }),
    sets.participants.grant("delete", { on: [EXPO, ALL] }),
  ];
  assertEquals(
    code(
      parts,
      sets.participants.grant("manage", { on: [EXPO, ALL] }),
      expoTenant,
    ),
    "not-held",
  );
  assertEquals(
    code(
      parts,
      sets.participants.grant("update", { on: [EXPO, ALL] }),
      expoTenant,
    ),
    "ok",
  );
});

test("delegation: malformed, unknown and reserved keys are refused", () => {
  const { sets, expoTenant, organizer, code } = setup();
  assertEquals(
    code(organizer, { key: "expositions.destroy", target: [EXPO] }, expoTenant),
    "invalid",
  );
  assertEquals(
    code(
      organizer,
      { key: "expositions.participants.read", target: [EXPO] },
      expoTenant,
    ),
    "invalid",
  );
  assertEquals(
    code(organizer, { key: "expositions.participants.read" }, expoTenant),
    "invalid",
  );
  assertEquals(
    code(
      organizer,
      {
        key: "expositions.participants.read",
        target: ["user:1", "participant:*"],
      },
      expoTenant,
    ),
    "invalid",
  );
  assertEquals(
    code(
      organizer,
      sets.devices.grant("approve", { on: [EXPO, ALL] }),
      expoTenant,
      (key) => key.startsWith("expositions.security."),
    ),
    "reserved",
  );
});

test("delegation: a tenant must be a concrete reference", () => {
  const { sets, entities, organizer, code } = setup();
  const asked = sets.participants.grant("read", { on: [EXPO, ALL] });
  const malformed: Tenant[] = [
    [],
    [{ entity: entities.exposition, path: ["exposition:*"] }],
    [{ entity: entities.exposition, path: [] }],
    [{ entity: entities.organization, path: [EXPO] }],
    [{ entity: entities.exposition, where: {} }],
  ];
  for (const tenant of malformed) {
    assertEquals(code(organizer, asked, tenant), "outside-tenant");
  }
});

test("delegation: a tenant bound by a condition keeps that condition on every grant", () => {
  const { system, sets, entities } = setup();
  const mine = { entrepriseId: "entreprise:e1" };
  const members = { entrepriseId: "entreprise:e1", status: "active" };
  const tenant: Tenant = [
    { entity: entities.exposition, where: mine },
    {
      entity: entities.user,
      slot: "tenant_memberships_of_user",
      where: members,
    },
  ];
  const owner: Grant[] = [
    sets.expositions.grant("manage", { on: ALL, where: mine }),
    sets.users.grant("list", { on: ALL, related: { tenants: members } }),
  ];
  const admin = system.wildcardGrants("admin") as Grant[];
  const code = (held: readonly Grant[], asked: Grant) =>
    system.delegationRefusal(held, asked, { within: tenant })?.code ?? "ok";

  assertEquals(
    code(owner, sets.expositions.grant("manage", { on: ALL, where: mine })),
    "ok",
  );
  assertEquals(
    code(
      owner,
      sets.participants.grant("read", {
        on: [ALL, ALL],
        parents: { exposition: mine },
      }),
    ),
    "ok",
  );
  assertEquals(
    code(
      owner,
      sets.users.grant("read", { on: ALL, related: { tenants: members } }),
    ),
    "ok",
  );

  assertEquals(
    code(admin, sets.expositions.grant("manage", { on: ALL })),
    "outside-tenant",
  );
  assertEquals(
    code(admin, sets.expositions.grant("manage", { on: EXPO })),
    "outside-tenant",
  );
  assertEquals(
    code(
      admin,
      sets.expositions.grant("manage", {
        on: ALL,
        where: { entrepriseId: "entreprise:e2" },
      }),
    ),
    "outside-tenant",
  );
  assertEquals(
    code(
      admin,
      sets.expositions.grant("manage", {
        on: ALL,
        where: { $or: [mine, { name: "Salon B" }] },
      }),
    ),
    "outside-tenant",
  );
  assertEquals(
    code(admin, sets.users.grant("manage", { on: ALL })),
    "outside-tenant",
  );
  assertEquals(
    code(
      admin,
      sets.users.grant("list", {
        on: ALL,
        related: { tenants: { entrepriseId: "entreprise:e1" } },
      }),
    ),
    "outside-tenant",
  );
  assertEquals(
    code(admin, sets.platform.grant("analytics.read", {})),
    "outside-tenant",
  );
  assertEquals(
    code(
      owner,
      sets.users.grant("manage", { on: ALL, related: { tenants: members } }),
    ),
    "not-held",
  );
});

test("delegation: the delegable catalogue of a tenant is its own tree", () => {
  const { system, entities } = setup();
  const organizationKeys = system.delegable(entities.organization);
  assertEquals(
    organizationKeys.every((key) =>
      key.startsWith("expositions.expo_organizations."),
    ),
    true,
  );
  assertEquals(
    organizationKeys.includes("expositions.expo_organizations.roles.update"),
    true,
  );
  const expositionKeys = system.delegable(entities.exposition);
  assertEquals(expositionKeys.includes("expositions.participants.read"), true);
  assertEquals(expositionKeys.includes("expositions.create"), false);
  assertEquals(expositionKeys.includes("users.read"), false);
  assertEquals(expositionKeys.includes("platform.analytics.read"), false);
});

test("delegation: a context answers from the grants its subject really holds", async () => {
  const fixture = createFixture();
  const { sets, entities } = fixture;
  const system = createSystem({
    permissions: fixture.all,
    providers: [
      {
        name: "roles",
        cacheKey: (subject) => `roles::${subject.id}`,
        fetch: (subject) =>
          subject.id === "user:1"
            ? [
                sets.orgRoles.grant("manage", {
                  id: "g1",
                  on: [EXPO, ORG, ALL],
                }),
              ]
            : [],
      },
    ],
  });
  const within: Tenant = [{ entity: entities.organization, path: [EXPO, ORG] }];
  const asked = sets.orgRoles.grant("update", { on: [EXPO, ORG, ALL] });
  const holder = system.context({ subject: { id: "user:1" } });
  const stranger = system.context({ subject: { id: "user:2" } });
  assertEquals(await holder.delegationRefusal(asked, { within }), null);
  assertEquals(
    (await stranger.delegationRefusal(asked, { within }))?.code,
    "not-held",
  );
});

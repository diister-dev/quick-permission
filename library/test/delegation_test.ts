import { test } from "node:test";
import { ALL, type Boundary, createSystem, type Grant } from "../mod.ts";
import { assertEquals, assertThrows } from "./+assert.ts";
import { createFixture } from "./+fixture.ts";

const EXPO = "exposition:1";
const OTHER_EXPO = "exposition:2";
const ORG = "expo_organization:o1";
const OTHER_ORG = "expo_organization:o2";

function setup() {
  const fixture = createFixture();
  const system = createSystem({ permissions: fixture.all });
  const { sets, entities } = fixture;
  const expoBoundary = system.boundary(entities.exposition, EXPO);
  const orgBoundary = system.boundary(entities.organization, EXPO, ORG);
  const organizer: Grant[] = [sets.expositions.grant("manage", { on: EXPO })];
  const orgAdmin: Grant[] = [
    sets.orgRoles.grant("manage", { on: [EXPO, ORG, ALL] }),
    sets.organizations.grant("manage", { on: [EXPO, ORG] }),
  ];
  const code = (
    held: readonly Grant[],
    asked: Grant,
    within?: Boundary,
    reserved?: (key: string) => boolean,
  ) =>
    system.delegation.refusal(held, asked, { within, reserved })?.code ?? "ok";
  return {
    system,
    sets,
    entities,
    expoBoundary,
    orgBoundary,
    organizer,
    orgAdmin,
    code,
  };
}

test("delegation: what the delegator holds, narrowed, passes", () => {
  const { sets, expoBoundary, orgBoundary, organizer, orgAdmin, code } =
    setup();
  assertEquals(
    code(
      organizer,
      sets.participants.grant("read", { on: [EXPO, ALL] }),
      expoBoundary,
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
      expoBoundary,
    ),
    "ok",
  );
  assertEquals(
    code(
      orgAdmin,
      sets.orgRoles.grant("read", { on: [EXPO, ORG, ALL] }),
      orgBoundary,
    ),
    "ok",
  );
});

test("delegation: a key the delegator lacks is refused", () => {
  const { sets, orgBoundary, orgAdmin, code } = setup();
  assertEquals(
    code(orgAdmin, sets.participants.grant("read", { on: [EXPO, ALL] })),
    "not-held",
  );
  assertEquals(
    code(orgAdmin, sets.expositions.grant("manage", { on: EXPO })),
    "not-held",
  );
  assertEquals(
    code(orgAdmin, sets.expositions.grant("manage", { on: EXPO }), orgBoundary),
    "outside-boundary",
  );
});

test("delegation: widening the target is refused", () => {
  const { sets, expoBoundary, orgBoundary, organizer, orgAdmin, code } =
    setup();
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
      expoBoundary,
    ),
    "outside-boundary",
  );
  assertEquals(
    code(
      orgAdmin,
      sets.orgRoles.grant("update", { on: [EXPO, OTHER_ORG, ALL] }),
      orgBoundary,
    ),
    "outside-boundary",
  );
  assertEquals(
    code(
      orgAdmin,
      sets.orgRoles.grant("update", { on: [EXPO, ALL, ALL] }),
      orgBoundary,
    ),
    "outside-boundary",
  );
  assertEquals(
    code(orgAdmin, sets.orgRoles.grant("update", { on: [EXPO, ALL, ALL] })),
    "not-held",
  );
});

test("delegation: a tenant role never carries a key from another tree", () => {
  const { sets, expoBoundary, organizer, code, system } = setup();
  const platformAdmin: Grant[] = system.wildcardGrants("admin") as Grant[];
  assertEquals(
    code(
      platformAdmin,
      sets.platform.grant("analytics.manage", {}),
      expoBoundary,
    ),
    "outside-boundary",
  );
  assertEquals(
    code(platformAdmin, sets.users.grant("manage", { on: ALL }), expoBoundary),
    "outside-boundary",
  );
  assertEquals(
    code(
      platformAdmin,
      sets.expositions.grant("manage", { on: ALL }),
      expoBoundary,
    ),
    "outside-boundary",
  );
  assertEquals(
    code(organizer, sets.expositions.grant("create", {}), expoBoundary),
    "outside-boundary",
  );
});

test("delegation: dropping or loosening a restriction is refused", () => {
  const { sets, expoBoundary, code } = setup();
  const limited: Grant[] = [
    sets.participants.grant("read", {
      on: [EXPO, ALL],
      where: { status: { $in: ["active", "pending"] } },
      fields: { _id: true, email: true },
    }),
  ];
  type ReadOptions = Parameters<typeof sets.participants.grant<"read">>[1];
  const ask = (options: Pick<ReadOptions, "where" | "fields">) =>
    code(
      limited,
      sets.participants.grant("read", { on: [EXPO, ALL], ...options }),
      expoBoundary,
    );

  assertEquals(
    ask({
      where: { status: { $in: ["active", "pending"] } },
      fields: { _id: true },
    }),
    "ok",
  );
  assertEquals(
    ask({ where: { status: "active" }, fields: { email: true } }),
    "ok",
  );
  assertEquals(
    ask({
      where: { $and: [{ status: { $in: ["active"] } }, { badgeCode: "B1" }] },
      fields: { _id: true },
    }),
    "ok",
  );

  assertEquals(ask({ fields: { _id: true } }), "not-held");
  assertEquals(ask({ where: { status: "active" } }), "not-held");
  assertEquals(
    ask({
      where: { status: "active" },
      fields: { _id: true, badgeCode: true },
    }),
    "not-held",
  );
  assertEquals(
    ask({ where: { status: "left" }, fields: { _id: true } }),
    "not-held",
  );
  assertEquals(
    ask({
      where: { status: { $in: ["active", "pending", "left"] } },
      fields: { _id: true },
    }),
    "not-held",
  );
  assertEquals(
    ask({ where: { status: { $ne: "left" } }, fields: { _id: true } }),
    "not-held",
  );
  assertEquals(
    ask({
      where: { $or: [{ status: "active" }, { badgeCode: "B1" }] },
      fields: { _id: true },
    }),
    "not-held",
  );
  assertEquals(
    ask({ where: { badgeCode: "B1" }, fields: { _id: true } }),
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
    system.delegation.refusal(bound, asked)?.code ?? "ok";
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
  const { sets, expoBoundary, code } = setup();
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
      expoBoundary,
    ),
    "not-held",
  );
  assertEquals(
    code(
      parts,
      sets.participants.grant("update", { on: [EXPO, ALL] }),
      expoBoundary,
    ),
    "ok",
  );
});

test("delegation: malformed, unknown and reserved keys are refused", () => {
  const { sets, expoBoundary, organizer, code } = setup();
  assertEquals(
    code(organizer, { key: "expositions.destroy", on: [EXPO] }, expoBoundary),
    "invalid",
  );
  assertEquals(
    code(
      organizer,
      { key: "expositions.participants.read", on: [EXPO] },
      expoBoundary,
    ),
    "invalid",
  );
  assertEquals(
    code(organizer, { key: "expositions.participants.read" }, expoBoundary),
    "invalid",
  );
  assertEquals(
    code(
      organizer,
      {
        key: "expositions.participants.read",
        on: ["user:1", "participant:*"],
      },
      expoBoundary,
    ),
    "invalid",
  );
  assertEquals(
    code(
      organizer,
      sets.devices.grant("approve", { on: [EXPO, ALL] }),
      expoBoundary,
      (key) => key.startsWith("expositions.security."),
    ),
    "reserved",
  );
});

test("boundary: it is drawn around one concrete instance", () => {
  const { system, entities } = setup();
  assertThrows(() => system.boundary(entities.exposition));
  assertThrows(() => system.boundary(entities.exposition, "exposition:*"));
  assertThrows(() => system.boundary(entities.exposition, "user:1"));
  assertThrows(() => system.boundary(entities.organization, EXPO));
  assertThrows(() => system.boundary(entities.exposition, EXPO, ORG));
  assertEquals(system.boundary(entities.organization, EXPO, ORG).path, [
    EXPO,
    ORG,
  ]);
});

test("boundary: what an entity declares it belongs to is kept on every grant", () => {
  const { system, sets, entities } = setup();
  const mine = { entrepriseId: "entreprise:e1" };
  const members = { entrepriseId: "entreprise:e1", status: "active" };
  const boundary = system.boundary(entities.entreprise, "entreprise:e1");
  const owner: Grant[] = [
    sets.expositions.grant("manage", { on: ALL, where: mine }),
    sets.users.grant("list", { on: ALL, related: { tenants: members } }),
  ];
  const admin = [...system.wildcardGrants("admin")];
  const code = (held: readonly Grant[], asked: Grant) =>
    boundary.refusal(held, asked)?.code ?? "ok";

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
    "outside-boundary",
  );
  assertEquals(
    code(admin, sets.expositions.grant("manage", { on: EXPO })),
    "outside-boundary",
  );
  assertEquals(
    code(
      admin,
      sets.expositions.grant("manage", {
        on: ALL,
        where: { entrepriseId: "entreprise:e2" },
      }),
    ),
    "outside-boundary",
  );
  assertEquals(
    code(
      admin,
      sets.expositions.grant("manage", {
        on: ALL,
        where: { $or: [mine, { name: "Salon B" }] },
      }),
    ),
    "outside-boundary",
  );
  assertEquals(
    code(admin, sets.users.grant("manage", { on: ALL })),
    "outside-boundary",
  );
  assertEquals(
    code(
      admin,
      sets.users.grant("list", {
        on: ALL,
        related: { tenants: { entrepriseId: "entreprise:e1" } },
      }),
    ),
    "outside-boundary",
  );
  assertEquals(
    code(admin, sets.platform.grant("analytics.read", {})),
    "outside-boundary",
  );
  assertEquals(
    code(
      owner,
      sets.users.grant("manage", { on: ALL, related: { tenants: members } }),
    ),
    "not-held",
  );
});

test("boundary: binding a grant adds the anchor and never loosens what is there", () => {
  const { system, sets, entities } = setup();
  const mine = { entrepriseId: "entreprise:e1" };
  const members = { entrepriseId: "entreprise:e1", status: "active" };
  const entreprise = system.boundary(entities.entreprise, "entreprise:e1");

  assertEquals(
    entreprise.bind(sets.expositions.grant("read", { on: ALL })).where,
    mine,
  );
  assertEquals(
    entreprise.bind(sets.expositions.grant("read", { on: ALL, where: mine }))
      .where,
    mine,
  );
  assertEquals(
    entreprise.bind(
      sets.expositions.grant("read", { on: ALL, where: { name: "Salon A" } }),
    ).where,
    { $and: [mine, { name: "Salon A" }] },
  );
  assertEquals(
    entreprise.bind(
      sets.expositions.grant("read", {
        on: ALL,
        where: { entrepriseId: "entreprise:e2" },
      }),
    ).where,
    { $and: [mine, { entrepriseId: "entreprise:e2" }] },
  );
  assertEquals(
    entreprise.bind(sets.participants.grant("read", { on: [ALL, ALL] }))
      .parents,
    { exposition: mine },
  );
  assertEquals(entreprise.bind(sets.users.grant("list", { on: ALL })).related, {
    tenants: members,
  });

  const unrelated = sets.platform.grant("analytics.read", {});
  assertEquals(entreprise.bind(unrelated), unrelated);

  const organization = system.boundary(entities.organization, EXPO, ORG);
  assertEquals(
    organization.bind(sets.orgRoles.grant("read", { on: [ALL, ALL, ALL] })).on,
    [EXPO, ORG, "expo_organization_role:*"],
  );
  const elsewhere = sets.orgRoles.grant("read", {
    on: [EXPO, OTHER_ORG, ALL],
  });
  assertEquals(organization.bind(elsewhere).on, elsewhere.on);
  assertEquals(
    organization.refusal([elsewhere], organization.bind(elsewhere))?.code,
    "outside-boundary",
  );
});

test("boundary: a bound grant is always inside, whatever it started as", () => {
  const { system, sets, entities } = setup();
  const boundary = system.boundary(entities.entreprise, "entreprise:e1");
  const attempts: Grant[] = [
    sets.expositions.grant("manage", { on: ALL }),
    sets.expositions.grant("manage", { on: EXPO }),
    sets.expositions.grant("manage", {
      on: ALL,
      where: { $or: [{ entrepriseId: "entreprise:e2" }, { name: "x" }] },
    }),
    sets.participants.grant("manage", { on: [ALL, ALL] }),
    sets.users.grant("list", { on: ALL }),
  ];
  for (const attempt of attempts) {
    const bound = boundary.bind(attempt);
    assertEquals(boundary.refusal([bound], bound), null);
  }
});

test("boundary: its keys are those that act inside it", () => {
  const { system, entities } = setup();
  const organization = system.boundary(entities.organization, EXPO, ORG).keys();
  assertEquals(
    organization.every((key) =>
      key.startsWith("expositions.expo_organizations."),
    ),
    true,
  );
  assertEquals(
    organization.includes("expositions.expo_organizations.roles.update"),
    true,
  );

  const exposition = system.boundary(entities.exposition, EXPO).keys();
  assertEquals(exposition.includes("expositions.participants.read"), true);
  assertEquals(exposition.includes("expositions.create"), false);
  assertEquals(exposition.includes("users.read"), false);
  assertEquals(exposition.includes("platform.analytics.read"), false);

  const entreprise = system
    .boundary(entities.entreprise, "entreprise:e1")
    .keys();
  assertEquals(entreprise.includes("expositions.participants.read"), true);
  assertEquals(entreprise.includes("users.list"), true);
  assertEquals(entreprise.includes("platform.analytics.read"), false);
  assertEquals(entreprise.includes("notes.read"), false);
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
  const within = system.boundary(entities.organization, EXPO, ORG);
  const asked = sets.orgRoles.grant("update", { on: [EXPO, ORG, ALL] });
  const holder = system.context({ subject: { id: "user:1" } });
  const stranger = system.context({ subject: { id: "user:2" } });
  assertEquals(await holder.delegationRefusal(asked, { within }), null);
  assertEquals(
    (await stranger.delegationRefusal(asked, { within }))?.code,
    "not-held",
  );
});

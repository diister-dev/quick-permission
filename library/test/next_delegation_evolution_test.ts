import { test } from "node:test";
import {
  ALL,
  compilePermissions,
  createSystem,
  type DelegationRefusal,
  type Tenant,
} from "../next/mod.ts";
import type { Grant } from "../types.ts";
import { assert, assertEquals } from "./+assert.ts";
import { createFixture } from "./+next_fixture.ts";

const ACME = "entreprise:e1";
const GLOBEX = "entreprise:e2";
const ACME_EXPO = "exposition:1";

function world() {
  const fixture = createFixture();
  const { sets, entities, stores } = fixture;
  const ofTenant = (entreprise: string) => ({ entrepriseId: entreprise });
  const tenant = (entreprise: string): Tenant => [
    { entity: entities.exposition, where: ofTenant(entreprise) },
  ];

  const members = new Map<string, { entreprise: string; role: string }>([
    ["user:author", { entreprise: ACME, role: "owner" }],
    ["user:editor", { entreprise: ACME, role: "editors" }],
  ]);
  const envelopes = new Map<string, Grant[]>([
    [
      ACME,
      [sets.expositions.grant("manage", { on: ALL, where: ofTenant(ACME) })],
    ],
  ]);
  const roles = new Map<string, Grant[]>([
    [
      "editors",
      [
        sets.expositions.grant("read", {
          id: "r",
          on: ALL,
          where: ofTenant(ACME),
        }),
        sets.expositions.grant("update", {
          id: "u",
          on: ALL,
          where: ofTenant(ACME),
        }),
      ],
    ],
  ]);
  const dropped: DelegationRefusal[] = [];

  const compiled = compilePermissions(fixture.all);
  const system = createSystem({
    permissions: fixture.all,
    providers: [
      {
        name: "tenantRoles",
        cacheKey: (subject) => `tenant::${subject.id}`,
        fetch: (subject) => {
          const member = members.get(subject.id);
          if (!member) return [];
          const envelope = envelopes.get(member.entreprise) ?? [];
          if (member.role === "owner") return envelope;
          const judged = compiled.withinEnvelope(
            envelope,
            roles.get(member.role) ?? [],
            { within: tenant(member.entreprise) },
          );
          for (const refusal of judged.dropped) {
            if (!dropped.some((seen) => seen.grant.id === refusal.grant.id)) {
              dropped.push(refusal);
            }
          }
          return [...judged.kept];
        },
      },
    ],
  });

  const can = async (
    user: string,
    key: "expositions.read" | "expositions.update",
    exposition = ACME_EXPO,
  ) =>
    (
      await system
        .context({ subject: { id: user } })
        .check(
          key,
          exposition,
          key === "expositions.update" ? { input: {} } : undefined,
        )
    ).ok;

  return {
    system,
    sets,
    stores,
    members,
    envelopes,
    roles,
    dropped,
    can,
    ofTenant,
  };
}

test("evolution: a resource that leaves the tenant leaves every role of that tenant", async () => {
  const { stores, can, system } = world();
  assertEquals(await can("user:editor", "expositions.read"), true);
  assertEquals(
    await can("user:editor", "expositions.read", "exposition:2"),
    false,
  );

  const moved = stores.expositions.get(ACME_EXPO);
  assert(moved);
  stores.expositions.set(ACME_EXPO, { ...moved, entrepriseId: GLOBEX });

  assertEquals(await can("user:editor", "expositions.read"), false);
  assertEquals(await can("user:author", "expositions.update"), false);
  const scope = await system
    .context({ subject: { id: "user:author" } })
    .scope("expositions.list");
  assert(scope.ok);
  assertEquals(scope.rows, { entrepriseId: ACME });
});

test("evolution: a subject that leaves the tenant holds nothing on the next request", async () => {
  const { members, can } = world();
  assertEquals(await can("user:editor", "expositions.update"), true);
  members.delete("user:editor");
  assertEquals(await can("user:editor", "expositions.update"), false);
  assertEquals(await can("user:editor", "expositions.read"), false);
});

test("evolution: a subject moved to another tenant takes none of the old one with it", async () => {
  const { members, envelopes, sets, ofTenant, can } = world();
  envelopes.set(GLOBEX, [
    sets.expositions.grant("manage", { on: ALL, where: ofTenant(GLOBEX) }),
  ]);
  members.set("user:author", { entreprise: GLOBEX, role: "owner" });
  assertEquals(await can("user:author", "expositions.read"), false);
  assertEquals(
    await can("user:author", "expositions.read", "exposition:2"),
    true,
  );
});

test("evolution: when the tenant loses a right, the roles it handed out lose it too", async () => {
  const { envelopes, sets, ofTenant, dropped, can } = world();
  assertEquals(await can("user:editor", "expositions.update"), true);

  envelopes.set(ACME, [
    sets.expositions.grant("read", { on: ALL, where: ofTenant(ACME) }),
  ]);

  assertEquals(await can("user:editor", "expositions.update"), false);
  assertEquals(await can("user:editor", "expositions.read"), true);
  assertEquals(
    dropped.map((refusal) => [refusal.grant.id, refusal.code]),
    [["u", "not-held"]],
  );

  envelopes.set(ACME, []);
  assertEquals(await can("user:editor", "expositions.read"), false);
});

test("evolution: a role outlives the member who wrote it", async () => {
  const { members, can } = world();
  members.delete("user:author");
  assertEquals(await can("user:editor", "expositions.update"), true);
});

test("evolution: a stored grant edited behind the service gives nothing outside the envelope", async () => {
  const { roles, sets, dropped, can } = world();
  roles.set("editors", [
    sets.expositions.grant("update", { id: "everywhere", on: ALL }),
    sets.expositions.grant("update", {
      id: "other-tenant",
      on: ALL,
      where: { entrepriseId: GLOBEX },
    }),
    sets.users.grant("manage", { id: "other-tree", on: ALL }),
    { id: "renamed", key: "expositions.edit", target: ["exposition:*"] },
  ]);
  assertEquals(await can("user:editor", "expositions.update"), false);
  assertEquals(
    await can("user:editor", "expositions.update", "exposition:2"),
    false,
  );
  assertEquals(
    dropped.map((refusal) => [refusal.grant.id, refusal.code]),
    [
      ["everywhere", "outside-tenant"],
      ["other-tenant", "outside-tenant"],
      ["other-tree", "outside-tenant"],
      ["renamed", "invalid"],
    ],
  );
});

test("evolution: a restriction added to the tenant reaches the roles already written", async () => {
  const { envelopes, sets, ofTenant, can } = world();
  envelopes.set(ACME, [
    sets.expositions.grant("manage", {
      on: ALL,
      where: { ...ofTenant(ACME), name: "Salon Z" },
    }),
  ]);
  assertEquals(await can("user:editor", "expositions.update"), false);
});

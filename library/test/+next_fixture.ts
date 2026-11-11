import {
  action,
  bundle,
  entity,
  external,
  globalPermissions,
  list,
  permissions,
} from "../next/mod.ts";

export type UserDoc = {
  _id: string;
  email: string;
  firstname: string;
  lastname: string;
  tenant: string;
  notes?: string;
};

export type ExpositionDoc = { _id: string; name: string; entrepriseId: string };

export type ParticipantDoc = {
  _id: string;
  expositionId: string;
  email: string;
  status: "active" | "pending";
  badgeCode: string;
};

export type MembershipDoc = {
  _id: string;
  expositionId: string;
  participantId: string;
  organizationId: string;
  status: "active" | "left";
};

export type DeviceDoc = { _id: string; expositionId: string; label: string };

export type OrganizationDoc = {
  _id: string;
  expositionId: string;
  name: string;
};

export type OrgRoleDoc = {
  _id: string;
  expositionId: string;
  organizationId: string;
  name: string;
};

export type NoteDoc = { _id: string; authorId: string; readers: string[] };

export function createFixture() {
  const loads: string[] = [];

  const users = new Map<string, UserDoc>([
    [
      "user:1",
      {
        _id: "user:1",
        email: "a@x.fr",
        firstname: "Ada",
        lastname: "A",
        tenant: "t1",
        notes: "vip",
      },
    ],
    [
      "user:2",
      {
        _id: "user:2",
        email: "b@x.fr",
        firstname: "Bob",
        lastname: "B",
        tenant: "t2",
      },
    ],
    [
      "user:3",
      {
        _id: "user:3",
        email: "c@x.fr",
        firstname: "Cyd",
        lastname: "C",
        tenant: "t1",
      },
    ],
  ]);
  const tenantMemberships = [
    { userId: "user:1", entrepriseId: "entreprise:e1", status: "active" },
    { userId: "user:2", entrepriseId: "entreprise:e2", status: "active" },
    { userId: "user:3", entrepriseId: "entreprise:e1", status: "left" },
  ];
  const expositions = new Map<string, ExpositionDoc>([
    [
      "exposition:1",
      { _id: "exposition:1", name: "Salon A", entrepriseId: "entreprise:e1" },
    ],
    [
      "exposition:2",
      { _id: "exposition:2", name: "Salon B", entrepriseId: "entreprise:e2" },
    ],
  ]);
  const participants = new Map<string, ParticipantDoc>([
    [
      "participant:p1",
      {
        _id: "participant:p1",
        expositionId: "exposition:1",
        email: "p1@x.fr",
        status: "active",
        badgeCode: "B1",
      },
    ],
    [
      "participant:p2",
      {
        _id: "participant:p2",
        expositionId: "exposition:1",
        email: "p2@x.fr",
        status: "active",
        badgeCode: "B2",
      },
    ],
    [
      "participant:p3",
      {
        _id: "participant:p3",
        expositionId: "exposition:2",
        email: "p3@x.fr",
        status: "pending",
        badgeCode: "B3",
      },
    ],
  ]);
  const memberships: MembershipDoc[] = [
    {
      _id: "org_membership:m1",
      expositionId: "exposition:1",
      participantId: "participant:p1",
      organizationId: "expo_organization:o1",
      status: "active",
    },
    {
      _id: "org_membership:m2",
      expositionId: "exposition:1",
      participantId: "participant:p2",
      organizationId: "expo_organization:o2",
      status: "active",
    },
  ];
  const devices = new Map<string, DeviceDoc>([
    [
      "device:d1",
      { _id: "device:d1", expositionId: "exposition:1", label: "Gate" },
    ],
  ]);
  const organizations = new Map<string, OrganizationDoc>([
    [
      "expo_organization:o1",
      {
        _id: "expo_organization:o1",
        expositionId: "exposition:1",
        name: "Acme",
      },
    ],
    [
      "expo_organization:o2",
      {
        _id: "expo_organization:o2",
        expositionId: "exposition:1",
        name: "Globex",
      },
    ],
  ]);
  const orgRoles = new Map<string, OrgRoleDoc>([
    [
      "expo_organization_role:r1",
      {
        _id: "expo_organization_role:r1",
        expositionId: "exposition:1",
        organizationId: "expo_organization:o1",
        name: "admin",
      },
    ],
  ]);
  const notes = new Map<string, NoteDoc>([
    ["note:n1", { _id: "note:n1", authorId: "user:1", readers: ["user:2"] }],
    ["note:n2", { _id: "note:n2", authorId: "user:2", readers: [] }],
  ]);

  const underExposition =
    <T extends { expositionId: string }>(
      store: Map<string, T>,
      label: string,
    ) =>
    (expositionId: string, id: string) => {
      loads.push(`${label}:${id}`);
      const doc = store.get(id);
      return doc && doc.expositionId === expositionId ? doc : null;
    };

  const user = entity("user", {
    load: (id) => {
      loads.push(`user:${id}`);
      return users.get(id);
    },
    loadMany: (paths) => {
      loads.push(`users:${paths.length}`);
      return paths.map(([id]) => users.get(id));
    },
    relations: {
      tenants: {
        id: "tenant_memberships_of_user",
        localField: "_id",
        foreignField: "userId",
        foreignCollection: "entreprises",
        type: "member",
        load: (doc) => tenantMemberships.filter((m) => m.userId === doc._id),
      },
    },
    conditions: { self: { self: true } },
  });

  const exposition = entity("exposition", {
    load: (id) => expositions.get(id),
  });

  const participant = exposition.child("participant", {
    load: (expositionId, id) =>
      underExposition(participants, "participant")(expositionId, id),
    relations: {
      memberships: {
        id: "memberships_of_participant",
        localField: "_id",
        foreignField: "participantId",
        type: "org_membership",
        load: (doc, expositionId) =>
          memberships.filter(
            (m) =>
              m.participantId === doc._id && m.expositionId === expositionId,
          ),
      },
    },
  });

  const device = exposition.child("security_device", {
    refType: "device",
    verifyExists: true,
    load: underExposition(devices, "device"),
  });

  const organization = exposition.child("expo_organization", {
    load: underExposition(organizations, "organization"),
  });

  const orgRole = organization.child("expo_organization_role", {
    load: (expositionId, organizationId, id) => {
      const doc = orgRoles.get(id);
      return doc &&
        doc.expositionId === expositionId &&
        doc.organizationId === organizationId
        ? doc
        : null;
    },
  });

  const note = entity("note", {
    load: (id) => notes.get(id),
    conditions: {
      author: { owner: (doc) => doc.authorId },
      reader: { member: (doc) => doc.readers },
      short: { test: (doc) => doc.readers.length < 2 },
    },
  });

  const sets = {
    users: permissions(user, "users", {
      create: action({ on: "none" }),
      read: action({ fields: "doc" }),
      update: action({ fields: "input" }),
      delete: action(),
      "notes.read": action(),
      "notes.update": action(),
      "notes.manage": bundle(["notes.read", "notes.update"]),
      list: list("read"),
      manage: bundle(
        ["list", "update", "delete", "notes.manage", external("consent.read")],
        { fields: "doc" },
      ),
    }),
    consent: permissions(user, "consent", {
      read: action(),
      withdraw: action(),
    }),
    expositions: permissions(exposition, "expositions", {
      create: action({ on: "none", input: true }),
      read: action({ fields: "doc" }),
      update: action({ fields: "input" }),
      "analytics.read": action(),
      list: list("read"),
      manage: bundle([
        "list",
        "update",
        "analytics.read",
        "expositions.participants.manage",
        "expositions.participants.create",
        "expositions.security.devices.manage",
        "expositions.expo_organizations.manage",
        "expositions.expo_organizations.roles.manage",
      ]),
    }),
    participants: permissions(participant, "expositions.participants", {
      create: action({ on: "parent", input: true }),
      read: action({ fields: "doc" }),
      update: action({ fields: "input" }),
      delete: action(),
      list: list("read"),
      manage: bundle(["list", "update", "delete"]),
    }),
    devices: permissions(device, "expositions.security.devices", {
      read: action({ fields: "doc" }),
      approve: action(),
      revoke: action(),
      list: list("read"),
      manage: bundle(["list", "approve", "revoke"]),
    }),
    organizations: permissions(organization, "expositions.expo_organizations", {
      read: action({ fields: "doc" }),
      update: action({ fields: "input" }),
      list: list("read"),
      manage: bundle(["list", "update"]),
    }),
    orgRoles: permissions(orgRole, "expositions.expo_organizations.roles", {
      read: action({ fields: "doc" }),
      update: action(),
      list: list("read"),
      manage: bundle(["list", "update"]),
    }),
    notes: permissions(note, "notes", {
      read: action({ fields: "doc" }),
      update: action(),
      list: list("read"),
    }),
    platform: globalPermissions("platform", {
      "analytics.read": action(),
      "analytics.manage": bundle(["analytics.read"]),
    }),
  };

  return {
    loads,
    stores: { users, participants, memberships, notes, expositions },
    entities: {
      user,
      exposition,
      participant,
      device,
      organization,
      orgRole,
      note,
    },
    sets,
    all: [
      sets.users,
      sets.consent,
      sets.expositions,
      sets.participants,
      sets.devices,
      sets.organizations,
      sets.orgRoles,
      sets.notes,
      sets.platform,
    ] as const,
  };
}

import {
  action,
  ALL,
  bundle,
  entity,
  external,
  list,
  permissions,
} from "../mod.ts";

type UserDoc = {
  _id: string;
  email: string;
  firstname?: string;
  lastname?: string;
  picture?: unknown;
};

type UsersDeps = {
  findById: (id: string) => Promise<UserDoc | null>;
  findByIds: (ids: readonly string[]) => Promise<(UserDoc | null)[]>;
  findMembershipsByUserId: (userId: string) => Promise<readonly unknown[]>;
};

export function createUsersPermissions(deps: UsersDeps) {
  const user = entity("user", {
    load: (id) => deps.findById(id),
    loadMany: (paths) => deps.findByIds(paths.map(([id]) => id)),
    relations: {
      tenants: {
        id: "tenant_memberships_of_user",
        localField: "_id",
        foreignField: "userId",
        foreignCollection: "entreprises",
        type: "member",
        load: (doc) => deps.findMembershipsByUserId(doc._id),
      },
    },
  });

  const users = permissions(user, "users", {
    create: action({ on: "none" }),
    read: action({ fields: "doc" }),
    list: list("read"),
    update: action({ fields: "input" }),
    delete: action(),
    "roles.create": action(),
    "roles.read": action(),
    "roles.update": action(),
    "roles.delete": action(),
    "sessions.list": action(),
    "sessions.revoke": action(),
    "lifecycle.suspend": action(),
    "lifecycle.ban": action(),
    "lifecycle.reactivate": action(),
    "lifecycle.delete": action(),
    "lifecycle.manage": bundle([
      "lifecycle.suspend",
      "lifecycle.ban",
      "lifecycle.reactivate",
      "lifecycle.delete",
    ]),
    "notes.read": action(),
    "notes.create": action(),
    "notes.update": action(),
    "notes.delete": action(),
    "notes.manage": bundle([
      "notes.read",
      "notes.create",
      "notes.update",
      "notes.delete",
    ]),
    "tags.read": action(),
    "tags.update": action(),
    "tags.manage": bundle(["tags.read", "tags.update"]),
    manage: bundle(
      [
        "list",
        "update",
        "delete",
        "roles.read",
        "roles.update",
        "roles.create",
        "roles.delete",
        "sessions.list",
        "sessions.revoke",
        "tags.manage",
        "lifecycle.manage",
        "notes.manage",
        external("consent.read"),
        external("consent.withdraw"),
      ],
      { fields: "doc" },
    ),
  });

  const consent = permissions(user, "consent", {
    read: action(),
    withdraw: action(),
  });

  const selfGrants = (subjectId: string) => [
    users.grant("read", { id: "self:users.read", on: subjectId }),
    users.grant("update", {
      id: "self:users.update",
      on: subjectId,
      fields: ["firstname", "lastname"],
    }),
  ];

  const directoryGrant = users.grant("read", {
    id: "members-directory:users.read",
    on: ALL,
    fields: ["_id", "firstname", "lastname", "picture"],
  });

  return { user, users, consent, selfGrants, directoryGrant };
}

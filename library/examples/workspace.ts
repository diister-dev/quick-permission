import { action, bundle, entity, list, permissions } from "../mod.ts";

export type Organisation = { _id: string; name: string };

export type Workspace = {
  _id: string;
  organisationId: string;
  name: string;
  archived: boolean;
};

export type Document = {
  _id: string;
  workspaceId: string;
  title: string;
  body: string;
  status: "draft" | "published";
  authorId: string;
  collaborators: string[];
};

export type Membership = {
  _id: string;
  userId: string;
  organisationId: string;
  status: "active" | "left";
};

export type Link = {
  _id: string;
  documentId: string;
  kind: "share" | "embed";
  audience: "public" | "organisation";
};

export type Account = { _id: string; email: string; name: string };

export type Store = {
  readonly organisations: Map<string, Organisation>;
  readonly workspaces: Map<string, Workspace>;
  readonly documents: Map<string, Document>;
  readonly accounts: Map<string, Account>;
  readonly memberships: Membership[];
  readonly links: Link[];
};

export function declare(store: Store) {
  const organisation = entity("organisation", {
    load: (id) => store.organisations.get(id),
  });

  const account = entity("account", {
    load: (id) => store.accounts.get(id),
    relations: {
      memberships: {
        localField: "_id",
        foreignField: "userId",
        foreignCollection: "memberships",
        load: (doc) =>
          store.memberships.filter((row) => row.userId === doc._id),
      },
    },
    conditions: { self: { self: true } },
    belongsTo: {
      organisation: {
        to: organisation,
        through: "memberships",
        where: (owner) => ({ organisationId: owner, status: "active" }),
      },
    },
  });

  const workspace = entity("workspace", {
    load: (id) => store.workspaces.get(id),
    belongsTo: { organisation: { to: organisation, field: "organisationId" } },
  });

  const document = workspace.child("document", {
    load: (workspaceId, id) => {
      const found = store.documents.get(id);
      return found?.workspaceId === workspaceId ? found : null;
    },
    verifyExists: true,
    relations: {
      links: {
        localField: "_id",
        foreignField: "documentId",
        foreignCollection: "links",
        only: { kind: "share" },
        load: (doc) =>
          store.links.filter(
            (row) => row.documentId === doc._id && row.kind === "share",
          ),
      },
    },
    conditions: {
      author: { owner: "authorId" },
      collaborator: { member: "collaborators" },
    },
  });

  const sets = {
    organisations: permissions(organisation, "organisations", {
      read: action({ fields: "doc" }),
      update: action({ fields: "input" }),
    }),
    accounts: permissions(account, "accounts", {
      read: action({ fields: "doc" }),
      list: list("read"),
    }),
    workspaces: permissions(workspace, "workspaces", {
      create: action({ on: "none", input: true }),
      read: action({ fields: "doc" }),
      update: action({ fields: "input" }),
      archive: action(),
      list: list("read"),
      manage: bundle(["list", "update", "archive", "documents.manage"]),
    }),
    documents: permissions(document, "workspaces.documents", {
      create: action({ on: "parent", input: true }),
      read: action({ fields: "doc" }),
      update: action({ fields: "input" }),
      delete: action({ forbid: ["collaborator"] }),
      list: list("read"),
      manage: bundle(["list", "update", "delete"]),
    }),
  };

  return {
    entities: { organisation, account, workspace, document },
    sets,
    all: [
      sets.organisations,
      sets.accounts,
      sets.workspaces,
      sets.documents,
    ] as const,
  };
}

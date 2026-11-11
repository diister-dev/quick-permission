import { test } from "node:test";
import { declare, type Document, type Store } from "../examples/workspace.ts";
import { ALL, createSystem, type Grant, memory } from "../mod.ts";
import { assert, assertEquals } from "./+assert.ts";

const ACME = "organisation:acme";
const GLOBEX = "organisation:globex";
const SPACE = "workspace:w1";

function store(): Store {
  const document = (
    id: string,
    workspaceId: string,
    status: Document["status"],
    authorId: string,
    collaborators: string[] = [],
  ): [string, Document] => [
    id,
    {
      _id: id,
      workspaceId,
      title: `Title of ${id}`,
      body: `Body of ${id}`,
      status,
      authorId,
      collaborators,
    },
  ];
  return {
    organisations: new Map([
      [ACME, { _id: ACME, name: "Acme" }],
      [GLOBEX, { _id: GLOBEX, name: "Globex" }],
    ]),
    workspaces: new Map([
      [
        SPACE,
        { _id: SPACE, organisationId: ACME, name: "Launch", archived: false },
      ],
      [
        "workspace:w2",
        {
          _id: "workspace:w2",
          organisationId: ACME,
          name: "Old",
          archived: true,
        },
      ],
      [
        "workspace:w3",
        {
          _id: "workspace:w3",
          organisationId: GLOBEX,
          name: "Rival",
          archived: false,
        },
      ],
    ]),
    documents: new Map([
      document("document:d1", SPACE, "draft", "account:ada", ["account:bob"]),
      document("document:d2", SPACE, "published", "account:bob"),
      document("document:d3", "workspace:w2", "published", "account:ada"),
      document("document:d4", "workspace:w3", "published", "account:cy"),
    ]),
    accounts: new Map([
      [
        "account:ada",
        { _id: "account:ada", email: "ada@acme.test", name: "Ada" },
      ],
      [
        "account:bob",
        { _id: "account:bob", email: "bob@acme.test", name: "Bob" },
      ],
      [
        "account:cy",
        { _id: "account:cy", email: "cy@globex.test", name: "Cy" },
      ],
    ]),
    memberships: [
      {
        _id: "m1",
        userId: "account:ada",
        organisationId: ACME,
        status: "active",
      },
      {
        _id: "m2",
        userId: "account:bob",
        organisationId: ACME,
        status: "active",
      },
      {
        _id: "m3",
        userId: "account:cy",
        organisationId: GLOBEX,
        status: "active",
      },
      {
        _id: "m4",
        userId: "account:ada",
        organisationId: GLOBEX,
        status: "left",
      },
    ],
    links: [
      {
        _id: "l1",
        documentId: "document:d2",
        kind: "share",
        audience: "public",
      },
      {
        _id: "l2",
        documentId: "document:d1",
        kind: "embed",
        audience: "public",
      },
      {
        _id: "l3",
        documentId: "document:d3",
        kind: "share",
        audience: "organisation",
      },
    ],
  };
}

function setup(
  grantsOf: (world: ReturnType<typeof declare>) => Record<string, Grant[]>,
) {
  const data = store();
  const world = declare(data);
  const held = grantsOf(world);
  const system = createSystem({
    permissions: world.all,
    providers: [
      {
        name: "held",
        cacheKey: (subject) => subject.id,
        fetch: (subject) => held[subject.id] ?? [],
      },
    ],
  });
  const as = (id: string) => system.context({ subject: { id } });
  return { data, world, system, as };
}

test("workspace: an editor reads every document and updates only its own", async () => {
  const { as } = setup(({ sets }) => ({
    "account:bob": [
      sets.documents.grant("read", { on: [SPACE, ALL] }),
      sets.documents.grant("update", { on: [SPACE, ALL], when: ["author"] }),
    ],
  }));
  const bob = as("account:bob");

  const read = await bob.check(
    "workspaces.documents.read",
    SPACE,
    "document:d1",
  );
  assert(read.ok);
  assertEquals(read.doc?.title, "Title of document:d1");

  const input = { title: "New" };
  assertEquals(
    (
      await bob.check("workspaces.documents.update", SPACE, "document:d2", {
        input,
      })
    ).ok,
    true,
  );
  assertEquals(
    (
      await bob.check("workspaces.documents.update", SPACE, "document:d1", {
        input,
      })
    ).ok,
    false,
  );
  assertEquals(await bob.could("workspaces.documents.update", SPACE), true);
  assertEquals(await bob.reach("workspaces.documents.update", SPACE), "some");
  assertEquals(await bob.reach("workspaces.documents.read", SPACE), "all");
});

test("workspace: a delete is refused to a collaborator, whoever granted it", async () => {
  const { as } = setup(({ sets }) => ({
    "account:bob": [sets.documents.grant("manage", { on: [SPACE, ALL] })],
  }));
  const bob = as("account:bob");
  assertEquals(
    (await bob.check("workspaces.documents.delete", SPACE, "document:d1")).ok,
    false,
  );
  assertEquals(
    (await bob.check("workspaces.documents.delete", SPACE, "document:d2")).ok,
    true,
  );
});

test("workspace: a document is only found under its own workspace", async () => {
  const { as } = setup(({ sets }) => ({
    "account:bob": [sets.documents.grant("read", { on: [ALL, ALL] })],
  }));
  const bob = as("account:bob");
  assertEquals(
    (
      await bob.check(
        "workspaces.documents.read",
        "workspace:w3",
        "document:d4",
      )
    ).ok,
    true,
  );
  const misplaced = await bob.check(
    "workspaces.documents.read",
    SPACE,
    "document:d4",
  );
  assert(!misplaced.ok);
  assertEquals(misplaced.reasons, [
    "exists[document] document:d4 not found under its parents",
  ]);
});

test("workspace: a public link opens the documents it points to, in a check and in a list", async () => {
  const { as, data } = setup(({ sets }) => ({
    "account:guest": [
      sets.documents.grant("list", {
        id: "public-links",
        on: [SPACE, ALL],
        related: { links: { audience: "public" } },
        fields: { _id: true, title: true },
      }),
    ],
  }));
  const guest = as("account:guest");

  const shared = await guest.check(
    "workspaces.documents.read",
    SPACE,
    "document:d2",
  );
  assert(shared.ok);
  assertEquals(shared.doc, {
    _id: "document:d2",
    title: "Title of document:d2",
  });
  assertEquals(
    (await guest.check("workspaces.documents.read", SPACE, "document:d1")).ok,
    false,
  );

  const scope = await guest.scope("workspaces.documents.list", SPACE);
  assert(scope.ok);
  assertEquals(scope.grants, ["public-links"]);
  assertEquals(scope.query, {
    filter: {},
    stages: [
      {
        $lookup: {
          from: "links",
          localField: "_id",
          foreignField: "documentId",
          pipeline: [{ $match: { kind: "share" } }],
          as: "_links_of_document",
        },
      },
      {
        $match: {
          _links_of_document: {
            $elemMatch: { kind: "share", audience: "public" },
          },
        },
      },
    ],
  });

  const inSpace = [...data.documents.values()].filter(
    (doc) => doc.workspaceId === SPACE,
  );
  const keeps = memory().compile(scope.plan);
  const listed = inSpace.filter((doc) =>
    keeps(doc, () => data.links.filter((link) => link.documentId === doc._id)),
  );
  assertEquals(
    listed.map((doc) => doc._id),
    ["document:d2"],
  );
  assertEquals(await scope.projectAll(inSpace), [
    { _id: "document:d2", title: "Title of document:d2" },
  ]);
});

test("workspace: an organisation is a boundary for the roles it hands out", () => {
  const { system, world } = setup(() => ({}));
  const { sets, entities } = world;
  const acme = system.boundary(entities.organisation, ACME);
  const mine = { organisationId: ACME };

  const keys = acme.keys();
  assertEquals(keys.includes("organisations.update"), true);
  assertEquals(keys.includes("workspaces.documents.read"), true);
  assertEquals(keys.includes("accounts.list"), true);
  assertEquals(keys.includes("workspaces.create"), false);

  const envelope = [
    acme.bind(sets.workspaces.grant("manage", { on: ALL })),
    acme.bind(sets.accounts.grant("list", { on: ALL })),
  ];
  assertEquals(envelope[0].where, mine);

  const judged = acme.within(envelope, [
    acme.bind(sets.documents.grant("read", { id: "inside", on: [ALL, ALL] })),
    sets.documents.grant("read", { id: "unbound", on: [ALL, ALL] }),
    sets.workspaces.grant("update", {
      id: "elsewhere",
      on: ALL,
      where: { organisationId: GLOBEX },
    }),
    sets.organisations.grant("update", { id: "not-held", on: ACME }),
    sets.organisations.grant("update", { id: "other-tree", on: GLOBEX }),
  ]);
  assertEquals(
    judged.kept.map((grant) => grant.id),
    ["inside"],
  );
  assertEquals(
    judged.dropped.map((refusal) => [refusal.grant.id, refusal.code]),
    [
      ["unbound", "outside-boundary"],
      ["elsewhere", "outside-boundary"],
      ["not-held", "not-held"],
      ["other-tree", "outside-boundary"],
    ],
  );
});

test("workspace: a workspace that changes organisation leaves the roles of the old one", async () => {
  const { as, data } = setup(({ sets }) => ({
    "account:ada": [
      sets.documents.grant("read", {
        on: [ALL, ALL],
        parents: { workspace: { organisationId: ACME } },
      }),
    ],
  }));
  assertEquals(
    (
      await as("account:ada").check(
        "workspaces.documents.read",
        SPACE,
        "document:d1",
      )
    ).ok,
    true,
  );
  assertEquals(
    (
      await as("account:ada").check(
        "workspaces.documents.read",
        "workspace:w3",
        "document:d4",
      )
    ).ok,
    false,
  );

  const moved = data.workspaces.get(SPACE);
  assert(moved);
  data.workspaces.set(SPACE, { ...moved, organisationId: GLOBEX });
  assertEquals(
    (
      await as("account:ada").check(
        "workspaces.documents.read",
        SPACE,
        "document:d1",
      )
    ).ok,
    false,
  );
});

test("workspace: listing the accounts of an organisation never shows the others", async () => {
  const { as, data, system, world } = setup(({ sets, entities }) => {
    const acme = createSystem({ permissions: [sets.accounts] }).boundary(
      entities.organisation,
      ACME,
    );
    return {
      "account:ada": [
        acme.bind(
          sets.accounts.grant("list", {
            on: ALL,
            fields: { _id: true, name: true },
          }),
        ),
      ],
    };
  });
  assertEquals(
    system
      .boundary(world.entities.organisation, ACME)
      .keys()
      .includes("accounts.list"),
    true,
  );
  const scope = await as("account:ada").scope("accounts.list");
  assert(scope.ok);
  const keeps = memory().compile(scope.plan);
  const listed = [...data.accounts.values()].filter((doc) =>
    keeps(doc, () => data.memberships.filter((row) => row.userId === doc._id)),
  );
  assertEquals(
    listed.map((doc) => doc._id),
    ["account:ada", "account:bob"],
  );
  assertEquals(await scope.projectAll([...data.accounts.values()]), [
    { _id: "account:ada", name: "Ada" },
    { _id: "account:bob", name: "Bob" },
  ]);
});

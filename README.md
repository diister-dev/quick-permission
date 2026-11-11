# @diister/quick-permission

Declarative, type-safe permissions that answer three questions at once: **may
this subject act?**, **on which rows?**, and **which fields come back?**

The same decision serves one document and a list. A check on one document
returns the visible part of that document. A scope on a list returns a query
for your storage that keeps exactly the rows the subject may see, and a
projection that trims each row to its visible fields.

[![npm](https://img.shields.io/npm/v/@diister/quick-permission)](https://www.npmjs.com/package/@diister/quick-permission)
[![JSR](https://jsr.io/badges/@diister/quick-permission)](https://jsr.io/@diister/quick-permission)
[![License](https://img.shields.io/github/license/diister-dev/quick-permission)](LICENSE)

Runs on Bun, Node.js 20.11+ and Deno. No runtime dependencies.

## Installation

```bash
# Bun / npm / pnpm / yarn
bun add @diister/quick-permission

# Deno
deno add jsr:@diister/quick-permission
```

Upgrading from 0.9: read
[docs/migrating-to-0.10.md](https://github.com/diister-dev/quick-permission/blob/develop/docs/migrating-to-0.10.md).

## Five-minute example

A workspace holds documents. Ada may list the published documents of one
workspace, and sees only their id and title.

```ts
import {
  ALL,
  action,
  createSystem,
  entity,
  list,
  memory,
  permissions,
} from "@diister/quick-permission";

type Workspace = { _id: string; name: string };
type Document = { _id: string; workspaceId: string; title: string; status: string };

const workspaceRows = new Map<string, Workspace>([
  ["workspace:w1", { _id: "workspace:w1", name: "Launch" }],
]);
const documentRows: Document[] = [
  { _id: "document:d1", workspaceId: "workspace:w1", title: "Plan", status: "draft" },
  { _id: "document:d2", workspaceId: "workspace:w1", title: "Notes", status: "published" },
];

const workspace = entity("workspace", { load: (id) => workspaceRows.get(id) });
const document = workspace.child("document", {
  load: (workspaceId, id) =>
    documentRows.find((doc) => doc._id === id && doc.workspaceId === workspaceId),
});

const documents = permissions(document, "workspaces.documents", {
  read: action({ fields: "doc" }),
  list: list("read"),
});

const system = createSystem({
  permissions: [documents],
  providers: [
    (subject) =>
      subject.id === "account:ada"
        ? [
            documents.grant("list", {
              id: "ada-published",
              on: ["workspace:w1", ALL],
              where: { status: "published" },
              fields: { _id: true, title: true },
            }),
          ]
        : [],
  ],
  storage: memory(),
});

const ctx = system.context({ subject: { id: "account:ada" } });

console.log(await ctx.check("workspaces.documents.read", "workspace:w1", "document:d2"));
// { ok: true, grants: ["ada-published"], doc: { _id: "document:d2", title: "Notes" } }
console.log((await ctx.check("workspaces.documents.read", "workspace:w1", "document:d1")).ok);
// false

const scope = await ctx.scope("workspaces.documents.list", "workspace:w1");
if (scope.ok) {
  const inWorkspace = documentRows.filter((doc) => doc.workspaceId === "workspace:w1");
  const rows = inWorkspace.filter((doc) => scope.query(doc));
  console.log(await scope.projectAll(rows));
  // [{ _id: "document:d2", title: "Notes" }]
}
```

The example uses the in-memory adapter so that it runs as is. The default
adapter is `mongo()`, whose `scope.query` is a MongoDB filter or pipeline (see
[Storage adapters](#storage-adapters)).

## Concepts

### Domain used in the examples

The examples below share one domain, the one of
[`library/examples/workspace.ts`](https://github.com/diister-dev/quick-permission/blob/develop/library/examples/workspace.ts): organisations,
accounts that are members of organisations, workspaces owned by an
organisation, documents inside a workspace, and share links on documents.
Each example after this block reuses its names. The library names an example
uses beyond this block (`ALL`, `memory`, `implies`...) come from the same
import.

```ts
import {
  action,
  bundle,
  createSystem,
  entity,
  type Grant,
  list,
  permissions,
} from "@diister/quick-permission";

type Organisation = { _id: string; name: string };
type Account = { _id: string; email: string; name: string };
type Membership = {
  _id: string;
  userId: string;
  organisationId: string;
  status: "active" | "left";
};
type Workspace = {
  _id: string;
  organisationId: string;
  name: string;
  archived: boolean;
};
type Document = {
  _id: string;
  workspaceId: string;
  title: string;
  body: string;
  status: "draft" | "published";
  authorId: string;
  collaborators: string[];
};
type Link = {
  _id: string;
  documentId: string;
  kind: "share" | "embed";
  audience: "public" | "organisation";
};

const ACME = "organisation:acme";
const W1 = "workspace:w1";

const db = {
  organisations: new Map<string, Organisation>([
    [ACME, { _id: ACME, name: "Acme" }],
  ]),
  accounts: new Map<string, Account>([
    ["account:ada", { _id: "account:ada", email: "ada@acme.test", name: "Ada" }],
    ["account:bob", { _id: "account:bob", email: "bob@acme.test", name: "Bob" }],
  ]),
  memberships: [
    { _id: "m1", userId: "account:ada", organisationId: ACME, status: "active" },
    { _id: "m2", userId: "account:bob", organisationId: ACME, status: "left" },
  ] as Membership[],
  workspaces: new Map<string, Workspace>([
    [W1, { _id: W1, organisationId: ACME, name: "Launch", archived: false }],
  ]),
  documents: new Map<string, Document>([
    [
      "document:d1",
      {
        _id: "document:d1",
        workspaceId: W1,
        title: "Plan",
        body: "Draft plan",
        status: "draft",
        authorId: "account:ada",
        collaborators: ["account:bob"],
      },
    ],
    [
      "document:d2",
      {
        _id: "document:d2",
        workspaceId: W1,
        title: "Notes",
        body: "Meeting notes",
        status: "published",
        authorId: "account:bob",
        collaborators: [],
      },
    ],
  ]),
  links: [
    { _id: "l1", documentId: "document:d2", kind: "share", audience: "public" },
  ] as Link[],
};

const organisation = entity("organisation", {
  load: (id) => db.organisations.get(id),
});

const account = entity("account", {
  load: (id) => db.accounts.get(id),
  relations: {
    memberships: {
      localField: "_id",
      foreignField: "userId",
      foreignCollection: "memberships",
      load: (doc) => db.memberships.filter((row) => row.userId === doc._id),
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
  load: (id) => db.workspaces.get(id),
  belongsTo: { organisation: { to: organisation, field: "organisationId" } },
});

const document = workspace.child("document", {
  load: (workspaceId, id) => {
    const found = db.documents.get(id);
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
        db.links.filter(
          (row) => row.documentId === doc._id && row.kind === "share",
        ),
    },
  },
  conditions: {
    author: { owner: "authorId" },
    collaborator: { member: "collaborators" },
  },
});

const organisations = permissions(organisation, "organisations", {
  read: action({ fields: "doc" }),
  update: action({ fields: "input" }),
});

const accounts = permissions(account, "accounts", {
  read: action({ fields: "doc" }),
  list: list("read"),
});

const workspaces = permissions(workspace, "workspaces", {
  create: action({ on: "none", input: true }),
  read: action({ fields: "doc" }),
  update: action({ fields: "input" }),
  archive: action(),
  list: list("read"),
  manage: bundle(["list", "update", "archive", "documents.manage"]),
});

const documents = permissions(document, "workspaces.documents", {
  create: action({ on: "parent", input: true }),
  read: action({ fields: "doc" }),
  update: action({ fields: "input" }),
  delete: action({ forbid: ["collaborator"] }),
  list: list("read"),
  manage: bundle(["list", "update", "delete"]),
});

const held = new Map<string, Grant[]>();

const system = createSystem({
  permissions: [organisations, accounts, workspaces, documents],
  providers: [
    {
      name: "stored",
      cacheKey: (subject) => subject.id,
      fetch: (subject) => held.get(subject.id) ?? [],
    },
  ],
});
```

### Entities

An entity says how to load one kind of document and how to name it.

- `entity(name, options)` declares a root entity. Its documents are addressed
  by one reference, such as `"workspace:w1"`.
- `parent.child(name, options)` declares an entity that lives under a parent.
  Its documents are addressed by the path of references from the root, such as
  `["workspace:w1", "document:d1"]`. A child shares the reference convention
  of its root.
- `load(...ids)` receives that path and returns the document, or `null` /
  `undefined` when there is none. An entity without `load` is a plain
  reference: the library never reads it, and grants on it cannot carry
  `where`.
- `loadMany(paths)` loads several documents at once. Inside one context, the
  loads of the same entity started in the same tick are merged into one call.
  The result must be aligned with `paths` by index; a result of the wrong
  length is an error, and every check of that batch is denied. When
  `loadMany` is present it serves every read, but the entity still counts as
  stored only if it declares `load`.
- `refType` is the type part of the references (default: the name).
- `idField` is the field of the document that holds its reference (default:
  `_id`). It is used by `seed`, by the `self` condition and by the row filter
  of a grant that pins one document.
- `verifyExists: true` makes every check on a concrete document load it and
  deny when it is missing. Without it, a document is loaded only when a grant
  needs to read it, so a grant with no condition passes on any id.

```ts
import { entity } from "@diister/quick-permission";

type Profile = { id: string; displayName: string };
const profileRows = new Map<string, Profile>();

const profile = entity("profile", {
  refType: "account",
  idField: "id",
  load: (id) => profileRows.get(id),
  loadMany: (paths) => paths.map(([id]) => profileRows.get(id)),
  verifyExists: true,
});
```

**Relations** describe rows of another collection joined to a document. A
grant constrains them through `related`.

| Option | Meaning |
| --- | --- |
| `localField` | field of the document (or of the `via` row) used for the join |
| `foreignField` | field of the joined rows that must equal it |
| `foreignCollection` | collection of the joined rows; omitted means the entity's own collection |
| `only` | a condition every joined row must hold, whatever the grant says |
| `via` | name of a relation declared before this one, joined first |
| `load(doc, ...ids)` | returns the joined rows of one document, for checks on a concrete document |
| `id` | identifier in plans and pipelines (default: `<name>_of_<entity>`) |

`load` is required. A check on a concrete document decides a `related`
condition from the rows `load` returns; the engine does not apply `only` to
them, so `load` must return only rows that hold `only`.

```ts
import { entity } from "@diister/quick-permission";

type Document = { _id: string; authorId: string };
const documentRows = new Map<string, Document>();
const accountRows: { _id: string; email: string }[] = [];
const membershipRows: { userId: string; organisationId: string; status: string }[] = [];

const document = entity("document", {
  load: (id) => documentRows.get(id),
  relations: {
    author: {
      localField: "authorId",
      foreignField: "_id",
      foreignCollection: "accounts",
      load: (doc) => accountRows.filter((row) => row._id === doc.authorId),
    },
    authorMemberships: {
      via: "author",
      localField: "_id",
      foreignField: "userId",
      foreignCollection: "memberships",
      only: { status: "active" },
      load: (doc) =>
        membershipRows.filter(
          (row) => row.userId === doc.authorId && row.status === "active",
        ),
    },
  },
});
```

**Named conditions** are tests a grant opts into with `when`, and an action
excludes with `forbid`.

| Form | Holds when | Row filter in a list |
| --- | --- | --- |
| `{ self: true }` | the entity's own reference equals the subject id | `{ [idField]: subject.id }` |
| `{ owner: "field" }` | `doc.field` equals the subject id | `{ field: subject.id }` |
| `{ member: "field" }` | the array `doc.field` contains the subject id | `{ field: subject.id }` |
| `{ owner: (doc) => id }`, `{ member: (doc) => ids }` | same, computed | none |
| `{ test: (doc, context) => boolean, whenUnknown }` | the function returns `true` | none |

A condition without a field cannot become a row filter. On a question with no
concrete document, a grant that needs it is refused, unless the condition is a
`test` with `whenUnknown: "allow"`: then the grant passes and the answer stays
partial (`reach` answers `some`, and `scope` relies on the per-row
projection). `context` holds `subject`, `ids`, `input`, `at`, `ip` and the
`grant`. A `forbid` condition with a field becomes a `$ne` row filter; one
without a field is applied only on a concrete document, so a list query does
not exclude its rows and the per-row projection drops them.

```ts
held.set("account:bob", [
  documents.grant("update", { on: [W1, ALL], when: ["author"] }),
]);
const bob = system.context({ subject: { id: "account:bob" } });
const edit = { input: { title: "New title" } };

console.log((await bob.check("workspaces.documents.update", W1, "document:d2", edit)).ok);
// true: Bob wrote d2
console.log((await bob.check("workspaces.documents.update", W1, "document:d1", edit)).ok);
// false
const editable = await bob.scope("workspaces.documents.update", W1);
console.log(editable.ok && editable.query);
// { filter: { authorId: "account:bob" }, stages: null }
```

**Ownership** (`belongsTo`) says what an entity belongs to. It is read only by
[boundaries](#delegation-and-boundaries).

- `{ to: organisation, field: "organisationId" }`: the owner's reference is a
  field of the document. The entity must declare `load`.
- `{ to: organisation, through: "memberships", where: (owner) => condition }`:
  the link goes through a relation, with the condition that makes it active.
- A child belongs to its parent by its path, with nothing to declare.

### Permission keys

`permissions(entity, prefix, spec)` declares the keys that act on an entity.
Each key is `<prefix>.<name>`. Without a prefix, the names are the full keys.
`globalPermissions(prefix, spec)` declares keys that act on no document.

`action(options)` declares a key that is checked as such.

| Option | Meaning |
| --- | --- |
| `on` | `"self"` (default): the target is the document. `"parent"`: the target is the parent path, for a create. `"none"`: no target |
| `fields` | `"doc"`: a check returns the document trimmed to the grant's `fields`. `"input"`: a check returns the input trimmed to the grant's `fields` |
| `input` | `true`: a grant may carry an `input` condition, tested against the input of the check |
| `forbid` | names of the entity's conditions that deny the action for every grant when they hold |
| `targetConstraint` | default `true`: a grant that pins one document adds `{ [idField]: id }` to the list filter. `false` leaves it out |
| `rules` | [custom rules](#custom-rules) |
| `meta` | free metadata, returned by the [catalog](#catalog-and-introspection) |

`list(read, options)` declares a list key. It includes the action `read`, so a
list grant also grants `read` on each row, and `scope` takes the fields of
each row from `read`. `options.includes` adds more keys.

`bundle(includes, options)` declares a key that grants the keys it includes.
A grant on a bundle becomes one grant per included key, with the same target
(extended with wildcards for a key that acts deeper), the same conditions,
`when`, `payload` and tags. Its `fields` reach only the keys that project. An
included name is first looked up as a sibling (`"read"` in the set
`"workspaces"` is `"workspaces.read"`), then as written. `external(key)`
skips the sibling lookup. `options.expand(grant)` may return more grants, for
links the declaration cannot express. A bundle accepts `on`, `fields: "doc"`,
`rules` and `meta` like an action.

```ts
const reviews = permissions(document, "reviews", {
  read: action({ fields: "doc", meta: { label: "Read for review" } }),
  approve: action({ targetConstraint: false }),
  everything: bundle(["read", "approve", external("workspaces.documents.read")]),
});

const reviewSystem = createSystem({ permissions: [workspaces, documents, reviews] });
console.log(reviewSystem.expand([reviews.grant("everything", { on: [W1, ALL] })]).map((grant) => grant.key));
// ["reviews.everything", "reviews.read", "reviews.approve", "workspaces.documents.read"]
```

`createSystem` and `compilePermissions` refuse a catalogue with mistakes, and
name all of them at once: a key declared twice, a list whose `read` is not an
action, an include of an unknown key, an include that acts on a wider scope or
under other entities, and a bundle cycle. Declaring a set already refuses a
`forbid` that names no condition of the entity.

```ts
import { action, bundle, createSystem, entity, list, permissions } from "@diister/quick-permission";

const workspace = entity("workspace", { load: (id) => ({ _id: id }) });

try {
  createSystem({
    permissions: [
      permissions(workspace, "workspaces", {
        read: action(),
        manage: bundle(["read", "publish", "loop"]),
        loop: bundle(["manage"]),
        list: list("manage"),
      }),
    ],
  });
} catch (error) {
  console.log((error as Error).message);
}
// Permission schema is invalid:
//   - "workspaces.manage" includes unknown key "publish"
//   - "workspaces.list" lists through "workspaces.manage", which is not an action
//   - bundle cycle: workspaces.manage -> workspaces.loop -> workspaces.manage
```

### Grants

A grant gives one key to a subject. It has one shape, for a grant built in
code and for a grant read from a database:

| Field | Meaning |
| --- | --- |
| `key` | the permission key |
| `id` | optional; listed in `grants` of a result and in the reasons of a deny |
| `on` | the target, one reference per entity of the key's path; a wildcard (`"document:*"`) matches every document of that type |
| `where` | a [condition](#conditions) on the document itself |
| `parents` | conditions on parent documents, by entity name |
| `related` | conditions on joined rows, by relation name; one joined row must hold it |
| `fields` | the visible fields, as an allow-list: `{ _id: true, author: { name: true } }` |
| `when` | named conditions that must hold |
| `input` | a condition on the input of the check |
| `payload` | free data for custom rules; compared as a whole by delegation |

Every other top-level field is a tag. Tags travel with the grant and are
ignored by the decision.

`set.grant(name, options)` builds a grant and validates it at once: it throws
on a mistake. `on` also accepts `ALL` (every segment is a wildcard), a single
reference for a key with one segment, and `ALL` as one segment of a path.
`fields: ALL` means no field list. Tags go in `extra`.

```ts
const built = documents.grant("read", {
  id: "bob-w1",
  on: [W1, ALL],
  where: { status: "published" },
  fields: { _id: true, title: true },
  extra: { grantedBy: "account:ada" },
});
console.log(built);
// {
//   grantedBy: "account:ada", id: "bob-w1", key: "workspaces.documents.read",
//   on: ["workspace:w1", "document:*"], where: { status: "published" },
//   fields: { _id: true, title: true },
// }

const stored: Grant = {
  key: "workspaces.documents.read",
  on: [W1, "document:*"],
  parents: { workspace: { archived: false } },
};
console.log(system.explain(stored));
// null
console.log(system.explain({ key: "workspaces.documents.read", on: [W1] }));
// "target has 1 segments, the key takes 2"
console.log(system.audit([stored, { key: "workspaces.documents.publish", on: [W1, "document:*"] }]));
// [{ grant: { key: "workspaces.documents.publish", ... }, reason: 'unknown permission key "workspaces.documents.publish"' }]
```

A grant is validated when `set.grant` builds it, when a provider returns it
(an invalid one is dropped and reported to `onGrantRejected`), by
`system.explain(grant)` (the reason, or `null`) and `system.audit(grants)`
(every rejection, including those found while expanding bundles), and by
delegation (code `invalid`). It is refused when:

- it carries a 0.9 field (`target`, `with`, `filter`, `flags`, `inputWith`);
  the reason names the replacement;
- the key is unknown;
- the target is missing, has the wrong length, or a segment of the wrong
  type;
- `where`, `input`, a value of `parents` or `related` is not a condition, or
  holds a forbidden operator;
- `where` is set on a key that does not act on a document with a `load`, a
  name in `parents` is not a stored parent of the key, a name in `related` is
  not a relation of its entity;
- a name in `when` is declared neither by the entity nor by a rule of the key;
- `input` is set on an action without `input: true`, or `fields` on an action
  that projects nothing;
- `fields` is not a selection whose leaves are `true`.

### Providers

A provider returns the grants of a subject. The engine asks the providers for
each key it decides, and a subject may act when one valid grant passes.

A function provider, `(subject, key, ids, access) => grants`, is called for
every question. An object provider can be skipped and cached:

| Field | Effect |
| --- | --- |
| `name` | names the provider in hooks and in reasons (default: `provider#<index>`) |
| `keys` | the keys it emits; a pattern may end with `*` (`"workspaces.*"`). It is also consulted for every key a bundle it emits includes |
| `matches(key)` | the same, as a function |
| `targetType` | consulted only when the first id of the question is one concrete reference of that type (or one of these types) |
| `cacheKey(subject, key, ids)` | within one context, the result is reused for the same cache key; `undefined` skips the cache |
| `fetch(subject, key, ids, access)` | returns the grants; `access.read(entity)` loads a document of the question's path, or `null` when that part is not concrete |

`entity.grants(name, { keys, for })` builds an object provider for grants that
depend on one document of that entity. `for` receives `{ subject, key, ids,
doc }`; `doc()` loads the document only when called. The provider is cached
per subject and document, and gives nothing to a question that does not name
one concrete document of that entity.

```ts
const orgMembers = workspace.grants("organisation-members", {
  keys: ["workspaces.read"],
  for: async ({ subject, ids: [workspaceId], doc }) => {
    const current = await doc();
    const member = db.memberships.some(
      (row) =>
        row.userId === subject.id &&
        row.organisationId === current?.organisationId &&
        row.status === "active",
    );
    return member ? [workspaces.grant("read", { on: workspaceId })] : [];
  },
});

const memberSystem = createSystem({
  permissions: [workspaces, documents],
  providers: [
    orgMembers,
    {
      name: "creators",
      keys: ["workspaces.create"],
      cacheKey: (subject) => subject.id,
      fetch: (subject) =>
        subject.id === "account:ada"
          ? [workspaces.grant("create", { input: { organisationId: ACME } })]
          : [],
    },
  ],
});
const ada = memberSystem.context({ subject: { id: "account:ada" } });
console.log((await ada.check("workspaces.read", W1)).ok);
// true
console.log((await ada.check("workspaces.create", { input: { organisationId: ACME } })).ok);
// true
```

A provider error never grants a right. A provider whose `fetch` or `cacheKey`
throws contributes no grant; the others are still used, the error reaches
`onError`, and a denied result lists `provider <name> failed: <message>` in
its reasons. Within a context, a cached failure is not retried.

### Checking

`system.context({ subject, input?, at?, ip? })` binds a subject for one
request. A context caches loaded documents and cached provider results; make
a new one per request. There is no check outside a context.

| Method | Answers |
| --- | --- |
| `check(key, ...ids, options?)` | may the subject act on this document? `ids` must be concrete; a wildcard gives `ok: false` |
| `could(key, ...ids)` | is there at least one document the subject may act on? Missing ids are wildcards |
| `reach(key, ...ids)` | `"all"`, `"some"` or `"none"` |
| `scope(key, ...parentIds)` | which rows of the list may the subject see? |
| `ask(key, target, options?)` | `check` or `could` for a key known only at run time; never throws, an unknown key gives `false` |

`check` returns `{ ok: true, grants, doc?, input? }`, or `{ ok: false,
reasons }`. `grants` lists the `id` of every grant that passed. `doc` is the
document trimmed to the fields of the passing grants, for a key declared with
`fields: "doc"`; `input` is the input trimmed the same way, for
`fields: "input"`. Options (`input`, `at`, `ip`) override those of the
context for one check.

`reach` answers:

- `"none"`: no grant passes;
- `"all"`: the ids are all concrete and a grant passes, or at least one
  passing grant covers every row with no condition, and no passing grant left
  a condition undecided or carries a per-document rule;
- `"some"`: a grant passes, but only for part of the rows, or for rows the
  library cannot tell without loading them (a `test` condition with
  `whenUnknown: "allow"`, a condition on a parent that was not named).

`scope(key, ...parentIds)` takes the concrete ids of the parents (none for a
root entity) and works on keys that act on the document itself. It returns
`{ ok: true, plan, query, grants, project, projectAll }`:

- `plan`: the neutral [plan](#storage-adapters), one alternative per passing
  grant;
- `query`: the plan compiled by the system's storage adapter;
- `project(doc, { denied }?)`: decides the row as a `check` would, without
  loading it again, and returns it trimmed to its fields, or `null` (or
  `denied(doc)`) when it is not visible;
- `projectAll(docs)`: the same for a page, dropping the rows that are not
  visible.

The query restricts rows within the parents you named. Selecting the children
of those parents (here, `workspaceId`) stays your job: the library does not
know which field links a child to its parent. `scope` refuses (`ok: false`)
when the parents are not concrete, and when a passing grant meets a
per-document rule that declares no `rows`.

```ts
held.set("account:bob", [
  documents.grant("read", { id: "published", on: [W1, ALL], where: { status: "published" } }),
  documents.grant("list", { id: "own", on: [W1, ALL], when: ["author"], fields: { _id: true, title: true } }),
]);
const reader = system.context({ subject: { id: "account:bob" } });

console.log(await reader.could("workspaces.documents.read"));
// true
console.log(await reader.reach("workspaces.documents.read", W1));
// "some"
console.log(await reader.ask("workspaces.documents.read", [W1, "document:d2"]));
// true

const page = await reader.scope("workspaces.documents.list", W1);
if (page.ok) {
  console.log(page.grants, page.query.filter);
  // ["own"] { authorId: "account:bob" }
  const docs = [...db.documents.values()].filter((doc) => doc.workspaceId === W1);
  reader.seed(document, docs, W1);
  console.log(await page.projectAll(docs));
  // [{ _id: "document:d2", workspaceId: "workspace:w1", title: "Notes", body: "Meeting notes", ... }]
}
console.log(reader.fetchCounters());
// { document: 1 }: the load made by ask(); the seeded page loaded nothing
console.log((await reader.heldGrants()).map((grant) => grant.key));
// ["workspaces.documents.read", "workspaces.documents.read", "workspaces.documents.list"]
```

`projectAll` gives Bob the whole of `d2` because his `read` grant on published
documents has no field list, and a row gets the union of the fields of every
grant that covers it.

The other members of a context:

- `seed(entity, docs, ...parentIds)` hands documents you already hold to the
  context, keyed by their `idField`, so that no check loads them again.
- `seedRelated(entity, relation, rows, ...ids)` does the same for the joined
  rows of one document; `ids` is the full path of that document.
- `heldGrants()` returns the grants, bundles expanded, of the providers with a
  `cacheKey` that this context already consulted. A function provider is
  never cached, so its grants never appear.
- `fetchCounters()` counts the document loads of this context, by entity
  name.
- `delegationRefusal(asked, options)` is described in
  [Delegation and boundaries](#delegation-and-boundaries).

### Conditions

A condition is a plain object in the MongoDB query language. It is evaluated
in memory against a document, and translated by the storage adapter for a
list. The supported operators are `$eq`, `$ne`, `$in`, `$nin`, `$gt`, `$gte`,
`$lt`, `$lte`, `$exists`, `$type`, `$and`, `$or`, `$nor`, `$not`, `$regex`,
`$options`, `$all`, `$elemMatch` and `$size`. A dotted field
(`"address.city"`) reaches inside an object.

Any other operator is refused, among them the ones able to run code (`$where`,
`$expr`, `$function`). A grant that holds one is refused when it enters
(through `onGrantRejected` for a provider), and the storage adapters refuse a
plan that holds one.

`implies(narrow, wide)` tells whether a condition is at least as strict as
another. It is the test delegation uses. It answers `true` when every clause
of `wide` appears in `narrow` with the same value, or with an `$eq` / `$in`
whose values are all accepted by the `wide` clause; `$and` is flattened. It is
conservative: any other shape must be equal to count.

```ts
console.log(implies({ status: "draft", authorId: "account:ada" }, { status: "draft" }));
// true
console.log(implies({ status: { $in: ["draft"] } }, { status: { $in: ["draft", "published"] } }));
// true
console.log(implies({ $or: [{ status: "draft" }] }, { status: "draft" }));
// false
console.log(system.explain({ key: "workspaces.documents.read", on: [W1, "document:*"], where: { $where: "true" } }));
// 'Forbidden operator at $: "$where". Allowed: $eq, $ne, ...'
```

### Storage adapters

`scope` builds a neutral plan and hands it to the system's storage adapter.
The adapter is set once: `createSystem({ ..., storage })`, `mongo()` by
default.

A plan is a list of alternatives, one per passing grant (duplicates removed).
A row is visible when one alternative holds entirely. An alternative carries
an optional `where` on the entity and an optional `through`: a list of
`{ relation, where }` steps, each meaning "one joined row of this relation
holds this condition". An alternative with neither opens the whole list.

**`mongo(options)`** returns `{ filter, stages }`:

- without a relation, `stages` is `null` and `filter` is the whole answer:
  `collection.find(filter)`;
- with a relation, `stages` is the pipeline: a first `$match` on the entity
  when every alternative has a condition on it, one `$lookup` per relation,
  then a `$match` that keeps each alternative's conditions together. Run
  `collection.aggregate(stages)`. `filter` is then only the pre-filter already
  inside the pipeline.

A relation without `foreignCollection` joins the entity's own collection. Its
`$lookup` reads `from: "<self>"`: replace the placeholder with the name of the
collection you query, or set `sameCollection` when every such relation of the
system lives in one collection. `alias(relation)` names the joined array
(default: `_<relation id>`). The joined arrays stay on the returned rows; add
a `$project` if you do not want them.

```ts
import type { Collection } from "mongodb";

async function listDocuments(collection: Collection, subjectId: string) {
  const ctx = system.context({ subject: { id: subjectId } });
  const scope = await ctx.scope("workspaces.documents.list", W1);
  if (!scope.ok) return [];
  const inWorkspace = { workspaceId: W1 };
  const rows =
    scope.query.stages === null
      ? await collection.find({ $and: [inWorkspace, scope.query.filter] }).toArray()
      : await collection.aggregate([{ $match: inWorkspace }, ...scope.query.stages]).toArray();
  return scope.projectAll(rows as unknown as Document[]);
}

const adapter = mongo({ sameCollection: "documents" });
console.log(typeof listDocuments, adapter.name);
// function mongo
```

**`memory()`** returns a predicate `(doc, related?) => boolean`. `related`
gives the joined rows of the document for a relation; without it, a joined
condition never holds. Use it for tests and small data sets.

```ts
held.set("account:guest", [
  documents.grant("list", {
    id: "public-links",
    on: [W1, ALL],
    related: { links: { audience: "public" } },
    fields: { _id: true, title: true },
  }),
]);
const guest = system.context({ subject: { id: "account:guest" } });
const shared = await guest.scope("workspaces.documents.list", W1);
if (shared.ok) {
  console.log(JSON.stringify(shared.query.stages));
  // [{"$lookup":{"from":"links","localField":"_id","foreignField":"documentId",
  //   "pipeline":[{"$match":{"kind":"share"}}],"as":"_links_of_document"}},
  //  {"$match":{"_links_of_document":{"$elemMatch":{"kind":"share","audience":"public"}}}}]
  const keeps = memory().compile(shared.plan);
  const visible = [...db.documents.values()].filter((doc) =>
    keeps(doc, () => db.links.filter((link) => link.documentId === doc._id)),
  );
  console.log(visible.map((doc) => doc._id));
  // ["document:d2"]
}
```

**Your own adapter** implements `StorageAdapter<TQuery>`: a `name` and
`compile(plan): TQuery`. The plan types are exported: `Plan`, `Alternative`,
`Through` and `RelationInfo` (`id`, `localField`, `foreignField`,
`collection?`, `only?`, `via?`). A relation step must hold `only` as well as
its own `where`. Throw on anything the store cannot express: a refused plan
is safer than a wider list.

```ts
import type { Alternative, Plan, StorageAdapter } from "@diister/quick-permission";

type EqualityQuery = "everything" | { readonly anyOf: readonly Record<string, string>[] };

function equalities(alternative: Alternative): Record<string, string> {
  if (alternative.through && alternative.through.length > 0) {
    throw new Error("this store cannot join");
  }
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(alternative.where ?? {})) {
    if (typeof value !== "string") throw new Error(`unsupported condition on ${field}`);
    out[field] = value;
  }
  return out;
}

const equalityOnly: StorageAdapter<EqualityQuery> = {
  name: "equality-only",
  compile(plan: Plan) {
    const anyOf = plan.alternatives.map(equalities);
    return anyOf.some((clause) => Object.keys(clause).length === 0)
      ? "everything"
      : { anyOf };
  },
};
```

### Delegation and boundaries

Delegation answers "may this delegator hand out this grant?". The rule is
narrower, never wider. A grant `asked` is covered by a held grant when:

- both have the same key (a bundle the delegator holds counts as the keys it
  includes; holding every part of a bundle does not cover the bundle);
- each segment of the held target covers the asked one (`"document:*"`
  covers `"document:d1"`, not the reverse);
- every held condition (`where`, each `parents` and `related` entry) is
  implied by the asked one, in the sense of `implies`;
- the asked `input` implies the held one;
- the asked `when` keeps every held name (it may add some);
- a held `payload` is kept as is;
- a held field list is kept or reduced; a grant without `fields` sees every
  field, so it is wider than any field list.

`system.delegation` holds the functions:

- `covers(held, asked)`: `true` when `held` covers `asked`;
- `refusal(held[], asked, { within?, reserved? })`: `null`, or
  `{ grant, code, reason }`;
- `withinEnvelope(envelope, grants, options)`: `{ kept, dropped }`, every grant
  judged against the envelope;
- `boundary(entity, ...ids)`: same as `system.boundary`.

The refusal codes, in the order they are tested:

| Code | Meaning |
| --- | --- |
| `invalid` | the asked grant is not a valid grant |
| `reserved` | `reserved(key)` returned `true`: the key is never delegated |
| `outside-boundary` | the grant, or one key its bundle expands to, is not bound to the boundary |
| `not-held` | no held grant covers it |

`system.boundary(entity, ...ids)` draws a boundary around one concrete
instance, for instance an organisation. A wildcard, a reference of another
type or a path of the wrong length throws. A key is inside the boundary when
it acts under the boundary's entity by its path, or under an entity that
declares it `belongsTo` the boundary's entity (and the children of that
entity). Ownership is followed one step only.

- `keys()`: the keys a grant of this boundary may carry;
- `bind(grant)`: adds the anchor to a grant: the path, or the ownership
  condition, joined with `$and` to a condition already there. It never
  changes a target that pins another instance; `refusal` then reports it;
- `refusal(held, asked, { reserved? })` and `within(envelope, grants,
  { reserved? })`: as above, with this boundary.

```ts
const acme = system.boundary(organisation, ACME);
console.log(acme.keys().includes("workspaces.documents.read"), acme.keys().includes("workspaces.create"));
// true false

const envelope = [acme.bind(workspaces.grant("manage", { on: ALL }))];
console.log(envelope[0].where);
// { organisationId: "organisation:acme" }

const judged = acme.within(envelope, [
  acme.bind(documents.grant("read", { id: "inside", on: [ALL, ALL] })),
  documents.grant("read", { id: "unbound", on: [ALL, ALL] }),
  organisations.grant("update", { id: "never-held", on: ACME }),
]);
console.log(judged.kept.map((grant) => grant.id));
// ["inside"]
console.log(judged.dropped.map((refusal) => [refusal.grant.id, refusal.code]));
// [["unbound", "outside-boundary"], ["never-held", "not-held"]]
```

**The read-time envelope.** Checking a role when it is written is not enough:
the organisation may lose a right later, or a stored role may be edited behind
the service. Judge the roles again when they are read, in the provider, and
return only what is kept. Then a right the organisation loses is lost by
every role it handed out, at the next request.

```ts
const sets = [organisations, accounts, workspaces, documents] as const;
const catalogue = compilePermissions(sets);
const tenant = catalogue.boundary(organisation, ACME);

const envelopes = new Map<string, Grant[]>([
  [ACME, [tenant.bind(workspaces.grant("manage", { on: ALL }))]],
]);
const roles = new Map<string, Grant[]>([
  ["account:ada", [tenant.bind(documents.grant("update", { on: [ALL, ALL] }))]],
]);

const tenantSystem = createSystem({
  permissions: sets,
  providers: [
    {
      name: "roles",
      cacheKey: (subject) => subject.id,
      fetch: (subject) => {
        const membership = db.memberships.find(
          (row) => row.userId === subject.id && row.status === "active",
        );
        if (!membership) return [];
        const boundary = catalogue.boundary(organisation, membership.organisationId);
        const envelope = envelopes.get(membership.organisationId) ?? [];
        return [...boundary.within(envelope, roles.get(subject.id) ?? []).kept];
      },
    },
  ],
});
const edit = { input: { title: "x" } };
const adaUpdates = () =>
  tenantSystem
    .context({ subject: { id: "account:ada" } })
    .check("workspaces.documents.update", W1, "document:d1", edit);

console.log((await adaUpdates()).ok);
// true
envelopes.set(ACME, [tenant.bind(workspaces.grant("read", { on: ALL }))]);
console.log((await adaUpdates()).ok);
// false
```

`ctx.delegationRefusal(asked, { within?, reserved? })` judges a grant against
what the context's subject holds. It consults the providers for the asked key
and target, then reads the grants as `heldGrants()` does, so only providers
with a `cacheKey` count.

### Custom rules

A custom rule adds a check the declaration cannot express. `defineRule` takes:

| Field | Meaning |
| --- | --- |
| `name` | names the rule in reasons |
| `when` | the rule runs only for grants whose `when` holds this name; the name is then accepted in `when` without declaring a condition |
| `perDocument` | `true` when the rule needs the document |
| `check(context)` | returns `true`, `false`, `{ ok: true }` or `{ ok: false, reason }` |
| `rows(context)` | for a per-document rule: the row filter that stands for it in a list, or `null` for no restriction |

`context` holds `subject`, `ids`, `input`, `at`, `ip`, `key`, `grant`,
`decidable` (the ids are all concrete), `doc()` (loads the key's document,
and rejects when it is not concrete) and `parent(name)` (the same for a
parent). A rule that throws rejects the grant it ran for, and reaches
`onError`.

A rule without `perDocument` runs for every question, `decidable` or not. A
per-document rule runs only on a concrete document. On a list, its `rows`
condition joins the grant's row filter. Without `rows`, the library cannot
build an exact list, so `scope` refuses the key instead of returning rows it
did not filter; `could` still answers, and `reach` answers `"some"`.
`defineRule` throws when `rows` is given without `perDocument`.

```ts
const businessHours = defineRule({
  name: "business-hours",
  when: "businessHours",
  check: (context) => {
    const hour = (context.at ?? new Date()).getUTCHours();
    return hour >= 8 && hour < 18;
  },
});
const shortBody = defineRule({
  name: "short-body",
  perDocument: true,
  async check(context) {
    const doc = (await context.doc()) as Document | null;
    return doc !== null && doc.body.length < 100;
  },
});
const publishing = permissions(document, "publishing", {
  publish: action({ rules: [businessHours] }),
  feature: action({ rules: [shortBody] }),
});
const publishingSystem = createSystem({
  permissions: [publishing],
  providers: [
    () => [
      { key: "publishing.publish", on: [W1, "document:*"], when: ["businessHours"] },
      publishing.grant("feature", { on: [W1, ALL] }),
    ],
  ],
});
const editor = publishingSystem.context({ subject: { id: "account:ada" } });
const at = new Date("2026-01-05T09:00:00Z");
console.log((await editor.check("publishing.publish", W1, "document:d1", { at })).ok);
// true
console.log((await editor.check("publishing.feature", W1, "document:d1")).ok);
// true
const featured = await editor.scope("publishing.feature", W1);
console.log(featured.ok || featured.reasons);
// ['rule "short-body" of "publishing.feature" decides per document and declares no rows']
```

The grant on `publishing.publish` is written by hand because `set.grant` types
`when` with the entity's conditions only.

### Hooks

`createSystem({ ..., hooks })` takes three observers. A hook that throws never
changes a decision.

| Hook | Called | Event |
| --- | --- | --- |
| `onGrantRejected` | an invalid grant from a provider, or a grant derived from a bundle that its included key cannot honour; once per distinct rejection | `{ grant, reason, provider?, via? }` (`via` is the bundle key) |
| `onProviderFetch` | each provider fetch that ran and did not throw (never a cache hit) | `{ provider, subject, key, ids, durationMs, grantCount }` |
| `onError` | a provider or `cacheKey` that throws, or a rule or load that throws | `{ source: "provider", provider, subject, key, ids, error }` or `{ source: "rule", grantId, subject, key, ids, error }` |

```ts
const events: string[] = [];
const observed = createSystem({
  permissions: [workspaces, documents],
  providers: [
    { name: "stored", fetch: () => [{ key: "workspaces.read", on: [W1], filter: { _id: true } } as Grant] },
    { name: "broken", fetch: () => { throw new Error("store down"); } },
  ],
  hooks: {
    onGrantRejected: (event) => events.push(`rejected by ${event.provider}: ${event.reason}`),
    onProviderFetch: (event) => events.push(`fetched ${event.provider}: ${event.grantCount}`),
    onError: (event) => events.push(`error ${event.source}: ${String(event.error)}`),
  },
});
console.log(await observed.context({ subject: { id: "account:ada" } }).check("workspaces.read", W1));
// { ok: false, reasons: ["no matching grant", "provider broken failed: store down"] }
console.log(events);
// ["error provider: Error: store down", "fetched stored: 1",
//  'rejected by stored: "filter" is not a grant field, use fields']
```

### Catalog and introspection

`compilePermissions(sets)` gives the same introspection as a system, without
providers or contexts, for a build step or an administration screen.

- `keys`: every key of the catalogue.
- `catalog()`: one entry per key: `{ key, kind, meta, on, path, includes,
  expandsTo, accepts }`. `path` lists `{ name, refType }` per segment.
  `expandsTo` lists the actions a bundle or list finally grants. `accepts`
  says what a grant on this key may carry: `where` (boolean), `parents`
  (names), `related` (relation descriptions with `name`, `id`, `localField`,
  `foreignField`, `collection?`, `only?`, `via?`), `when` (names), `fields`
  (`"doc"`, `"input"` or `null`) and `input` (boolean).
- `explain(grant)`: why a grant is refused, or `null`.
- `expand(grants)`: the valid grants with their bundles expanded.
- `audit(grants)`: every rejection, including the keys a bundle cannot carry
  its restrictions to.
- `wildcardGrants(idPrefix)`: one grant per key on every target, with ids
  `<idPrefix>:<key>`, for a platform administrator.

```ts
const compiled = compilePermissions([workspaces, documents]);
const entry = compiled.catalog().find((item) => item.key === "workspaces.documents.list");
console.log(entry?.kind, entry?.expandsTo, entry?.accepts.related.map((relation) => relation.name));
// list ["workspaces.documents.read"] ["links"]
console.log(compiled.wildcardGrants("admin")[0]);
// { id: "admin:workspaces.create", key: "workspaces.create" }
```

### Reference convention

A reference is `"type:id"` by default, and a wildcard is `"type:*"` (any
reference ending in `*` covers the references that start with what precedes
it; a bare `"*"` covers every reference). This convention is `typedRefs`, an
implementation of `RefConvention`:

| Method | Answers |
| --- | --- |
| `typeOf(ref)` | the type of a reference, or `undefined` |
| `isWildcard(ref)` | whether it stands for several references |
| `wildcard(type)` | the wildcard of every reference of a type |
| `isOfType(ref, type)` | whether a reference, or a wildcard, is of that type |
| `covers(held, asked)` | whether the held reference includes the asked one |
| `overlaps(a, b)` | whether two references can name one same document |

Another convention is set with `refs` on the root entity. Its children use it
too, and every entity of a system must use the same one.

```ts
import { ALL, action, createSystem, entity, permissions, type RefConvention } from "@diister/quick-permission";

const slashRefs: RefConvention = {
  typeOf: (ref) =>
    typeof ref === "string" && ref.includes("/") ? ref.slice(0, ref.indexOf("/")) : undefined,
  isWildcard: (ref) => typeof ref === "string" && ref.endsWith("/*"),
  wildcard: (type) => `${type}/*`,
  isOfType: (ref, type) => typeof ref === "string" && ref.startsWith(`${type}/`),
  covers: (held, asked) =>
    held === asked ||
    (typeof held === "string" &&
      held.endsWith("/*") &&
      typeof asked === "string" &&
      asked.startsWith(held.slice(0, -1))),
  overlaps: (a, b) => slashRefs.covers(a, b) || slashRefs.covers(b, a),
};

const workspace = entity("workspace", { refs: slashRefs, load: (id) => ({ _id: id }) });
const workspaces = permissions(workspace, "workspaces", { read: action() });
const system = createSystem({
  permissions: [workspaces],
  providers: [() => [workspaces.grant("read", { on: ALL })]],
});
console.log(workspaces.grant("read", { on: ALL }).on);
// ["workspace/*"]
console.log((await system.context({ subject: { id: "account/ada" } }).check("workspaces.read", "workspace/w1")).ok);
// true
```

## Guarantees

Each of these is held by the test suite in `library/test/`.

- **Deny by default.** Without a grant that passes, the answer is no
  (`core_test.ts`: "check: a grant on one user reads that user and no other").
- **A provider or loader error denies.** A throwing provider gives no grant,
  and a throwing `load` or `loadMany` rejects the grants that needed it
  (`provider_test.ts`: "a throwing provider counts as no grant...", "a
  throwing load rejects only the grant that needed it";
  `batch_fetch_test.ts`: "a failing loadMany denies every check of the
  batch").
- **An invalid grant is dropped and reported, never read in part.**
  (`core_test.ts`: "grant: a misspelled constraint is rejected, never
  ignored"; `improvements_test.ts`: "grant: a field of the retired shape is
  refused, never read").
- **A capability question loads no document it does not need.**
  (`capability_test.ts`: "capability query: loads no document";
  `hot_path_reads_test.ts`: "a match rule reads its document only for a grant
  that carries a condition").
- **A list filter is exact per grant.** Each grant's conditions on the
  document and on its joined rows stay in one alternative, and `mongo()` and
  `memory()` keep the same rows (`storage_test.ts`: "storage: each
  alternative keeps its own conditions together").
- **Fields are an allow-list.** A field missing from `fields` is never
  returned, and a refused grant never widens the fields of another
  (`core_test.ts`: "update: the body is reduced to the granted fields";
  `provider_test.ts`: "a rejected grant never widens the projected fields of
  an accepted one").

## Known limits

Behaviours that are deliberate, and worth knowing before relying on them.

- **`scope.query` does not add the parent link.** It restricts rows by what
  the grants say. The filter on the parents the scope was asked for
  (`{ workspaceId }`) stays in the caller's own query.
- **With `stages`, `filter` is only a first cut.** When a plan goes through a
  relation, the last `$match` of `stages` is what makes the list exact. Running
  `filter` alone would show too much.
- **A check trusts the rows a relation's `load` returns.** The relation's
  `only` is applied by the storage adapters, so `load` must return only the
  rows `only` describes.
- **`could` takes no options.** A capability question that depends on
  `input`, `at` or `ip` reads them from the context.
- **`CheckResult.grants` lists only grants that carry an `id`.**
- **`heldGrants()` and `ctx.delegationRefusal()` see what the context has
  cached.** A provider without `cacheKey` is fetched again on every check and
  is not part of that view.
- **`seed` and `seedRelated` take ids differently.** `seed` takes the ids of
  the parents and reads each document's own id from `idField`; `seedRelated`
  takes the full path of the document the rows are joined to.
- **An explicit `entity<Doc>(...)` stops name inference.** TypeScript does not
  infer part of a type argument list, so relation and condition names fall
  back to `never`. Type the `load` return instead, or pass every argument.
- **`when` is typed in `set.grant`.** It accepts the entity's named
  conditions. A name that only a custom rule reads goes into a grant written
  by hand.
- **`ALL` is the string `"all"`.** An entity whose reference is literally
  `"all"` cannot be told apart from it in `set.grant`.
- **`typedRefs` reads any trailing `*` as a wildcard.** An id that ends with
  `*` needs another `RefConvention`.
- **A bundle is expanded for the key being checked, not in full.** A check
  only follows the includes that lead to its key, so a child a bundle cannot
  carry (a restriction the child cannot read) is reported through
  `onGrantRejected` when a check first reaches that child. `system.audit(grants)`
  reports every one of them at once.
- **Ownership is followed one step.** An entity that belongs to an entity that
  belongs to a boundary is not inside it. Declare the direct link.

## License

MIT, see [LICENSE](LICENSE).

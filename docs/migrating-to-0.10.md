# Migrating from 0.9 to 0.10

The examples use the workspace domain of the [README](../README.md#domain-used-in-the-examples).
Blocks marked `0.9` show the old API; every other block runs against 0.10.

## 1. What changed and why

- 0.9 declared resources, rules and target kinds separately, and a permission
  wired them together. 0.10 declares entities once, and each key derives its
  target and its accepted restrictions from its entity.
- A grant has one shape, with one field per kind of restriction. A field the
  key cannot honour is refused instead of being silently ignored.
- `can()` answered several questions at once. 0.10 has one method per
  question: `check`, `could`, `reach`, `scope`, `ask`.
- The engine is rewritten around entities and paths, and storage goes through
  an adapter: `mongo()` by default, `memory()` for tests.
- A list filter is now exact per grant; 0.9 could let a row through the filter
  and remove it only in the per-row projection.
- Delegation (who may hand out which grant) and ownership boundaries are new.

## 2. Exports, one by one

| 0.9 export | 0.10 replacement |
| --- | --- |
| `createSystem({ schema, providers, hooks })` | `createSystem({ permissions, providers, hooks, storage })` |
| `resource({ id, fetch, fetchMany })` | `entity(name, { load, loadMany })`, or `parent.child(name, ...)` |
| `resource` `dedupKey` | removed: documents are cached by their path within a context |
| `resource` `activeWhen` | removed: a document is read only when a grant needs it |
| `Resource#match()` | nothing to declare: the grant's `where` / `parents` |
| `Resource#filter()` | `action({ fields: "doc" })` and the grant's `fields` |
| `Resource#includes(field, extract)` | a `where` on the array field (`{ collaborators: "account:ada" }` holds when the array contains it), or a `member` condition |
| `Resource#requireTruthy()` | `verifyExists: true` on the entity |
| `Resource#requireOwner(get, { flag })` | condition `{ owner: "field" }` and grant `when` |
| `Resource#requireMembership(get, { flag })` | condition `{ member: "field" }` and grant `when` |
| `Resource#requireCustom(predicate, { flag })` | condition `{ test }` and grant `when`, or `defineRule` |
| `indirectResource(...)` | an entry of `relations` on the entity |
| `permission({ target }).rules([...])` | `action(options)` in `permissions(entity, prefix, spec)` |
| `intermediate({ target, expandsTo })` | `bundle([...])`, `list("read")`; `bundle(..., { expand })` for the rest |
| `target.required(type)`, `target.path(...)` | the entity's path, with `on: "self"` (default) |
| `target.none()` | `on: "none"`, or `globalPermissions` |
| `target.optional(type)` | removed: a key has one arity. Use `on: "parent"` for a create, or two keys |
| `seg` | removed: segments come from the entities |
| `defineRule({ kind, needs, flag, check })` | `defineRule({ name, when, perDocument, check, rows })` (section 4) |
| `inputMatch()` | `action({ input: true })` and the grant's `input` |
| `matchPath()` | built in: `targetConstraint` (default `true`) |
| `requireSelf({ flag })` | condition `{ self: true }` and grant `when` |
| `applyFilter`, `pickFields` | removed: `check` and `scope.project` return trimmed documents |
| `isCapabilityQuery` | removed: the method states the question (`check` or `could` / `reach` / `scope`) |
| `isWildcardSegment` | `typedRefs.isWildcard` |
| `refType` | `typedRefs.typeOf` |
| `System.can(subject, key, target)` | removed: no check outside a context |
| `System.list()`, `System.tree()`, `System.schema(key)` | `system.catalog()`, `system.keys` |
| `System.indirectResources()`, `indirectsUsedBy(key)` | `catalog()` entries, `accepts.related` |
| `context.can(key, target, perCall)` | `check`, `could`, `reach`, `scope`, `ask` |
| `context.preseed(resource, docs, opts)` | `seed(entity, docs, ...parentIds)`, `seedRelated(...)` |
| `context.getFetchCounters()` | `fetchCounters()` |
| `context.clearCounters()` | removed: open a new context |
| `context.dumpGrants()` | `heldGrants()` |
| type `Grant` | `Grant`, new shape (section 3) |
| type `Subject` | `Subject`, unchanged |
| type `CanResult` | `CheckResult`, `ScopeResult` |
| type `CanContext` | `CheckOptions`: `checkDate` is `at`, `checkIp` is `ip` |
| type `FetchCtx` | `RuleContext` (rules), `ConditionContext` (`test` conditions) |
| type `Rule`, `RuleResult`, `DefineRuleOpts` | `CustomRule`, `RuleVerdict` |
| type `RuleDescriptor` | removed: `catalog()` entries describe what a grant accepts |
| type `Permission`, `PermissionConfig`, `PermissionBuilder` | `ActionOptions`, `PermissionSet`, `KeyInfo` |
| type `IntermediateConfig`, `IntermediateBuilder` | `BundleOptions` |
| type `IndirectResource`, `IndirectResourceJoin` | `RelationSpec` |
| type `IndirectResourceInfo` | `RelationInfo`, and `CatalogEntry.accepts.related` |
| type `ListEntry`, `TreeNode` | `CatalogEntry` |
| type `AggregationStage` | `MongoStage` |
| type `FilterSpec`, `FilterContribution` | `FieldSelection` |
| type `Provider`, `ProviderFn` | `GrantProvider`, `ProviderFetch` |
| type `ProviderObject`, `ProviderAccess` | same names; `target` is now `ids`, and `access.read(entity)` replaces `access.read(resource)` |
| type `ProviderFetchEvent`, `PermissionErrorEvent` | same names; `target` is now `ids` |
| type `SystemHooks` | `Hooks`, which adds `onGrantRejected` |
| type `System` | `System<Types, Query, Meta>`; `Compiled` for `compilePermissions` |
| types `AnyTarget`, `TargetNone`, `TargetOptional`, `TargetRequired`, `TargetPath`, `TargetArgs`, `SegmentSpec`, `AnySegment`, `SpecToSegment`, `SerializableSegment`, `SerializableTarget` | removed: targets come from entities; `CatalogEntry.on` and `.path` describe them |
| types `ResourceData`, `ResourcesData` | removed: the document type is carried by the entity, and `check` returns `Partial<Doc>` |

## 3. The grant shape

| 0.9 field | 0.10 field |
| --- | --- |
| `key`, `id` | unchanged |
| `target` | `on`: references only, one per entity of the key's path |
| `with[<entity the key acts on>]` | `where` |
| `with[<parent>]` | `parents[<parent entity name>]` |
| `with[<indirect resource id>]` | `related[<relation name>]` |
| `filter` | `fields`: leaves are `true` only; a `false` leaf is dropped |
| `flags: { name: true }` | `when: ["name"]` |
| `inputWith` | `input` |
| `payload` | unchanged |
| any other field | unchanged, a tag |

The library offers no conversion function. Splitting `with` needs knowledge
the library no longer has: the 0.9 resource ids are gone, and only you know
which of them named the document, a parent or a join. A stored grant that
still carries a 0.9 field (`target`, `with`, `filter`, `flags`, `inputWith`)
is refused, never read in part, with the name of its replacement:
`"with" is not a grant field, use where, parents or related`.

This function converts one stored grant. Adapt `KeyShape` to your keys, run
it once over your stored grants, and check the result with `system.audit`.

```ts
import type { Condition, FieldSelection, Grant } from "@diister/quick-permission";

type FilterV09 = { readonly [field: string]: boolean | FilterV09 };

type GrantV09 = {
  readonly id?: string;
  readonly key: string;
  readonly target?: readonly unknown[];
  readonly with?: Readonly<Record<string, unknown>>;
  readonly filter?: FilterV09;
  readonly flags?: Readonly<Record<string, boolean>>;
  readonly inputWith?: Readonly<Record<string, unknown>>;
  readonly payload?: unknown;
  readonly [tag: string]: unknown;
};

type KeyShape = {
  readonly entity?: string;
  readonly relations?: Readonly<Record<string, string>>;
};

function isCondition(value: unknown): value is Condition {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldsOf(filter: FilterV09): FieldSelection {
  const out: Record<string, true | FieldSelection> = {};
  for (const [field, value] of Object.entries(filter)) {
    if (value === true) out[field] = true;
    else if (value !== false) out[field] = fieldsOf(value);
  }
  return out;
}

function migrateGrant(old: GrantV09, shape: KeyShape): Grant {
  const { id, key, target, with: constraints, filter, flags, inputWith, payload, ...tags } = old;
  let where: Condition | undefined;
  const parents: Record<string, Condition> = {};
  const related: Record<string, Condition> = {};
  for (const [name, condition] of Object.entries(constraints ?? {})) {
    if (!isCondition(condition)) {
      throw new Error(`${key}: with.${name} is a value, not a condition; rewrite it as { <field>: value }`);
    }
    const relation = shape.relations?.[name];
    if (name === shape.entity) where = condition;
    else if (relation !== undefined) related[relation] = condition;
    else parents[name] = condition;
  }
  const on = target?.map((segment) => {
    if (typeof segment !== "string") throw new Error(`${key}: target holds a non-string segment`);
    return segment;
  });
  const when = Object.entries(flags ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  const grant: Grant = {
    key,
    ...(id !== undefined && { id }),
    ...(on !== undefined && on.length > 0 && { on }),
    ...(where !== undefined && { where }),
    ...(Object.keys(parents).length > 0 && { parents }),
    ...(Object.keys(related).length > 0 && { related }),
    ...(filter !== undefined && { fields: fieldsOf(filter) }),
    ...(when.length > 0 && { when }),
    ...(inputWith !== undefined && { input: inputWith }),
    ...(payload !== undefined && { payload }),
  };
  return { ...tags, ...grant };
}
```

- `shape.entity` is the `with` entry that named the document the key acts on
  (in 0.9, the id of its resource).
- `shape.relations` maps an indirect resource id to the name of the relation
  that replaces it.
- Every other `with` entry becomes a `parents` entry under the same name. If
  your 0.9 resource ids differ from the 0.10 entity names, rename them here.
- A `with` value that is not an object was read by `match(extract)`, which
  compared it to an extracted value. A condition needs the field name, so the
  function throws and leaves that grant to you.

```ts
const old = {
  id: "g1",
  key: "workspaces.documents.read",
  target: ["workspace:w1", "document:*"],
  with: {
    document: { status: "published" },
    workspace: { archived: false },
    links_of_document: { audience: "public" },
  },
  filter: { _id: true, title: true, body: false },
  flags: { author: true, collaborator: false },
  grantedBy: "account:ada",
};

console.log(system.explain(old as unknown as Grant));
// '"target" is not a grant field, use on'

const migrated = migrateGrant(old, {
  entity: "document",
  relations: { links_of_document: "links" },
});
console.log(migrated);
// {
//   grantedBy: "account:ada", key: "workspaces.documents.read", id: "g1",
//   on: ["workspace:w1", "document:*"], where: { status: "published" },
//   parents: { workspace: { archived: false } },
//   related: { links: { audience: "public" } },
//   fields: { _id: true, title: true }, when: ["author"],
// }
console.log(system.explain(migrated));
// null
```

## 4. Declarations

### Resource to entity, indirect resource to relation

```ts 0.9
const documentOf = resource({
  id: "document",
  fetch: ({ target }) => db.documents.findOne({ _id: target[1] }),
});

const linksOf = indirectResource({
  id: "links_of_document",
  from: documentOf,
  on: { localField: "_id", foreignField: "documentId", foreignCollection: "links" },
  to: { _type: "share" },
  cardinality: "many",
});
```

```ts
import { entity } from "@diister/quick-permission";

type Workspace = { _id: string };
type Document = { _id: string; workspaceId: string; authorId: string };
type Link = { _id: string; documentId: string; _type: string; audience: string };

const workspaceRows = new Map<string, Workspace>();
const documentRows = new Map<string, Document>();
const linkRows: Link[] = [];

const workspace = entity("workspace", { load: (id) => workspaceRows.get(id) });

const document = workspace.child("document", {
  load: (workspaceId, id) => {
    const found = documentRows.get(id);
    return found?.workspaceId === workspaceId ? found : null;
  },
  relations: {
    links: {
      localField: "_id",
      foreignField: "documentId",
      foreignCollection: "links",
      only: { _type: "share" },
      load: (doc) =>
        linkRows.filter((row) => row.documentId === doc._id && row._type === "share"),
    },
  },
  conditions: { author: { owner: "authorId" } },
});
```

- A loader receives the ids of the path (`workspaceId, id`), not a target.
- `fetchMany` becomes `loadMany(paths)`.
- `to: { _type }` becomes `only`, a full condition.
- `cardinality` is gone: a relation always yields rows, and one row must hold
  the grant's condition.
- `from: otherIndirect` becomes `via: "<relation name>"`, declared before.
- `load` on a relation is required. In 0.9, an indirect resource without
  `fetch` did nothing on a concrete check, so a grant restricted by a join
  passed on a single document without the join being verified. 0.10 decides
  the join from the rows `load` returns, and those rows must already hold
  `only`.

### Target kinds to `on`

| 0.9 | 0.10 |
| --- | --- |
| `target.required("document")` on a root resource | a key of a root entity, `on: "self"` (default) |
| `target.path("workspace", "document")` | a key of the child entity `document`, `on: "self"` |
| `target.path("workspace")` for a create under a workspace | a key of `document` with `on: "parent"` |
| `target.none()` | `on: "none"`, or `globalPermissions(prefix, spec)` |
| `target.optional(...)` | no equivalent |

### Rules to options

| 0.9 rule | 0.10 |
| --- | --- |
| `documentOf.match()` | nothing: a grant may carry `where` when the entity has `load` |
| `workspaceOf.match()` on a parent | nothing: a grant may carry `parents.workspace` |
| `linksOf.match()` | nothing: a grant may carry `related.links` |
| `documentOf.filter()` | `action({ fields: "doc" })` |
| `inputMatch()` | `action({ input: true })` |
| filtering the input of an update | `action({ fields: "input" })` |
| `documentOf.requireOwner(get, { flag: "author" })` | `conditions: { author: { owner: "authorId" } }` on the entity |
| `requireSelf({ flag: "self" })` | `conditions: { self: { self: true } }` on the entity |
| `documentOf.requireTruthy()` | `verifyExists: true` on the entity |
| a rule that denies when the subject is the author | `action({ forbid: ["author"] })` |
| `matchPath()` | nothing: `targetConstraint` is on by default |

### Intermediate to bundle and list

```ts 0.9
"workspaces.documents.manage": intermediate({
  target: target.path("workspace", "document"),
  expandsTo: (grant) => [
    { ...grant, key: "workspaces.documents.list" },
    { ...grant, key: "workspaces.documents.update" },
    { ...grant, key: "workspaces.documents.delete" },
  ],
}).rules([]),
```

```ts
const editorial = permissions(document, "editorial", {
  read: action({ fields: "doc" }),
  update: action({ fields: "input" }),
  list: list("read"),
  manage: bundle(["list", "update"]),
});
const editorialSystem = createSystem({ permissions: [editorial] });
console.log(editorialSystem.catalog().find((entry) => entry.key === "editorial.manage")?.expandsTo);
// ["editorial.update", "editorial.read"]
```

A bundle passes the target, conditions, `when`, `payload` and tags to the keys
it includes, and its `fields` to the keys that project. A list key is a bundle
that always includes its `read` action. An `expandsTo` that rewrote the target
toward another entity becomes `bundle(includes, { expand })`, whose grants are
validated like any other.

### Custom rules

| 0.9 | 0.10 |
| --- | --- |
| `kind` | `name` |
| `needs: [documentOf]`, `check([doc], ...)` | `perDocument: true`, `await context.doc()` (or `context.parent(name)`) |
| `flag: "x"` (read `grant.flags.x`) | `when: "x"` (read `grant.when`) |
| `activeWhen(grant)` | read `context.grant` in `check` and return `true` |
| `fetchWhen(grant)` | `context.doc()` loads only when called |
| `check(data, payload, ctx)` | `check(context)`; the payload is `context.grant.payload` |
| a `constraint` in the result, for lists | `rows(context)`, returning a condition |
| `describe()` | removed; the `when` a rule declares appears in `catalog()` |
| `{ ok: true, data }` | removed: a rule decides, it does not produce data |

A per-document rule without `rows` makes `scope` refuse the key, instead of
returning a list it could not filter.

```ts
const longEnough = defineRule({
  name: "long-enough",
  perDocument: true,
  async check(context) {
    const doc = (await context.doc()) as Document | null;
    return doc !== null && doc.body.length >= 5;
  },
  rows: () => ({ "body.4": { $exists: true } }),
});
console.log(longEnough.name, typeof longEnough.rows);
// long-enough function
```

## 5. Checking

| 0.9 | 0.10 |
| --- | --- |
| `ctx.can(key, [concrete ids], { input })` | `ctx.check(key, ...ids, { input })` |
| `ctx.can(key, [ids with "*"])`, then `result.ok` | `ctx.could(key, ...ids)` |
| `result.constraints`, `result.stages` | `(await ctx.scope(key, ...parentIds)).query` |
| `result.data` (filtered document) | `result.doc` / `result.input` of `check`; `scope.project(doc)` for a list |
| `result.matchedGrants` | `result.grants` |
| `sys.can(subject, key, target)` | `sys.context({ subject }).check(...)` |
| `ctx.can(variableKey, target)` | `ctx.ask(variableKey, target)` |
| `ctx.preseed(resource, docs, { dedupKey })` | `ctx.seed(entity, docs, ...parentIds)` |
| `ctx.preseed(indirect, docs, { dedupKey, value })` | `ctx.seedRelated(entity, relation, rows, ...ids)` per document |
| `ctx.dumpGrants()` | `ctx.heldGrants()` |

```ts 0.9
const result = await sys.context({ subject }).can("workspaces.documents.list", ["workspace:w1", "document:*"]);
const rows = !result.ok
  ? []
  : result.stages
    ? await collection.aggregate([...result.stages]).toArray()
    : await collection.find(result.constraints ?? {}).toArray();
```

```ts
held.set("account:bob", [documents.grant("list", { on: [W1, ALL], when: ["author"] })]);
const ctx = system.context({ subject: { id: "account:bob" } });
const scope = await ctx.scope("workspaces.documents.list", W1);
console.log(scope.ok && scope.query);
// { filter: { authorId: "account:bob" }, stages: null }
```

`check` with a wildcard id returns `ok: false` and names `could`, `reach` and
`scope`. With `stages` set, run `collection.aggregate(stages)`; `filter` is
then only the first `$match` of the pipeline. The query keeps the rows within
the parents you named, but selecting the children of those parents (here
`workspaceId: "workspace:w1"`) is your job.

## 6. Behaviour changes to expect

**The list filter is exact per grant, and the pipeline changed.** 0.9 merged
the conditions on the document across grants, and the joined conditions
across grants, separately: a row matching the document condition of one grant
and the joined condition of another passed the filter. 0.10 keeps each
grant's conditions in one alternative. The pipeline now starts with a
`$match` only when every alternative has a condition on the document, and
ends with one `$match` that is an `$or` of the alternatives.
What to do: run `stages` as given, never edit them; update tests that compare
pipelines; replace the `"<self>"` placeholder of same-collection lookups, or
set `mongo({ sameCollection })`.

**`scope` needs concrete parents.** `scope(key, ...parentIds)` returns
`ok: false` when a parent id is missing or a wildcard.
What to do: list per parent. For "may the subject list anything at all", ask
`could` or `reach`.

**A forbidden operator is refused when the grant enters.** A grant whose
condition holds `$where`, `$expr`, `$function` or any operator outside the
supported list is dropped when a provider returns it, and reported through
`onGrantRejected`. It never reaches a check or a storage.
What to do: set `onGrantRejected`, and run `system.audit(storedGrants)` before
a deployment.

**A bundle cycle or an include of an unknown key fails at start-up.**
`createSystem` and `compilePermissions` throw, naming every mistake.
What to do: fix the catalogue. Build the system in a test so the error shows
before a deployment.

**`reach` answers `"some"` for a condition it cannot decide.** When a passing
grant holds a condition that needs the document (a `test` condition with
`whenUnknown: "allow"`, a `parents` condition on a parent that was not named),
`reach` answers `"some"`, never `"all"`. A condition with a field (`owner`,
`member`, `self`) becomes a row filter instead: `could` answers `true` where
0.9 denied, and `reach` answers `"some"`.
What to do: show the action on `"some"`, and check each document.

**No check outside a context.** `System.can` is gone.
What to do: open one context per request, `system.context({ subject })`, and
ask it everything that request needs. It caches loads and provider results.

**A relation needs a `load`.** It decides a `related` condition on a concrete
check.
What to do: write `load(doc, ...ids)` for every relation, returning only rows
that hold `only`.

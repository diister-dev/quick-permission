# RFC: public API of 0.10.0

> **Status:** implemented on `poc/entity-api`, on top of commit `e902dc5`. Not released.
>
> **Decisions:** one public API, the previous way of declaring permissions is removed; the engine is rewritten; ownership is declared on the entity; storage goes through an adapter, MongoDB by default; a grant has a single shape, with no compatibility layer for 0.9; code, comments and documentation are in English.

## 0. Staying general

The library knows nothing about the application that uses it. Four rules hold that.

1. **No business vocabulary.** No role, member, organisation or tenant in the code or the API. The library knows entities, grants, providers and boundaries.
2. **The reference format is a convention, not an assumption.** `type:id` and the wildcard `type:*` stay the default, behind one interface (`refs`) a project can replace.
3. **Storage is an adapter.** The engine holds no notion of MongoDB (§7).
4. **Two domains in the tests.** A second fixture, unrelated to the first (organisation, workspace, document, link sharing), replays the delegation, envelope and evolution scenarios. The README examples come from it.

## 1. What the package exports

One entry point, `@diister/quick-permission`. No `/next` subpath.

| Family | Exports |
|---|---|
| Declare | `entity`, `permissions`, `globalPermissions`, `action`, `list`, `bundle`, `external`, `ALL` |
| Assemble | `createSystem`, `compilePermissions` |
| Store | `mongo` (default), `memory` |
| Extend | `defineRule`, `implies`, `typedRefs` |
| Types | `Grant`, `Condition`, `FieldSelection`, `Subject`, `GrantProvider`, `Entity`, `PermissionSet`, `System`, `Context`, `CheckResult`, `ScopeResult`, `Reach`, `CatalogEntry`, `Boundary`, `DelegationRefusal`, `Plan`, `StorageAdapter`, `CustomRule`, `RefConvention`, `Hooks` |

Removed from the public surface: `permission()`, `resource()`, `indirectResource()`, `target.*`, `seg`, the ready-made rules (`match`, `matchPath`, `filter`, `inputMatch`…), the schema as a record, `expandsTo`, `CanResult`, `CanContext`.

What they did stays possible, through the declaration:

| 0.9 | 0.10 |
|---|---|
| `resource({ fetch })` | `entity("user", { load, loadMany })` |
| `indirectResource(...)` | `relations: { memberships: {...} }` on the entity |
| `target.required("user")` / `target.path(...)` / `target.none()` | derived from the entity and `on: "self" \| "parent" \| "none"` |
| `permission().rules([match(), filter()])` | `action({ fields: "doc" })` |
| `expandsTo: (grant) => [...]` | `bundle([...])`, `list("read")` |
| `context.can(key, target)` | `ctx.check`, `ctx.could`, `ctx.reach`, `ctx.scope`, `ctx.ask` |

## 2. Declaring

```ts
const workspace = entity("workspace", { load });
const document = workspace.child("document", { load });

const documents = permissions(document, "workspaces.documents", {
  create: action({ on: "parent", input: true }),
  read: action({ fields: "doc" }),
  update: action({ fields: "input" }),
  delete: action(),
  list: list("read"),
  manage: bundle(["list", "update", "delete"]),
});
```

A relation joins an entity to rows held elsewhere:

```ts
const document = workspace.child("document", {
  load,
  relations: {
    author: { localField: "authorId", foreignField: "_id", foreignCollection: "accounts", load: loadAuthor },
    authorTeam: { via: "author", localField: "teamId", foreignField: "_id", foreignCollection: "teams", load: loadAuthorTeam },
    links: { localField: "_id", foreignField: "documentId", foreignCollection: "links", only: { kind: "share" }, load: loadLinks },
  },
});
```

`load` is required: a condition on a relation is checked on one document through it, and pushed into the list query through the plan. `only` is a fixed condition every joined row must hold. `via` names a relation declared before it, for a link that takes two steps.

The reference convention (`type:id`, `type:*`) is the default. Another one is given once, as `refs` on a root entity, and every entity of a system uses the same.

## 3. A grant has one shape

A grant is what `grant(...)` takes, plus its key. `set.grant("read", options)` validates the options and returns a plain grant, so a grant written by hand and a built one are the same object. The builder only spells out its shorthands: `on: ALL` becomes one wildcard per segment of the path, a single string becomes a one-segment target, `ALL` inside a target becomes that segment's wildcard, and `fields: ALL` is dropped, since a grant without `fields` shows everything.

```ts
type Grant = {
  readonly id?: string;
  readonly key: string;
  readonly on?: readonly string[];                          // 0.9: target
  readonly where?: Condition;                               // 0.9: with[<entity>]
  readonly parents?: Readonly<Record<string, Condition>>;   // 0.9: with[<parent>]
  readonly related?: Readonly<Record<string, Condition>>;   // 0.9: with[<relation id>]
  readonly fields?: FieldSelection;                         // 0.9: filter
  readonly when?: readonly string[];                        // 0.9: flags, { name: true }
  readonly input?: Condition;                               // 0.9: inputWith
  readonly payload?: unknown;
};

type FieldSelection = { readonly [field: string]: true | FieldSelection };

documents.grant("read", {
  on: ["workspace:1", ALL],
  where: { status: "published" },
  fields: { _id: true, title: true, author: { name: true } },
});
```

`fields` keeps the record form: it nests, and the leaf value leaves room for more than `true` later (a masked or truncated value). It is an allow-list: a field added to a document later is never visible by default.

No compatibility with the 0.9 shape lives in the library. An application that stored grants migrates them itself. A grant that still carries a 0.9 field (`target`, `with`, `filter`, `flags`, `inputWith`) is refused with the name of its replacement, never read. Any other unknown top-level field is a tag and travels with the grant.

A system holds only the keys of its own sets, and there is no way to mix a hand-written schema into a compiled one. A bundle's include is read first as a sibling of the bundle (`"read"` in the set `documents` is `documents.read`), then as a full key of any set of the same system. A key the system does not hold fails when the system is created.

What becomes a storage contract, and is documented as such: the name of a parent and the name of a relation (keys of `parents` and `related`), the name of a named condition (values of `when`), and the reference convention (values of `on`). Renaming one of them means migrating data.

## 4. New: ownership

An entity says what it belongs to. Two forms.

```ts
const organisation = entity("organisation", { load });

const workspace = entity("workspace", {
  load,
  belongsTo: { organisation: { to: organisation, field: "organisationId" } },
});

const user = entity("user", {
  load,
  relations: { memberships: { localField: "_id", foreignField: "userId", load } },
  belongsTo: {
    organisation: {
      to: organisation,
      through: "memberships",
      where: (id) => ({ organisationId: id, status: "active" }),
    },
  },
});
```

- `field`: the owner's reference is a field of the document.
- `through`: the link goes through a relation, with the condition that makes it active.
- A child entity (`organisation.child("team")`) belongs to its parent by its path, with nothing to declare.

Any entity instance can then serve as a delegation boundary: an organisation, a team, a project, a folder. The boundary is derived from the declarations.

```ts
const boundary = system.boundary(organisation, "organisation:acme");
const nested = system.boundary(team, "organisation:acme", "team:core");

boundary.keys();                      // the keys a grant of this boundary may carry
boundary.bind(grant);                 // adds the anchor (path or condition), with `$and` when a condition is already there
boundary.refusal(held, asked, { reserved });      // invalid | reserved | outside-boundary | not-held | null
boundary.within(envelope, grants, { reserved });  // { kept, dropped }, the read-time ceiling
```

`reserved` is an optional predicate on a key: a key it names can never be delegated, whatever is held.

A boundary is drawn around one concrete instance: a wildcard, a reference of another type or a path of the wrong length throws.

What is inside:

- every key that acts under the boundary's entity, by its path;
- every key that acts under an entity declaring it belongs to the boundary's entity, and the keys of that entity's children, since a child carries its parent's condition.

Ownership is followed one step: an entity that belongs to an entity that belongs to the boundary is not inside. Declare the direct link when it is needed.

`bind` never changes what a grant already pins: a grant already targeting another instance is returned as it is, and `refusal` then reports it as outside. A grant whose condition already implies the anchor is returned unchanged, so binding twice adds nothing. A condition that contradicts the anchor is kept beside it under `$and`, which matches nothing. A grant the system would not admit is returned as it is, and `refusal` reports it as invalid.

## 5. Checking

```ts
const ctx = system.context({ subject });

await ctx.check("workspaces.documents.update", "workspace:1", "document:d1", { input });
await ctx.could("workspaces.documents.create", "workspace:1");
await ctx.reach("workspaces.documents.read");                 // "all" | "some" | "none"
const scope = await ctx.scope("workspaces.documents.list", "workspace:1");
await ctx.ask(key, target);                                   // untyped, for a key only known at run time
```

`check` requires concrete references. `could`, `reach` and `scope` answer a capability question. `scope` needs concrete parent ids.

`ask` takes one reference or an array of them, and the same options as `check`. It answers a boolean and never throws on the request itself: an unknown key, a target of the wrong length or a segment that is not a string is `false`. A wildcard segment makes it a capability question, as `could` would ask it.

`reach` answers `all` when a grant covers the request with no restriction, `some` when every covering grant carries a restriction (a condition, a pinned target, a named condition that cannot be decided without the document), `none` otherwise.

Options, on the context or on one call: `input` (what is being written), `at` (a date) and `ip`.

`ctx.seed(entity, docs, ...parentIds)` and `ctx.seedRelated(entity, relation, rows, ...ids)` hand over documents the caller already loaded. `ctx.heldGrants()` and `ctx.fetchCounters()` are for diagnosis.

`system.catalog()` describes every key: its kind, its path, what it includes and reaches, and what a grant on it may carry (`where`, `parents`, `related` with each relation's fields, `when`, `fields`, `input`).

## 6. Delegating

Grouped under `system.delegation` and `boundary`, out of the core.

```ts
system.delegation.covers(held, asked);
system.delegation.refusal(held, asked, { within: boundary, reserved });
system.delegation.withinEnvelope(envelope, grants, { within: boundary });
system.delegation.boundary(entity, ...path);                  // same as system.boundary
await ctx.delegationRefusal(asked, { within: boundary });
```

Rules, each one only ever narrowing what is held:

- a target equal or narrower;
- a condition that holds every clause of the held one (an `$and` that adds, an `$in` that shrinks), on the entity, on a parent, on a relation and on `input`;
- fields as a subset;
- every named condition of the held grant, and possibly more: adding one restricts further;
- the same `payload` when the held grant has one; a held grant without `payload` lets the asked one set its own;
- a bundle cannot be assembled from its parts.

## 7. Providing grants

```ts
createSystem({
  permissions: [users, documents],
  providers: [
    { name: "roles", keys: ["users.*"], cacheKey: (subject) => subject.id, fetch: (subject) => [...] },
    workspace.grants("owners", { keys: ["workspaces.*"], for: ({ subject, ids, doc }) => [...] }),
  ],
  hooks: { onGrantRejected, onProviderFetch, onError },
});
```

An invalid grant is dropped on entry and reported through `onGrantRejected`. No provider can bring in an unknown key, a malformed target, or a constraint no rule reads.

## 8. Storage is an adapter

Conditions (`{ status: "active" }`, `$in`, `$and`, `$or`…) are the library's own language. They are evaluated in memory against a document, and translated for a storage.

`ctx.scope(...)` returns a neutral plan, with nothing specific to a database:

```ts
type Plan = { readonly alternatives: readonly Alternative[] };

type Alternative = {
  readonly where?: Condition;                  // condition on the entity
  readonly through?: readonly {                // relations to traverse
    readonly relation: RelationInfo;           // local and foreign fields, collection, static part, parent relation
    readonly where: Condition;
  }[];
};

interface StorageAdapter<TQuery> {
  readonly name: string;
  compile(plan: Plan): TQuery;
}

createSystem({ permissions, providers, storage: mongo() });   // `mongo()` is the default
```

A row is visible when one alternative holds entirely: its condition on the entity and every one of its joined conditions. There is one alternative per grant that covers the request. Two grants that say the same thing give one alternative, and an alternative with no condition opens the whole collection: the plan is then that single empty alternative.

A relation's fixed part (`only`) and a grant's condition on that relation must hold on the same joined row. A grant cannot widen a relation by naming the field `only` fixes.

This is stricter than 0.9, which merged the conditions on the entity across grants and the joined conditions across grants separately. A row matching the entity condition of one grant and the joined condition of another passed the list filter, and was only removed afterwards by the per-row projection. The plan keeps each grant's conditions together, so the list filter is exact.

Shipped in 0.10.0:

- `mongo()`: returns `{ filter, stages }`. Without a relation, `stages` is `null` and `filter` is the whole answer. With one, `stages` is a first `$match` on the entity when every alternative has one, the `$lookup` stages, then the exact `$match`.
- `memory()`: returns a predicate `(doc, related?) => boolean`, where `related(relation)` gives the joined rows of a document. Without it, an alternative that goes through a relation never holds. Used by the tests and for small data sets, and proves the interface with a second real implementation.

No SQL adapter in this version: it would not be verified. The interface is documented so one can be written.

`scope.query` is the adapter's output. `scope.plan` stays available for whoever wants to translate it themselves.

Two things the caller keeps in hand. The query restricts rows by what the grants say; it does not add the link to the parents the scope was asked for, which the caller's own query already carries. And when `stages` is set, `filter` is only a first cut that the last `$match` completes: running `filter` alone would show too much.

## 9. Custom rules

```ts
const officeHours = defineRule({
  name: "office-hours",
  when: "officeHours",
  check: (context) => (context.at ?? new Date()).getUTCHours() < 18,
});

const ownDraft = defineRule({
  name: "own-draft",
  perDocument: true,
  check: async (context) => {
    const doc = await context.doc();
    return isDraftOf(doc, context.subject.id);
  },
  rows: (context) => ({ status: "draft", authorId: context.subject.id }),
});

action({ rules: [officeHours, ownDraft] });
```

A rule receives the subject, the ids, the grant, `input`, `at`, `ip`, and can read the document (`doc()`) or a parent (`parent(name)`). `when` ties it to grants that list that name.

A rule whose answer depends on the document says so with `perDocument`. On a list it is asked for `rows`, a condition that enters the plan. A per-document rule with no `rows` makes `scope()` refuse, instead of returning a list the rule never looked at.

## 10. Layout of the rewritten code

```
library/
  mod.ts            public exports, nothing else
  entity.ts         entities, relations, named conditions, ownership
  permissions.ts    action, list, bundle, sets, grant building
  grant.ts          the grant shape and the provider types
  compile.ts        catalogue validation, grant admission, bundle expansion
  condition.ts      the condition language: validation, in-memory evaluation, implication
  fields.ts         field selections: projection, union, inclusion
  refs.ts           reference convention, `type:id` by default
  rule.ts           `defineRule`
  delegation.ts     coverage, boundary, envelope
  system.ts         `createSystem`, `compilePermissions`, the context
  engine/           model.ts, loader.ts (cache, batching), providers.ts, evaluate.ts
  storage/          plan.ts, mongo.ts, memory.ts
  sift/             vendored third-party library, unchanged
```

The engine is written directly around entities and paths: no translation to an intermediate schema, no three kinds of target, no per-key expansion callback (a bundle's reach is computed once from its includes, and the catalogue reports it as `expandsTo`). Nothing under `engine/` imports an adapter; it only imports the plan types from `storage/plan.ts`.

## 11. Guard rails, as they held

1. The 164 tests of the 0.9 engine were ported to this API and passed on the 0.9 engine before it was touched: 140 as they were, the rest listed below. They then ran against the rewritten engine, and the 0.9 engine and its own tests were deleted.
2. Measured with `scripts/bench.ts` and `scripts/drive-bench.ts`. One check: 7 µs on 0.9, 3 to 5 µs now. A 100-row page: 1,123 µs through the 0.9 entity layer, about 330 µs now (two decisions per row, as before: may it be listed, and which fields). The heaviest case of the drive benchmark (1,000 grants, 100 files): 866 ms on 0.9, about 320 ms now. A first application showed what these benches missed: a subject holding the whole catalogue paid a full expansion on every request, which is why a bundle is now expanded only for the key being checked.
3. The library is judged on its own: no guard rail depends on an application. A second domain (`examples/workspace.ts`, `test/workspace_test.ts`) replays checks, lists, relations, boundaries, the envelope and an ownership change.
4. Behaviours kept, each with its test: deny by default, a provider or loader error never grants a right, a capability question loads no document it does not need, a target of the wrong arity is refused.
5. `test/relations_mongo_test.ts` runs the pipelines against a real MongoDB: every row set the 0.9 tests expected is returned, and a row matching the entity condition of one grant and the joined condition of another is not.

What changed on purpose, compared with 0.9:

- A relation must declare `load`. On 0.9 a joined condition on a relation without a loader passed a check on one document without being verified.
- `scope` needs concrete parent ids. On 0.9 a wildcard parent turned the parent's condition into a filter on the child's rows.
- A forbidden operator is refused when the grant enters and reported through `onGrantRejected`; the check answers `no matching grant`. On 0.9 it surfaced as a rule failure, or as an exception while building stages.
- `reach` answers `some`, not `all`, when a grant carries a named condition that cannot be decided without the document, or when the action forbids one.
- A grant's condition on a relation is combined with the relation's fixed part instead of being spread over it.
- A bundle cycle, or a bundle including a key the system does not hold, fails when the system is created.
- No check outside a context. No optional target. No schema tree. A document source tied to the subject instead of the target is no longer declarable: a custom rule loads what it needs.
- A provider returns a fresh list: a grant or a list mutated in place after it was returned is not looked at again.
- A bundle is expanded for the key being checked. A child a bundle cannot carry is reported when a check first reaches it; `system.audit(grants)` reports them all at once.
- A loader that throws denies the grants that needed its document, and is reported through `onError`. On 0.9 the error reached the caller.

## 12. What is left

1. A stable 0.10.0, once an application has run the betas in production.
2. Known gaps: `seed` cannot record that a document is absent; no SQL adapter; ownership is followed one step.
3. Applications on 0.9 migrate with `docs/migrating-to-0.10.md`: stored grants take the new shape, relations gain a `load`, list queries read `scope.query`.

# @diister/quick-permission

Declarative, type-safe permissions that answer three questions at once: **may
this subject act?**, **on which rows?**, and **which fields come back?**

A check returns not just a yes or no, but the MongoDB constraints — and, when a
rule reaches across collections, the aggregation pipeline — needed to enforce
the same decision on a list query.

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

## Quick start

A **resource** says how to load a document. A **permission** says what target it
takes and which rules must hold. A **provider** says which grants a subject
carries.

```ts
import {
  createSystem,
  permission,
  resource,
  target,
} from "@diister/quick-permission";

const userOf = resource({
  id: "user",
  fetch: ({ target }) => db.users.findOne({ _id: target[0] }),
});

const sys = createSystem({
  schema: {
    "users.read": permission({ target: target.required("user") })
      .rules([userOf.match()]),
  },
  providers: [
    (subject) => grantsFor(subject), // [{ key: "users.read", target: ["user:abc"] }]
  ],
});

const result = await sys
  .context({ subject: { id: "user:caller" } })
  .can("users.read", ["user:abc"]);

result.ok; // true
```

## Core concepts

### Targets

A permission declares the shape of what it acts on. Targets are segment tuples,
so `["user:abc"]` and `["org:1", "project:2"]` are both valid — for their
respective declarations.

```ts
target.required("user")        // exactly one user segment
target.optional("user")        // the segment may be omitted
target.none()                  // the permission acts on nothing in particular
target.path("org", "project")  // a hierarchy
```

Grants may use `*` as a segment wildcard: a grant on `["user:*"]` matches any
user.

### Resources

A resource is a named loader. The engine calls `fetch` at most once per distinct
target within a check, and `dedupKey` lets you widen or narrow that sharing.

```ts
const postOf = resource({
  id: "post",
  fetch: ({ subject, target, grant }) => db.posts.findOne({ _id: target[0] }),
  activeWhen: (grant) => grant.with?.post !== undefined, // skip when irrelevant
  dedupKey: ({ target }) => String(target[0]),
});
```

### Rules

Rules are what a permission checks. Every resource carries sugar methods for the
common ones:

| Method | Holds when |
| --- | --- |
| `match(extract?)` | the fetched value equals the grant's constraint |
| `filter(extract?)` | contributes a field filter rather than a verdict |
| `includes(field, extract)` | the grant's `field` is in the extracted list |
| `requireTruthy()` | the document exists and is truthy |
| `requireOwner(get, { flag })` | the subject owns the document |
| `requireMembership(get, { flag })` | the subject is in the extracted list |
| `requireCustom(predicate, opts)` | your own predicate holds |

For anything else, `defineRule` is the primitive they are all built on:

```ts
import { defineRule } from "@diister/quick-permission";

const isPublished = defineRule({
  kind: "post.published",
  needs: [postOf],
  check: ([post]) =>
    post?.status === "published"
      ? true
      : { ok: false, reason: "post is not published" },
});
```

`check` returns a boolean for a plain verdict, or `{ ok: false, reason }` when
the caller deserves to know why.

### Providers

A provider turns a subject into grants. Several may be combined, and a subject
is allowed when any single grant satisfies the permission's rules.

```ts
providers: [
  (subject) => db.grants.find({ userId: subject.id }).toArray(),
  (subject) => (subject.isAdmin ? [{ key: "*", target: ["*"] }] : []),
]
```

## Filtering lists, not just single documents

This is what the library is really for. `can()` hands back the query fragments
needed to apply the same decision to a list.

```ts
const result = await sys.context({ subject }).can("posts.list");
if (!result.ok) return [];

const rows = result.stages
  ? await db.posts.aggregate([...result.stages]).toArray()
  : await db.posts.find(result.constraints ?? {}).toArray();
```

`constraints` is a plain MongoDB filter. `stages` appears instead when a rule
reaches through an **indirect resource** — a join the engine has to express as
an aggregation, because the deciding data lives in another collection.

```ts
import { indirectResource } from "@diister/quick-permission";

const membershipsOf = indirectResource({
  id: "memberships_of_participant",
  from: participantOf,
  on: { localField: "_id", foreignField: "participantId" },
  to: { _type: "org_membership" },
  cardinality: "many",
});
```

Field-level filtering works the same way: `filter()` rules contribute a
`FilterSpec`, and `applyFilter` applies it to a document.

```ts
import { applyFilter } from "@diister/quick-permission";

const visible = applyFilter(post, result.data as FilterSpec);
```

## API reference

### `createSystem({ schema, providers })`

Builds the engine. `schema` maps permission keys to `permission(...)`
declarations; `providers` lists the grant sources. Returns a `System`:

| Member | Purpose |
| --- | --- |
| `context({ subject })` | bind a subject; returns the surface below |
| `can(key, target?)` | one-shot check without binding a context |
| `list()` | every permission key with its metadata |
| `tree()` | the same, as a hierarchy |
| `schema` | the declaration you passed in |
| `indirectResources()` | every indirect resource reachable from the schema |
| `indirectsUsedBy(key)` | those a given permission depends on |

### `context({ subject })`

| Member | Purpose |
| --- | --- |
| `can(key, target?)` | run a check; resource fetches are deduplicated across it |
| `preseed(resourceOrId, target, value)` | supply a document you already hold |
| `getFetchCounters()` | how many times each resource was fetched |
| `clearCounters()` | reset those counters |
| `dumpGrants()` | the grants the providers returned, for debugging |

`preseed` is worth knowing: when the caller already has the document in hand,
seeding it skips the fetch entirely.

### The result of `can()`

```ts
type CanResult =
  | {
      ok: true;
      data?: unknown;                              // filter spec, when filter() rules ran
      constraints?: Record<string, unknown>;       // MongoDB filter for list queries
      stages?: readonly Record<string, unknown>[]; // aggregation, for indirect rules
      matchedGrants?: readonly string[];
    }
  | { ok: false /* … */ };
```

### Other exports

`permission`, `resource`, `defineRule`, `indirectResource`, `target`, `seg`,
`applyFilter`, `inputMatch`, `intermediate`, `matchPath`, `pickFields`,
`requireSelf`, and the types they use.

## Development

```bash
bun install
bun test          # 184 tests
bun run check     # tsc
bun run lint      # biome
bun run build     # dist/ for npm
```

The suite targets `node:test`, so it runs unchanged under `bun test`,
`node --test` and `deno test` — worth it, because Bun runs JavaScriptCore while
Node and Deno run V8. Five cases need a MongoDB on `localhost:27017`; set
`MONGO_URL` to point elsewhere.

`sift/` is vendored from [sift.js](https://github.com/crcn/sift.js) (MIT) with
the `$where` operator removed, and is excluded from lint and formatting so
re-vendoring stays a clean diff.

## License

MIT — see [LICENSE](LICENSE).

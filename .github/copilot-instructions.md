# Working on quick-permission

`quick-permission` is a TypeScript permission library: entities, permission keys declared on them, grants with one shape, list filters pushed to the storage, field allow-lists and delegation boundaries. The public surface is `library/mod.ts`; `README.md` documents it and `docs/rfc-0.10-api.md` records why it has this shape.

## Layout

```
library/
  mod.ts            public exports, nothing else
  entity.ts         entities, relations, named conditions, ownership
  permissions.ts    action, list, bundle, sets, grant building
  grant.ts          the grant shape and the provider types
  compile.ts        catalogue validation, grant admission, bundle expansion
  condition.ts      the condition language
  fields.ts         field selections
  refs.ts           reference convention
  rule.ts           custom rules
  delegation.ts     coverage, boundary, envelope
  system.ts         createSystem, compilePermissions, the context
  engine/           model, loader, providers, evaluate
  storage/          plan, mongo, memory
  sift/             vendored third-party library, left unchanged
  test/             one file per behaviour, run by bun, node and deno
```

## Rules

- Strict TypeScript, no `any` outside a commented lint exception, `satisfies` before `as`.
- English for code, comments and documentation. Comments state a constraint the code cannot express; they do not narrate.
- Nothing under `engine/` imports a storage adapter.
- A behaviour change comes with its test, and with its line in `README.md` when a caller can observe it.
- The library is judged on its own: no test and no example depends on an application.

## Checks

From `library/`: `bun run check`, `bun run lint`, `bun run fmt:check`, `bun test`, `bun run build`. The suite also runs under `node --test "test/*_test.ts"` and `deno test -A --no-check test/`. `test/relations_mongo_test.ts` needs a MongoDB on `localhost:27017`.

## Releasing

Set the version in `library/package.json` and `library/jsr.json`, then push the tag `v<version>`. The publish workflow refuses a tag that does not match the manifest, stages the npm release for a maintainer to approve, and publishes to JSR.

import {
  createSystem as createEngine,
  intermediate,
  matchPath,
  permission,
  target,
} from "../mod.ts";
import { ALL, createSystem } from "../next/mod.ts";
import { createFixture } from "../test/+next_fixture.ts";

const ROUNDS = 20_000;
const PAGE = 100;

async function time(label: string, runs: number, body: () => Promise<unknown>) {
  for (let i = 0; i < 2_000; i++) await body();
  const started = performance.now();
  for (let i = 0; i < runs; i++) await body();
  const micros = ((performance.now() - started) * 1000) / runs;
  console.log(`${label.padEnd(46)} ${micros.toFixed(2)} µs`);
  return micros;
}

const fixture = createFixture();
const userOf = fixture.entities.user.resource;

const legacy = createEngine({
  schema: {
    "users.read": permission({ target: target.required("user") }).rules([
      userOf.match(),
      matchPath(),
      userOf.filter(),
    ]),
    "users.list": intermediate({
      target: target.required("user"),
      expandsTo: (grant) => [{ ...grant, key: "users.read" }],
    }).rules([userOf.match(), userOf.filter()]),
  },
  providers: [
    {
      cacheKey: (subject) => subject.id,
      fetch: () => [
        {
          id: "g",
          key: "users.list",
          target: ["user:*"],
          with: { user: { tenant: "t1" } },
          filter: { _id: true, firstname: true },
        },
      ],
    },
  ],
});

const next = createSystem({
  permissions: fixture.all,
  providers: [
    {
      cacheKey: (subject) => subject.id,
      fetch: () => [
        fixture.sets.users.grant("list", {
          id: "g",
          on: ALL,
          where: { tenant: "t1" },
          fields: ["_id", "firstname"],
        }),
      ],
    },
  ],
});

const subject = { id: "user:9" };
const page = Array.from({ length: PAGE }, (_, index) => ({
  _id: `user:${index + 100}`,
  email: `${index}@x.fr`,
  firstname: "F",
  lastname: "L",
  tenant: index % 2 === 0 ? "t1" : "t2",
}));

const legacyContext = legacy.context({ subject });
const nextContext = next.context({ subject });

const single = await time("engine  can(users.read, one id)", ROUNDS, () =>
  legacyContext.can("users.read", ["user:1"]),
);
const layered = await time("layer   check(users.read, one id)", ROUNDS, () =>
  nextContext.check("users.read", "user:1"),
);

const legacyPage = await time(
  `engine  list + read ${PAGE} rows`,
  ROUNDS / 100,
  async () => {
    const context = legacy.context({ subject });
    const cap = await context.can("users.list", ["user:*"]);
    if (!cap.ok) return;
    context.preseed(userOf, page, { dedupKey: (doc) => [doc._id] });
    await Promise.all(page.map((doc) => context.can("users.read", [doc._id])));
  },
);
const nextPage = await time(
  `layer   scope + project ${PAGE} rows`,
  ROUNDS / 100,
  async () => {
    const scope = await next.context({ subject }).scope("users.list");
    if (scope.ok) await scope.projectAll(page);
  },
);

console.log(
  `\nsingle check overhead ${(layered - single).toFixed(2)} µs, page overhead ${((nextPage - legacyPage) / PAGE).toFixed(2)} µs per row`,
);

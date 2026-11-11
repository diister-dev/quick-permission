import { ALL, createSystem } from "../mod.ts";
import { createFixture } from "../test/+fixture.ts";

const ROUNDS = 20_000;
const WARM_UP = 2_000;
const PAGE = 100;

async function time(label: string, runs: number, body: () => Promise<unknown>) {
  for (let i = 0; i < WARM_UP; i++) await body();
  const started = performance.now();
  for (let i = 0; i < runs; i++) await body();
  const micros = ((performance.now() - started) * 1000) / runs;
  console.log(`${label.padEnd(40)} ${micros.toFixed(2)} µs`);
  return micros;
}

const fixture = createFixture();

const system = createSystem({
  permissions: fixture.all,
  providers: [
    {
      cacheKey: (subject) => subject.id,
      fetch: () => [
        fixture.sets.users.grant("list", {
          id: "g",
          on: ALL,
          where: { tenant: "t1" },
          fields: { _id: true, firstname: true },
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

const context = system.context({ subject });

await time("check(users.read, one id)", ROUNDS, () =>
  context.check("users.read", "user:1"),
);
await time("could(users.read)", ROUNDS, () => context.could("users.read"));
const listed = await time(
  `scope + project ${PAGE} rows`,
  ROUNDS / 100,
  async () => {
    const scope = await system.context({ subject }).scope("users.list");
    if (scope.ok) await scope.projectAll(page);
  },
);

console.log(`\n${(listed / PAGE).toFixed(2)} µs per projected row`);

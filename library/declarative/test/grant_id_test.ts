import { createSystem } from "../system.ts";
import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";
import { custom } from "../rules.ts";
import type { Provider } from "../system.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

function assert(cond: boolean, msg = "") {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

type Meta = { description: string };
const { permission } = createPermissionFactory<Meta>();

const doIt = permission({
  metadata: { description: "Do" },
  target: target.none(),
}).rules([]);

Deno.test("grant.id — ok result exposes matched grant ids", async () => {
  const provider: Provider = () => [
    { id: "grant-a", key: "do" },
    { id: "grant-b", key: "do" },
  ];
  const sys = createSystem<Meta>({ schema: { do: doIt }, providers: [provider] });

  const r = await sys.can({ id: "u" }, "do");
  assert(r.ok);
  if (r.ok) {
    assertEq(r.matchedGrants, ["grant-a", "grant-b"]);
  }
});

Deno.test("grant.id — denied reasons mention the grant id", async () => {
  const guarded = permission({
    metadata: { description: "Guarded" },
    target: target.none(),
  }).rules([custom(() => false)]);

  const provider: Provider = () => [{ id: "grant-x", key: "do" }];
  const sys = createSystem<Meta>({
    schema: { do: guarded },
    providers: [provider],
  });

  const r = await sys.can({ id: "u" }, "do");
  assertEq(r.ok, false);
  if (!r.ok) {
    assert(r.reasons.some((s) => s.includes("grant-x")));
  }
});

Deno.test("grant.id — anonymous grants are accepted (id is optional)", async () => {
  const provider: Provider = () => [{ key: "do" }];
  const sys = createSystem<Meta>({ schema: { do: doIt }, providers: [provider] });

  const r = await sys.can({ id: "u" }, "do");
  assert(r.ok);
  if (r.ok) {
    // No id → matchedGrants omitted
    assertEq(r.matchedGrants, undefined);
  }
});

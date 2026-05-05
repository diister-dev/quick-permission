import { createSystem } from "../system.ts";
import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";
import type { Provider } from "../system.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

type Meta = { description: string };
const { permission } = createPermissionFactory<Meta>();

const badgeRead = permission({
  metadata: { description: "Read badge" },
  target: target.path("exposition", "badge"),
}).rules([]);

Deno.test("broadMatch — request ['expo:1', '*'] overlaps grant ['expo:1', 'badge:*']", async () => {
  const provider: Provider = () => [{
    key: "expositions.badges.read",
    target: ["expo:1", "badge:*"],
  }];
  const sys = createSystem<Meta>({
    schema: { "expositions.badges.read": badgeRead },
    providers: [provider],
  });

  // Strict mode: ["expo:1", "*"] must NOT match ["expo:1", "badge:*"] strictly.
  const strict = await sys.can(
    { id: "u" },
    "expositions.badges.read",
    ["expo:1", "*"],
  );
  assertEq(strict.ok, false);

  // Broad mode: should overlap.
  const broad = await sys.can(
    { id: "u" },
    "expositions.badges.read",
    ["expo:1", "*"],
    { broadMatch: true },
  );
  assertEq(broad.ok, true);
});

Deno.test("broadMatch — non-overlapping targets still denied", async () => {
  const provider: Provider = () => [{
    key: "expositions.badges.read",
    target: ["expo:1", "badge:*"],
  }];
  const sys = createSystem<Meta>({
    schema: { "expositions.badges.read": badgeRead },
    providers: [provider],
  });

  const r = await sys.can(
    { id: "u" },
    "expositions.badges.read",
    ["expo:2", "*"],
    { broadMatch: true },
  );
  assertEq(r.ok, false);
});

Deno.test("broadMatch — request without target is the same as broad request '*'", async () => {
  const provider: Provider = () => [{
    key: "expositions.badges.read",
    target: ["expo:1", "badge:42"],
  }];
  const sys = createSystem<Meta>({
    schema: { "expositions.badges.read": badgeRead },
    providers: [provider],
  });

  // Request without target in broad mode — accepts any matching grant.
  const r = await sys.can(
    { id: "u" },
    "expositions.badges.read",
    undefined,
    { broadMatch: true },
  );
  assertEq(r.ok, true);
});

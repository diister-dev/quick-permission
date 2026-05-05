import { createSystem } from "../system.ts";
import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";
import { match } from "../rules.ts";
import type { Provider } from "../system.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

type Meta = { description: string };
const { permission } = createPermissionFactory<Meta>();

// ── partial spec match ────────────────────────────────────────────────────────

Deno.test("match — grant.with[seg] is a partial spec, only declared fields are constrained", async () => {
  // Resource has many fields, grant only constrains exhibitorId.
  const p = permission({
    metadata: { description: "" },
    target: target.required("collaborator"),
    fetch: ([id]) => Promise.resolve({
      _id: id,
      exhibitorId: "exhibitor:3",
      name: "Alice",
      role: "manager",
      createdAt: new Date(),
    }),
  }).rules([match("collaborator", (v) => v)]);

  const provider: Provider = () => [{
    key: "u.r",
    target: ["collab:1"],
    with: { collaborator: { exhibitorId: "exhibitor:3" } },
  }];

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [provider],
  });

  const r = await sys.can({ id: "u" }, "u.r", ["collab:1"]);
  assertEq(r.ok, true);
});

Deno.test("match — partial spec mismatch on a constrained field denies", async () => {
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]) => Promise.resolve({ _id: id, status: "banned", role: "x" }),
  }).rules([match("user", (v) => v)]);

  const provider: Provider = () => [{
    key: "u.r",
    target: ["user:1"],
    with: { user: { status: "active" } }, // resource has banned, mismatch
  }];

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [provider],
  });

  const r = await sys.can({ id: "u" }, "u.r", ["user:1"]);
  assertEq(r.ok, false);
});

Deno.test("match — multiple fields in spec, all must match", async () => {
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]) => Promise.resolve({ _id: id, status: "active", role: "admin" }),
  }).rules([match("user", (v) => v)]);

  // Both fields match
  const okProvider: Provider = () => [{
    key: "u.r",
    target: ["user:1"],
    with: { user: { status: "active", role: "admin" } },
  }];
  const okSys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [okProvider],
  });
  assertEq((await okSys.can({ id: "u" }, "u.r", ["user:1"])).ok, true);

  // One field mismatches
  const nokProvider: Provider = () => [{
    key: "u.r",
    target: ["user:1"],
    with: { user: { status: "active", role: "viewer" } },
  }];
  const nokSys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [nokProvider],
  });
  assertEq((await nokSys.can({ id: "u" }, "u.r", ["user:1"])).ok, false);
});

Deno.test("match — empty spec ({}) is vacuously satisfied", async () => {
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]) => Promise.resolve({ _id: id, status: "any" }),
  }).rules([match("user", (v) => v)]);

  const provider: Provider = () => [{
    key: "u.r",
    target: ["user:1"],
    with: { user: {} },
  }];

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [provider],
  });

  assertEq((await sys.can({ id: "u" }, "u.r", ["user:1"])).ok, true);
});

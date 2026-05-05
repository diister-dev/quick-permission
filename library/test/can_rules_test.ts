import { createSystem } from "../system.ts";
import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";
import { custom, filter, match } from "../rules.ts";
import { payload } from "../payload.ts";
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

// ── result shape ──────────────────────────────────────────────────────────────

Deno.test("can() returns { ok: true } when granted", async () => {
  const sys = createSystem<Meta>({
    schema: {
      "x.do": permission({ metadata: { description: "x" }, target: target.none() }).rules([]),
    },
    providers: [() => [{ key: "x.do" }]],
  });
  const r = await sys.can({ id: "u" }, "x.do");
  assertEq(r.ok, true);
});

Deno.test("can() returns { ok: false, reasons } when denied", async () => {
  const sys = createSystem<Meta>({
    schema: {
      "x.do": permission({ metadata: { description: "x" }, target: target.none() }).rules([]),
    },
    providers: [],
  });
  const r = await sys.can({ id: "u" }, "x.do");
  assertEq(r.ok, false);
  if (!r.ok) assert(Array.isArray(r.reasons));
});

// ── match rule ────────────────────────────────────────────────────────────────

Deno.test("match rule — grant.with[seg] matches → ok", async () => {
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]) => Promise.resolve({ id, status: "active" }),
  }).rules([match("user", (v) => ({ status: v.status }))]);

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [() => [{ key: "u.r", target: ["user:1"], with: { user: { status: "active" } } }]],
  });

  const r = await sys.can({ id: "u" }, "u.r", ["user:1"]);
  assertEq(r.ok, true);
});

Deno.test("match rule — grant.with[seg] mismatch → denied", async () => {
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]) => Promise.resolve({ id, status: "active" }),
  }).rules([match("user", (v) => ({ status: v.status }))]);

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [() => [{ key: "u.r", target: ["user:1"], with: { user: { status: "banned" } } }]],
  });

  const r = await sys.can({ id: "u" }, "u.r", ["user:1"]);
  assertEq(r.ok, false);
});

Deno.test("match rule — no grant.with[seg] → constraint vacuously ok", async () => {
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]) => Promise.resolve({ id, status: "active" }),
  }).rules([match("user", (v) => ({ status: v.status }))]);

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [() => [{ key: "u.r", target: ["user:1"] }]],
  });

  const r = await sys.can({ id: "u" }, "u.r", ["user:1"]);
  assertEq(r.ok, true);
});

// ── filter rule ───────────────────────────────────────────────────────────────

Deno.test("filter rule — grant.filter applied to extracted resource", async () => {
  type User = { id: string; email: string; salary: number };
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]): Promise<User> =>
      Promise.resolve({ id, email: "a@b.c", salary: 1000 }),
  }).rules([filter((v) => v)]);

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [() => [{
      key: "u.r",
      target: ["user:1"],
      filter: { id: true, email: true },
    }]],
  });

  const r = await sys.can({ id: "u" }, "u.r", ["user:1"]);
  assertEq(r.ok, true);
  if (r.ok) {
    assertEq(r.output?.data, { id: "user:1", email: "a@b.c" });
  }
});

Deno.test("filter rule — no grant.filter returns full extracted value", async () => {
  type User = { id: string; email: string };
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]): Promise<User> => Promise.resolve({ id, email: "a@b.c" }),
  }).rules([filter((v) => v)]);

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [() => [{ key: "u.r", target: ["user:1"] }]],
  });

  const r = await sys.can({ id: "u" }, "u.r", ["user:1"]);
  assertEq(r.ok, true);
  if (r.ok) {
    assertEq(r.output?.data, { id: "user:1", email: "a@b.c" });
  }
});

// ── custom rule ───────────────────────────────────────────────────────────────

Deno.test("custom rule — predicate true → ok", async () => {
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]) => Promise.resolve({ id }),
  }).rules([custom(() => true)]);

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [() => [{ key: "u.r", target: ["user:1"] }]],
  });

  const r = await sys.can({ id: "u" }, "u.r", ["user:1"]);
  assertEq(r.ok, true);
});

Deno.test("custom rule — predicate false → denied", async () => {
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]) => Promise.resolve({ id }),
  }).rules([custom(() => false)]);

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [() => [{ key: "u.r", target: ["user:1"] }]],
  });

  const r = await sys.can({ id: "u" }, "u.r", ["user:1"]);
  assertEq(r.ok, false);
});

Deno.test("custom rule — has access to typed payload", async () => {
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]) => Promise.resolve({ id }),
    payload: payload<{ requiredScope: string }>(),
  }).rules([
    custom((ctx) => ctx.payload.requiredScope === "admin"),
  ]);

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [() => [{
      key: "u.r",
      target: ["user:1"],
      payload: { requiredScope: "admin" },
    }]],
  });

  const r = await sys.can({ id: "u" }, "u.r", ["user:1"]);
  assertEq(r.ok, true);
});

Deno.test("custom rule — receives subject and target in ctx", async () => {
  let captured: unknown;
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]) => Promise.resolve({ id }),
  }).rules([custom((ctx) => {
    captured = { subject: ctx.subject, target: ctx.target };
    return true;
  })]);

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [() => [{ key: "u.r", target: ["user:1"] }]],
  });

  await sys.can({ id: "u:abc" }, "u.r", ["user:1"]);
  assertEq(captured, { subject: { id: "u:abc" }, target: ["user:1"] });
});

// ── fetch invocation ──────────────────────────────────────────────────────────

Deno.test("can() invokes fetch only when target is provided", async () => {
  let calls = 0;
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: ([id]) => {
      calls++;
      return Promise.resolve({ id });
    },
  }).rules([]);

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [() => [{ key: "u.r", target: ["user:1"] }]],
  });

  await sys.can({ id: "u" }, "u.r", ["user:1"]);
  assertEq(calls, 1);
});

Deno.test("can() — fetch error → grant rejected", async () => {
  const p = permission({
    metadata: { description: "" },
    target: target.required("user"),
    fetch: () => Promise.reject(new Error("not found")),
  }).rules([]);

  const sys = createSystem<Meta>({
    schema: { "u.r": p },
    providers: [() => [{ key: "u.r", target: ["user:1"] }]],
  });

  const r = await sys.can({ id: "u" }, "u.r", ["user:1"]);
  assertEq(r.ok, false);
});

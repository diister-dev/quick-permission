import { createSystem } from "../system.ts";
import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";
import { ip, time } from "../rules.ts";
import type { Provider } from "../system.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

type Meta = { description: string };
const { permission } = createPermissionFactory<Meta>();

const doIt = permission({
  metadata: { description: "Do it" },
  target: target.none(),
}).rules([time(), ip()]);

// ── time() ────────────────────────────────────────────────────────────────────

Deno.test("time() — grant inside window passes", async () => {
  const provider: Provider = () => [{
    key: "do",
    startDate: new Date("2020-01-01"),
    endDate: new Date("2099-12-31"),
  }];
  const sys = createSystem<Meta>({ schema: { do: doIt }, providers: [provider] });
  const r = await sys.can({ id: "u" }, "do");
  assertEq(r.ok, true);
});

Deno.test("time() — grant before startDate is rejected", async () => {
  const provider: Provider = () => [{
    key: "do",
    startDate: new Date("2099-01-01"),
  }];
  const sys = createSystem<Meta>({ schema: { do: doIt }, providers: [provider] });
  const r = await sys.can({ id: "u" }, "do");
  assertEq(r.ok, false);
});

Deno.test("time() — grant after endDate is rejected", async () => {
  const provider: Provider = () => [{
    key: "do",
    endDate: new Date("2000-01-01"),
  }];
  const sys = createSystem<Meta>({ schema: { do: doIt }, providers: [provider] });
  const r = await sys.can({ id: "u" }, "do");
  assertEq(r.ok, false);
});

Deno.test("time() — no startDate/endDate means always valid", async () => {
  const provider: Provider = () => [{ key: "do" }];
  const sys = createSystem<Meta>({ schema: { do: doIt }, providers: [provider] });
  const r = await sys.can({ id: "u" }, "do");
  assertEq(r.ok, true);
});

Deno.test("time() — context.checkDate overrides 'now'", async () => {
  const provider: Provider = () => [{
    key: "do",
    startDate: new Date("2025-01-01"),
    endDate: new Date("2025-12-31"),
  }];
  const sys = createSystem<Meta>({ schema: { do: doIt }, providers: [provider] });
  const r = await sys.can(
    { id: "u" },
    "do",
    undefined,
    { checkDate: new Date("2025-06-01") },
  );
  assertEq(r.ok, true);
});

// ── ip() ──────────────────────────────────────────────────────────────────────

Deno.test("ip() — no grant.ips means no restriction", async () => {
  const provider: Provider = () => [{ key: "do" }];
  const sys = createSystem<Meta>({ schema: { do: doIt }, providers: [provider] });
  const r = await sys.can({ id: "u" }, "do");
  assertEq(r.ok, true);
});

Deno.test("ip() — grant.ips contains context.checkIp → ok", async () => {
  const provider: Provider = () => [{ key: "do", ips: ["10.0.0.1", "10.0.0.2"] }];
  const sys = createSystem<Meta>({ schema: { do: doIt }, providers: [provider] });
  const r = await sys.can({ id: "u" }, "do", undefined, { checkIp: "10.0.0.2" });
  assertEq(r.ok, true);
});

Deno.test("ip() — grant.ips does NOT contain checkIp → denied", async () => {
  const provider: Provider = () => [{ key: "do", ips: ["10.0.0.1"] }];
  const sys = createSystem<Meta>({ schema: { do: doIt }, providers: [provider] });
  const r = await sys.can({ id: "u" }, "do", undefined, { checkIp: "10.0.0.99" });
  assertEq(r.ok, false);
});

Deno.test("ip() — grant.ips defined but no checkIp in context → denied", async () => {
  const provider: Provider = () => [{ key: "do", ips: ["10.0.0.1"] }];
  const sys = createSystem<Meta>({ schema: { do: doIt }, providers: [provider] });
  const r = await sys.can({ id: "u" }, "do");
  assertEq(r.ok, false);
});

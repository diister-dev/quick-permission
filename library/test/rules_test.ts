import { custom, filter, ip, match, time } from "../rules.ts";
import { payload } from "../payload.ts";

function assertEq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

function assert(cond: boolean, msg = "") {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

Deno.test("match — kind 'match', segment + extractor stored", () => {
  const ext = (v: { x: number }) => v.x;
  const r = match("seg-name", ext);
  assertEq(r.kind, "match");
  assertEq(r.segment, "seg-name");
  assert(r.extractor === ext);
});

Deno.test("filter — kind 'filter', extractor stored", () => {
  const ext = (v: { x: number }) => v.x;
  const r = filter(ext);
  assertEq(r.kind, "filter");
  assert(r.extractor === ext);
});

Deno.test("custom — kind 'custom', check stored", () => {
  const check = () => true;
  const r = custom(check);
  assertEq(r.kind, "custom");
  assert(r.check === check);
});

Deno.test("time — kind 'time'", () => {
  assertEq(time().kind, "time");
});

Deno.test("ip — kind 'ip'", () => {
  assertEq(ip().kind, "ip");
});

Deno.test("payload<T>() — returns marker (runtime-opaque)", () => {
  const p = payload<{ exhibitorId: string }>();
  assert(typeof p === "object" && p !== null);
});

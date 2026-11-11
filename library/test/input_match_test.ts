import { test } from "node:test";
import {
  action,
  createSystem,
  entity,
  type Grant,
  permissions,
} from "../mod.ts";
import { assertEquals } from "./+assert.ts";

const exposition = entity("exposition", {});
const organization = exposition.child("expo_organization", {});
const invitations = permissions(organization, "invitations", {
  create: action({ input: true }),
});

const ON = ["exposition:e1", "expo_organization:o1"] as const;

function contextWith(grants: readonly Grant[]) {
  return createSystem({
    permissions: [invitations],
    providers: [() => grants],
  }).context({ subject: { id: "user:1" } });
}

test("input: unconditional grant + input -> ok", async () => {
  const ctx = contextWith([invitations.grant("create", { on: ON })]);
  const result = await ctx.check("invitations.create", ...ON, {
    input: { flowId: "flow:abc" },
  });
  assertEquals(result.ok, true);
});

test("input: unconditional grant + no input -> ok", async () => {
  const ctx = contextWith([invitations.grant("create", { on: ON })]);
  const result = await ctx.check("invitations.create", ...ON);
  assertEquals(result.ok, true);
});

test("input: conditional grant + matching input -> ok", async () => {
  const ctx = contextWith([
    invitations.grant("create", { on: ON, input: { flowId: "flow:abc" } }),
  ]);
  const result = await ctx.check("invitations.create", ...ON, {
    input: { flowId: "flow:abc" },
  });
  assertEquals(result.ok, true);
});

test("input: conditional grant + mismatched input -> deny", async () => {
  const ctx = contextWith([
    invitations.grant("create", { on: ON, input: { flowId: "flow:abc" } }),
  ]);
  const result = await ctx.check("invitations.create", ...ON, {
    input: { flowId: "flow:zzz" },
  });
  assertEquals(result.ok, false);
});

test("input: conditional grant + no input -> deny (cannot validate)", async () => {
  const ctx = contextWith([
    invitations.grant("create", { on: ON, input: { flowId: "flow:abc" } }),
  ]);
  const result = await ctx.check("invitations.create", ...ON);
  assertEquals(result.ok, false);
});

test("input: mixed grants (unconditional + conditional) -> broadest wins with input", async () => {
  const ctx = contextWith([
    invitations.grant("create", { on: ON }),
    invitations.grant("create", { on: ON, input: { flowId: "flow:abc" } }),
  ]);
  const result = await ctx.check("invitations.create", ...ON, {
    input: { flowId: "flow:zzz" },
  });
  assertEquals(result.ok, true);
});

test("input: mixed grants -> broadest wins without input", async () => {
  const ctx = contextWith([
    invitations.grant("create", { on: ON }),
    invitations.grant("create", { on: ON, input: { flowId: "flow:abc" } }),
  ]);
  const result = await ctx.check("invitations.create", ...ON);
  assertEquals(result.ok, true);
});

test("input: multiple conditional grants -> any matching wins", async () => {
  const ctx = contextWith([
    invitations.grant("create", { on: ON, input: { flowId: "flow:abc" } }),
    invitations.grant("create", { on: ON, input: { flowId: "flow:def" } }),
  ]);
  const result = await ctx.check("invitations.create", ...ON, {
    input: { flowId: "flow:def" },
  });
  assertEquals(result.ok, true);
});

test("input: nested field in input matches a dotted-path condition", async () => {
  const ctx = contextWith([
    invitations.grant("create", {
      on: ON,
      input: { "params.expoOrganizationId": "expo_organization:o1" },
    }),
  ]);
  const result = await ctx.check("invitations.create", ...ON, {
    input: {
      flowId: "flow:abc",
      params: { expoOrganizationId: "expo_organization:o1" },
    },
  });
  assertEquals(result.ok, true);
});

test("input: empty input condition treated as unconditional", async () => {
  const ctx = contextWith([invitations.grant("create", { on: ON, input: {} })]);
  const result = await ctx.check("invitations.create", ...ON);
  assertEquals(result.ok, true);
});

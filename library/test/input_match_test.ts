import { assertEquals } from "jsr:@std/assert";
import {
  createSystem,
  inputMatch,
  permission,
  target,
} from "../mod.ts";

const schema = {
  "invitations.create": permission({
    target: target.path("exposition", "expo_organization"),
  }).rules([inputMatch()]),
};

const CONCRETE_TARGET = ["exposition:e1", "expo_organization:o1"] as const;

Deno.test("inputMatch: unconditional grant + input → ok", async () => {
  const sys = createSystem({
    schema,
    providers: [() => [{
      key: "invitations.create",
      target: ["exposition:e1", "expo_organization:o1"],
    }]],
  });
  const r = await sys.context({ subject: { id: "user:1" } }).can(
    "invitations.create",
    CONCRETE_TARGET,
  );
  assertEquals(r.ok, true);
});

Deno.test("inputMatch: unconditional grant + no input → ok", async () => {
  const sys = createSystem({
    schema,
    providers: [() => [{
      key: "invitations.create",
      target: ["exposition:e1", "expo_organization:o1"],
    }]],
  });
  const r = await sys.can(
    { id: "user:1" },
    "invitations.create",
    CONCRETE_TARGET,
  );
  assertEquals(r.ok, true);
});

Deno.test("inputMatch: conditional grant + matching input → ok", async () => {
  const sys = createSystem({
    schema,
    providers: [() => [{
      key: "invitations.create",
      target: ["exposition:e1", "expo_organization:o1"],
      inputWith: { flowId: "flow:abc" },
    }]],
  });
  const r = await sys.can(
    { id: "user:1" },
    "invitations.create",
    CONCRETE_TARGET,
    { input: { flowId: "flow:abc" } },
  );
  assertEquals(r.ok, true);
});

Deno.test("inputMatch: conditional grant + mismatched input → deny", async () => {
  const sys = createSystem({
    schema,
    providers: [() => [{
      key: "invitations.create",
      target: ["exposition:e1", "expo_organization:o1"],
      inputWith: { flowId: "flow:abc" },
    }]],
  });
  const r = await sys.can(
    { id: "user:1" },
    "invitations.create",
    CONCRETE_TARGET,
    { input: { flowId: "flow:zzz" } },
  );
  assertEquals(r.ok, false);
});

Deno.test("inputMatch: conditional grant + no input → deny (cannot validate)", async () => {
  const sys = createSystem({
    schema,
    providers: [() => [{
      key: "invitations.create",
      target: ["exposition:e1", "expo_organization:o1"],
      inputWith: { flowId: "flow:abc" },
    }]],
  });
  const r = await sys.can(
    { id: "user:1" },
    "invitations.create",
    CONCRETE_TARGET,
  );
  assertEquals(r.ok, false);
});

Deno.test("inputMatch: mixed grants (unconditional + conditional) → broadest wins with input", async () => {
  const sys = createSystem({
    schema,
    providers: [() => [
      {
        key: "invitations.create",
        target: ["exposition:e1", "expo_organization:o1"],
      },
      {
        key: "invitations.create",
        target: ["exposition:e1", "expo_organization:o1"],
        inputWith: { flowId: "flow:abc" },
      },
    ]],
  });
  // Even a mismatched input passes because the unconditional grant wins.
  const r = await sys.can(
    { id: "user:1" },
    "invitations.create",
    CONCRETE_TARGET,
    { input: { flowId: "flow:zzz" } },
  );
  assertEquals(r.ok, true);
});

Deno.test("inputMatch: mixed grants → broadest wins without input", async () => {
  const sys = createSystem({
    schema,
    providers: [() => [
      {
        key: "invitations.create",
        target: ["exposition:e1", "expo_organization:o1"],
      },
      {
        key: "invitations.create",
        target: ["exposition:e1", "expo_organization:o1"],
        inputWith: { flowId: "flow:abc" },
      },
    ]],
  });
  // No input + unconditional grant present → still ok.
  const r = await sys.can(
    { id: "user:1" },
    "invitations.create",
    CONCRETE_TARGET,
  );
  assertEquals(r.ok, true);
});

Deno.test("inputMatch: multiple conditional grants → any matching wins", async () => {
  const sys = createSystem({
    schema,
    providers: [() => [
      {
        key: "invitations.create",
        target: ["exposition:e1", "expo_organization:o1"],
        inputWith: { flowId: "flow:abc" },
      },
      {
        key: "invitations.create",
        target: ["exposition:e1", "expo_organization:o1"],
        inputWith: { flowId: "flow:def" },
      },
    ]],
  });
  const r = await sys.can(
    { id: "user:1" },
    "invitations.create",
    CONCRETE_TARGET,
    { input: { flowId: "flow:def" } },
  );
  assertEquals(r.ok, true);
});

Deno.test("inputMatch: nested field in input matches dotted-path with", async () => {
  const sys = createSystem({
    schema,
    providers: [() => [{
      key: "invitations.create",
      target: ["exposition:e1", "expo_organization:o1"],
      inputWith: { "params.expoOrganizationId": "expo_organization:o1" },
    }]],
  });
  const r = await sys.can(
    { id: "user:1" },
    "invitations.create",
    CONCRETE_TARGET,
    {
      input: {
        flowId: "flow:abc",
        params: { expoOrganizationId: "expo_organization:o1" },
      },
    },
  );
  assertEquals(r.ok, true);
});

Deno.test("inputMatch: empty `with` object treated as unconditional", async () => {
  const sys = createSystem({
    schema,
    providers: [() => [{
      key: "invitations.create",
      target: ["exposition:e1", "expo_organization:o1"],
      inputWith: {},
    }]],
  });
  const r = await sys.can(
    { id: "user:1" },
    "invitations.create",
    CONCRETE_TARGET,
  );
  assertEquals(r.ok, true);
});

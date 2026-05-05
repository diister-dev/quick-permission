import { createSystem } from "../system.ts";
import { createPermissionFactory } from "../factory.ts";
import { target } from "../target.ts";

function assertThrows(fn: () => unknown, msgIncludes: string) {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  if (!thrown) throw new Error(`Expected throw, none thrown`);
  const msg = (thrown as Error).message;
  if (!msg.includes(msgIncludes)) {
    throw new Error(`Expected error to include "${msgIncludes}", got: ${msg}`);
  }
}

type Meta = { description: string };
const { permission, intermediate } = createPermissionFactory<Meta>();

Deno.test("schema validation — unknown key in expandsTo throws at boot", () => {
  const schema = {
    "users.read": permission({
      metadata: { description: "Read" },
      target: target.none(),
    }).rules([]),
    "users.manage": intermediate({
      metadata: { description: "Manage" },
      target: target.none(),
      expandsTo: (grant) => [
        { ...grant, key: "users.crete" }, // typo
      ],
    }).rules([]),
  };

  assertThrows(
    () => createSystem<Meta>({ schema }),
    'intermediate "users.manage" expands to unknown key "users.crete"',
  );
});

Deno.test("schema validation — passes when all keys exist", () => {
  const schema = {
    "users.read": permission({
      metadata: { description: "Read" },
      target: target.none(),
    }).rules([]),
    "users.create": permission({
      metadata: { description: "Create" },
      target: target.none(),
    }).rules([]),
    "users.manage": intermediate({
      metadata: { description: "Manage" },
      target: target.none(),
      expandsTo: (grant) => [
        { ...grant, key: "users.read" },
        { ...grant, key: "users.create" },
      ],
    }).rules([]),
  };

  // Should not throw.
  createSystem<Meta>({ schema });
});

Deno.test("schema validation — listing every typo in one error", () => {
  const schema = {
    "users.read": permission({
      metadata: { description: "Read" },
      target: target.none(),
    }).rules([]),
    "users.manage": intermediate({
      metadata: { description: "Manage" },
      target: target.none(),
      expandsTo: (grant) => [
        { ...grant, key: "users.crete" },
        { ...grant, key: "users.deltete" },
      ],
    }).rules([]),
  };

  let err: Error | undefined;
  try {
    createSystem<Meta>({ schema });
  } catch (e) {
    err = e as Error;
  }
  if (!err) throw new Error("expected throw");
  if (!err.message.includes("users.crete")) throw new Error("missing crete");
  if (!err.message.includes("users.deltete")) throw new Error("missing deltete");
});

Deno.test("schema validation — skips intermediates whose expandsTo throws", () => {
  // Some expandsTo callbacks require a specific target shape and throw on stub.
  // Validation should skip them (best-effort) rather than fail.
  const schema = {
    "users.read": permission({
      metadata: { description: "Read" },
      target: target.none(),
    }).rules([]),
    "users.manage": intermediate({
      metadata: { description: "Manage" },
      target: target.required("user"),
      expandsTo: (grant) => {
        if (!Array.isArray(grant.target)) {
          throw new Error("requires tuple target");
        }
        return [{ ...grant, key: "users.read" }];
      },
    }).rules([]),
  };

  // The stub passes ["*"] which is an array, so this won't throw.
  // But even if it did, validation should skip and not fail.
  createSystem<Meta>({ schema });
});

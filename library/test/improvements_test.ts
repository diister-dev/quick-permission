import { test } from "node:test";
import {
  ALL,
  action,
  bundle,
  createSystem,
  defineRule,
  entity,
  type Grant,
  type GrantRejection,
  list,
  permissions,
} from "../mod.ts";
import { assert, assertEquals, assertThrows } from "./+assert.ts";

type NoteDoc = {
  _id: string;
  authorId: string;
  readers: string[];
  title: string;
  status: "draft" | "published";
  address?: { city: string; street: string };
  lines?: { label: string; price: number }[];
};

function workspace() {
  const loads: string[] = [];
  const store = new Map<string, NoteDoc>([
    [
      "note:1",
      {
        _id: "note:1",
        authorId: "user:1",
        readers: ["user:2"],
        title: "One",
        status: "draft",
        address: { city: "Lyon", street: "Rue A" },
        lines: [
          { label: "a", price: 1 },
          { label: "b", price: 2 },
        ],
      },
    ],
    [
      "note:2",
      {
        _id: "note:2",
        authorId: "user:2",
        readers: [],
        title: "Two",
        status: "published",
      },
    ],
    [
      "note:3",
      {
        _id: "note:3",
        authorId: "user:1",
        readers: ["user:2", "user:3"],
        title: "Three",
        status: "published",
      },
    ],
  ]);
  const note = entity("note", {
    load: (id) => {
      loads.push(id);
      return store.get(id);
    },
    conditions: {
      author: { owner: "authorId" },
      reader: { member: "readers" },
      published: { test: (doc) => doc.status === "published" },
      lenient: { test: (doc) => doc.title.length > 0, whenUnknown: "allow" },
    },
  });
  const officeHours = defineRule({
    name: "office-hours",
    when: "officeHours",
    check: (context) => (context.at ?? new Date()).getUTCHours() < 18,
  });
  const notes = permissions(note, "notes", {
    read: action({ fields: "doc" }),
    update: action({ fields: "input" }),
    delete: action({ forbid: ["author"] }),
    archive: action({ rules: [officeHours] }),
    list: list("read"),
    manage: bundle(["list", "update", "delete"]),
  });
  return { loads, store, note, notes, all: [...store.values()] };
}

function systemFor(
  space: ReturnType<typeof workspace>,
  grants: (subjectId: string) => Grant[],
) {
  const rejections: GrantRejection[] = [];
  const system = createSystem({
    permissions: [space.notes],
    providers: [{ name: "test", fetch: (subject) => grants(subject.id) }],
    hooks: { onGrantRejected: (event) => rejections.push(event) },
  });
  return { system, rejections };
}

test("scope: a bulk action gets the same row filter as a list", async () => {
  const space = workspace();
  const { system } = systemFor(space, () => [
    space.notes.grant("update", { on: ALL, where: { status: "draft" } }),
  ]);
  const ctx = system.context({ subject: { id: "user:9" } });
  const scope = await ctx.scope("notes.update");
  assert(scope.ok);
  assertEquals(scope.query.filter, { status: "draft" });
  assertEquals(scope.query.stages, null);
  const allowed = await scope.projectAll(space.all);
  assertEquals(
    allowed.map((doc) => doc._id),
    ["note:1"],
  );
});

test("conditions: a field condition becomes a row filter instead of a refusal", async () => {
  const space = workspace();
  const { system } = systemFor(space, () => [
    space.notes.grant("list", { on: ALL, when: ["author"] }),
    space.notes.grant("update", { on: ALL, when: ["reader"] }),
  ]);
  const ada = system.context({ subject: { id: "user:1" } });
  assertEquals(await ada.could("notes.list"), true);
  assertEquals(await ada.reach("notes.list"), "some");
  const mine = await ada.scope("notes.list");
  assert(mine.ok);
  assertEquals(mine.query.filter, { authorId: "user:1" });
  assertEquals(
    (await mine.projectAll(space.all)).map((doc) => doc._id),
    ["note:1", "note:3"],
  );

  const bob = system.context({ subject: { id: "user:2" } });
  const editable = await bob.scope("notes.update");
  assert(editable.ok);
  assertEquals(editable.query.filter, { readers: "user:2" });
  assertEquals(
    (await bob.check("notes.update", "note:1", { input: {} })).ok,
    true,
  );
  assertEquals(
    (await bob.check("notes.update", "note:2", { input: {} })).ok,
    false,
  );
});

test("reach: all, some and none are three different answers", async () => {
  const space = workspace();
  const { system } = systemFor(space, (subjectId) =>
    subjectId === "user:admin"
      ? [space.notes.grant("manage", { on: ALL })]
      : subjectId === "user:1"
        ? [
            space.notes.grant("update", { on: "note:1" }),
            space.notes.grant("read", { on: ALL, when: ["published"] }),
            space.notes.grant("archive", { on: ALL, when: ["lenient"] }),
          ]
        : [],
  );
  const admin = system.context({ subject: { id: "user:admin" } });
  const ada = system.context({ subject: { id: "user:1" } });
  const nobody = system.context({ subject: { id: "user:0" } });
  assertEquals(await admin.reach("notes.update"), "all");
  assertEquals(await ada.reach("notes.update"), "some");
  assertEquals(await nobody.reach("notes.update"), "none");
  assertEquals(await ada.reach("notes.update", "note:1"), "all");
  assertEquals(await ada.reach("notes.update", "note:2"), "none");
  assertEquals(await ada.reach("notes.read"), "none");
  assertEquals(await ada.reach("notes.archive"), "some");
});

test("forbid: an interdiction binds every grant and filters bulk rows", async () => {
  const space = workspace();
  const { system } = systemFor(space, () => [
    space.notes.grant("manage", { on: ALL }),
  ]);
  const ada = system.context({ subject: { id: "user:1" } });
  assertEquals((await ada.check("notes.delete", "note:2")).ok, true);
  const own = await ada.check("notes.delete", "note:1");
  assert(!own.ok);
  assert(
    own.reasons.some((reason) =>
      reason.includes('forbidden when "author" holds'),
    ),
  );
  const scope = await ada.scope("notes.delete");
  assert(scope.ok);
  assertEquals(scope.query.filter, { authorId: { $ne: "user:1" } });
});

test("forbid: an unknown condition fails when the schema is declared", () => {
  const thing = entity("thing", { load: (id) => ({ _id: id }) });
  const error = assertThrows(() =>
    permissions(thing, "things", { delete: action({ forbid: ["owner"] }) }),
  );
  assert(error.message.includes('cannot forbid "owner"'));
});

test("custom rule: its flag is known without declaring it twice", async () => {
  const space = workspace();
  const { system, rejections } = systemFor(space, () => [
    { key: "notes.archive", on: ["note:*"], when: ["officeHours"] },
  ]);
  const ctx = system.context({ subject: { id: "user:1" } });
  const morning = { at: new Date("2026-01-05T09:00:00Z") };
  const night = { at: new Date("2026-01-05T22:00:00Z") };
  assertEquals((await ctx.check("notes.archive", "note:1", morning)).ok, true);
  assertEquals((await ctx.check("notes.archive", "note:1", night)).ok, false);
  assertEquals(rejections, []);
});

test("rejection: the same bad grant is reported once, however often it comes back", async () => {
  const space = workspace();
  const { system, rejections } = systemFor(space, () => [
    { key: "notes.delete", on: ["note:*"], when: ["officeHours"] },
  ]);
  const ctx = system.context({ subject: { id: "user:1" } });
  for (let round = 0; round < 5; round++) {
    assertEquals((await ctx.check("notes.delete", "note:2")).ok, false);
  }
  assertEquals(rejections.length, 1);
});

test("fields: a dotted path projects inside objects and arrays", async () => {
  const space = workspace();
  const { system } = systemFor(space, () => [
    space.notes.grant("read", {
      on: ALL,
      fields: { _id: true, address: { city: true }, lines: { label: true } },
    }),
    space.notes.grant("update", {
      on: ALL,
      fields: { address: { city: true } },
    }),
  ]);
  const ctx = system.context({ subject: { id: "user:9" } });
  const read = await ctx.check("notes.read", "note:1");
  assert(read.ok);
  assertEquals(read.doc, {
    _id: "note:1",
    address: { city: "Lyon" },
    lines: [{ label: "a" }, { label: "b" }],
  } as never);
  const update = await ctx.check("notes.update", "note:1", {
    input: { title: "x", address: { city: "Paris", street: "Rue B" } },
  });
  assert(update.ok);
  assertEquals(update.input, { address: { city: "Paris" } });
});

test("covers: a narrower grant is covered, a wider one is not", () => {
  const space = workspace();
  const { system } = systemFor(space, () => []);
  const { notes } = space;
  const held = notes.grant("manage", {
    on: ALL,
    where: { status: "draft" },
    fields: { _id: true, title: true, address: true },
  });
  const covers = (asked: Grant) => system.delegation.covers(held, asked);

  assertEquals(
    covers(
      notes.grant("update", {
        on: "note:1",
        where: { status: "draft" },
        fields: { title: true },
      }),
    ),
    true,
  );
  assertEquals(
    covers(
      notes.grant("read", {
        on: ALL,
        where: { status: "draft", authorId: "user:1" },
        fields: { _id: true, address: { city: true } },
      }),
    ),
    true,
  );
  assertEquals(
    covers(
      notes.grant("list", {
        on: ALL,
        where: { status: "draft" },
        fields: { _id: true },
        when: ["author"],
      }),
    ),
    true,
  );

  assertEquals(
    covers(notes.grant("update", { on: ALL, fields: { title: true } })),
    false,
  );
  assertEquals(
    covers(
      notes.grant("update", {
        on: ALL,
        where: { status: "published" },
        fields: { title: true },
      }),
    ),
    false,
  );
  assertEquals(
    covers(notes.grant("read", { on: ALL, where: { status: "draft" } })),
    false,
  );
  assertEquals(
    covers(
      notes.grant("read", {
        on: ALL,
        where: { status: "draft" },
        fields: { readers: true },
      }),
    ),
    false,
  );
  assertEquals(
    covers(notes.grant("archive", { on: ALL, where: { status: "draft" } })),
    false,
  );
});

test("audit: stored grants are judged before any subject meets them", () => {
  const space = workspace();
  const { system } = systemFor(space, () => []);
  const findings = system.audit([
    { id: "ok", key: "notes.manage", on: ["note:*"] },
    { id: "typo", key: "notes.read", on: ["note:*"], parents: { nota: {} } },
    { id: "gone", key: "notes.publish", on: ["note:*"] },
    { id: "shape", key: "notes.read", on: ["user:1"] },
    {
      id: "partial",
      key: "notes.manage",
      on: ["note:*"],
      input: { title: "x" },
    },
  ]);
  assertEquals(
    findings.map(
      (finding) =>
        `${finding.grant.id} ${finding.grant.key}${finding.via ? ` via ${finding.via}` : ""}`,
    ),
    [
      "typo notes.read",
      "gone notes.publish",
      "shape notes.read",
      "partial notes.update via notes.manage",
      "partial notes.delete via notes.manage",
      "partial notes.read via notes.list",
    ],
  );
});

test("resource grants: an entity provides the grants of its own documents", async () => {
  const loads: string[] = [];
  type FolderDoc = { _id: string; ownerId: string; shared: string[] };
  const folders = new Map<string, FolderDoc>([
    ["folder:1", { _id: "folder:1", ownerId: "user:1", shared: ["user:2"] }],
    ["folder:2", { _id: "folder:2", ownerId: "user:3", shared: [] }],
  ]);
  const folder = entity("folder", {
    load: (id) => {
      loads.push(id);
      return folders.get(id);
    },
  });
  const file = folder.child("file", { load: (_folderId, id) => ({ _id: id }) });
  const folderKeys = permissions(folder, "folders", {
    read: action({ fields: "doc" }),
    update: action(),
    owner: bundle(["read", "update", "folders.files.manage"]),
    viewer: bundle(["read", "folders.files.read"]),
  });
  const fileKeys = permissions(file, "folders.files", {
    read: action(),
    delete: action(),
    manage: bundle(["read", "delete"]),
  });
  let calls = 0;
  const system = createSystem({
    permissions: [folderKeys, fileKeys],
    providers: [
      folder.grants("folderAccess", {
        keys: ["folders.*"],
        for: async ({ subject, ids: [folderId], doc }) => {
          calls++;
          const current = await doc();
          if (!current) return [];
          if (current.ownerId === subject.id) {
            return [folderKeys.grant("owner", { on: folderId })];
          }
          return current.shared.includes(subject.id)
            ? [folderKeys.grant("viewer", { on: folderId })]
            : [];
        },
      }),
    ],
  });

  const bob = system.context({ subject: { id: "user:2" } });
  bob.seed(folder, [...folders.values()]);
  assertEquals((await bob.check("folders.read", "folder:1")).ok, true);
  assertEquals((await bob.check("folders.update", "folder:1")).ok, false);
  assertEquals(
    (await bob.check("folders.files.read", "folder:1", "file:a")).ok,
    true,
  );
  assertEquals(
    (await bob.check("folders.files.delete", "folder:1", "file:a")).ok,
    false,
  );
  assertEquals((await bob.check("folders.read", "folder:2")).ok, false);
  assertEquals(await bob.could("folders.read"), false);
  assertEquals(loads, []);
  assertEquals(calls, 2);

  const ada = system.context({ subject: { id: "user:1" } });
  assertEquals(
    (await ada.check("folders.files.delete", "folder:1", "file:a")).ok,
    true,
  );
  assertEquals(loads, ["folder:1"]);
});

test("grant: a field of the retired shape is refused, never read", async () => {
  const space = workspace();
  const retired: Record<string, unknown>[] = [
    { target: ["note:*"] },
    { on: ["note:*"], with: { note: { status: "draft" } } },
    { on: ["note:*"], filter: { _id: true } },
    { on: ["note:*"], flags: { author: true } },
    { on: ["note:*"], inputWith: { title: "x" } },
  ];
  const { system, rejections } = systemFor(space, () =>
    retired.map((shape) => ({ key: "notes.read", ...shape })),
  );
  const ctx = system.context({ subject: { id: "user:9" } });
  assertEquals(await ctx.could("notes.read"), false);
  assertEquals(
    rejections.map((event) => event.reason),
    [
      '"target" is not a grant field, use on',
      '"with" is not a grant field, use where, parents or related',
      '"filter" is not a grant field, use fields',
      '"flags" is not a grant field, use when',
      '"inputWith" is not a grant field, use input',
    ],
  );
});

test("grant: a malformed field is refused with its name", () => {
  const space = workspace();
  const { system } = systemFor(space, () => []);
  const explain = (shape: Record<string, unknown>) =>
    system.explain({ key: "notes.read", on: ["note:*"], ...shape });
  assertEquals(explain({}), null);
  assertEquals(
    explain({ fields: ["_id"] }),
    "fields must be a selection of fields",
  );
  assertEquals(
    explain({ fields: { _id: false } }),
    "fields._id must be true or a nested selection",
  );
  assertEquals(explain({ where: "draft" }), "where must be a condition");
  assertEquals(
    explain({ when: { author: true } }),
    "when must be a list of condition names",
  );
  assertEquals(
    explain({ related: { nobody: {} } }),
    'unknown relation "nobody"',
  );
  assertEquals(
    system.explain({ key: "notes.read", on: "note:*" } as never),
    "on must be a list of references",
  );
});

test("keys: a set may spell its keys in full, so a search finds the declaration", async () => {
  const thing = entity("thing", {
    load: (id) => ({ _id: id }),
    verifyExists: true,
  });
  const things = permissions(thing, {
    "things.read": action({ fields: "doc" }),
    "things.list": list("things.read"),
    "things.manage": bundle(["things.list", "audit.read"]),
  });
  const audit = permissions(entity("thing", { load: (id) => ({ _id: id }) }), {
    "audit.read": action(),
  });
  const system = createSystem({
    permissions: [things, audit],
    providers: [() => [things.grant("things.manage", { on: ALL })]],
  });
  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals((await ctx.check("things.read", "thing:1")).ok, true);
  assertEquals((await ctx.check("audit.read", "thing:1")).ok, true);
});

test("entity: a reference without a loader adds no document rule and reads nothing", async () => {
  const catalogueModule = entity("module", {});
  const modules = permissions(catalogueModule, {
    "modules.read": action(),
    "modules.configure": action({ targetConstraint: false }),
  });
  const system = createSystem({
    permissions: [modules],
    providers: [
      () => [
        modules.grant("modules.read", { on: "module:a" }),
        modules.grant("modules.configure", { on: "module:a" }),
      ],
    ],
  });
  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals((await ctx.check("modules.read", "module:a")).ok, true);
  assertEquals((await ctx.check("modules.read", "module:b")).ok, false);
  assertEquals(await ctx.reach("modules.configure"), "all");
  assertEquals(ctx.fetchCounters(), {});
});

test("reach: an interdiction that cannot become a row filter is not 'all'", async () => {
  const thing = entity("thing", {
    load: (id) => ({ _id: id, locked: id === "thing:2" }),
    conditions: { locked: { test: (doc) => doc.locked } },
  });
  const things = permissions(thing, "things", {
    remove: action({ forbid: ["locked"] }),
  });
  const system = createSystem({
    permissions: [things],
    providers: [() => [things.grant("remove", { on: ALL })]],
  });
  const ctx = system.context({ subject: { id: "user:1" } });
  assertEquals(await ctx.reach("things.remove"), "some");
  assertEquals((await ctx.check("things.remove", "thing:1")).ok, true);
  assertEquals((await ctx.check("things.remove", "thing:2")).ok, false);
});

test("entity: loadMany alone is enough to read and filter documents", async () => {
  const batches: number[] = [];
  const thing = entity("thing", {
    loadMany: (paths) => {
      batches.push(paths.length);
      return paths.map(([id]) => ({
        _id: id,
        tier: id === "thing:1" ? "gold" : "basic",
      }));
    },
  });
  const things = permissions(thing, "things", {
    read: action({ fields: "doc" }),
  });
  const system = createSystem({
    permissions: [things],
    providers: [
      () => [
        things.grant("read", {
          on: ALL,
          where: { tier: "gold" },
          fields: { _id: true },
        }),
      ],
    ],
  });
  const ctx = system.context({ subject: { id: "user:1" } });
  const [gold, basic] = await Promise.all([
    ctx.check("things.read", "thing:1"),
    ctx.check("things.read", "thing:2"),
  ]);
  assert(gold.ok);
  assertEquals(gold.doc, { _id: "thing:1" });
  assertEquals(basic.ok, false);
  assertEquals(batches, [2]);
});

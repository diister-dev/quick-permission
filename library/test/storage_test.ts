import { test } from "node:test";
import { compileCondition as compileSpec } from "../condition.ts";
import { memory, type Related } from "../storage/memory.ts";
import {
  type MongoQuery,
  type MongoStage,
  mongo,
  SAME_COLLECTION,
} from "../storage/mongo.ts";
import {
  EVERYTHING,
  type Plan,
  planOf,
  type RelationInfo,
} from "../storage/plan.ts";
import { assertEquals, assertThrows } from "./+assert.ts";

type Row = Readonly<Record<string, unknown>>;

const documents: Row[] = [
  { _id: "d1", status: "draft", ownerId: "u1", folder: "f1" },
  { _id: "d2", status: "published", ownerId: "u1", folder: "f1" },
  { _id: "d3", status: "published", ownerId: "u2", folder: "f2" },
  { _id: "d4", status: "archived", ownerId: "u3", folder: "f2" },
  { _id: "d5", status: "draft", ownerId: "u9", folder: "f3" },
];
const links: Row[] = [
  {
    _id: "l1",
    kind: "share",
    documentId: "d1",
    audience: "team",
    role: "editor",
  },
  {
    _id: "l2",
    kind: "share",
    documentId: "d3",
    audience: "public",
    role: "viewer",
  },
  {
    _id: "l3",
    kind: "comment",
    documentId: "d4",
    audience: "public",
    role: "viewer",
  },
  {
    _id: "l4",
    kind: "share",
    documentId: "d4",
    audience: "team",
    role: "viewer",
  },
];
const users: Row[] = [
  { _id: "u1", teamId: "t1" },
  { _id: "u2", teamId: "t2" },
  { _id: "u3", teamId: "t1" },
];
const teams: Row[] = [
  { _id: "t1", plan: "pro" },
  { _id: "t2", plan: "free" },
];
const collections: Readonly<Record<string, readonly Row[]>> = {
  [SAME_COLLECTION]: documents,
  links,
  users,
  teams,
};

const shares: RelationInfo = {
  id: "shares",
  localField: "_id",
  foreignField: "documentId",
  collection: "links",
  only: { kind: "share" },
};
const owner: RelationInfo = {
  id: "owner",
  localField: "ownerId",
  foreignField: "_id",
  collection: "users",
};
const ownerTeam: RelationInfo = {
  id: "ownerTeam",
  localField: "teamId",
  foreignField: "_id",
  collection: "teams",
  via: owner,
};

const joinedRows = (doc: Row, relation: RelationInfo): readonly Row[] => {
  const from = collections[relation.collection ?? SAME_COLLECTION];
  const local = relation.via
    ? joinedRows(doc, relation.via)[0]?.[relation.localField]
    : doc[relation.localField];
  return from.filter((row) => row[relation.foreignField] === local);
};

const relatedTo =
  (doc: Row): Related =>
  (relation) =>
    joinedRows(doc, relation);

function runStage(rows: readonly Row[], stage: MongoStage): readonly Row[] {
  if ("$match" in stage) return rows.filter(compileSpec(stage.$match));
  const lookup = stage.$lookup as {
    from: string;
    as: string;
    localField?: string;
    foreignField?: string;
    let?: { src: { $arrayElemAt: [string, number] } };
    pipeline?: { $match: Record<string, unknown> }[];
  };
  const from = collections[lookup.from];
  return rows.map((row) => {
    const { $expr, ...static_ } = lookup.pipeline?.[0]?.$match ?? {};
    const keeps = compileSpec(static_);
    if (lookup.localField !== undefined && lookup.foreignField !== undefined) {
      const { localField, foreignField } = lookup;
      const joined = from.filter(
        (candidate) =>
          candidate[foreignField] === row[localField] && keeps(candidate),
      );
      return { ...row, [lookup.as]: joined };
    }
    const [path] = lookup.let?.src.$arrayElemAt ?? [""];
    const [alias, field] = path.slice(1).split(".");
    const src = (row[alias] as readonly Row[] | undefined)?.[0]?.[field];
    const foreign = String(($expr as { $eq: [string, string] }).$eq[0]).slice(
      1,
    );
    const joined = from.filter(
      (candidate) => candidate[foreign] === src && keeps(candidate),
    );
    return { ...row, [lookup.as]: joined };
  });
}

function idsThroughMongo(query: MongoQuery): string[] {
  const rows =
    query.stages === null
      ? documents.filter(compileSpec(query.filter))
      : query.stages.reduce(runStage, documents as readonly Row[]);
  return rows.map((row) => String(row._id));
}

function idsThroughMemory(plan: Plan): string[] {
  const keeps = memory().compile(plan);
  return documents
    .filter((doc) => keeps(doc, relatedTo(doc)))
    .map((doc) => String(doc._id));
}

function assertSameRows(plan: Plan, expected: readonly string[]): MongoQuery {
  const query = mongo().compile(plan);
  assertEquals(idsThroughMongo(query), [...expected]);
  assertEquals(idsThroughMemory(plan), [...expected]);
  return query;
}

test("storage: an unrestricted alternative opens the whole collection", () => {
  const plan = planOf([{ where: { status: "draft" } }, {}]);
  assertEquals(plan, EVERYTHING);
  const query = assertSameRows(plan, ["d1", "d2", "d3", "d4", "d5"]);
  assertEquals(query, { filter: {}, stages: null });
});

test("storage: conditions on the entity become one filter, no pipeline", () => {
  const one = assertSameRows(planOf([{ where: { status: "draft" } }]), [
    "d1",
    "d5",
  ]);
  assertEquals(one, { filter: { status: "draft" }, stages: null });

  const two = assertSameRows(
    planOf([
      { where: { status: "draft" } },
      { where: { folder: "f2", status: { $ne: "archived" } } },
      { where: { status: "draft" } },
    ]),
    ["d1", "d3", "d5"],
  );
  assertEquals(two.stages, null);
  assertEquals(two.filter, {
    $or: [{ status: "draft" }, { folder: "f2", status: { $ne: "archived" } }],
  });
});

test("storage: a relation is joined once and its static part is always applied", () => {
  const query = assertSameRows(
    planOf([
      { through: [{ relation: shares, where: { audience: "public" } }] },
    ]),
    ["d3"],
  );
  assertEquals(query.filter, {});
  assertEquals(query.stages, [
    {
      $lookup: {
        from: "links",
        localField: "_id",
        foreignField: "documentId",
        pipeline: [{ $match: { kind: "share" } }],
        as: "_shares",
      },
    },
    {
      $match: {
        _shares: { $elemMatch: { kind: "share", audience: "public" } },
      },
    },
  ]);
});

test("storage: each alternative keeps its own conditions together", () => {
  const plan = planOf([
    {
      where: { status: "draft" },
      through: [{ relation: shares, where: { role: "editor" } }],
    },
    {
      where: { status: "archived" },
      through: [{ relation: shares, where: { audience: "team" } }],
    },
  ]);
  const query = assertSameRows(plan, ["d1", "d4"]);
  assertEquals(query.filter, {
    $or: [{ status: "draft" }, { status: "archived" }],
  });
  assertEquals(query.stages?.[0], { $match: query.filter });

  assertSameRows(
    planOf([
      {
        where: { status: "published" },
        through: [{ relation: shares, where: { role: "editor" } }],
      },
    ]),
    [],
  );
});

test("storage: an alternative without a condition on the entity lifts the first filter", () => {
  const query = assertSameRows(
    planOf([
      { where: { status: "draft" } },
      { through: [{ relation: shares, where: { audience: "public" } }] },
    ]),
    ["d1", "d3", "d5"],
  );
  assertEquals(query.filter, {});
  assertEquals(query.stages?.length, 2);
});

test("storage: a relation reached through another is joined after it", () => {
  const plan = planOf([
    { through: [{ relation: ownerTeam, where: { plan: "pro" } }] },
  ]);
  const query = assertSameRows(plan, ["d1", "d2", "d4"]);
  assertEquals(
    query.stages?.map((stage) =>
      "$lookup" in stage ? (stage.$lookup as { as: string }).as : "$match",
    ),
    ["_owner", "_ownerTeam", "$match"],
  );
});

test("storage: the memory adapter refuses a joined condition it is given no rows for", () => {
  const keeps = memory().compile(
    planOf([{ through: [{ relation: shares, where: { audience: "team" } }] }]),
  );
  assertEquals(keeps(documents[0]), false);
  assertEquals(keeps(documents[0], relatedTo(documents[0])), true);
});

test("storage: an operator that runs code never reaches a storage", () => {
  const plan = planOf([{ where: { $where: "this.a > 1" } }]);
  assertThrows(() => mongo().compile(plan));
  assertThrows(() => memory().compile(plan));
  const joined = planOf([
    { through: [{ relation: shares, where: { $function: {} } }] },
  ]);
  assertThrows(() => mongo().compile(joined));
  assertThrows(() => memory().compile(joined));
});

test("storage: a condition cannot replace the fixed part of a relation", () => {
  const plan = planOf([
    { through: [{ relation: shares, where: { kind: "comment" } }] },
  ]);
  const query = assertSameRows(plan, []);
  assertEquals(query.stages?.at(-1), {
    $match: {
      _shares: {
        $elemMatch: { $and: [{ kind: "share" }, { kind: "comment" }] },
      },
    },
  });
});

test("storage: a relation that leads back to itself is refused", () => {
  const first: { -readonly [K in keyof RelationInfo]: RelationInfo[K] } = {
    id: "first",
    localField: "a",
    foreignField: "b",
  };
  const second: RelationInfo = {
    id: "second",
    localField: "a",
    foreignField: "b",
    via: first,
  };
  first.via = second;
  assertThrows(() =>
    mongo().compile(
      planOf([{ through: [{ relation: second, where: { x: 1 } }] }]),
    ),
  );
});

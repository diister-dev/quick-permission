import sift from "./sift/index.ts";

export type Condition = Readonly<Record<string, unknown>>;

export type Tester = (doc: unknown) => boolean;

const OPERATORS: ReadonlySet<string> = new Set([
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$exists",
  "$type",
  "$and",
  "$or",
  "$nor",
  "$not",
  "$regex",
  "$options",
  "$all",
  "$elemMatch",
  "$size",
]);

const COMPILED_LIMIT = 512;

type Clause = readonly [field: string, value: unknown];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isEmpty(condition: Condition | undefined): boolean {
  return condition === undefined || Object.keys(condition).length === 0;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => key in b && deepEqual(a[key], b[key]))
  );
}

function inspect(value: unknown, path: string): boolean {
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value) && !Object.is(value, -0);
    case "object":
      break;
    default:
      return false;
  }
  if (value === null) return true;
  let plain = true;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      if (!inspect(item, `${path}[${index}]`)) plain = false;
    }
    return plain;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) plain = false;
  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith("$") && !OPERATORS.has(key)) {
      throw new Error(
        `Forbidden operator at ${path}: "${key}". Allowed: ${[...OPERATORS].join(", ")}`,
      );
    }
    if (!inspect(nested, `${path}.${key}`)) plain = false;
  }
  return plain;
}

export function validateCondition(condition: unknown): void {
  inspect(condition, "$");
}

export function conditionProblem(condition: unknown): string | null {
  try {
    inspect(condition, "$");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const compiled = new Map<string, Tester>();

function build(condition: unknown): Tester {
  return (sift as (query: unknown) => Tester)(condition);
}

function buildCached(condition: unknown): Tester {
  const signature = JSON.stringify(condition);
  const known = compiled.get(signature);
  if (known) return known;
  const tester = build(JSON.parse(signature));
  if (compiled.size >= COMPILED_LIMIT) {
    const oldest = compiled.keys().next();
    if (!oldest.done) compiled.delete(oldest.value);
  }
  compiled.set(signature, tester);
  return tester;
}

export function prepareCondition(condition: unknown): () => Tester {
  const plain = inspect(condition, "$");
  let tester: Tester | undefined;
  return () => {
    tester ??= plain ? buildCached(condition) : build(condition);
    return tester;
  };
}

export function compileCondition(condition: unknown): Tester {
  return prepareCondition(condition)();
}

export function holds(condition: Condition, doc: unknown): boolean {
  return compileCondition(condition)(doc);
}

function clausesOf(condition: Condition): Clause[] {
  const clauses: Clause[] = [];
  for (const [field, value] of Object.entries(condition)) {
    if (field === "$and" && Array.isArray(value) && value.every(isRecord)) {
      for (const part of value) clauses.push(...clausesOf(part));
    } else {
      clauses.push([field, value]);
    }
  }
  return clauses;
}

function acceptedValues(value: unknown): readonly unknown[] | undefined {
  if (!isRecord(value)) return [value];
  const operators = Object.keys(value);
  if (operators.length !== 1) return undefined;
  if (operators[0] === "$eq") return [value.$eq];
  if (operators[0] === "$in" && Array.isArray(value.$in)) return value.$in;
  return undefined;
}

function valueImplies(narrow: unknown, wide: unknown): boolean {
  if (deepEqual(narrow, wide)) return true;
  const allowed = acceptedValues(wide);
  const wanted = acceptedValues(narrow);
  if (allowed === undefined || wanted === undefined) return false;
  if (wanted.some((value) => isRecord(value) || Array.isArray(value))) {
    return false;
  }
  return wanted.every((value) =>
    allowed.some((candidate) => deepEqual(candidate, value)),
  );
}

export function implies(narrow: unknown, wide: unknown): boolean {
  if (wide === undefined) return true;
  if (narrow === undefined) return false;
  if (!isRecord(wide) || !isRecord(narrow)) return deepEqual(narrow, wide);
  const held = clausesOf(narrow);
  return clausesOf(wide).every(([field, value]) =>
    held.some(
      ([candidate, own]) =>
        candidate === field &&
        (field.startsWith("$")
          ? deepEqual(own, value)
          : valueImplies(own, value)),
    ),
  );
}

export function conjunction(required: Condition, existing: unknown): Condition {
  if (existing === undefined) return required;
  if (isRecord(existing) && implies(existing, required)) return existing;
  return { $and: [required, existing] };
}

export function together(
  fixed: Condition | undefined,
  extra: Condition,
): Condition {
  if (fixed === undefined || isEmpty(fixed)) return extra;
  if (isEmpty(extra)) return fixed;
  const collides = Object.keys(extra).some((field) => field in fixed);
  return collides ? { $and: [fixed, extra] } : { ...fixed, ...extra };
}

export function allOf(parts: readonly Condition[]): Condition {
  const present = parts.filter((part) => !isEmpty(part));
  if (present.length === 0) return {};
  return present.length === 1 ? present[0] : { $and: present };
}

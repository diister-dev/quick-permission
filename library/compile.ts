import { type Condition, conditionProblem, isRecord } from "./condition.ts";
import type { Catalogue, EntityModel, KeyModel } from "./engine/model.ts";
import { type FieldSelection, fieldsProblem } from "./fields.ts";
import type { Grant } from "./grant.ts";
import type { RefConvention } from "./refs.ts";

export const MAX_EXPANSION_DEPTH = 10;

export type ValidGrant = {
  readonly source: Grant;
  readonly key: KeyModel;
  readonly id: string | undefined;
  readonly on: readonly string[];
  readonly slots: Readonly<Record<string, Condition>>;
  readonly fields: FieldSelection | undefined;
  readonly when: readonly string[];
  readonly input: Condition | undefined;
  readonly payload: unknown;
  readonly tags: Readonly<Record<string, unknown>>;
};

export type Admission =
  | { readonly ok: true; readonly grant: ValidGrant }
  | { readonly ok: false; readonly problem: string };

export type Rejection = {
  readonly grant: Grant;
  readonly reason: string;
  readonly provider?: string;
  readonly via?: string;
};

export type Expanded = { readonly grant: ValidGrant; readonly depth: number };

export interface Compiled {
  readonly catalogue: Catalogue;
  readonly refs: RefConvention;
  admit(grant: Grant): Admission;
  publish(grant: ValidGrant): Grant;
  children(
    grant: ValidGrant,
    report?: (rejection: Rejection) => void,
    wanted?: (key: string) => boolean,
  ): readonly ValidGrant[];
  expand(
    grants: readonly ValidGrant[],
    report?: (rejection: Rejection) => void,
    wanted?: (key: string) => boolean,
  ): readonly Expanded[];
  leadsTo(key: string): (candidate: string) => boolean;
  ancestors(key: string): readonly string[];
  reached(key: string): readonly string[];
}

export type KeySet = { readonly keys: ReadonlyMap<string, KeyModel> };

const RETIRED = {
  target: "on",
  with: "where, parents or related",
  filter: "fields",
  flags: "when",
  inputWith: "input",
} as const satisfies Readonly<Record<string, string>>;

const NO_REPORT = (): void => {};
const EVERY_KEY = (): boolean => true;
const NO_GRANTS: readonly Grant[] = [];

function isStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function sameStep(a: EntityModel, b: EntityModel): boolean {
  return a.name === b.name && a.refType === b.refType;
}

function resolve(sets: readonly KeySet[]): Map<string, KeyModel> {
  const catalogue = new Map<string, KeyModel>();
  for (const set of sets) {
    for (const [key, model] of set.keys) {
      if (catalogue.has(key)) {
        throw new Error(`Duplicate permission key "${key}"`);
      }
      catalogue.set(key, model);
    }
  }
  for (const [key, model] of catalogue) {
    const includes = model.includeRefs.map((include) => {
      if (typeof include !== "string") return include.external;
      if (model.prefix === "") return include;
      const sibling = `${model.prefix}.${include}`;
      return catalogue.has(sibling) ? sibling : include;
    });
    catalogue.set(key, { ...model, includes });
  }
  return catalogue;
}

function validate(catalogue: Catalogue): void {
  const issues: string[] = [];
  for (const model of catalogue.values()) {
    if (
      model.read !== undefined &&
      catalogue.get(model.read)?.kind !== "action"
    ) {
      issues.push(
        `"${model.key}" lists through "${model.read}", which is not an action`,
      );
    }
    for (const includedKey of model.includes) {
      const included = catalogue.get(includedKey);
      if (!included) {
        issues.push(`"${model.key}" includes unknown key "${includedKey}"`);
        continue;
      }
      if (included.path.length < model.path.length) {
        issues.push(
          `"${model.key}" includes "${includedKey}", which acts on a wider scope`,
        );
        continue;
      }
      if (model.path.some((step, at) => !sameStep(included.path[at], step))) {
        issues.push(
          `"${model.key}" includes "${includedKey}", which is not under the same entities`,
        );
      }
    }
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (key: string, trail: readonly string[]): void => {
    if (state.get(key) === "done") return;
    if (state.get(key) === "visiting") {
      issues.push(`bundle cycle: ${[...trail, key].join(" -> ")}`);
      return;
    }
    state.set(key, "visiting");
    for (const next of catalogue.get(key)?.includes ?? []) {
      if (catalogue.has(next)) visit(next, [...trail, key]);
    }
    state.set(key, "done");
  };
  for (const key of catalogue.keys()) visit(key, []);
  if (issues.length > 0) {
    throw new Error(
      `Permission schema is invalid:\n  - ${issues.join("\n  - ")}`,
    );
  }
}

function graphOf(catalogue: Catalogue): {
  readonly ancestors: ReadonlyMap<string, readonly string[]>;
  readonly reached: ReadonlyMap<string, readonly string[]>;
  readonly dynamic: ReadonlySet<string>;
} {
  const ancestors = new Map<string, string[]>();
  const reached = new Map<string, string[]>();
  const dynamic = new Set<string>();
  for (const root of catalogue.values()) {
    if (root.kind === "action") continue;
    const leaves: string[] = [];
    const seen = new Set<string>([root.key]);
    const queue = [root.key];
    for (let head = 0; head < queue.length; head++) {
      const model = catalogue.get(queue[head]);
      if (!model) continue;
      if (model.kind === "action") {
        leaves.push(model.key);
        continue;
      }
      if (model.expand !== undefined) dynamic.add(root.key);
      for (const next of model.includes) {
        if (seen.has(next)) continue;
        seen.add(next);
        ancestors.set(next, [...(ancestors.get(next) ?? []), root.key]);
        queue.push(next);
      }
    }
    reached.set(root.key, leaves);
  }
  return { ancestors, reached, dynamic };
}

function targetProblem(
  model: KeyModel,
  on: unknown,
  refs: RefConvention,
): string | null {
  if (model.path.length === 0) {
    return on === undefined || (Array.isArray(on) && on.length === 0)
      ? null
      : "this key takes no target";
  }
  if (on === undefined) return "target is missing";
  if (!isStringList(on)) return "on must be a list of references";
  if (on.length !== model.path.length) {
    return `target has ${on.length} segments, the key takes ${model.path.length}`;
  }
  for (const [index, segment] of on.entries()) {
    const step = model.path[index];
    if (!refs.isOfType(segment, step.refType)) {
      return `target segment ${index} is not a "${step.refType}" reference`;
    }
  }
  return null;
}

function conditionsOf(
  value: unknown,
  label: string,
): Readonly<Record<string, Condition>> | string {
  if (value === undefined) return {};
  if (!isRecord(value)) return `${label} must map a name to a condition`;
  const out: Record<string, Condition> = {};
  for (const [name, condition] of Object.entries(value)) {
    if (!isRecord(condition)) return `${label}.${name} must be a condition`;
    out[name] = condition;
  }
  return out;
}

export function admitGrant(
  model: KeyModel,
  grant: Grant,
  refs: RefConvention,
): Admission {
  const fail = (problem: string): Admission => ({ ok: false, problem });
  const {
    id,
    key: _key,
    on,
    where,
    parents,
    related,
    fields,
    when,
    input,
    payload,
    ...tags
  } = grant;

  for (const [retired, replacement] of Object.entries(RETIRED)) {
    if (retired in tags) {
      return fail(`"${retired}" is not a grant field, use ${replacement}`);
    }
  }
  const misplaced = targetProblem(model, on, refs);
  if (misplaced !== null) return fail(misplaced);

  if (when !== undefined && !isStringList(when)) {
    return fail("when must be a list of condition names");
  }
  if (where !== undefined && !isRecord(where)) {
    return fail("where must be a condition");
  }
  if (input !== undefined && !isRecord(input)) {
    return fail("input must be a condition");
  }
  const ancestors = conditionsOf(parents, "parents");
  if (typeof ancestors === "string") return fail(ancestors);
  const joined = conditionsOf(related, "related");
  if (typeof joined === "string") return fail(joined);

  const slots: Record<string, Condition> = {};
  for (const [name, condition] of Object.entries(ancestors)) {
    if (!model.parents.has(name)) {
      return fail(`constraint "${name}" is read by no rule of this key`);
    }
    slots[name] = condition;
  }
  if (where !== undefined) {
    const subject = model.subject;
    if (subject === null) {
      return fail('"where" needs a key that acts on a document');
    }
    if (!subject.stored) {
      return fail(
        `constraint "${subject.name}" is read by no rule of this key`,
      );
    }
    slots[subject.name] = where;
  }
  for (const [name, condition] of Object.entries(joined)) {
    const relation = model.subject?.relations.get(name);
    if (!relation) return fail(`unknown relation "${name}"`);
    slots[relation.id] = condition;
  }
  for (const condition of Object.values(slots)) {
    const forbidden = conditionProblem(condition);
    if (forbidden !== null) return fail(forbidden);
  }
  for (const name of when ?? []) {
    if (!model.conditions.has(name)) {
      return fail(`condition "${name}" is declared by no rule of this key`);
    }
  }
  if (input !== undefined) {
    const forbidden = conditionProblem(input);
    if (forbidden !== null) return fail(forbidden);
    if (model.kind === "action" && !model.input) {
      return fail("an input constraint is set on a key that reads no input");
    }
  }
  if (fields !== undefined) {
    const malformed = fieldsProblem(fields);
    if (malformed !== null) return fail(malformed);
    if (model.kind === "action" && model.fields === null) {
      return fail("a field list is set on a key that projects nothing");
    }
  }

  return {
    ok: true,
    grant: {
      source: grant,
      key: model,
      id,
      on: on ?? [],
      slots,
      fields,
      when: when ?? [],
      input,
      payload,
      tags,
    },
  };
}

function publishGrant(grant: ValidGrant): Grant {
  const model = grant.key;
  const subject = model.subject;
  const relationNames = new Map<string, string>();
  for (const [name, relation] of subject?.relations ?? []) {
    relationNames.set(relation.id, name);
  }
  let where: Condition | undefined;
  const parents: Record<string, Condition> = {};
  const related: Record<string, Condition> = {};
  for (const [slot, condition] of Object.entries(grant.slots)) {
    const relation = relationNames.get(slot);
    if (subject !== null && slot === subject.name) where = condition;
    else if (relation !== undefined) related[relation] = condition;
    else parents[slot] = condition;
  }
  return {
    ...grant.tags,
    ...(grant.id !== undefined && { id: grant.id }),
    key: model.key,
    ...(model.path.length > 0 && { on: grant.on }),
    ...(where !== undefined && { where }),
    ...(Object.keys(parents).length > 0 && { parents }),
    ...(Object.keys(related).length > 0 && { related }),
    ...(grant.fields !== undefined && { fields: grant.fields }),
    ...(grant.when.length > 0 && { when: grant.when }),
    ...(grant.input !== undefined && { input: grant.input }),
    ...(grant.payload !== undefined && { payload: grant.payload }),
  };
}

function slotProblem(model: KeyModel, grant: ValidGrant): string | null {
  const subject = model.subject;
  for (const slot of Object.keys(grant.slots)) {
    const readable =
      model.parents.has(slot) ||
      (subject !== null && subject.stored && slot === subject.name) ||
      [...(subject?.relations.values() ?? [])].some(
        (relation) => relation.id === slot,
      );
    if (!readable) return `constraint "${slot}" is read by no rule of this key`;
  }
  for (const name of grant.when) {
    if (!model.conditions.has(name)) {
      return `condition "${name}" is declared by no rule of this key`;
    }
  }
  if (model.kind !== "action") return null;
  if (grant.input !== undefined && !model.input) {
    return "an input constraint is set on a key that reads no input";
  }
  if (grant.fields !== undefined && model.fields === null) {
    return "a field list is set on a key that projects nothing";
  }
  return null;
}

export function compile(
  sets: readonly KeySet[],
  refs: RefConvention,
): Compiled {
  const catalogue = resolve(sets);
  validate(catalogue);
  const graph = graphOf(catalogue);
  const admissions = new WeakMap<Grant, Admission>();

  function admit(grant: Grant): Admission {
    const known = admissions.get(grant);
    if (known) return known;
    const model = catalogue.get(grant.key);
    const admission: Admission = model
      ? admitGrant(model, grant, refs)
      : { ok: false, problem: `unknown permission key "${grant.key}"` };
    admissions.set(grant, admission);
    return admission;
  }

  const customs = new WeakMap<ValidGrant, readonly Grant[]>();

  function customChildren(grant: ValidGrant): readonly Grant[] {
    const expand = grant.key.expand;
    if (expand === undefined) return NO_GRANTS;
    const known = customs.get(grant);
    if (known) return known;
    const produced = expand(grant.source);
    customs.set(grant, produced);
    return produced;
  }

  function children(
    grant: ValidGrant,
    report: (rejection: Rejection) => void = NO_REPORT,
    wanted: (key: string) => boolean = EVERY_KEY,
  ): readonly ValidGrant[] {
    const parent = grant.key;
    if (parent.kind === "action") return [];
    const out: ValidGrant[] = [];
    for (const includedKey of parent.includes) {
      if (!wanted(includedKey)) continue;
      const included = catalogue.get(includedKey);
      if (!included) continue;
      const keepsFields =
        included.kind !== "action" || included.fields !== null;
      const child: ValidGrant = {
        ...grant,
        key: included,
        on: [
          ...grant.on,
          ...included.path
            .slice(grant.on.length)
            .map((step) => refs.wildcard(step.refType)),
        ],
        fields: keepsFields ? grant.fields : undefined,
      };
      const derived: ValidGrant = { ...child, source: publishGrant(child) };
      const problem = slotProblem(included, derived);
      if (problem === null) out.push(derived);
      else report({ grant: derived.source, reason: problem, via: parent.key });
    }
    for (const custom of customChildren(grant)) {
      if (!wanted(custom.key)) continue;
      const admission = admit(custom);
      if (admission.ok) out.push(admission.grant);
      else {
        report({ grant: custom, reason: admission.problem, via: parent.key });
      }
    }
    return out;
  }

  function expand(
    grants: readonly ValidGrant[],
    report: (rejection: Rejection) => void = NO_REPORT,
    wanted: (key: string) => boolean = EVERY_KEY,
  ): readonly Expanded[] {
    const queue: Expanded[] = [];
    for (const grant of grants) {
      if (wanted(grant.key.key)) queue.push({ grant, depth: 0 });
    }
    for (let head = 0; head < queue.length; head++) {
      const { grant, depth } = queue[head];
      if (depth >= MAX_EXPANSION_DEPTH) continue;
      for (const child of children(grant, report, wanted)) {
        queue.push({ grant: child, depth: depth + 1 });
      }
    }
    return queue;
  }

  const leadingTo = new Map<string, (key: string) => boolean>();

  function leadsTo(key: string): (candidate: string) => boolean {
    const known = leadingTo.get(key);
    if (known) return known;
    const above = new Set(graph.ancestors.get(key) ?? []);
    const leads = (candidate: string) =>
      candidate === key || above.has(candidate) || graph.dynamic.has(candidate);
    leadingTo.set(key, leads);
    return leads;
  }

  return {
    catalogue,
    refs,
    admit,
    publish: publishGrant,
    children,
    expand,
    leadsTo,
    ancestors: (key) => graph.ancestors.get(key) ?? [],
    reached: (key) => graph.reached.get(key) ?? [],
  };
}

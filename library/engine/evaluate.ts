import type { Compiled, Expanded, ValidGrant } from "../compile.ts";
import { allOf, type Condition, holds, isEmpty } from "../condition.ts";
import { selectFields, type Visible, widen } from "../fields.ts";
import type { ProviderAccess } from "../grant.ts";
import type { Alternative, Through } from "../storage/plan.ts";
import type { Loader } from "./loader.ts";
import type {
  EntityModel,
  Facts,
  KeyModel,
  RuleContext,
  RuleVerdict,
} from "./model.ts";
import {
  callHook,
  describeError,
  type Hooks,
  type ProviderCache,
  type Providers,
} from "./providers.ts";

export type Request = {
  readonly model: KeyModel;
  readonly ids: readonly string[];
  readonly facts: Facts;
};

export type Decision =
  | { readonly ok: false; readonly reasons: readonly string[] }
  | {
      readonly ok: true;
      readonly grants: readonly string[];
      readonly alternatives: readonly Alternative[];
      readonly undecided: boolean;
      readonly unlistable: string | undefined;
      readonly doc?: unknown;
      readonly input?: unknown;
    };

export type Session = {
  readonly loader: Loader;
  readonly cache: ProviderCache;
};

type Shown = { readonly source: unknown; readonly fields: Visible };

type Granted = {
  readonly ok: true;
  readonly alternative: Alternative;
  readonly undecided: boolean;
  readonly unlistable: string | undefined;
  readonly doc?: Shown;
  readonly input?: Shown;
};

type Verdict = Granted | { readonly ok: false; readonly reason: string };

const deny = (reason: string): Verdict => ({ ok: false, reason });

function refused(verdict: RuleVerdict, name: string): string | null {
  if (verdict === true) return null;
  if (verdict === false) return `${name} denied`;
  return verdict.ok ? null : verdict.reason;
}

export function createEvaluator(
  compiled: Compiled,
  providers: Providers,
  hooks: Hooks,
) {
  const { refs } = compiled;

  function matches(
    grant: ValidGrant,
    ids: readonly string[],
    capability: boolean,
  ): boolean {
    if (grant.on.length !== ids.length) return false;
    return grant.on.every((segment, index) =>
      capability
        ? refs.overlaps(segment, ids[index])
        : refs.covers(segment, ids[index]),
    );
  }

  async function judge(
    grant: ValidGrant,
    request: Request,
    session: Session,
  ): Promise<Verdict> {
    const { model, ids, facts } = request;
    const subject = model.subject;
    const context = { ...facts, grant: grant.source };

    const decidable = (step: EntityModel): boolean =>
      ids.length > step.depth &&
      ids.slice(0, step.depth + 1).every((id) => !refs.isWildcard(id));
    const docOf = (step: EntityModel): Promise<unknown> =>
      session.loader.document(step.source, ids.slice(0, step.depth + 1));

    const parts: Condition[] = [];
    const through: Through[] = [];
    let undecided = false;
    let unlistable: string | undefined;

    for (const step of model.path) {
      if (step === subject || !step.stored) continue;
      const condition = grant.slots[step.name];
      if (condition === undefined) continue;
      if (!decidable(step)) {
        undecided = true;
        continue;
      }
      if (!holds(condition, await docOf(step))) {
        return deny(`match[${step.name}] mismatch`);
      }
    }

    if (subject !== null) {
      const known = decidable(subject);
      if (subject.verifyExists && known) {
        const doc = await docOf(subject);
        if (doc === null || doc === undefined) {
          return deny(
            `exists[${subject.name}] ${ids[subject.depth]} not found under its parents`,
          );
        }
      }

      const where = subject.stored ? grant.slots[subject.name] : undefined;
      if (where !== undefined) {
        if (!known) parts.push(where);
        else if (!holds(where, await docOf(subject))) {
          return deny(`match[${subject.name}] mismatch`);
        }
      }

      if (model.targetConstraint && !known) {
        const pinned = grant.on[subject.depth];
        if (pinned !== undefined && !refs.isWildcard(pinned)) {
          parts.push({ [subject.idField]: pinned });
        }
      }

      for (const relation of subject.relations.values()) {
        const condition = grant.slots[relation.id];
        if (condition === undefined) continue;
        if (!known) {
          through.push({ relation, where: condition });
          continue;
        }
        const doc = await docOf(subject);
        const rows =
          doc === null || doc === undefined
            ? []
            : await session.loader.related(
                relation.source,
                doc,
                ids.slice(0, subject.depth + 1),
              );
        if (!rows.some((row) => holds(condition, row))) {
          return deny(`related[${relation.id}] no joined row matches`);
        }
      }

      for (const name of grant.when) {
        const named = subject.conditions.get(name);
        if (!named) continue;
        if (known) {
          const doc = named.needsDoc ? await docOf(subject) : undefined;
          if (!named.holds(doc, context)) {
            return deny(`condition "${name}" does not hold`);
          }
        } else if (named.field !== undefined) {
          parts.push({ [named.field]: facts.subject.id });
        } else if (named.whenUnknown === "allow") {
          undecided = true;
        } else {
          return deny(`condition "${name}" cannot be decided without a target`);
        }
      }

      for (const name of model.forbid) {
        const named = subject.conditions.get(name);
        if (!named) continue;
        if (known) {
          const doc = named.needsDoc ? await docOf(subject) : undefined;
          if (named.holds(doc, context)) {
            return deny(`forbidden when "${name}" holds`);
          }
        } else if (named.field !== undefined) {
          parts.push({ [named.field]: { $ne: facts.subject.id } });
        } else {
          undecided = true;
        }
      }
    }

    const concrete = ids.every((id) => !refs.isWildcard(id));
    const doc: Shown | undefined =
      model.fields === "doc" && subject !== null && concrete
        ? { source: await docOf(subject), fields: grant.fields ?? "all" }
        : undefined;
    const input: Shown | undefined =
      model.fields === "input" && facts.input !== undefined
        ? { source: facts.input, fields: grant.fields ?? "all" }
        : undefined;

    if (model.input && !isEmpty(grant.input)) {
      if (facts.input === undefined) return deny("input-match: input required");
      if (!holds(grant.input ?? {}, facts.input)) {
        return deny("input-match: mismatch");
      }
    }

    if (model.rules.length > 0) {
      const ruleContext: RuleContext = {
        ...context,
        key: model.key,
        decidable: concrete,
        doc: () => {
          if (subject === null || !decidable(subject)) {
            return Promise.reject(
              new Error(`"${model.key}" has no document to read here`),
            );
          }
          return docOf(subject);
        },
        parent: (name) => {
          const step = model.path.find((candidate) => candidate.name === name);
          if (!step || !decidable(step)) {
            return Promise.reject(
              new Error(`"${model.key}" has no "${name}" to read here`),
            );
          }
          return docOf(step);
        },
      };
      for (const rule of model.rules) {
        if (rule.when !== undefined && !grant.when.includes(rule.when)) {
          continue;
        }
        if (rule.perDocument && !concrete) {
          const rows = rule.rows?.(ruleContext);
          if (rows === undefined) unlistable ??= rule.name;
          else if (rows !== null) parts.push(rows);
          continue;
        }
        const reason = refused(await rule.check(ruleContext), rule.name);
        if (reason !== null) return deny(reason);
      }
    }

    return {
      ok: true,
      alternative: {
        ...(parts.length > 0 && { where: allOf(parts) }),
        ...(through.length > 0 && { through }),
      },
      undecided,
      unlistable,
      ...(doc && { doc }),
      ...(input && { input }),
    };
  }

  function shown(merged: Shown | undefined): unknown {
    if (merged === undefined) return undefined;
    return merged.fields === "all"
      ? merged.source
      : selectFields(merged.source, merged.fields);
  }

  function widened(current: Shown | undefined, addition: Shown): Shown {
    return {
      source: addition.source,
      fields: widen(current?.fields, addition.fields),
    };
  }

  async function decide(request: Request, session: Session): Promise<Decision> {
    const { model, ids, facts } = request;
    const key = model.key;
    const target = model.path.length === 0 ? undefined : ids;
    const capability = ids.some((id) => refs.isWildcard(id));

    const access: ProviderAccess = {
      read: (entity) => {
        const own = ids.slice(0, entity.depth + 1);
        return own.length === entity.depth + 1 &&
          own.every((id) => !refs.isWildcard(id))
          ? session.loader.document(entity.source, own)
          : Promise.resolve(null);
      },
    };
    const outcomes = await providers.consult(
      session.cache,
      facts.subject,
      key,
      target,
      access,
    );
    const failures = outcomes.flatMap((outcome) =>
      outcome.failure === undefined ? [] : [outcome.failure],
    );

    const lists: (readonly Expanded[])[] = [];
    for (const outcome of outcomes) {
      if (outcome.grants.length === 0) continue;
      const list = providers.expansionFor(outcome, key);
      if (list.length > 0) lists.push(list);
    }
    const ordered =
      lists.length === 1
        ? lists[0]
        : lists.flat().sort((a, b) => a.depth - b.depth);
    const matching = ordered
      .map((entry) => entry.grant)
      .filter((grant) => matches(grant, ids, capability));
    if (matching.length === 0) {
      return { ok: false, reasons: ["no matching grant", ...failures] };
    }

    const reasons: string[] = [];
    const grants: string[] = [];
    const alternatives: Alternative[] = [];
    let undecided = false;
    let unlistable: string | undefined;
    let doc: Shown | undefined;
    let input: Shown | undefined;
    let granted = false;

    for (const grant of matching) {
      let verdict: Verdict;
      try {
        verdict = await judge(grant, request, session);
      } catch (error) {
        callHook(() =>
          hooks.onError?.({
            source: "rule",
            grantId: grant.id,
            subject: facts.subject,
            key,
            ids: target,
            error,
          }),
        );
        verdict = deny(`rule evaluation failed: ${describeError(error)}`);
      }
      if (!verdict.ok) {
        reasons.push(
          grant.id ? `[${grant.id}] ${verdict.reason}` : verdict.reason,
        );
        continue;
      }
      granted = true;
      if (grant.id !== undefined) grants.push(grant.id);
      alternatives.push(verdict.alternative);
      undecided ||= verdict.undecided;
      unlistable ??= verdict.unlistable;
      if (verdict.doc) doc = widened(doc, verdict.doc);
      if (verdict.input) input = widened(input, verdict.input);
    }

    if (!granted) {
      return {
        ok: false,
        reasons: [
          ...(reasons.length > 0 ? reasons : ["no matching grant"]),
          ...failures,
        ],
      };
    }
    return {
      ok: true,
      grants,
      alternatives,
      undecided,
      unlistable,
      ...(doc && { doc: shown(doc) }),
      ...(input && { input: shown(input) }),
    };
  }

  return { decide };
}

export type Evaluator = ReturnType<typeof createEvaluator>;

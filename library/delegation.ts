import {
  type Compiled,
  MAX_EXPANSION_DEPTH,
  type ValidGrant,
} from "./compile.ts";
import {
  type Condition,
  conjunction,
  deepEqual,
  implies,
} from "./condition.ts";
import type { EntityModel, KeyModel } from "./engine/model.ts";
import { fieldsWithin } from "./fields.ts";
import type { Grant } from "./grant.ts";
import type { RefConvention } from "./refs.ts";

export type BoundaryAnchor =
  | {
      readonly kind: "path";
      readonly entity: EntityModel;
      readonly path: readonly string[];
    }
  | {
      readonly kind: "condition";
      readonly entity: EntityModel;
      readonly slot: string;
      readonly where: Condition;
    };

export type RefusalCode =
  | "invalid"
  | "reserved"
  | "outside-boundary"
  | "not-held";

export type DelegationRefusal = {
  readonly grant: Grant;
  readonly code: RefusalCode;
  readonly reason: string;
};

export type ReservedKeys = (key: string) => boolean;

export type DelegationOptions = {
  readonly within?: Boundary;
  readonly reserved?: ReservedKeys;
};

export type Judged<G extends Grant> = {
  readonly kept: readonly G[];
  readonly dropped: readonly DelegationRefusal[];
};

export interface Boundary {
  readonly entity: EntityModel;
  readonly path: readonly string[];
  readonly anchors: readonly BoundaryAnchor[];
  keys(): readonly string[];
  bind(grant: Grant): Grant;
  refusal(
    held: readonly Grant[],
    asked: Grant,
    options?: { readonly reserved?: ReservedKeys },
  ): DelegationRefusal | null;
  within<G extends Grant>(
    envelope: readonly Grant[],
    grants: readonly G[],
    options?: { readonly reserved?: ReservedKeys },
  ): Judged<G>;
}

export interface Delegation {
  covers(held: Grant, asked: Grant): boolean;
  refusal(
    held: readonly Grant[],
    asked: Grant,
    options?: DelegationOptions,
  ): DelegationRefusal | null;
  withinEnvelope<G extends Grant>(
    envelope: readonly Grant[],
    grants: readonly G[],
    options?: DelegationOptions,
  ): Judged<G>;
  boundary(entity: EntityModel, ...path: string[]): Boundary;
}

export type DelegationEngine = {
  readonly delegation: Delegation;
  judgeAgainst(
    held: readonly ValidGrant[],
    asked: Grant,
    options: DelegationOptions,
  ): DelegationRefusal | null;
};

type Verdict = Omit<DelegationRefusal, "grant">;

function sameEntity(a: EntityModel, b: EntityModel): boolean {
  return a.name === b.name && a.refType === b.refType && a.depth === b.depth;
}

function startsAt(model: KeyModel, root: EntityModel): boolean {
  return (
    root.lineage.length > 0 &&
    root.lineage.every((step, index) => {
      const at = model.path[index];
      return at !== undefined && sameEntity(at, step);
    })
  );
}

function targetCovers(
  held: ValidGrant,
  asked: ValidGrant,
  refs: RefConvention,
): boolean {
  return (
    held.on.length === asked.on.length &&
    held.on.every((segment, index) => refs.covers(segment, asked.on[index]))
  );
}

function restrictionsCover(held: ValidGrant, asked: ValidGrant): boolean {
  for (const [slot, condition] of Object.entries(held.slots)) {
    if (!implies(asked.slots[slot], condition)) return false;
  }
  if (!implies(asked.input, held.input)) return false;
  if (held.payload !== undefined && !deepEqual(asked.payload, held.payload)) {
    return false;
  }
  if (!held.when.every((name) => asked.when.includes(name))) return false;
  if (held.fields === undefined) return true;
  return asked.fields !== undefined && fieldsWithin(asked.fields, held.fields);
}

function coveredBy(
  held: readonly ValidGrant[],
  asked: ValidGrant,
  refs: RefConvention,
): boolean {
  return held.some(
    (candidate) =>
      candidate.key.key === asked.key.key &&
      targetCovers(candidate, asked, refs) &&
      restrictionsCover(candidate, asked),
  );
}

function readable(model: KeyModel, slot: string): boolean {
  const subject = model.subject;
  if (model.parents.has(slot)) return true;
  if (subject === null) return false;
  if (subject.stored && subject.name === slot) return true;
  for (const relation of subject.relations.values()) {
    if (relation.id === slot) return true;
  }
  return false;
}

function applies(model: KeyModel, anchor: BoundaryAnchor): boolean {
  return anchor.kind === "path"
    ? startsAt(model, anchor.entity)
    : readable(model, anchor.slot);
}

function anchored(grant: ValidGrant, anchor: BoundaryAnchor): boolean {
  if (!applies(grant.key, anchor)) return false;
  if (anchor.kind === "path") {
    return anchor.path.every((id, index) => grant.on[index] === id);
  }
  return implies(grant.slots[anchor.slot], anchor.where);
}

function boundTo(
  grant: ValidGrant,
  anchors: readonly BoundaryAnchor[],
  refs: RefConvention,
): ValidGrant {
  const anchor = anchors.find((candidate) => applies(grant.key, candidate));
  if (!anchor) return grant;
  if (anchor.kind === "condition") {
    return {
      ...grant,
      slots: {
        ...grant.slots,
        [anchor.slot]: conjunction(anchor.where, grant.slots[anchor.slot]),
      },
    };
  }
  const free =
    grant.on.length >= anchor.path.length &&
    anchor.path.every(
      (id, index) => grant.on[index] === id || refs.isWildcard(grant.on[index]),
    );
  if (!free) return grant;
  return {
    ...grant,
    on: [...anchor.path, ...grant.on.slice(anchor.path.length)],
  };
}

function anchorsOf(
  compiled: Compiled,
  entity: EntityModel,
  path: readonly string[],
): readonly BoundaryAnchor[] {
  const { refs } = compiled;
  const concrete =
    path.length === entity.lineage.length &&
    path.length > 0 &&
    path.every(
      (id, index) =>
        typeof id === "string" &&
        !refs.isWildcard(id) &&
        refs.isOfType(id, entity.lineage[index].refType),
    );
  if (!concrete) {
    throw new Error(
      `boundary(${entity.name}): expected ${entity.lineage.length} concrete references, got ${JSON.stringify(path)}`,
    );
  }
  const owner = path[path.length - 1];
  const anchors: BoundaryAnchor[] = [{ kind: "path", entity, path }];
  const seen = new Set<string>();
  for (const model of compiled.catalogue.values()) {
    for (const step of model.path) {
      for (const ownership of step.ownerships) {
        if (!sameEntity(ownership.to, entity)) continue;
        const signature = `${step.name}|${ownership.slot}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        anchors.push({
          kind: "condition",
          entity: step,
          slot: ownership.slot,
          where: ownership.where(owner),
        });
      }
    }
  }
  return anchors;
}

export function createDelegation(compiled: Compiled): DelegationEngine {
  const { refs } = compiled;

  function boundaryProblem(
    asked: ValidGrant,
    anchors: readonly BoundaryAnchor[],
  ): string | null {
    const queue = [{ grant: asked, depth: 0 }];
    for (let head = 0; head < queue.length; head++) {
      const { grant, depth } = queue[head];
      if (!anchors.some((anchor) => anchored(grant, anchor))) {
        return `"${grant.key.key}" is not bound to the boundary`;
      }
      if (grant.key.kind === "action") continue;
      if (depth >= MAX_EXPANSION_DEPTH) {
        return `"${grant.key.key}" expands deeper than ${MAX_EXPANSION_DEPTH} levels`;
      }
      for (const child of compiled.children(grant)) {
        queue.push({ grant: child, depth: depth + 1 });
      }
    }
    return null;
  }

  function verdictOf(
    held: readonly ValidGrant[],
    asked: ValidGrant,
    options: DelegationOptions,
  ): Verdict | null {
    const key = asked.key.key;
    if (options.reserved?.(key)) {
      return { code: "reserved", reason: `"${key}" cannot be delegated` };
    }
    if (options.within) {
      const outside = boundaryProblem(asked, options.within.anchors);
      if (outside !== null)
        return { code: "outside-boundary", reason: outside };
    }
    if (!coveredBy(held, asked, refs)) {
      return {
        code: "not-held",
        reason: `"${key}" exceeds what the delegator holds`,
      };
    }
    return null;
  }

  function judgeAgainst(
    held: readonly ValidGrant[],
    asked: Grant,
    options: DelegationOptions,
  ): DelegationRefusal | null {
    const admission = compiled.admit(asked);
    if (!admission.ok) {
      return { grant: asked, code: "invalid", reason: admission.problem };
    }
    const verdict = verdictOf(held, admission.grant, options);
    return verdict === null ? null : { grant: asked, ...verdict };
  }

  function expandedOf(grants: readonly Grant[]): readonly ValidGrant[] {
    const valid: ValidGrant[] = [];
    for (const grant of grants) {
      const admission = compiled.admit(grant);
      if (admission.ok) valid.push(admission.grant);
    }
    return compiled.expand(valid).map((entry) => entry.grant);
  }

  function judgeAll<G extends Grant>(
    envelope: readonly Grant[],
    grants: readonly G[],
    options: DelegationOptions,
  ): Judged<G> {
    const held = expandedOf(envelope);
    const kept: G[] = [];
    const dropped: DelegationRefusal[] = [];
    for (const grant of grants) {
      const refusal = judgeAgainst(held, grant, options);
      if (refusal === null) kept.push(grant);
      else dropped.push(refusal);
    }
    return { kept, dropped };
  }

  const delegation: Delegation = {
    covers(held, asked) {
      const wanted = compiled.admit(asked);
      return wanted.ok && coveredBy(expandedOf([held]), wanted.grant, refs);
    },
    refusal: (held, asked, options = {}) =>
      judgeAgainst(expandedOf(held), asked, options),
    withinEnvelope: (envelope, grants, options = {}) =>
      judgeAll(envelope, grants, options),
    boundary(entity, ...path) {
      const anchors = anchorsOf(compiled, entity, path);
      const boundary: Boundary = {
        entity,
        path,
        anchors,
        keys: () =>
          [...compiled.catalogue.values()]
            .filter((model) => anchors.some((anchor) => applies(model, anchor)))
            .map((model) => model.key),
        bind(grant) {
          const admission = compiled.admit(grant);
          if (!admission.ok) return grant;
          const bound = boundTo(admission.grant, anchors, refs);
          return bound === admission.grant ? grant : compiled.publish(bound);
        },
        refusal: (held, asked, options = {}) =>
          judgeAgainst(expandedOf(held), asked, {
            ...options,
            within: boundary,
          }),
        within: (envelope, grants, options = {}) =>
          judgeAll(envelope, grants, { ...options, within: boundary }),
      };
      return boundary;
    },
  };

  return { delegation, judgeAgainst };
}

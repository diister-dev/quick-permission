import type { Condition } from "../grant.ts";

export type RelationInfo = {
  readonly id: string;
  readonly localField: string;
  readonly foreignField: string;
  readonly collection?: string;
  readonly only?: Condition;
  readonly via?: RelationInfo;
};

export type Through = {
  readonly relation: RelationInfo;
  readonly where: Condition;
};

export type Alternative = {
  readonly where?: Condition;
  readonly through?: readonly Through[];
};

export type Plan = { readonly alternatives: readonly Alternative[] };

export interface StorageAdapter<TQuery> {
  readonly name: string;
  compile(plan: Plan): TQuery;
}

export const EVERYTHING: Plan = { alternatives: [{}] };

function isEmpty(condition: Condition | undefined): boolean {
  return condition === undefined || Object.keys(condition).length === 0;
}

export function isUnrestricted(alternative: Alternative): boolean {
  return (
    isEmpty(alternative.where) &&
    (alternative.through === undefined || alternative.through.length === 0)
  );
}

export function planOf(alternatives: readonly Alternative[]): Plan {
  if (alternatives.some(isUnrestricted)) return EVERYTHING;
  const seen = new Set<string>();
  const distinct: Alternative[] = [];
  for (const alternative of alternatives) {
    const signature = JSON.stringify([
      alternative.where ?? null,
      (alternative.through ?? []).map((step) => [step.relation.id, step.where]),
    ]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    distinct.push(alternative);
  }
  return { alternatives: distinct };
}

export function relationsOf(plan: Plan): readonly RelationInfo[] {
  const ordered: RelationInfo[] = [];
  const known = new Set<string>();
  const visit = (relation: RelationInfo, trail: readonly string[]): void => {
    if (known.has(relation.id)) return;
    if (trail.includes(relation.id)) {
      throw new Error(
        `Relation cycle: ${[...trail, relation.id].join(" -> ")}`,
      );
    }
    if (relation.via) visit(relation.via, [...trail, relation.id]);
    known.add(relation.id);
    ordered.push(relation);
  };
  for (const alternative of plan.alternatives) {
    for (const step of alternative.through ?? []) visit(step.relation, []);
  }
  return ordered;
}

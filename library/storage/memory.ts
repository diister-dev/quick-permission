import {
  type Condition,
  compileCondition,
  isEmpty,
  type Tester,
  together,
} from "../condition.ts";
import {
  isUnrestricted,
  type Plan,
  type RelationInfo,
  type StorageAdapter,
} from "./plan.ts";

export type Related = (relation: RelationInfo) => readonly unknown[];

export type MemoryQuery = (doc: unknown, related?: Related) => boolean;

const always: Tester = () => true;

function testerOf(condition: Condition | undefined): Tester {
  return condition === undefined || isEmpty(condition)
    ? always
    : compileCondition(condition);
}

export function memory(): StorageAdapter<MemoryQuery> {
  return {
    name: "memory",
    compile(plan: Plan): MemoryQuery {
      if (plan.alternatives.some(isUnrestricted)) return always;
      const alternatives = plan.alternatives.map((alternative) => ({
        own: testerOf(alternative.where),
        joined: (alternative.through ?? []).map((step) => ({
          relation: step.relation,
          matches: testerOf(together(step.relation.only, step.where)),
        })),
      }));
      return (doc, related) =>
        alternatives.some(
          ({ own, joined }) =>
            own(doc) &&
            joined.every(
              ({ relation, matches }) =>
                related?.(relation).some(matches) ?? false,
            ),
        );
    },
  };
}

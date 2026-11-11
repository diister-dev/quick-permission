import { type Condition, together, validateCondition } from "../condition.ts";
import {
  type Alternative,
  isUnrestricted,
  type Plan,
  type RelationInfo,
  relationsOf,
  type StorageAdapter,
} from "./plan.ts";

export type MongoFilter = Readonly<Record<string, unknown>>;
export type MongoStage = Readonly<Record<string, unknown>>;

export type MongoQuery = {
  readonly filter: MongoFilter;
  readonly stages: readonly MongoStage[] | null;
};

export type MongoOptions = {
  readonly sameCollection?: string;
  readonly alias?: (relation: RelationInfo) => string;
};

export const SAME_COLLECTION = "<self>";

function present(condition: Condition | undefined): condition is Condition {
  return condition !== undefined && Object.keys(condition).length > 0;
}

function all(parts: readonly MongoFilter[]): MongoFilter {
  if (parts.length === 0) return {};
  return parts.length === 1 ? parts[0] : { $and: parts };
}

function any(parts: readonly MongoFilter[]): MongoFilter {
  return parts.length === 1 ? parts[0] : { $or: parts };
}

function checked(condition: Condition): Condition {
  validateCondition(condition);
  return condition;
}

export function mongo(options: MongoOptions = {}): StorageAdapter<MongoQuery> {
  const sameCollection = options.sameCollection ?? SAME_COLLECTION;
  const alias =
    options.alias ?? ((relation: RelationInfo) => `_${relation.id}`);

  const lookup = (relation: RelationInfo): MongoStage => {
    const from = relation.collection ?? sameCollection;
    const only = present(relation.only) ? checked(relation.only) : undefined;
    if (!relation.via) {
      return {
        $lookup: {
          from,
          localField: relation.localField,
          foreignField: relation.foreignField,
          ...(only && { pipeline: [{ $match: only }] }),
          as: alias(relation),
        },
      };
    }
    return {
      $lookup: {
        from,
        let: {
          src: {
            $arrayElemAt: [`$${alias(relation.via)}.${relation.localField}`, 0],
          },
        },
        pipeline: [
          {
            $match: {
              $expr: { $eq: [`$${relation.foreignField}`, "$$src"] },
              ...only,
            },
          },
        ],
        as: alias(relation),
      },
    };
  };

  const matchOf = (alternative: Alternative): MongoFilter =>
    all([
      ...(present(alternative.where) ? [checked(alternative.where)] : []),
      ...(alternative.through ?? []).map((step) => ({
        [alias(step.relation)]: {
          $elemMatch: together(step.relation.only, checked(step.where)),
        },
      })),
    ]);

  return {
    name: "mongo",
    compile(plan: Plan): MongoQuery {
      if (plan.alternatives.some(isUnrestricted)) {
        return { filter: {}, stages: null };
      }
      const relations = relationsOf(plan);
      if (relations.length === 0) {
        return { filter: any(plan.alternatives.map(matchOf)), stages: null };
      }
      const own = plan.alternatives
        .map((alternative) => alternative.where)
        .filter(present);
      const filter =
        own.length === plan.alternatives.length ? any(own.map(checked)) : {};
      return {
        filter,
        stages: [
          ...(Object.keys(filter).length > 0 ? [{ $match: filter }] : []),
          ...relations.map(lookup),
          { $match: any(plan.alternatives.map(matchOf)) },
        ],
      };
    },
  };
}

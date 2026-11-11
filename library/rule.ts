import type { CustomRule } from "./engine/model.ts";

export type {
  CustomRule,
  RuleContext,
  RuleVerdict,
} from "./engine/model.ts";

export function defineRule(rule: CustomRule): CustomRule {
  if (rule.perDocument !== true && rule.rows !== undefined) {
    throw new Error(
      `defineRule(${rule.name}): "rows" only makes sense on a rule that decides per document`,
    );
  }
  return rule;
}

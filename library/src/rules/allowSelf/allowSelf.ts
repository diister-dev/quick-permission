import { rule } from "../../core/rule.ts";
import { target } from "../../schemas/target/target.ts";
import type { Rule } from "../../types/rule.ts";

export function allowSelf(): Rule<[ReturnType<typeof target>]> {
  return rule(
    "allowSelf",
    [target()],
    (_state, request) => {
      if (request.from === request.target) {
        return true;
      }

      // Not handled by this validation
      return undefined;
    },
  );
}

import { rule } from "../../core/rule.ts";
import { target } from "../../schemas/target/target.ts";
import type { Rule } from "../../types/rule.ts";

export function denySelf(): Rule<[ReturnType<typeof target>]> {
  return rule(
    "denySelf",
    [target()],
    (_state, request) => {
      if (request.from === request.target) {
        return false;
      }

      // Not handled by this validation
      return undefined;
    },
  );
}

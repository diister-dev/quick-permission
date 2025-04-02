import { rule } from "../../core/rule.ts";
import { target } from "../../schemas/target/target.ts";

export function allowSelf() {
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

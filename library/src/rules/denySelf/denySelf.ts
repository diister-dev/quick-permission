import { rule } from "../../core/rule.ts";
import { target } from "../../schemas/target/target.ts";

export function denySelf() {
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

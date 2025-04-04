import { rule } from "../../core/rule.ts";
import { owner } from "../../schemas/owner/owner.ts";

export function allowOwner() {
  return rule(
    "allowOwner",
    [owner()],
    (_state, request) => {
      if (request.from === request.owner) {
        return true;
      }

      // Not handled by this validation
      return undefined;
    },
  );
}

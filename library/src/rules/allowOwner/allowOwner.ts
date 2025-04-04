import { rule } from "../../core/rule.ts";
import { owner } from "../../schemas/owner/owner.ts";
import type { Rule } from "../../types/rule.ts";

export function allowOwner(): Rule<[ReturnType<typeof owner>]> {
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

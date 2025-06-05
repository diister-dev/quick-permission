import { allowOwner } from "../rules/allowOwner/allowOwner.ts";
import { allowTarget } from "../rules/allowTarget/allowTarget.ts";
import { allowSelf } from "../rules/allowSelf/allowSelf.ts";
import { denySelf } from "../rules/denySelf/denySelf.ts";
import { hierarchy, permission, validate } from "../core/permission.ts";
import { PermissionStateSet } from "../types/common.ts";
import { and, merge, not } from "../operators/operations.ts";
import { ensureTime } from "../rules/ensureTime/ensureTime.ts";
import { TimeState } from "../schemas/time/time.ts";
import { target, TargetState } from "../schemas/target/target.ts";
import { Rule } from "../types/rule.ts";
import {
  printTestHeader,
  printValidationResults,
} from "./helpers/test_utils.ts";

const rules = merge([allowTarget({ wildcards: true }), ensureTime()]);

const permissions = hierarchy({
  user: permission({
    rules: [rules],
    children: {
      create: permission({
        rules: [rules, allowTarget({ wildcards: true })],
      }),
      view: permission({
        rules: [rules, allowSelf()],
      }),
      update: permission({
        rules: [rules, allowSelf()],
      }),
      delete: permission({
        rules: [rules, denySelf()],
      }),
    },
  }),
});

const defaultPermissions: PermissionStateSet<typeof permissions> = {
  "user.view": {
    target: [],
  },
  "user.delete": {
    target: [],
  },
  "user.update": {
    target: [],
  },
};

const states: PermissionStateSet<typeof permissions>[] = [
  {
    ...defaultPermissions,
    "user": {
      target: ["user:D*"],
    },
    "user.view": {
      target: ["group:A.B.*"],
    },
    "user.create": {
      target: ["group:user"],
    },
  },
  {
    ...defaultPermissions,
    "user.create": {
      dateStart: new Date(new Date().getTime() + 1000 * 60 * 60 * 24),
      target: ["group:*"],
    },
  },
];

// Success case
printTestHeader(
  1,
  "Success case - user requesting to view an authorized group",
);
const result1 = validate(permissions, states, "user.view", {
  from: "user:A",
  target: "group:A.B.C",
});
printValidationResults(result1);

// Error case - denySelf rule
printTestHeader(
  2,
  "Failure case - user trying to delete themselves (denySelf)",
);
const result2 = validate(permissions, states, "user.delete", {
  from: "user:D123",
  target: "user:D123",
});
printValidationResults(result2);

// Error case - unauthorized target
printTestHeader(3, "Failure case - user targeting an unauthorized group");
const result3 = validate(permissions, states, "user.view", {
  from: "user:A",
  target: "group:C.D.E",
});
printValidationResults(result3);

// Error case - time check (future)
printTestHeader(4, "Failure case - future authorization not yet valid");
const result4 = validate(permissions, states, "user.create", {
  from: "user:A",
  target: "group:anything",
});
printValidationResults(result4);

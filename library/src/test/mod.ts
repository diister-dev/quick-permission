import { allowOwner } from "../rules/allowOwner/allowOwner.ts";
import { allowTarget } from "../rules/allowTarget/allowTarget.ts";
import { allowSelf } from "../rules/allowSelf/allowSelf.ts";
import { denySelf } from "../rules/denySelf/denySelf.ts";
import { hierarchy, permission, validate } from "../core/permission.ts";
import { PermissionStateSet } from "../types/common.ts";
import { not } from "../operators/operations.ts";
import { ensureTime } from "../rules/ensureTime/ensureTime.ts";
import { TimeState } from "../schemas/time/time.ts";
import { target, TargetState } from "../schemas/target/target.ts";
import { Rule } from "../types/rule.ts";

const rules = <const>[allowTarget({ wildcards: true }), ensureTime()] satisfies Rule[];

const permissions = hierarchy({
    user: permission({
        rules,
        children: {
            create: permission({
                rules: [...rules, allowTarget({ wildcards: true })],
            }),
            view: permission({
                rules: [...rules, allowSelf()],
            }),
            update: permission({
                rules: [...rules, allowSelf()],
            }),
            delete: permission({
                rules: [...rules, denySelf()],
            }),
        }
    }),
})

const defaultPermissions: PermissionStateSet<typeof permissions> = {
    "user.view" : {
        target: [],
    },
    "user.delete": {
        target: []
    },
    "user.update": {
        target: []
    },
} 

const states: PermissionStateSet<typeof permissions>[] = [
    {
        ...defaultPermissions,
        "user" :{
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
    }
]

const result = validate(permissions, states, "user.view", {
    from: "user:A",
    target: "user:C",
});

console.log(result, "->", !!result);
import { target } from "../schemas/target/target.ts";
import { owner } from "../schemas/owner/owner.ts";
import { allowOwner } from "../rules/allowOwner/allowOwner.ts";
import { allowTarget } from "../rules/allowTarget/allowTarget.ts";
import { allowSelf } from "../rules/allowSelf/allowSelf.ts";
import { denySelf } from "../rules/denySelf/denySelf.ts";
import { Schema } from "../types/schema.ts";
import { time } from "../schemas/time/time.ts";
import { Rule } from "../types/rule.ts";
import { hierarchy, permission, validate } from "../core/permission.ts";
import { PermissionKey } from "../types/common.ts";
import { not } from "../operators/operations.ts";
import { ensureTime } from "../rules/ensureTime/ensureTime.ts";

type AllowerStates<T> = T extends [infer A, ...infer B] ?
    B extends [] ?
    A extends Schema<infer State, any> ? State : never
    : A extends Schema<infer State, any> ? State & AllowerStates<B> : never
    : never;

type AllowerRequests<T> = T extends [infer A, ...infer B] ?
    B extends [] ?
    A extends Schema<any, infer Request> ? Request : never
    : A extends Schema<any, infer Request> ? Request & AllowerRequests<B> : never
    : never;

function allow<const A extends Schema<any, any>[]>(schemas: A, rules: Rule<AllowerStates<A>, AllowerRequests<A>>[]) {
    function makeRequest(state: AllowerStates<A>, request: AllowerRequests<A>): boolean {
        for (const rule of schemas) {
            console.debug(`Checking rule ${rule.name}`);
            if (rule.state && !rule.state(state)) return false;
            if (rule.request && !rule.request(request)) return false;
        }
        
        let anyExplicitAllow = false;
        for (const rule of rules) {
            console.debug(`Checking rule ${rule.name}`);
            const result = rule.check(state, request);
            if (result === false) return false;
            if (result === true) anyExplicitAllow = true;
        }

        return anyExplicitAllow;
    }

    return {
        makeRequest,
    }
}

// const allower = allow([target(), owner(), time()], [allowTarget({ wildcards: true }), allowOwner(), denySelf()]);

// const value = allower.makeRequest({
//     dateStart: new Date(),
//     dateEnd: new Date(new Date().getTime() + 1000 * 60 * 60 * 24 * 7), // 1 week
//     target: ["user:*"],
// }, {
//     from: "owner",
//     target: "user:pouet",
//     owner: "pouet",
// })

// console.log(value);

const permissions = hierarchy({
    A: permission({
        schemas: [owner()],
        children: {
            B: permission({
                schemas: [owner()],
                rules: [allowOwner()],
                children: {
                    C: {
                        D: permission({
                            schemas: [target(), owner(), time()],
                            rules: [ensureTime(), allowTarget()],
                            children: {
                                F: permission({
                                    schemas: [target(), owner()],
                                    rules: [allowOwner()],
                                }),
                            }
                        }),
                        E: permission({}),
                    }
                }
            }),
        }
    }),
})

const states = [
    {
        "A.B.C.D": {
            target: ["owner:123"],
        },
        "A.B.C.D.F": {
            target: [],
        }
    },
    {
        "A.B.C.D.F": {
            target: [],
        }
    }
]

const result = validate(states, permissions, "A.B.C.D.F", {
    from: "B",
    owner: "A",
    target: "owner:123",
});
console.log(result, "->", !!result);
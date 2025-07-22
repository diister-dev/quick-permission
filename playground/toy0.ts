type PermissionState = [string, any];

type UnknowObj = Record<PropertyKey, unknown>;

type Merge<T> = T extends [infer A, ...infer B]
  ? (A extends undefined ? UnknowObj : A) & Merge<B>
  : T extends [] ? UnknowObj
  : never;

type Validation = (obj: unknown) => boolean;
type GuardedType<T> = T extends (obj: unknown) => obj is infer R ? R : never;
type GuardedTypes<T> = T extends [infer A, ...infer B]
  ? [GuardedType<A>, ...GuardedTypes<B>]
  : T extends [] ? []
  : never;

type RuleResult = "accept" | "reject" | "neutral" | "DENY";

type Rule<
  S extends Validation[],
  R extends Validation[],
> = {
  name: string;
  validState: S;
  validRequest: R;
  check: (opts: {
    state: Merge<GuardedTypes<S>>;
    request: Merge<GuardedTypes<R>>;
  }) => RuleResult;
};

function worldCheck(obj: unknown): obj is { world: string } {
  return true;
}

function requestFrom(obj: unknown): obj is { from: string } {
  return true;
}

function requestTarget(obj: unknown): obj is { target: string } {
  return true;
}

function stateTarget(obj: unknown): obj is { target: string[] } {
  return true;
}

function rule<
  const S extends Validation[] = [],
  const R extends Validation[] = [],
>(opts: {
  name: string;
  validState?: S;
  validRequest?: R;
  check: (opts: {
    state: Merge<GuardedTypes<S>>;
    request: Merge<GuardedTypes<R>>;
  }) => RuleResult;
}): Rule<S, R> {
  return {
    ...opts,
    validState: (opts.validState || []) as S,
    validRequest: (opts.validRequest || []) as R,
  };
}

const ruleTarget = rule({
  name: "exampleRule",
  validState: [stateTarget],
  validRequest: [requestTarget, worldCheck],
  check: ({ state, request }) => {
    if (state.target.includes(request.target)) return "accept";
    return "neutral";
  },
});

const allowOwner = rule({
  name: "allowOwner",
  validState: [],
  validRequest: [requestTarget, requestFrom],
  check: ({ request }) => {
    if (request.from === request.target) return "accept";
    return "neutral";
  },
});

const ruleAlwaysAccept = rule({ name: "accept", check: () => "accept" });
const ruleAlwaysReject = rule({ name: "reject", check: () => "reject" });
const ruleAlwaysNeutral = rule({ name: "neutral", check: () => "neutral" });
const ruleAlwaysDeny = rule({ name: "deny", check: () => "DENY" });

type Permission<
  R extends Rule<any, any>[],
> = {
  rules: R;
};

type JoinRulesStates<T> = T extends [infer A, ...infer B]
  ? A extends Rule<infer S, any> ? Merge<GuardedTypes<S>> & JoinRulesStates<B>
  : never
  : T extends [] ? UnknowObj
  : never;
type JoinRulesRequests<T> = T extends [infer A, ...infer B]
  ? A extends Rule<any, infer R> ? Merge<GuardedTypes<R>> & JoinRulesRequests<B>
  : never
  : T extends [] ? UnknowObj
  : never;

type PermissionStates<T> = T extends Permission<infer R> ? JoinRulesStates<R>
  : never;
type PermissionRequests<T> = T extends Permission<infer R>
  ? JoinRulesRequests<R>
  : never;

function permission<
  const R extends Rule<any, any>[],
>(rules: R): Permission<R> {
  return { rules };
}

const perm1 = permission([ruleTarget, allowOwner]);

function valid<
  const P extends Permission<any>,
>(
  permission: P,
  state: PermissionStates<P>,
  request: PermissionRequests<P>,
): RuleResult {
  return "DENY";
}

const result = valid(perm1, {
  target: ["huh"],
}, {
  from: "ou",
  target: "world",
  world: "zoege",
});
console.log(result);

///////////////////////////// HIERARCHY /////////////////////////////
const hierarchy = {
  user: {
    create: permission([ruleAlwaysAccept]),
    read: [permission([ruleAlwaysAccept]), {
      profile: permission([ruleAlwaysAccept]),
      settings: permission([ruleAlwaysAccept]),
      notifications: permission([ruleAlwaysAccept]),
    }],
    update: permission([ruleAlwaysAccept]),
    delete: permission([ruleAlwaysAccept]),
  },
};

type Hierarchy = {
  [key: string]: Permission<any> | Hierarchy;
};

type HierarchyElements<T, K extends string = ""> = T extends Hierarchy ?
    | {
      key: K;
    }
    | {
      [key in keyof T]: key extends string
        ? HierarchyElements<T[key], K extends "" ? key : `${K}.${key}`>
        : never;
    }[keyof T]
  : never;

type A = HierarchyElements<typeof hierarchy>;

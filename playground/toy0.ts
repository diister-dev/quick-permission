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
  : [];

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

function requestFrom(obj: unknown): obj is { subject: string } {
  return true;
}

function requestTarget(obj: unknown): obj is { target: string } {
  return true;
}

function stateTarget(obj: unknown): obj is { target: string[] } {
  return true;
}

function scope<const T extends string>(name: T) {
  return (obj: unknown): obj is { [K in T]: string } => {
    return true;
  };
}

function namedTarget<const T extends string>(name: T) {
  return (obj: unknown): obj is { [K in T]: string } => {
    return true;
  };
}

function rule<
  const S extends Validation[],
  const R extends Validation[],
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
    validState: (opts.validState ?? []) as S,
    validRequest: (opts.validRequest ?? []) as R,
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

function scopeRule<const T extends string>(name: T) {
  return rule({
    name: `scope:${name}`,
    validState: [scope(name)],
    validRequest: [scope(name)],
    check: ({ state, request }) => {
      console.log("scopeRule", { state, request });
      if (state[name] !== request[name]) return "reject";
      return "neutral";
    },
  }) as Rule<
    [ReturnType<typeof scope<T>>],
    [ReturnType<typeof scope<T>>]
  >;
}

function targetRule<const T extends string>(name: T) {
  return rule({
    name: `target:${name}`,
    validState: [namedTarget(name)],
    validRequest: [namedTarget(name)],
    check: ({ state, request }) => {
      if (state[name] !== request[name]) return "reject";
      return "neutral";
    },
  }) as Rule<
    [ReturnType<typeof namedTarget<T>>],
    [ReturnType<typeof namedTarget<T>>]
  >;
}

const ruleAlwaysAccept = rule({ name: "accept", check: () => "accept" });
const ruleAlwaysReject = rule({ name: "reject", check: () => "reject" });
const ruleAlwaysNeutral = rule({ name: "neutral", check: () => "neutral" });
const ruleAlwaysDeny = rule({ name: "deny", check: () => "DENY" });

const alwaysTruePermission = permission([ruleAlwaysAccept, targetRule("userId")]);
type UH = typeof alwaysTruePermission extends Permission<infer R>
  ? JoinRulesStates<R>
  : never;
type TEST = PermissionStates<typeof ruleAlwaysAccept>;
type TEST2 = JoinRulesStates<typeof ruleAlwaysAccept>;
type TEST3 = typeof alwaysTruePermission["rules"] extends [infer A, ...infer B]
  ? A extends Rule<infer S, any> ? Merge<GuardedTypes<S>> & JoinRulesStates<B>
  : never
  : typeof alwaysTruePermission["rules"] extends [] ? UnknowObj
  : never;
// type TEST3 = T extends [infer A, ...infer B]
//   ? A extends Rule<infer S, any> ? Merge<GuardedTypes<S>> & JoinRulesStates<B>
//   : never
//   : T extends [] ? UnknowObj
//   : never;

type Permission<
  R extends Rule<any, any>[],
> = {
  type: "permission";
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
  return {
    type: "permission",
    rules,
  };
}

const perm1 = permission([ruleTarget, allowOwner]);
const perm2 = permission([scopeRule("userId"), ruleAlwaysAccept]);

function valid<
  const P extends Permission<any>,
>(
  permission: P,
  state: PermissionStates<P>,
  request: PermissionRequests<P>,
): RuleResult {
  let accepted = false;
  for (const rule of permission.rules) {
    const result = rule.check({ state, request });
    if (result === "DENY") return "DENY";
    if (result === "reject") return "reject";
    if (result === "accept") {
      accepted = true;
    }
  }
  return accepted ? "accept" : "neutral";
}

const result = valid(perm1, {
  target: ["huh"],
}, {
  subject: "ou",
  target: "world",
  world: "zoege",
});

///////////////////////////// HIERARCHY /////////////////////////////
const hierarchy = {
  user: {
    create: permission([ruleAlwaysAccept]),
    read: {
      profile: permission([ruleAlwaysAccept]),
      settings: permission([ruleAlwaysAccept]),
      notifications: permission([ruleAlwaysAccept]),
    },
    update: permission([targetRule("userId")]),
    delete: permission([ruleAlwaysAccept]),
  },
  exhibition: {
    create: permission([]),
    read: permission([targetRule("exhibitionId")]),
    update: permission([targetRule("exhibitionId")]),
    delete: permission([targetRule("exhibitionId")]),
    exhibitor: {
      create: permission([]),
      read: permission([scopeRule("exhibitionId"), targetRule("exhibitorId")]),
      update: permission([]),
      delete: permission([]),
      visitors: {
        invitations: {
          create: permission([]),
          read: permission([scopeRule("exhibitionId"), scopeRule("exhibitorId"), scopeRule("visitorId")]),
          update: permission([]),
          delete: permission([]),
        },
      },
    },
  },
} as const;

type Hierarchy = {
  [key: string]: Permission<any> | Hierarchy;
};

type HierarchyElements<T, K extends string = ""> = T extends Hierarchy ?
    | (K extends "" ? never : {
      type: "h";
      key: K;
    })
    | {
      [key in keyof T]: key extends string
        ? HierarchyElements<T[key], K extends "" ? key : `${K}.${key}`>
        : never;
    }[keyof T]
  : T extends Permission<infer Any> ? {
      type: "p";
      key: K;
      value: T;
    }
  : never;

type Endpoints<H> = H extends Hierarchy
  ? HierarchyElements<H> extends infer E
    ? E extends { key: infer K; type: "p" } ? K : never
  : never
  : never;

type Branch<H> = H extends Hierarchy
  ? HierarchyElements<H> extends infer E
    ? E extends { key: infer K; type: "h" } ? K : never
  : never
  : never;

type FilterEndpoints<H, P extends Branch<H>> = H extends Hierarchy
  ? HierarchyElements<H> extends infer E
    ? E extends { key: infer K; type: "p" }
      ? K extends `${P}.${string}` ? K : never
    : never
  : never
  : never;

type WithoutPrefix<T, P extends string> = T extends `${P}.${infer R}` ? R : T;

type EndpointElement<H, P> = P extends Endpoints<H>
  ? HierarchyElements<H> extends infer E
    ? E extends { key: P; type: "p" } ? E : never
  : never
  : never;

type A = HierarchyElements<typeof hierarchy>;
type Paths = Endpoints<typeof hierarchy>;

// To Think
// - A way to describe how to obtain the permissions depending on the context & hierarchy position
// - A way to collect context to validate the permissions
type OmitProperties<T, K extends PropertyKey> = {
  [P in keyof T as Exclude<P, K>]: T[P];
};

function buildPermissionSystem<H extends Hierarchy>(
  hierarchy: H,
  opts: {
    resolvers: any;
  },
) {
  const flatHierarchy: any = {};
  {
    const flattenHierarchy = (
      h: any,
      prefix: string = "",
    ) => {
      for (const key in h) {
        const value = h[key];
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (
          typeof value === "object" && !Array.isArray(value) &&
          value?.type !== "permission"
        ) {
          flattenHierarchy(value, fullKey);
        } else {
          flatHierarchy[fullKey] = value;
        }
      }
    };

    flattenHierarchy(hierarchy);
  }
  console.log("hierarchy", Object.keys(flatHierarchy));

  function createVerifier(ctx: { subject: string }) {
    const stateSets = {};

    function resolve<P extends Endpoints<H>>(
      permKey: P,
      request: OmitProperties<
        PermissionRequests<EndpointElement<H, P>["value"]>,
        "subject"
      >,
    ): { success: boolean } {
      const perm = flatHierarchy[permKey];

      console.log({
        permKey,
        request,
        stateSets,
        subject: ctx.subject,
      });
      const flatPerm = Object.entries(stateSets).reduce(
        (acc, [key, permState]) => {
          return [...acc, ...permState];
        },
        [],
      );

      const scopePerms = flatPerm.filter(([key, value]: any) => {
        return key === permKey;
      }).map(([key, value]: any) => {
        return value;
      });

      let oneValid = false;
      for (const permState of scopePerms) {
        const result = valid(perm, permState, {
          ...request,
          subject: ctx.subject,
        });
        console.log(">>>", {
          permKey,
          request,
          permState,
          result,
        });
        if (result === "accept") {
          oneValid = true;
        } else if (result === "DENY") {
          return { success: false };
        }
      }

      return { success: oneValid };
    }

    async function verify<
      P extends Endpoints<H>,
    >(
      permKey: P,
      request: OmitProperties<
        PermissionRequests<EndpointElement<H, P>["value"]>,
        "subject"
      >,
    ): Promise<boolean> {
      await Promise.all(
        Object.entries(opts.resolvers).map(async ([resolverName, resolver]) => {
          const result = await resolver(ctx.subject, permKey, request);
          stateSets[resolverName] = result;
        }),
      );

      return resolve(permKey, request);
    }

    return {
      verify,
    };
  }

  function createIntermediate<
    P extends Branch<H>,
    const S extends Validation[],
  >(
    path: P,
    validation: S,
    behavior: {
      // [K in WithoutPrefix<FilterEndpoints<H, P>, `${P}.`>]?: (state: GuardedType<S>) => PermissionStates<EndpointElement<H, `${P}.${K}`>["value"]>;
      // [K in WithoutPrefix<FilterEndpoints<H, P>, P>]?: (
      //   state: Merge<GuardedTypes<S>>,
      // ) => PermissionStates<EndpointElement<H, `${P}.${K}`>["value"]>;
      [K in FilterEndpoints<H, P>]?: (state: Merge<GuardedTypes<S>>) => PermissionStates<EndpointElement<H, K>["value"]>;
    }
  ) {
    return [];
  }

  return {
    createVerifier,
    createIntermediate,
  };
}
// Nomenclature
// - Subject
// - Resource
// - Mesure
// - Environment
const permissionSystem = buildPermissionSystem(hierarchy, {
  resolvers: {
    direct: async (subject: string, permKey: string, request: any) => {
      if (subject === "user:123") {
        return [
          ["user.update", { userId: "user:123" }],
        ];
      }
    },
    // directPermissionResolver(), // Directly defined permissions to the subject
    // rolesPermissionResolver(), // Permissions based on roles assigned to the subject
    // expositionPermissionResolver(), // Permissions based on the exposition context
    // exhibitorPermissionResolver(), // Permissions based on the exhibitor context
  },
});

permissionSystem.createIntermediate(
  "exhibition.exhibitor.visitors",
  [
    scope("exhibitionId"),
  ],
  {
    "invitations.read": (o) => ({
      exhibitionId: o.exhibitionId,
      exhibitorId: "exhibitor:*",
      visitorId: "visitor:*",
    })
  }
);

const verifier = permissionSystem.createVerifier({
  subject: "user:123",
});

// Mesure
console.log(
  await verifier.verify("exhibition.update", {
    exhibitionId: "expo123",
  }),
);

console.log(
  await verifier.verify("exhibition.exhibitor.read", {
    exhibitionId: "expo123",
    exhibitorId: "exhibitor456",
  }),
);

// Do not use resolvers directly, but can be convenient for frontend checks
// const accepted2 = verifier.direct("user.update", {
//   userId: "user123",
// })
// expositionId: "expo123",
// exhibitorId: "exhibitor456",

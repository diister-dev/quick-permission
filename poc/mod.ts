import * as p from "@dii/quick-permission"

// Semantic
// - Permission Hierarchy : Define the hierarchy of permissions
// - Permission : An object that contains the permission, based on the path of the hierarchy, and the state
// - Request : An object that contains the request, based on the path of the hierarchy, and the state

type PouetState = {
    pouet: string;
}

type PouetRequest = {
    isPouet: boolean;
}

const pouetAllower = allower({
    state(obj): obj is PouetState {
        return typeof obj === "object" && (obj as PouetState).pouet === 'pouet';
    },
    request(obj): obj is PouetRequest {
        return typeof obj === "object" && (obj as PouetRequest).isPouet === true;
    }
}, (state, request) => {
    // Check if the request is allowed based on the state
    return state.pouet === 'pouet' && request.isPouet === true;
})

const timeAllower = allower({
    state(obj): obj is { dateStart?: Date; dateEnd?: Date } {
        return typeof obj === "object" && (obj as { dateStart?: Date; dateEnd?: Date }).dateStart !== undefined;
    },
    request(obj): obj is { date?: Date } {
        return typeof obj === "object" && (obj as { date?: Date }).date !== undefined;
    }
}, (state, request) => {
    // Check if the request is allowed based on the state
    return state.dateStart !== undefined && state.dateEnd !== undefined && request.date !== undefined &&
        state.dateStart <= request.date && request.date <= state.dateEnd;
});

const ownerAllower = allower({
    request(obj): obj is { from: string, owner: string } {
        if(typeof obj !== "object" || !obj) return false;
        if(typeof (obj as any).from !== "string") return false;
        if(typeof (obj as any).owner !== "string") return false;
        return true;
    }
}, (state, request) => {
    return;
});

const scopeAllower = allower({
    state(obj): obj is { scope: string[] } {
        return typeof obj === "object" && (obj as { scope: string[] }).scope !== undefined;
    },
    request(obj): obj is { scope: string } {
        return typeof obj === "object" && (obj as { scope: string }).scope !== undefined;
    }
}, (state, request) => {
    // Check if the request is allowed based on the state
    return state.scope.includes(request.scope);
});

function allowOwner(state: unknown, request: { from: string, owner: string }) {
    return request.from === request.owner;
}

// Define permission hierarchy
const hierarchy = p.root({
    user: p.root({
        create: p.allowed(),
        view: p.allowed([p.target()], [p.selfTarget()]),
        update: p.allowed(p.target(), [p.selfTarget()]),
        delete: p.allowed(p.target(), [p.exceptSelf()]),
    }),
    article: p.root({
        create: p.allowed(),
        view: p.allowed(p.target()),
        update: p.allowed(p.target()),
        delete: p.allowed(p.target()),
        share: p.allowed([p.target(), p.owner()], [p.allowOwner()]),
        comment: p.allowed([p.target(), p.owner()], [p.allowOwner()]),
    }),
})

// Group
// User
// Article

// State
// { target: string[] }
// Request
// { target: string, from: string, owner: string }

// Define an example permission, stored in a database
const permissions = {
    "user.create": {
        dateEnd: new Date("2026-01-01"),
    },
    "user.view": {
        target: ["group:client", "user:id_abc"],
    },
    "user.delete": {
        target: ["group:client"],   // required by target
        isPouet: true,              // Required by pouetAllower
    }
}

const permisionsAdmin = {
    "user": {},
}

// hierarchy, permissions, query, request
const validate = p.validate(hierarchy, [permissions], "user.view", {
    from: "user:abc",
    owner: "user:abc",
}); // empty request
console.log(validate); // true

const validation = p.validation(hierarchy, permissions);
validation.can("user.create", {}); // true
validation.can("user.view", {
    target: "group:client",
}); // true
validation.can("user.view", {
    target: "user:id_abc",
}); // true

p.validate(hierarchy, permissions, "user.delete", {
    target: "group:client",
    isPouet: false, // pouetAllower requires isPouet to be true
}); // false

type Merge<T> = T extends [infer A, ...infer B] ? B extends [] ? A : A & Merge<B> : never;

function merge<A extends object[]>(...a: [...A]) {
    return Object.assign({}, ...a) as Merge<A>;
}

type Flexible<T> = T & { [key: string]: any };

type GuardType<T> = T extends (obj: unknown) => obj is infer U ? U : never;

type Allower<State, Request> = {
    type: "allower";
    checkers: {
        state?: (obj: unknown) => obj is State;
        request: (obj: unknown) => obj is Request;
    };
    allow: (state: State, request: Request) => boolean | undefined | void;
}

function allower<
    State extends object,
    Request extends object,
    Allow extends (state: State, request: Request) => boolean | undefined | void,
>(checkers: {
    state?: (obj: unknown) => obj is State;
    request: (obj: unknown) => obj is Request;
}, allow: Allow): Allower<State, Request> {
    return {
        type: "allower",
        checkers,
        allow,
    }
}

type AllowerStates<T> = T extends [infer A, ...infer B] ?
    B extends [] ?
        A extends Allower<infer State, any> ? State : never
        : A extends Allower<infer State, any> ? State & AllowerStates<B> : never
    : never;

type AllowerRequests<T> = T extends [infer A, ...infer B] ?
    B extends [] ?
        A extends Allower<any, infer Request> ? Request : never
        : A extends Allower<any, infer Request> ? Request & AllowerRequests<B> : never
    : never;

function allow<const A extends Allower<any, any>[]>(allowers: A, validators: ((state: AllowerStates<A>, request: AllowerRequests<A>) => boolean | undefined)[]) {
    function makeRequest(state: AllowerStates<A>, request: AllowerRequests<A>) {
        
    }

    return {
        makeRequest,
    }
}

function selfTargetValidation(state: { target: string[] }, request: { target: string }) {
    if(state.target.includes(request.target)) return true; // Allow
}

function ensurePouet(state: PouetState) {
    if (state.pouet != "pouet") return false; // Deny
}

function ensurePouetTime(state: PouetState, request: PouetRequest & { date?: Date }) {
    if (state.pouet != "pouet") return false; // Deny
    if (request.date && request.date.getTime() < Date.now()) return false; // Deny
    return true; // Allow
}

const allowing = allow([pouetAllower, timeAllower, ownerAllower], [ensurePouet, ensurePouetTime, allowOwner])
// allow([pouetAllower, timeAllower], [ensurePouet, ensurePouetTime, selfTargetValidation]) // Cannot add `selfTargetValidation` because it is not a valid validator for the allower

allowing.makeRequest({
    pouet: "pouet",
}, {
    from: "user:abc",
    owner: "user:abc",
    isPouet: true,
    date: new Date(),
})
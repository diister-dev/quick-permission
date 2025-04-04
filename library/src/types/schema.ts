export type Schema<
  State extends object,
  Request extends object,
> = {
  name: string;
  state?: (obj: unknown) => obj is State;
  request?: (obj: unknown) => obj is Request;
  defaultState?: () => State;
};

export type SchemasStates<T> = T extends [infer A, ...infer B]
  ? B extends []
    ? A extends Schema<infer State, any>
      ? State extends undefined ? never : State
    : never
  : A extends Schema<infer State, any>
    ? (State extends undefined ? never : State) & SchemasStates<B>
  : never
  : never;

export type SchemasRequests<T> = T extends [infer A, ...infer B]
  ? B extends [] ? A extends Schema<any, infer Request> ? Request : never
  : A extends Schema<any, infer Request> ? Request & SchemasRequests<B>
  : never
  : never;

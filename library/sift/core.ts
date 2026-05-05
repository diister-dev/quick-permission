// Vendored from sift.js (https://github.com/crcn/sift.js) — MIT licensed.
// `$where` operator removed (security: arbitrary code execution).

import {
  comparable,
  Comparator,
  equals,
  isArray,
  isProperty,
  isVanillaObject,
  Key,
} from "./utils.ts";

export interface Operation<TItem> {
  readonly keep: boolean;
  readonly done: boolean;
  propop: boolean;
  reset(): void;
  next(
    item: TItem,
    key?: Key,
    owner?: unknown,
    root?: boolean,
    leaf?: boolean,
  ): void;
}

export type Tester = (
  item: unknown,
  key?: Key,
  owner?: unknown,
  root?: boolean,
  leaf?: boolean,
) => boolean;

export interface NamedOperation {
  name: string;
}

export type OperationCreator<TItem> = (
  params: unknown,
  parentQuery: unknown,
  options: Options,
  name: string,
) => Operation<TItem>;

export type BasicValueQuery<TValue> = {
  $eq?: TValue;
  $ne?: TValue;
  $lt?: TValue;
  $gt?: TValue;
  $lte?: TValue;
  $gte?: TValue;
  $in?: TValue[];
  $nin?: TValue[];
  $all?: TValue[];
  $mod?: [number, number];
  $exists?: boolean;
  $regex?: string | RegExp;
  $size?: number;
  $options?: "i" | "g" | "m" | "u";
  // deno-lint-ignore ban-types
  $type?: Function;
  $not?: NestedQuery<TValue>;
  $or?: NestedQuery<TValue>[];
  $nor?: NestedQuery<TValue>[];
  $and?: NestedQuery<TValue>[];
};

export type ArrayValueQuery<TValue> = {
  $elemMatch?: Query<TValue>;
} & BasicValueQuery<TValue>;

type Unpacked<T> = T extends (infer U)[] ? U : T;

export type ValueQuery<TValue> = TValue extends Array<unknown>
  ? ArrayValueQuery<Unpacked<TValue>>
  : BasicValueQuery<TValue>;

type NotObject = string | number | Date | boolean | Array<unknown>;
export type ShapeQuery<TItemSchema> = TItemSchema extends NotObject
  // deno-lint-ignore ban-types
  ? {}
  : { [k in keyof TItemSchema]?: TItemSchema[k] | ValueQuery<TItemSchema[k]> };

export type NestedQuery<TItemSchema> =
  & ValueQuery<TItemSchema>
  & ShapeQuery<TItemSchema>;

export type Query<TItemSchema> =
  | TItemSchema
  | RegExp
  | NestedQuery<TItemSchema>;

export type QueryOperators<TValue = unknown> = keyof ValueQuery<TValue>;

// Walks each value at a key path for nested ops, e.g. { "person.address": { $eq: "x" } }.
const walkKeyPathValues = (
  item: unknown,
  keyPath: Key[],
  next: Tester,
  depth: number,
  key: Key | undefined,
  owner: unknown,
): boolean | void => {
  const currentKey = keyPath[depth];

  // If array and currentKey is non-numeric / not own prop, fan out across elements.
  // Falls through for cases like { $eq: [1, 2, 3] } against [1, 2, 3].
  if (
    isArray(item) &&
    isNaN(Number(currentKey)) &&
    !isProperty(item as object, currentKey)
  ) {
    for (let i = 0, { length } = item; i < length; i++) {
      // Returning false from `next` terminates the walk — for operations,
      // that means the search criterion was met.
      if (!walkKeyPathValues(item[i], keyPath, next, depth, i, item)) {
        return false;
      }
    }
  }

  if (depth === keyPath.length || item == null) {
    return next(item, key, owner, depth === 0, depth === keyPath.length);
  }

  return walkKeyPathValues(
    (item as Record<string, unknown>)[currentKey as string],
    keyPath,
    next,
    depth + 1,
    currentKey,
    item,
  );
};

export abstract class BaseOperation<TParams, TItem = unknown>
  implements Operation<TItem> {
  keep = false;
  done = false;
  abstract propop: boolean;
  readonly params: TParams;
  readonly owneryQuery: unknown;
  readonly options: Options;
  readonly name?: string;
  // Fields are assigned manually (not via parameter properties) so they're
  // available inside init(), which runs from this constructor before subclass
  // field initializers fire under TS's `useDefineForClassFields` semantics.
  constructor(
    params: TParams,
    owneryQuery: unknown,
    options: Options,
    name?: string,
  ) {
    this.params = params;
    this.owneryQuery = owneryQuery;
    this.options = options;
    this.name = name;
    this.init();
  }
  protected init(): void {}
  reset(): void {
    this.done = false;
    this.keep = false;
  }
  abstract next(
    item: TItem,
    key?: Key,
    parent?: unknown,
    root?: boolean,
    leaf?: boolean,
  ): void;
}

abstract class GroupOperation extends BaseOperation<unknown> {
  constructor(
    params: unknown,
    owneryQuery: unknown,
    options: Options,
    public readonly children: Operation<unknown>[],
  ) {
    super(params, owneryQuery, options);
  }

  override reset(): void {
    this.keep = false;
    this.done = false;
    for (let i = 0, { length } = this.children; i < length; i++) {
      this.children[i].reset();
    }
  }

  abstract override next(
    item: unknown,
    key?: Key,
    owner?: unknown,
    root?: boolean,
    leaf?: boolean,
  ): void;

  protected childrenNext(
    item: unknown,
    key: Key | undefined,
    owner: unknown,
    root: boolean,
    leaf?: boolean,
  ): void {
    let done = true;
    let keep = true;
    for (let i = 0, { length } = this.children; i < length; i++) {
      const childOperation = this.children[i];
      if (!childOperation.done) {
        childOperation.next(item, key, owner, root, leaf);
      }
      if (!childOperation.keep) {
        keep = false;
      }
      if (childOperation.done) {
        if (!childOperation.keep) {
          break;
        }
      } else {
        done = false;
      }
    }
    this.done = done;
    this.keep = keep;
  }
}

export abstract class NamedGroupOperation extends GroupOperation
  implements NamedOperation {
  abstract override propop: boolean;
  constructor(
    params: unknown,
    owneryQuery: unknown,
    options: Options,
    children: Operation<unknown>[],
    override readonly name: string,
  ) {
    super(params, owneryQuery, options, children);
  }
}

export class QueryOperation<TItem> extends GroupOperation {
  readonly propop = true;

  override next(
    item: TItem,
    key?: Key,
    parent?: unknown,
    root?: boolean,
  ): void {
    this.childrenNext(item, key, parent, root ?? false);
  }
}

export class NestedOperation extends GroupOperation {
  readonly propop = true;
  constructor(
    readonly keyPath: Key[],
    params: unknown,
    owneryQuery: unknown,
    options: Options,
    children: Operation<unknown>[],
  ) {
    super(params, owneryQuery, options, children);
  }

  override next(item: unknown, key?: Key, parent?: unknown): void {
    walkKeyPathValues(
      item,
      this.keyPath,
      this._nextNestedValue,
      0,
      key,
      parent,
    );
  }

  private _nextNestedValue = (
    value: unknown,
    key: Key | undefined,
    owner: unknown,
    root: boolean | undefined,
    leaf: boolean | undefined,
  ): boolean => {
    this.childrenNext(value, key, owner, root ?? false, leaf);
    return !this.done;
  };
}

export const createTester = (
  a: unknown,
  compare: Comparator,
): Tester => {
  if (a instanceof Function) {
    return a as Tester;
  }
  if (a instanceof RegExp) {
    return (b: unknown) => {
      const result = typeof b === "string" && a.test(b);
      a.lastIndex = 0;
      return result;
    };
  }
  const comparableA = comparable(a);
  return (b: unknown) => compare(comparableA, comparable(b));
};

export class EqualsOperation<TParam> extends BaseOperation<TParam> {
  readonly propop = true;
  // `declare` so the field has no runtime initializer that would clobber
  // the value set by init() in the parent constructor.
  declare private _test: Tester;
  override init(): void {
    // Params can be a raw value, RegExp, or a custom tester function.
    this._test = createTester(this.params as unknown, this.options.compare);
  }
  next(item: unknown, key?: Key, parent?: unknown): void {
    if (
      !Array.isArray(parent) ||
      Object.prototype.hasOwnProperty.call(parent, key as PropertyKey)
    ) {
      if (this._test(item, key, parent)) {
        this.done = true;
        this.keep = true;
      }
    }
  }
}

export const createEqualsOperation = (
  params: unknown,
  owneryQuery: unknown,
  options: Options,
): EqualsOperation<unknown> =>
  new EqualsOperation(params, owneryQuery, options);

export const numericalOperationCreator =
  (createNumericalOperation: OperationCreator<unknown>): OperationCreator<unknown> =>
  (params: unknown, owneryQuery: unknown, options: Options, name: string) => {
    return createNumericalOperation(params, owneryQuery, options, name);
  };

export const numericalOperation = (
  createTester: (value: unknown) => Tester,
): OperationCreator<unknown> =>
  numericalOperationCreator(
    (
      params: unknown,
      owneryQuery: unknown,
      options: Options,
      name: string,
    ) => {
      const typeofParams = typeof comparable(params);
      const test = createTester(params);
      return new EqualsOperation(
        ((b: unknown) => {
          const actualValue = b == null ? null : b;
          return (
            typeof comparable(actualValue) === typeofParams && test(actualValue)
          );
          // EqualsOperation accepts a Tester as params; cast retains that contract.
        }) as unknown,
        owneryQuery,
        options,
        name,
      );
    },
  );

export type Options = {
  operations: {
    // Heterogeneous registry: each operator returns its own Operation subtype.
    // deno-lint-ignore no-explicit-any
    [identifier: string]: OperationCreator<any>;
  };
  compare: (a: unknown, b: unknown) => boolean;
};

const createNamedOperation = (
  name: string,
  params: unknown,
  parentQuery: unknown,
  options: Options,
): Operation<unknown> | null => {
  const operationCreator = options.operations[name];
  if (!operationCreator) {
    throwUnsupportedOperation(name);
  }
  return operationCreator(params, parentQuery, options, name);
};

const throwUnsupportedOperation = (name: string): never => {
  throw new Error(`Unsupported operation: ${name}`);
};

export const containsOperation = (query: unknown, options: Options): boolean => {
  if (query == null || typeof query !== "object") return false;
  for (const key in query as object) {
    if (
      Object.prototype.hasOwnProperty.call(options.operations, key) ||
      key.charAt(0) === "$"
    ) {
      return true;
    }
  }
  return false;
};

const createNestedOperation = (
  keyPath: Key[],
  nestedQuery: unknown,
  parentKey: string,
  owneryQuery: unknown,
  options: Options,
): NestedOperation => {
  if (containsOperation(nestedQuery, options)) {
    const [selfOperations, nestedOperations] = createQueryOperations(
      nestedQuery,
      parentKey,
      options,
    );
    if (nestedOperations.length) {
      throw new Error(
        `Property queries must contain only operations, or exact objects.`,
      );
    }
    return new NestedOperation(
      keyPath,
      nestedQuery,
      owneryQuery,
      options,
      selfOperations,
    );
  }
  return new NestedOperation(keyPath, nestedQuery, owneryQuery, options, [
    new EqualsOperation(nestedQuery, owneryQuery, options),
  ]);
};

export const createQueryOperation = <TItem, TSchema = TItem>(
  query: Query<TSchema>,
  owneryQuery: unknown = null,
  { compare, operations }: Partial<Options> = {},
): QueryOperation<TItem> => {
  const options: Options = {
    compare: compare || equals,
    operations: Object.assign({}, operations || {}),
  };

  const [selfOperations, nestedOperations] = createQueryOperations(
    query,
    null,
    options,
  );

  const ops: Operation<unknown>[] = [];

  if (selfOperations.length) {
    ops.push(
      new NestedOperation([], query, owneryQuery, options, selfOperations),
    );
  }

  ops.push(...nestedOperations);

  if (ops.length === 1) {
    return ops[0] as QueryOperation<TItem>;
  }
  return new QueryOperation<TItem>(query, owneryQuery, options, ops);
};

const createQueryOperations = (
  query: unknown,
  parentKey: string | null,
  options: Options,
): [Operation<unknown>[], NestedOperation[]] => {
  const selfOperations: Operation<unknown>[] = [];
  const nestedOperations: NestedOperation[] = [];
  if (!isVanillaObject(query)) {
    selfOperations.push(new EqualsOperation(query, query, options));
    return [selfOperations, nestedOperations];
  }
  const queryObj = query as Record<string, unknown>;
  for (const key in queryObj) {
    if (Object.prototype.hasOwnProperty.call(options.operations, key)) {
      const op = createNamedOperation(key, queryObj[key], queryObj, options);

      if (op) {
        if (!op.propop && parentKey && !options.operations[parentKey]) {
          throw new Error(
            `Malformed query. ${key} cannot be matched against property.`,
          );
        }
      }

      // A null op may just be a flag for another operation (like $options).
      if (op != null) {
        selfOperations.push(op);
      }
    } else if (key.charAt(0) === "$") {
      throwUnsupportedOperation(key);
    } else {
      nestedOperations.push(
        createNestedOperation(
          key.split("."),
          queryObj[key],
          key,
          queryObj,
          options,
        ),
      );
    }
  }

  return [selfOperations, nestedOperations];
};

export const createOperationTester =
  <TItem>(operation: Operation<TItem>) =>
  (item: TItem, key?: Key, owner?: unknown): boolean => {
    operation.reset();
    operation.next(item, key, owner);
    return operation.keep;
  };

export const createQueryTester = <TItem, TSchema = TItem>(
  query: Query<TSchema>,
  options: Partial<Options> = {},
): (item: TItem, key?: Key, owner?: unknown) => boolean => {
  return createOperationTester(
    createQueryOperation<TItem, TSchema>(query, null, options),
  );
};

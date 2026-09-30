// Vendored from sift.js (https://github.com/crcn/sift.js) — MIT licensed.
// `$where` operator removed (security: arbitrary code execution).

import {
  BaseOperation,
  containsOperation,
  createQueryOperation,
  createTester,
  EqualsOperation,
  NamedGroupOperation,
  numericalOperation,
  type Operation,
  type Options,
  type Query,
  type QueryOperation,
  type Tester,
} from "./core.ts";
import { comparable, isArray, type Key } from "./utils.ts";

class $Ne extends BaseOperation<unknown> {
  readonly propop = true;
  // `declare` so no runtime initializer clobbers the value set by init().
  declare private _test: Tester;
  override init(): void {
    this._test = createTester(this.params, this.options.compare);
  }
  override reset(): void {
    super.reset();
    this.keep = true;
  }
  next(item: unknown): void {
    if (this._test(item)) {
      this.done = true;
      this.keep = false;
    }
  }
}

class $ElemMatch extends BaseOperation<Query<unknown>> {
  readonly propop = true;
  declare private _queryOperation: QueryOperation<unknown>;
  override init(): void {
    if (!this.params || typeof this.params !== "object") {
      throw new Error(`Malformed query. $elemMatch must by an object.`);
    }
    this._queryOperation = createQueryOperation(
      this.params,
      this.owneryQuery,
      this.options,
    );
  }
  override reset(): void {
    super.reset();
    this._queryOperation.reset();
  }
  next(item: unknown): void {
    if (isArray(item)) {
      for (let i = 0, { length } = item; i < length; i++) {
        // Reset between elements: a passing element must satisfy ALL child ops on its own.
        this._queryOperation.reset();

        const child = item[i];
        this._queryOperation.next(child, i, item, false);
        this.keep = this.keep || this._queryOperation.keep;
      }
      this.done = true;
    } else {
      this.done = false;
      this.keep = false;
    }
  }
}

class $Not extends BaseOperation<Query<unknown>> {
  readonly propop = true;
  declare private _queryOperation: QueryOperation<unknown>;
  override init(): void {
    this._queryOperation = createQueryOperation(
      this.params,
      this.owneryQuery,
      this.options,
    );
  }
  override reset(): void {
    super.reset();
    this._queryOperation.reset();
  }
  next(item: unknown, key?: Key, owner?: unknown, root?: boolean): void {
    this._queryOperation.next(item, key, owner, root);
    this.done = this._queryOperation.done;
    this.keep = !this._queryOperation.keep;
  }
}

export class $Size extends BaseOperation<number> {
  readonly propop = true;
  next(item: unknown): void {
    if (isArray(item) && item.length === this.params) {
      this.done = true;
      this.keep = true;
    }
  }
}

const assertGroupNotEmpty = (values: unknown[]): void => {
  if (values.length === 0) {
    throw new Error(`$and/$or/$nor must be a nonempty array`);
  }
};

class $Or extends BaseOperation<Query<unknown>[]> {
  readonly propop = false;
  declare private _ops: Operation<unknown>[];
  override init(): void {
    assertGroupNotEmpty(this.params);
    this._ops = this.params.map((op) =>
      createQueryOperation(op, null, this.options),
    );
  }
  override reset(): void {
    this.done = false;
    this.keep = false;
    for (let i = 0, { length } = this._ops; i < length; i++) {
      this._ops[i].reset();
    }
  }
  next(item: unknown, key?: Key, owner?: unknown): void {
    let done = false;
    let success = false;
    for (let i = 0, { length } = this._ops; i < length; i++) {
      const op = this._ops[i];
      op.next(item, key, owner);
      if (op.keep) {
        done = true;
        success = op.keep;
        break;
      }
    }

    this.keep = success;
    this.done = done;
  }
}

class $Nor extends $Or {
  override readonly propop = false;
  override next(item: unknown, key?: Key, owner?: unknown): void {
    super.next(item, key, owner);
    this.keep = !this.keep;
  }
}

class $In extends BaseOperation<unknown> {
  readonly propop = true;
  declare private _testers: Tester[];
  override init(): void {
    const params = Array.isArray(this.params) ? this.params : [this.params];
    this._testers = params.map((value: unknown) => {
      if (containsOperation(value, this.options)) {
        throw new Error(
          `cannot nest $ under ${(this.name ?? "").toLowerCase()}`,
        );
      }
      return createTester(value, this.options.compare);
    });
  }
  next(item: unknown, _key?: Key, _owner?: unknown): void {
    let done = false;
    let success = false;
    for (let i = 0, { length } = this._testers; i < length; i++) {
      const test = this._testers[i];
      if (test(item)) {
        done = true;
        success = true;
        break;
      }
    }

    this.keep = success;
    this.done = done;
  }
}

class $Nin extends BaseOperation<unknown> {
  readonly propop = true;
  private _in: $In;
  constructor(
    params: unknown,
    ownerQuery: unknown,
    options: Options,
    name: string,
  ) {
    super(params, ownerQuery, options, name);
    this._in = new $In(params, ownerQuery, options, name);
  }
  next(item: unknown, key?: Key, owner?: unknown, root?: boolean): void {
    this._in.next(item, key, owner);

    if (isArray(owner) && !root) {
      if (this._in.keep) {
        this.keep = false;
        this.done = true;
      } else if (key == owner.length - 1) {
        this.keep = true;
        this.done = true;
      }
    } else {
      this.keep = !this._in.keep;
      this.done = true;
    }
  }
  override reset(): void {
    super.reset();
    this._in.reset();
  }
}

class $Exists extends BaseOperation<boolean> {
  readonly propop = true;
  next(
    _item: unknown,
    key?: Key,
    owner?: unknown,
    _root?: boolean,
    leaf?: boolean,
  ): void {
    if (!leaf) {
      this.done = true;
      this.keep = !this.params;
    } else if (
      owner != null &&
      Object.prototype.hasOwnProperty.call(owner, key as PropertyKey) ===
        this.params
    ) {
      this.done = true;
      this.keep = true;
    }
  }
}

class $And extends NamedGroupOperation {
  readonly propop = false;
  constructor(
    params: Query<unknown>[],
    owneryQuery: Query<unknown>,
    options: Options,
    name: string,
  ) {
    super(
      params,
      owneryQuery,
      options,
      params.map((query) => createQueryOperation(query, owneryQuery, options)),
      name,
    );

    assertGroupNotEmpty(params);
  }
  next(item: unknown, key?: Key, owner?: unknown, root?: boolean): void {
    this.childrenNext(item, key, owner, root ?? false);
  }
}

class $All extends NamedGroupOperation {
  readonly propop = true;
  constructor(
    params: Query<unknown>[],
    owneryQuery: Query<unknown>,
    options: Options,
    name: string,
  ) {
    super(
      params,
      owneryQuery,
      options,
      params.map((query) => createQueryOperation(query, owneryQuery, options)),
      name,
    );
  }
  next(item: unknown, key?: Key, owner?: unknown, root?: boolean): void {
    this.childrenNext(item, key, owner, root ?? false);
  }
}

export const $eq = (
  params: unknown,
  owneryQuery: Query<unknown>,
  options: Options,
): EqualsOperation<unknown> =>
  new EqualsOperation(params, owneryQuery, options);

export const $ne = (
  params: unknown,
  owneryQuery: Query<unknown>,
  options: Options,
  name: string,
): $Ne => new $Ne(params, owneryQuery, options, name);

export const $or = (
  params: Query<unknown>[],
  owneryQuery: Query<unknown>,
  options: Options,
  name: string,
): $Or => new $Or(params, owneryQuery, options, name);

export const $nor = (
  params: Query<unknown>[],
  owneryQuery: Query<unknown>,
  options: Options,
  name: string,
): $Nor => new $Nor(params, owneryQuery, options, name);

export const $elemMatch = (
  params: unknown,
  owneryQuery: Query<unknown>,
  options: Options,
  name: string,
): $ElemMatch =>
  new $ElemMatch(params as Query<unknown>, owneryQuery, options, name);

export const $nin = (
  params: unknown,
  owneryQuery: Query<unknown>,
  options: Options,
  name: string,
): $Nin => new $Nin(params, owneryQuery, options, name);

export const $in = (
  params: unknown,
  owneryQuery: Query<unknown>,
  options: Options,
  name: string,
): $In => new $In(params, owneryQuery, options, name);

export const $lt = numericalOperation(
  (params) => (b) => b != null && (b as number) < (params as number),
);
export const $lte = numericalOperation(
  (params) => (b) =>
    b === params || (b != null && (b as number) <= (params as number)),
);
export const $gt = numericalOperation(
  (params) => (b) => b != null && (b as number) > (params as number),
);
export const $gte = numericalOperation(
  (params) => (b) =>
    b === params || (b != null && (b as number) >= (params as number)),
);

export const $mod = (
  modParams: number[],
  owneryQuery: Query<unknown>,
  options: Options,
): EqualsOperation<unknown> => {
  const [mod, equalsValue] = modParams;
  return new EqualsOperation(
    // EqualsOperation accepts a Tester; cast retains that contract.
    ((b: unknown) =>
      (comparable(b) as number) % mod === equalsValue) as unknown,
    owneryQuery,
    options,
  );
};

export const $exists = (
  params: boolean,
  owneryQuery: Query<unknown>,
  options: Options,
  name: string,
): $Exists => new $Exists(params, owneryQuery, options, name);

export const $regex = (
  pattern: string,
  owneryQuery: Query<unknown>,
  options: Options,
): EqualsOperation<RegExp> =>
  new EqualsOperation(
    new RegExp(pattern, (owneryQuery as { $options?: string }).$options),
    owneryQuery,
    options,
  );

export const $not = (
  params: unknown,
  owneryQuery: Query<unknown>,
  options: Options,
  name: string,
): $Not => new $Not(params as Query<unknown>, owneryQuery, options, name);

const typeAliases: Record<string, (v: unknown) => boolean> = {
  number: (v) => typeof v === "number",
  string: (v) => typeof v === "string",
  bool: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  null: (v) => v === null,
  timestamp: (v) => v instanceof Date,
};

export const $type = (
  // deno-lint-ignore ban-types
  clazz: Function | string,
  owneryQuery: Query<unknown>,
  options: Options,
): EqualsOperation<unknown> =>
  new EqualsOperation(
    // EqualsOperation accepts a Tester; cast retains that contract.
    ((b: unknown) => {
      if (typeof clazz === "string") {
        const alias = typeAliases[clazz];
        if (!alias) {
          throw new Error(`Type alias does not exist`);
        }
        return alias(b);
      }
      return b != null
        ? b instanceof (clazz as new (...args: unknown[]) => unknown) ||
            (b as { constructor?: unknown }).constructor === clazz
        : false;
    }) as unknown,
    owneryQuery,
    options,
  );

export const $and = (
  params: Query<unknown>[],
  ownerQuery: Query<unknown>,
  options: Options,
  name: string,
): $And => new $And(params, ownerQuery, options, name);

export const $all = (
  params: Query<unknown>[],
  ownerQuery: Query<unknown>,
  options: Options,
  name: string,
): $All => new $All(params, ownerQuery, options, name);

export const $size = (
  params: number,
  ownerQuery: Query<unknown>,
  options: Options,
): $Size => new $Size(params, ownerQuery, options, "$size");

export const $options = (): null => null;

// $where intentionally removed from this fork.
// Upstream evaluated arbitrary JS via `new Function()`. Forbidden in a permission
// system whose grants come from the DB — code-execution risk.
// `validateSpec()` in mongo-query.ts is the second barrier.

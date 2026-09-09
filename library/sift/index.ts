// Vendored from sift.js (https://github.com/crcn/sift.js) — MIT licensed.
// `$where` operator removed (security: arbitrary code execution).

import * as defaultOperations from "./operations.ts";
import {
  createEqualsOperation,
  createOperationTester,
  createQueryOperation,
  createQueryTester,
  EqualsOperation,
  type Options,
} from "./core.ts";
import type {
  ArrayValueQuery,
  BasicValueQuery,
  NestedQuery,
  Query,
  QueryOperators,
  ShapeQuery,
  ValueQuery,
} from "./core.ts";
import type { Key } from "./utils.ts";

const createDefaultQueryOperation = <TItem, TSchema extends TItem = TItem>(
  query: Query<TSchema>,
  ownerQuery: unknown,
  { compare, operations }: Partial<Options> = {},
) => {
  return createQueryOperation<TItem, TSchema>(query, ownerQuery, {
    compare,
    operations: Object.assign({}, defaultOperations, operations || {}),
  });
};

const createDefaultQueryTester = <TItem, TSchema extends TItem = TItem>(
  query: Query<TSchema>,
  options: Partial<Options> = {},
): ((item: TItem, key?: Key, owner?: unknown) => boolean) => {
  const op = createDefaultQueryOperation<TItem, TSchema>(query, null, options);
  return createOperationTester(op);
};

export {
  createDefaultQueryOperation,
  createEqualsOperation,
  createOperationTester,
  createQueryOperation,
  createQueryTester,
  EqualsOperation,
};
export type {
  ArrayValueQuery,
  BasicValueQuery,
  NestedQuery,
  Query,
  QueryOperators,
  ShapeQuery,
  ValueQuery,
};
export * from "./operations.ts";

export default createDefaultQueryTester;

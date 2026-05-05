// Vendored from sift.js (https://github.com/crcn/sift.js) — MIT licensed.
// `$where` operator removed (security: arbitrary code execution).

export type Key = string | number;
export type Comparator = (a: unknown, b: unknown) => boolean;

export const typeChecker = <TType>(type: string) => {
  const typeString = "[object " + type + "]";
  return function (value: unknown): value is TType {
    return getClassName(value) === typeString;
  };
};

const getClassName = (value: unknown): string =>
  Object.prototype.toString.call(value);

export const comparable = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.getTime();
  } else if (isArray(value)) {
    return value.map(comparable);
  } else if (
    value != null &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    return (value as { toJSON: () => unknown }).toJSON();
  }

  return value;
};

export const coercePotentiallyNull = (value: unknown): unknown =>
  value == null ? null : value;

export const isArray = typeChecker<unknown[]>("Array");
// deno-lint-ignore ban-types
export const isObject = typeChecker<Object>("Object");
// deno-lint-ignore ban-types
export const isFunction = typeChecker<Function>("Function");

export const isProperty = (item: object, key: PropertyKey): boolean => {
  return Object.prototype.hasOwnProperty.call(item, key) &&
    !isFunction((item as Record<PropertyKey, unknown>)[key as string]);
};

export const isVanillaObject = (value: unknown): boolean => {
  if (value == null || typeof value !== "object") return false;
  const ctor = (value as { constructor?: unknown }).constructor as
    | { toString(): string }
    | undefined;
  if (!ctor) return false;
  return (
    (ctor === Object ||
      ctor === Array ||
      ctor.toString() === "function Object() { [native code] }" ||
      ctor.toString() === "function Array() { [native code] }") &&
    !(value as { toJSON?: unknown }).toJSON
  );
};

export const equals = (a: unknown, b: unknown): boolean => {
  if (a == null && a == b) {
    return true;
  }
  if (a === b) {
    return true;
  }

  if (Object.prototype.toString.call(a) !== Object.prototype.toString.call(b)) {
    return false;
  }

  if (isArray(a)) {
    const arrB = b as unknown[];
    if (a.length !== arrB.length) {
      return false;
    }
    for (let i = 0, { length } = a; i < length; i++) {
      if (!equals(a[i], arrB[i])) return false;
    }
    return true;
  } else if (isObject(a)) {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    if (Object.keys(objA).length !== Object.keys(objB).length) {
      return false;
    }
    for (const key in objA) {
      if (!equals(objA[key], objB[key])) return false;
    }
    return true;
  }
  return false;
};

export interface RefConvention {
  typeOf(ref: unknown): string | undefined;
  isWildcard(ref: unknown): boolean;
  wildcard(type: string): string;
  isOfType(ref: unknown, type: string): boolean;
  covers(held: unknown, asked: unknown): boolean;
  overlaps(a: unknown, b: unknown): boolean;
}

const ANY = "*";
const SEPARATOR = ":";

function prefixOf(ref: string): string | null {
  return ref.endsWith(ANY) ? ref.slice(0, -1) : null;
}

export const typedRefs: RefConvention = {
  typeOf(ref) {
    if (typeof ref !== "string") return undefined;
    const at = ref.indexOf(SEPARATOR);
    return at > 0 ? ref.slice(0, at) : undefined;
  },

  isWildcard(ref) {
    return typeof ref === "string" && ref.endsWith(ANY);
  },

  wildcard(type) {
    return `${type}${SEPARATOR}${ANY}`;
  },

  isOfType(ref, type) {
    return (
      ref === ANY ||
      (typeof ref === "string" && ref.startsWith(`${type}${SEPARATOR}`))
    );
  },

  covers(held, asked) {
    if (held === ANY) return true;
    if (typeof held !== "string") return held === asked;
    const prefix = prefixOf(held);
    if (prefix === null) return held === asked;
    return typeof asked === "string" && asked.startsWith(prefix);
  },

  overlaps(a, b) {
    if (a === ANY || b === ANY) return true;
    if (typeof a !== "string" || typeof b !== "string") return a === b;
    const left = prefixOf(a);
    const right = prefixOf(b);
    if (left !== null && right !== null) {
      return left.startsWith(right) || right.startsWith(left);
    }
    if (left !== null) return b.startsWith(left);
    if (right !== null) return a.startsWith(right);
    return a === b;
  },
};

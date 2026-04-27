import type { TargetPath } from "./types.ts";

/**
 * Match a requested target path against a pattern path.
 *
 * Targets are always arrays of segments. Each segment is matched against the
 * corresponding pattern segment.
 *
 * Segment-level wildcards:
 * - `"*"` matches any value in that segment.
 * - `"prefix:*"` matches any string segment that starts with `prefix:`.
 *
 * For "any target" semantics, leave the permission's `target` undefined at the
 * call site rather than passing a wildcard here.
 *
 * @example
 * matchPath(["article:123"], ["article:*"]) // true
 * matchPath(["article:123", "comment:4"], ["article:*", "*"]) // true
 * matchPath(["a"], ["a", "b"]) // false (different arity)
 */
export function matchPath(requested: TargetPath, pattern: TargetPath): boolean {
  if (requested.length !== pattern.length) return false;
  return requested.every((segment, i) => matchSegment(segment, pattern[i]));
}

function matchSegment(requested: unknown, pattern: unknown): boolean {
  // Full-segment wildcard
  if (pattern === "*") return true;

  // Prefix wildcard on string segments: "article:*"
  if (typeof pattern === "string" && typeof requested === "string" && pattern.endsWith("*")) {
    return requested.startsWith(pattern.slice(0, -1));
  }

  // Nested array segments (rare, but supported)
  if (Array.isArray(pattern) && Array.isArray(requested)) {
    return matchPath(requested, pattern);
  }

  return requested === pattern;
}

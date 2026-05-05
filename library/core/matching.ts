type TargetPath = readonly unknown[];

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

/**
 * Symmetric "overlap" match: returns true if there's any concrete value that
 * could satisfy both `a` and `b` simultaneously (treating both as patterns).
 *
 * Used by broad-match checks where the request target itself may carry
 * wildcards — e.g. "do I have any badge access in this expo?" with the request
 * `["expo:1", "*"]` overlapping a grant on `["expo:1", "badge:*"]`.
 */
export function overlapPath(a: TargetPath, b: TargetPath): boolean {
  if (a.length !== b.length) return false;
  return a.every((segment, i) => overlapSegment(segment, b[i]));
}

function overlapSegment(a: unknown, b: unknown): boolean {
  // Full wildcards on either side → overlap
  if (a === "*" || b === "*") return true;

  if (typeof a === "string" && typeof b === "string") {
    const aPrefix = a.endsWith("*") ? a.slice(0, -1) : null;
    const bPrefix = b.endsWith("*") ? b.slice(0, -1) : null;

    if (aPrefix !== null && bPrefix !== null) {
      // Two prefix wildcards: overlap iff one prefix extends the other
      return aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix);
    }
    if (aPrefix !== null) return b.startsWith(aPrefix);
    if (bPrefix !== null) return a.startsWith(bPrefix);
  }

  // Nested arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    return overlapPath(a, b);
  }

  return a === b;
}

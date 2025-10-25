/**
 * Match a requested path against a pattern with wildcard support
 *
 * @example
 * matchPath("article:123", "*") // true
 * matchPath("article:123", "article:*") // true
 * matchPath(["article:123", "comment:456"], ["article:*", "*"]) // true
 */
export function matchPath(requested: any, pattern: any): boolean {
  // Wildcard complet
  if (pattern === "*") return true;

  // Même type primitif
  if (typeof requested !== 'object' && typeof pattern !== 'object') {
    // Pattern avec wildcard: "article:*" matches "article:123"
    if (typeof pattern === 'string' && pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return typeof requested === 'string' && requested.startsWith(prefix);
    }
    return requested === pattern;
  }

  // Matching de tableaux (pour les paths composés)
  if (Array.isArray(requested) && Array.isArray(pattern)) {
    if (requested.length !== pattern.length) return false;

    return requested.every((segment, i) =>
      matchPath(segment, pattern[i])
    );
  }

  // Types incompatibles
  return false;
}

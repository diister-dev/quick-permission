import type { PermissionProvider, Subject, TargetPath } from "../core/types.ts";

/**
 * Creates a provider that grants permissions based on ownership.
 *
 * @param keys Permission keys to grant
 * @param targetPattern Target path pattern (always an array). Use `["article:*"]`
 *                      for prefix wildcards, `["*"]` for any single-segment target.
 * @param additionalMetadata Extra fields merged into each grant (e.g. filter spec).
 *
 * @example
 * ownerProvider(["article.read", "article.update"], ["article:*"])
 * // Grants article.read and article.update on any article where owner matches subject.id
 */
export function ownerProvider(
  keys: string[],
  targetPattern: TargetPath,
  additionalMetadata?: Record<string, unknown>,
): PermissionProvider {
  return {
    provide: (subject: Subject) => {
      return keys.map((k) => ({
        ...additionalMetadata,
        subject,
        key: k,
        target: targetPattern,
        with: {
          owner: subject.id,
        },
      }));
    },
  };
}

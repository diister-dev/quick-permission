import type { PermissionProvider, Subject } from "../core/types.ts";

/**
 * Creates a provider that grants permissions based on ownership
 *
 * @param keys Permission keys to grant
 * @param targetPattern Target pattern (can include wildcards)
 * @returns A permission provider
 *
 * @example
 * ownerProvider(["article.read", "article.update"], "article:*")
 * // Grants article.read and article.update on article:* where owner matches subject.id
 */
export function ownerProvider(
  keys: string[],
  targetPattern: any,
  additionalMetadata?: Record<string, any>
): PermissionProvider {
  return {
    provide: async (subject: Subject) => {
      return keys.map(k => ({
        subject,
        key: k,
        target: targetPattern,
        with: {
          owner: subject.id,
        },
        ...additionalMetadata,
      }));
    }
  };
}

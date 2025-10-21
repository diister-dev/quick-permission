import type { PermissionProvider, Subject, PermissionWithMetadata } from "../core/types.ts";

/**
 * Creates a direct provider from a static list of permissions
 *
 * @param source Array of permission entries
 * @returns A permission provider
 *
 * @example
 * directProvider([
 *   { subject: user1, key: "article.create" },
 *   { subject: user2, key: "article.read", target: "article:1" }
 * ])
 */
export function directProvider(source: PermissionWithMetadata[]): PermissionProvider {
  return {
    provide: async (subject: Subject, _key: string, _target?: any) => {
      return source.filter((entry) => entry.subject.id === subject.id);
    }
  };
}

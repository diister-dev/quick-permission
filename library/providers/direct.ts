import type { PermissionProvider, Subject, PermissionStateBase } from "../core/types.ts";

/**
 * Creates a direct provider from a static list of permissions.
 *
 * @example
 * directProvider([
 *   { subject: user1, key: "article.create" },
 *   { subject: user2, key: "article.read", target: ["article:1"] }
 * ])
 */
export function directProvider(source: PermissionStateBase[]): PermissionProvider {
  return {
    provide: (subject: Subject) => {
      return source.filter((entry) => entry.subject.id === subject.id);
    },
  };
}

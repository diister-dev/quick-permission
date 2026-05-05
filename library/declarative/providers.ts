import type { Grant, Provider, Subject } from "./system.ts";

export type DirectGrant = Grant & {
  subject: { id: string };
};

export function directProvider(source: readonly DirectGrant[]): Provider {
  return (subject: Subject) =>
    source
      .filter((entry) => entry.subject.id === subject.id)
      .map(({ subject: _s, ...rest }) => rest);
}

export function ownerProvider(opts: {
  keys: readonly string[];
  target: readonly unknown[];
  /** Segment name under which the owner constraint is checked (matches a `match(seg, ...)` rule). */
  segment: string;
  additionalGrantFields?: Partial<Grant>;
}): Provider {
  const { keys, target, segment, additionalGrantFields } = opts;
  return (subject: Subject) =>
    keys.map((key) => ({
      ...additionalGrantFields,
      key,
      target,
      with: {
        ...(additionalGrantFields?.with ?? {}),
        [segment]: { owner: subject.id },
      },
    }));
}

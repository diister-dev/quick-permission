import { isRecord } from "./condition.ts";

export type FieldSelection = {
  readonly [field: string]: true | FieldSelection;
};

export type Visible = FieldSelection | "all";

type MutableSelection = { [field: string]: true | MutableSelection };

export function fieldsProblem(value: unknown, path = "fields"): string | null {
  if (!isRecord(value)) return `${path} must be a selection of fields`;
  for (const [field, nested] of Object.entries(value)) {
    if (nested === true) continue;
    const at = `${path}.${field}`;
    if (!isRecord(nested)) return `${at} must be true or a nested selection`;
    const problem = fieldsProblem(nested, at);
    if (problem !== null) return problem;
  }
  return null;
}

export function selectFields(
  source: unknown,
  selection: FieldSelection,
): unknown {
  if (!isRecord(source)) return source;
  const out: Record<string, unknown> = {};
  for (const [field, nested] of Object.entries(selection)) {
    if (!(field in source)) continue;
    const value = source[field];
    if (nested === true) {
      out[field] = value;
    } else if (Array.isArray(value)) {
      out[field] = value.map((item) =>
        isRecord(item) ? selectFields(item, nested) : null,
      );
    } else if (isRecord(value)) {
      out[field] = selectFields(value, nested);
    }
  }
  return out;
}

function merge(target: MutableSelection, addition: FieldSelection): void {
  for (const [field, nested] of Object.entries(addition)) {
    const current = target[field];
    if (current === true) continue;
    if (nested === true) {
      target[field] = true;
      continue;
    }
    const branch = current ?? {};
    target[field] = branch;
    merge(branch, nested);
  }
}

export function widen(
  current: Visible | undefined,
  addition: Visible,
): Visible {
  if (current === "all" || addition === "all") return "all";
  const merged: MutableSelection = {};
  if (current !== undefined) merge(merged, current);
  merge(merged, addition);
  return merged;
}

export function fieldsWithin(
  asked: FieldSelection,
  allowed: FieldSelection,
): boolean {
  return Object.entries(asked).every(([field, nested]) => {
    const permitted = allowed[field];
    if (permitted === true) return true;
    if (permitted === undefined || nested === true) return false;
    return fieldsWithin(nested, permitted);
  });
}

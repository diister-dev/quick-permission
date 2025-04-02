import type { Schema } from "../../types/schema.ts";

export type TargetState = {
  target: string[];
};

export type TargetRequest = {
  from: string;
  target: string;
};

export function target(): Schema<TargetState, TargetRequest> {
  return {
    name: "target",
    state(obj: unknown): obj is TargetState {
      if (typeof obj !== "object" || !obj) return false;
      const target = (obj as TargetState).target;
      if (!Array.isArray(target)) return false;
      return true;
    },
    request(obj: unknown): obj is TargetRequest {
      if (typeof obj !== "object" || !obj) return false;
      if (typeof (obj as TargetRequest).from !== "string") return false;
      if (typeof (obj as TargetRequest).target !== "string") return false;
      return true;
    },
    defaultState(): TargetState {
      return {
        target: [],
      };
    },
  };
}

import type { Schema } from "../../types/schema.ts";

export type TimeState = {
  dateStart?: Date;
  dateEnd?: Date;
};

export type TimeRequest = {
  date?: Date;
};

export function time(): Schema<TimeState, TimeRequest> {
  return {
    name: "time",
    state(obj: unknown): obj is TimeState {
      if (typeof obj !== "object" || !obj) return false;
      const dateStart = (obj as TimeState).dateStart;
      const dateEnd = (obj as TimeState).dateEnd;
      if (dateStart !== undefined && !(dateStart instanceof Date)) return false;
      if (dateEnd !== undefined && !(dateEnd instanceof Date)) return false;
      return true;
    },
    request(obj: unknown): obj is TimeRequest {
      if (typeof obj !== "object" || !obj) return false;
      const date = (obj as TimeRequest).date;
      if (date !== undefined && !(date instanceof Date)) return false;
      return true;
    },
    defaultState(): TimeState {
      // By default, no time limits are defined
      return {};
    },
  };
}

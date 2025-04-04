import { Schema, SchemasRequests, SchemasStates } from "./schema.ts";

export type Rule<
  S extends Schema<any, any>[] = any,
> = {
  name: string;
  schemas: S;
  check: (
    state: SchemasStates<S>,
    request: SchemasRequests<S>,
  ) => boolean | undefined;
};

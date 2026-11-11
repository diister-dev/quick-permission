import type { Condition } from "./condition.ts";
import type { MaybePromise } from "./engine/loader.ts";
import type { EntityModel, Subject } from "./engine/model.ts";
import type { FieldSelection } from "./fields.ts";

export type { Condition, FieldSelection };

export type Grant = {
  readonly id?: string;
  readonly key: string;
  readonly on?: readonly string[];
  readonly where?: Condition;
  readonly parents?: Readonly<Record<string, Condition>>;
  readonly related?: Readonly<Record<string, Condition>>;
  readonly fields?: FieldSelection;
  readonly when?: readonly string[];
  readonly input?: Condition;
  readonly payload?: unknown;
};

export type ProviderAccess = {
  read(entity: EntityModel): Promise<unknown>;
};

export type ProviderFetch = (
  subject: Subject,
  key: string,
  ids: readonly string[] | undefined,
  access: ProviderAccess,
) => MaybePromise<readonly Grant[]>;

export type ProviderObject = {
  readonly name?: string;
  readonly keys?: readonly string[];
  readonly matches?: (key: string) => boolean;
  readonly targetType?: string | readonly string[];
  readonly cacheKey?: (
    subject: Subject,
    key: string,
    ids: readonly string[] | undefined,
  ) => string | undefined;
  readonly fetch: ProviderFetch;
};

export type GrantProvider = ProviderFetch | ProviderObject;

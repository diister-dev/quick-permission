import type { Compiled, Expanded, Rejection, ValidGrant } from "../compile.ts";
import type {
  Grant,
  GrantProvider,
  ProviderAccess,
  ProviderObject,
} from "../grant.ts";
import type { Subject } from "./model.ts";

export type ProviderFetchEvent = {
  readonly provider: string;
  readonly subject: Subject;
  readonly key: string;
  readonly ids: readonly string[] | undefined;
  readonly durationMs: number;
  readonly grantCount: number;
};

export type PermissionErrorEvent =
  | {
      readonly source: "provider";
      readonly provider: string;
      readonly subject: Subject;
      readonly key: string;
      readonly ids: readonly string[] | undefined;
      readonly error: unknown;
    }
  | {
      readonly source: "rule";
      readonly grantId: string | undefined;
      readonly subject: Subject;
      readonly key: string;
      readonly ids: readonly string[] | undefined;
      readonly error: unknown;
    };

export type Hooks = {
  readonly onProviderFetch?: (event: ProviderFetchEvent) => void;
  readonly onError?: (event: PermissionErrorEvent) => void;
  readonly onGrantRejected?: (event: Rejection) => void;
};

export type Outcome = {
  readonly provider: string;
  readonly grants: readonly Grant[];
  readonly failure?: string;
};

export type ProviderCache = Map<GrantProvider, Map<string, Promise<Outcome>>>;

export interface Providers {
  consult(
    cache: ProviderCache,
    subject: Subject,
    key: string,
    ids: readonly string[] | undefined,
    access: ProviderAccess,
  ): Promise<readonly Outcome[]>;
  expansionFor(outcome: Outcome, key: string): readonly Expanded[];
  dump(cache: ProviderCache): Promise<readonly ValidGrant[]>;
}

const REPORTED_LIMIT = 2000;

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function callHook(invoke: () => void): void {
  try {
    invoke();
  } catch {
    return;
  }
}

function matchesPattern(key: string, pattern: string): boolean {
  if (pattern === key) return true;
  return pattern.endsWith("*") && key.startsWith(pattern.slice(0, -1));
}

function declaresKey(provider: ProviderObject, key: string): boolean {
  return (
    provider.keys?.some((pattern) => matchesPattern(key, pattern)) === true ||
    provider.matches?.(key) === true
  );
}

export function createProviders(
  providers: readonly GrantProvider[],
  compiled: Compiled,
  hooks: Hooks,
): Providers {
  const { refs } = compiled;
  const names = new Map<GrantProvider, string>(
    providers.map((provider, index) => [
      provider,
      (typeof provider === "object" && provider.name) || `provider#${index}`,
    ]),
  );
  const handled = new Map<ProviderObject, Map<string, boolean>>();
  const reported = new Set<string>();
  const admittedBy = new WeakMap<Outcome, readonly ValidGrant[]>();
  const expansions = new WeakMap<Outcome, Map<string, readonly Expanded[]>>();

  function reject(rejection: Rejection): void {
    const signature = `${rejection.provider ?? ""}|${rejection.via ?? ""}|${rejection.reason}|${JSON.stringify(rejection.grant)}`;
    if (reported.has(signature)) return;
    if (reported.size >= REPORTED_LIMIT) reported.clear();
    reported.add(signature);
    callHook(() => hooks.onGrantRejected?.(rejection));
  }

  function handlesKey(provider: ProviderObject, key: string): boolean {
    if (!provider.keys && !provider.matches) return true;
    let memo = handled.get(provider);
    if (!memo) {
      memo = new Map();
      handled.set(provider, memo);
    }
    const known = memo.get(key);
    if (known !== undefined) return known;
    const answer =
      declaresKey(provider, key) ||
      compiled
        .ancestors(key)
        .some((ancestor) => declaresKey(provider, ancestor));
    memo.set(key, answer);
    return answer;
  }

  function handlesTarget(
    provider: ProviderObject,
    ids: readonly string[] | undefined,
  ): boolean {
    if (provider.targetType === undefined) return true;
    const first = ids?.[0];
    if (first === undefined || refs.isWildcard(first)) return false;
    const type = refs.typeOf(first);
    if (type === undefined) return false;
    return typeof provider.targetType === "string"
      ? provider.targetType === type
      : provider.targetType.includes(type);
  }

  function failed(
    name: string,
    subject: Subject,
    key: string,
    ids: readonly string[] | undefined,
    error: unknown,
  ): Outcome {
    callHook(() =>
      hooks.onError?.({
        source: "provider",
        provider: name,
        subject,
        key,
        ids,
        error,
      }),
    );
    return {
      provider: name,
      grants: [],
      failure: `provider ${name} failed: ${describeError(error)}`,
    };
  }

  async function fetch(
    provider: GrantProvider,
    name: string,
    subject: Subject,
    key: string,
    ids: readonly string[] | undefined,
    access: ProviderAccess,
  ): Promise<Outcome> {
    const onFetch = hooks.onProviderFetch;
    const started = onFetch ? performance.now() : 0;
    let grants: readonly Grant[];
    try {
      grants =
        typeof provider === "function"
          ? await provider(subject, key, ids, access)
          : await provider.fetch(subject, key, ids, access);
    } catch (error) {
      return failed(name, subject, key, ids, error);
    }
    if (onFetch) {
      const durationMs = performance.now() - started;
      callHook(() =>
        onFetch({
          provider: name,
          subject,
          key,
          ids,
          durationMs,
          grantCount: grants.length,
        }),
      );
    }
    return { provider: name, grants };
  }

  function invoke(
    cache: ProviderCache,
    provider: GrantProvider,
    subject: Subject,
    key: string,
    ids: readonly string[] | undefined,
    access: ProviderAccess,
  ): Promise<Outcome> {
    const name = names.get(provider) ?? "provider";
    let cacheKey: string | undefined;
    try {
      cacheKey =
        typeof provider === "object"
          ? provider.cacheKey?.(subject, key, ids)
          : undefined;
    } catch (error) {
      return Promise.resolve(failed(name, subject, key, ids, error));
    }
    if (!cacheKey) return fetch(provider, name, subject, key, ids, access);
    let byKey = cache.get(provider);
    if (!byKey) {
      byKey = new Map();
      cache.set(provider, byKey);
    }
    const known = byKey.get(cacheKey);
    if (known) return known;
    const pending = fetch(provider, name, subject, key, ids, access);
    byKey.set(cacheKey, pending);
    return pending;
  }

  function admitted(outcome: Outcome): ValidGrant[] {
    const valid: ValidGrant[] = [];
    for (const grant of outcome.grants) {
      const admission = compiled.admit(grant);
      if (admission.ok) valid.push(admission.grant);
      else {
        reject({
          grant,
          reason: admission.problem,
          provider: outcome.provider,
        });
      }
    }
    return valid;
  }

  function validOf(outcome: Outcome): readonly ValidGrant[] {
    const known = admittedBy.get(outcome);
    if (known) return known;
    const grants = admitted(outcome);
    admittedBy.set(outcome, grants);
    return grants;
  }

  function reporting(outcome: Outcome): (rejection: Rejection) => void {
    return (rejection) => reject({ ...rejection, provider: outcome.provider });
  }

  return {
    consult(cache, subject, key, ids, access) {
      const consulted = providers.filter(
        (provider) =>
          typeof provider === "function" ||
          (handlesKey(provider, key) && handlesTarget(provider, ids)),
      );
      return Promise.all(
        consulted.map((provider) =>
          invoke(cache, provider, subject, key, ids, access),
        ),
      );
    },

    expansionFor(outcome, key) {
      let byKey = expansions.get(outcome);
      if (!byKey) {
        byKey = new Map();
        expansions.set(outcome, byKey);
      }
      const known = byKey.get(key);
      if (known) return known;
      const reaching = compiled
        .expand(validOf(outcome), reporting(outcome), compiled.leadsTo(key))
        .filter((entry) => entry.grant.key.key === key);
      byKey.set(key, reaching);
      return reaching;
    },

    async dump(cache) {
      const outcomes = await Promise.all(
        [...cache.values()].flatMap((byKey) => [...byKey.values()]),
      );
      return outcomes.flatMap((outcome) =>
        compiled
          .expand(validOf(outcome), reporting(outcome))
          .map((entry) => entry.grant),
      );
    },
  };
}

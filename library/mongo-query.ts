/**
 * Évaluateur d'expressions style MongoDB query basé sur `sift`.
 *
 * Sift supporte ~100% du Mongo query language en pur JS. On délègue
 * l'évaluation à sift mais on **valide la spec en amont** pour s'assurer
 * qu'aucun opérateur dangereux n'est utilisé (`$where`, `$function`, etc.
 * permettent de l'exécution de code arbitraire — interdits dans un grant
 * qui peut venir de la DB).
 *
 * Whitelist :
 *   - Comparaisons : `$eq`, `$ne`, `$in`, `$nin`, `$gt`, `$gte`, `$lt`, `$lte`
 *   - Existence    : `$exists`, `$type`
 *   - Logiques     : `$and`, `$or`, `$nor`, `$not`
 *   - String       : `$regex`, `$options`
 *   - Tableaux     : `$all`, `$elemMatch`, `$size`
 *
 * Interdit (pas dans la whitelist, throw au boot ou au check) :
 *   - `$where`, `$function`, `$expr`, `$jsonSchema`, `$accumulator`
 *
 * La même spec sert à :
 *  1. Évaluer en mémoire un document (per-doc check via sift)
 *  2. Filtrer une collection MongoDB en pushdown (la spec EST déjà du Mongo)
 */

import sift from "./sift/index.ts";

const ALLOWED_OPERATORS: ReadonlySet<string> = new Set([
  // Comparison
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  // Existence / type
  "$exists",
  "$type",
  // Logical
  "$and",
  "$or",
  "$nor",
  "$not",
  // String
  "$regex",
  "$options",
  // Array
  "$all",
  "$elemMatch",
  "$size",
]);

export type MongoSpec = Record<string, unknown>;

/**
 * Vérifie récursivement qu'aucun opérateur non-whitelisté n'est présent
 * dans la spec. Throw au premier opérateur interdit (`$where`, etc.).
 *
 * À appeler à la création du grant (validation côté API) ou au pire au
 * check time, pour empêcher l'exécution de code arbitraire.
 */
export function validateSpec(spec: unknown, path = "$"): void {
  inspectSpec(spec, path);
}

/** Validates like `validateSpec` and tells whether the spec survives a JSON round trip unchanged. */
function inspectSpec(spec: unknown, path: string): boolean {
  switch (typeof spec) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(spec) && !Object.is(spec, -0);
    case "object":
      break;
    default:
      return false;
  }
  if (spec === null) return true;
  let pure = true;
  if (Array.isArray(spec)) {
    for (const [i, item] of spec.entries()) {
      if (!inspectSpec(item, `${path}[${i}]`)) pure = false;
    }
    return pure;
  }
  const proto = Object.getPrototypeOf(spec);
  if (proto !== Object.prototype && proto !== null) pure = false;
  for (const [key, value] of Object.entries(spec as object)) {
    if (key.startsWith("$")) {
      if (!ALLOWED_OPERATORS.has(key)) {
        throw new Error(
          `Forbidden Mongo operator at ${path}: "${key}". ` +
            `Allowed: ${[...ALLOWED_OPERATORS].join(", ")}`,
        );
      }
    }
    if (!inspectSpec(value, `${path}.${key}`)) pure = false;
  }
  return pure;
}

type SpecTester = (doc: unknown) => boolean;

const COMPILED_LIMIT = 512;
const compiled = new Map<string, SpecTester>();

// deno-lint-ignore no-explicit-any
const compile = (spec: unknown): SpecTester => (sift as any)(spec);

/**
 * Validates then compiles. A JSON-only spec is cached by its serialized form
 * and compiled from a private copy, so mutating the caller's object later
 * never reaches the cached tester; any other spec is compiled afresh.
 */
export function compileSpec(spec: unknown): SpecTester {
  return prepareSpec(spec)();
}

/** Validates now and compiles on the first call, for callers that must not compile a spec they end up not evaluating. */
export function prepareSpec(spec: unknown): () => SpecTester {
  const pure = inspectSpec(spec, "$");
  let tester: SpecTester | undefined;
  return () => {
    tester ??= pure ? compileCached(spec) : compile(spec);
    return tester;
  };
}

function compileCached(spec: unknown): SpecTester {
  const key = JSON.stringify(spec);
  const known = compiled.get(key);
  if (known) return known;
  const tester = compile(JSON.parse(key));
  if (compiled.size >= COMPILED_LIMIT) {
    compiled.delete(compiled.keys().next().value as string);
  }
  compiled.set(key, tester);
  return tester;
}

/**
 * Évalue une spec contre un document. La spec est validée d'abord pour
 * rejeter tout opérateur non-whitelisté.
 */
export function evaluateSpec(spec: MongoSpec, doc: unknown): boolean {
  return compileSpec(spec)(doc);
}

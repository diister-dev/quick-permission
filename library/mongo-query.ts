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

import sift from './sift/index.ts';

const ALLOWED_OPERATORS: ReadonlySet<string> = new Set([
	// Comparison
	'$eq',
	'$ne',
	'$in',
	'$nin',
	'$gt',
	'$gte',
	'$lt',
	'$lte',
	// Existence / type
	'$exists',
	'$type',
	// Logical
	'$and',
	'$or',
	'$nor',
	'$not',
	// String
	'$regex',
	'$options',
	// Array
	'$all',
	'$elemMatch',
	'$size',
]);

export type MongoSpec = Record<string, unknown>;

/**
 * Vérifie récursivement qu'aucun opérateur non-whitelisté n'est présent
 * dans la spec. Throw au premier opérateur interdit (`$where`, etc.).
 *
 * À appeler à la création du grant (validation côté API) ou au pire au
 * check time, pour empêcher l'exécution de code arbitraire.
 */
export function validateSpec(spec: unknown, path = '$'): void {
	if (spec === null || typeof spec !== 'object') return;
	if (Array.isArray(spec)) {
		spec.forEach((item, i) => validateSpec(item, `${path}[${i}]`));
		return;
	}
	for (const [key, value] of Object.entries(spec as object)) {
		if (key.startsWith('$')) {
			if (!ALLOWED_OPERATORS.has(key)) {
				throw new Error(
					`Forbidden Mongo operator at ${path}: "${key}". ` +
						`Allowed: ${[...ALLOWED_OPERATORS].join(', ')}`,
				);
			}
		}
		validateSpec(value, `${path}.${key}`);
	}
}

/**
 * Évalue une spec contre un document. La spec est validée d'abord pour
 * rejeter tout opérateur non-whitelisté.
 */
export function evaluateSpec(spec: MongoSpec, doc: unknown): boolean {
	validateSpec(spec);
	// deno-lint-ignore no-explicit-any
	return (sift as any)(spec)(doc);
}

/**
 * Quick Permission - Rules Module
 *
 * This module exports built-in permission rule functions that can be used to validate
 * permission requests against permission states. Each rule evaluates a specific aspect
 * of permission and returns one of four possible validation result values.
 *
 * ## Available Rules
 *
 * - **allowOwner**: Grants permission when the requester is the resource owner
 * - **allowSelf**: Grants permission when the requester and target are the same
 * - **allowTarget**: Grants permission based on target patterns
 * - **denySelf**: Denies permission when requester and target are the same
 * - **ensureTime**: Validates time-based permissions
 *
 * ## Rule Return Values
 *
 * Rules can return four possible values with specific meanings:
 * - `"granted"`: Explicitly grants permission
 * - `"rejected"`: Explicitly denies permission (short-circuits validation)
 * - `"neutral"`: No opinion (the rule doesn't apply to this request)
 * - `"blocked"`: High-priority denial that overrides other results *
 * ## Example Usage
 *
 * ```typescript
 * import { permission } from "@diister/quick-permission";
 * import { allowTarget } from "@diister/quick-permission/rules/allowTarget";
 * import { allowOwner } from "@diister/quick-permission/rules/allowOwner";
 *
 * const documentPermission = permission({
 *   rules: [
 *     // Allow if the user is the owner of the document
 *     allowOwner(),
 *     // Or if they have explicit target permission
 *     allowTarget({ wildcards: true })
 *   ]
 * });
 * ```
 *
 * @module rules
 */

export { allowOwner } from "./allowOwner/allowOwner.ts";
export { allowSelf } from "./allowSelf/allowSelf.ts";
export { allowTarget } from "./allowTarget/allowTarget.ts";
export { denySelf } from "./denySelf/denySelf.ts";
export { ensureTime } from "./ensureTime/ensureTime.ts";

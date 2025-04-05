/**
 * Quick Permission - Rules Module
 *
 * This module exports built-in permission rule functions that can be used to validate
 * permission requests against permission states. Each rule evaluates a specific aspect
 * of permission and returns true, false, or undefined.
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
 * Rules can return three possible values with specific meanings:
 * - `true`: Explicitly grants permission
 * - `false`: Explicitly denies permission (short-circuit)
 * - `undefined`: No opinion (neutral)
 *
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

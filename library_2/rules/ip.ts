import type { PermissionRule } from "../core/types.ts";

/**
 * Rule that validates IP-based permissions
 *
 * Checks if the request comes from an allowed IP address
 *
 * @example
 * IpRule()
 * // State: { allowedIps: ["192.168.1.1", "10.0.0.1"] }
 * // Request: { ips: ["192.168.1.1"] }
 */
export function IpRule(): PermissionRule<
  { allowedIps?: string[] },
  { ips: string[] }
> {
  return {
    name: "ip",
    check: (state, request) => {
      const allowed = state.allowedIps;
      if (!allowed?.length) return { ok: true }; // No IP restrictions
      const valid = request.ips.some((ip: string) => allowed.includes(ip));
      if (!valid) {
        return {
          ok: false,
          reason: "IP address not allowed",
        };
      }
      return { ok: true };
    },
    default: () => ({ ips: [] }),
  };
}

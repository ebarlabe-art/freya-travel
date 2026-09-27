// Bound by the existing DB lease, not by a provider/model identity.
export const LEASE_MS=90_000;
export const RPC_TIMEOUT_MS=5_000;
export const LEASE_RESERVE_MS=10_000;
export const ATTEMPT_TIMEOUT_MS=LEASE_MS-LEASE_RESERVE_MS;
export const PROVIDER_TIMEOUT_MS=ATTEMPT_TIMEOUT_MS-2*RPC_TIMEOUT_MS;
export function attemptBudget(leaseExpiresAt,now=Date.now()){
 const expiry=Date.parse(leaseExpiresAt);
 return Number.isFinite(expiry)?Math.max(0,Math.min(ATTEMPT_TIMEOUT_MS,expiry-now-LEASE_RESERVE_MS)):ATTEMPT_TIMEOUT_MS;
}

/**
 * Ownership is opt-in while existing file-backed Pi sessions are unclaimed.
 * Enable after a one-time backfill, or set it explicitly in a fresh install.
 */
export function isPiOwnershipEnabled() {
 return process.env.FEATURE_PI_SESSION_OWNERSHIP === "true";
}

export function isWorkOrchestratorEnabled() {
 return process.env.FEATURE_WORK_ORCHESTRATOR !== "false";
}

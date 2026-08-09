let initialized = false;

/**
 * Compatibility no-op. Project storage is local by default and is wired by
 * `persistence/bootstrap`.
 *
 * Idempotent. Safe to call from multiple bootstrap paths.
 */
export function initIntegratedProjectStore(): void {
    if (initialized) return;
    initialized = true;
}

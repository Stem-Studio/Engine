let initialized = false;

/**
 * Compatibility no-op. The default AI backend already targets same-origin
 * local ai-server endpoints and uses BYOK key storage where needed.
 *
 * Idempotent. Safe to call from multiple bootstrap paths.
 */
export function initIntegratedAIBackend(): void {
    if (initialized) return;
    initialized = true;
}

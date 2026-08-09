let registered = false;

/**
 * Compatibility no-op. This repository ships the null analytics recorder by
 * default and does not wire Firebase.
 *
 * Idempotent.
 */
export function initIntegratedAnalytics(): void {
    if (registered) return;
    registered = true;
}

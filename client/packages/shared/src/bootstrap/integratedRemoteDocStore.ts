let registered = false;

/**
 * Compatibility no-op. This repository ships the null remote doc store by
 * default and does not wire Firestore.
 *
 * Idempotent.
 */
export function initIntegratedRemoteDocStore(): void {
    if (registered) return;
    registered = true;
}

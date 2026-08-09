import type {ICopilotProvider} from "./ICopilotProvider";

let singleton: ICopilotProvider | undefined;
let factory: (() => ICopilotProvider) | undefined;

/**
 * Returns the process-wide copilot provider. Constructed lazily via the
 * registered factory so unit tests can override via `setCopilotProvider()`
 * before any consumer pulls it in.
 *
 * If no provider is registered, the seam stays empty and the UI hides the
 * copilot panel. Forks that ship a copilot provider can register it from
 * their own bootstrap.
 */
export function getCopilotProvider(): ICopilotProvider | null {
    if (singleton) return singleton;
    if (factory) {
        singleton = factory();
        return singleton;
    }
    return null;
}

/**
 * Replace the singleton directly. Tests use this to inject a stub.
 * Production code should prefer `setCopilotProviderFactory()` so the
 * singleton is constructed lazily on first access.
 */
export function setCopilotProvider(provider: ICopilotProvider | undefined): void {
    singleton = provider;
}

/**
 * Register a lazy factory for the copilot provider. The factory is invoked
 * on the first `getCopilotProvider()` call after registration. Subsequent
 * calls return the memoized instance.
 */
export function setCopilotProviderFactory(fn: (() => ICopilotProvider) | undefined): void {
    factory = fn;
    singleton = undefined;
}

import type {IAuthProvider} from "./IAuthProvider";
import {NullAuthProvider} from "./NullAuthProvider";

let singleton: IAuthProvider | undefined;

/**
 * Returns the process-wide auth provider.
 *
 * This repository ships one open-source runtime, so the default provider is the local
 * `NullAuthProvider` that exposes the `stemstudio-token` accepted by the
 * local ai-server. Tests and embedders can still replace it via
 * `setAuthProvider()`.
 */
export function getAuthProvider(): IAuthProvider {
    if (singleton) return singleton;
    singleton = new NullAuthProvider();
    return singleton;
}

/**
 * Replace the singleton. Tests and embedders can use this to inject a stub
 * or custom auth provider.
 */
export function setAuthProvider(provider: IAuthProvider | undefined): void {
    singleton = provider;
}

/**
 * OSS stub for `@stem/auth-firebase`.
 *
 * The package is not part of this repository. This stub does nothing, so the
 * auth factory uses its local `NullAuthProvider` default.
 *
 * Importing `FirebaseAuthProvider` or `installFirebaseAuthProvider` from
 * the real package is a programmer error in OSS code — the boundary lint
 * forbids it. The dummy exports below exist so accidental imports compile
 * but observably fail at runtime instead of silently registering Firebase.
 */

/* eslint-disable @typescript-eslint/no-empty-function */

class FirebaseAuthProviderStub {
    constructor() {
        throw new Error(
            "FirebaseAuthProvider is not available in OSS builds. Use the editor-oss NullAuthProvider default instead, " +
                "or register your own via setAuthProvider().",
        );
    }
}

export {FirebaseAuthProviderStub as FirebaseAuthProvider};

/**
 * No-op in OSS builds — the editor-oss factory's NullAuthProvider default
 * is what the editor uses. Calling this is harmless.
 */
export function installFirebaseAuthProvider(): void {
    // intentionally empty
}

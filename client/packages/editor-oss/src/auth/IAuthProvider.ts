/**
 * Brand-neutral user shape. Mirrors the subset of `firebase/auth`'s `User`
 * that the editor actually reads, so editor code can be authored against
 * this interface without touching the Firebase SDK directly.
 */
export interface IAuthUser {
    /** Stable, opaque identifier for this user. */
    uid: string;
    /** Verified email address, or null when none is associated. */
    email: string | null;
    /** Display name as supplied by the provider, or null. */
    displayName: string | null;
    /** Avatar URL as supplied by the provider, or null. */
    photoURL: string | null;
    /** True for anonymous / guest sessions. */
    isAnonymous: boolean;
    /** True when the user's email has been verified (always false for anonymous sessions). */
    emailVerified: boolean;
    /**
     * Returns a fresh bearer token to attach to backend requests. Pass
     * `true` to force a refresh — useful when the previous token has
     * just been rejected.
     */
    getIdToken(forceRefresh?: boolean): Promise<string>;
}

/** Subset of OAuth provider identifiers that the editor knows about. */
export type AuthProviderId = "google.com" | "apple.com" | "facebook.com" | "github.com";

/**
 * IAuthProvider is the seam between editor UI and any authentication
 * surface. This repository wires `NullAuthProvider`, which returns the
 * dummy local user so AI-server BYOK requests still flow.
 *
 * Editor code reads `getCurrentUser()` and `onAuthStateChanged` for state,
 * and calls the sign-in / account-management methods for flows. Calls
 * are expected to be promise-returning even when the underlying provider
 * resolves synchronously (consistent error-path shape).
 */
export interface IAuthProvider {
    /** Current user, or null when no session. Cheap and synchronous. */
    getCurrentUser(): IAuthUser | null;

    /**
     * Subscribe to auth-state changes. The callback fires immediately
     * with the current user (or null), then on every subsequent change.
     * Returns an idempotent unsubscribe function.
     */
    onAuthStateChanged(cb: (user: IAuthUser | null) => void): () => void;

    // ─── Sign-in flows ────────────────────────────────────────────────
    signInAnonymously(): Promise<IAuthUser>;
    signInWithCustomToken(token: string): Promise<IAuthUser>;
    signInWithEmailAndPassword(email: string, password: string): Promise<IAuthUser>;
    createUserWithEmailAndPassword(email: string, password: string): Promise<IAuthUser>;
    signInWithGoogle(scopes?: string[]): Promise<IAuthUser>;
    signInWithOAuth(providerId: AuthProviderId, scopes?: string[]): Promise<IAuthUser>;

    // ─── Account management ───────────────────────────────────────────
    sendEmailVerification(): Promise<void>;
    sendPasswordResetEmail(email: string): Promise<void>;
    linkAnonymousToEmailPassword(email: string, password: string): Promise<IAuthUser>;
    signOut(): Promise<void>;
}

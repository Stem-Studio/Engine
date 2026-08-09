// OSS stub for `firebase/auth`. See firebase-app.ts for the rationale.
//
// Types are deliberately permissive (`any`) so compatibility code paths that
// read `auth.currentUser`, `user.uid`, `user.getIdToken()` etc. still
// typecheck. Auth calls throw because this repository does not ship Firebase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const unreachable = (name: string): never => {
    throw new Error(`firebase/auth.${name}() is not available in OSS builds`);
};

export type Auth = any;
export type User = any;
export type UserInfo = any;
export type UserCredential = any;
export type AuthError = Error;
export type IdTokenResult = any;

export class EmailAuthProvider {
    static credential(): never {
        return unreachable("EmailAuthProvider.credential");
    }
}

export class GoogleAuthProvider {
    addScope(): void {/* no-op */}
    setCustomParameters(): void {/* no-op */}
    static credential(): never {
        return unreachable("GoogleAuthProvider.credential");
    }
}

export class OAuthProvider {
    constructor(_providerId: string) {/* no-op */}
    addScope(): void {/* no-op */}
    setCustomParameters(): void {/* no-op */}
    static credential(): never {
        return unreachable("OAuthProvider.credential");
    }
}

export const getAuth = (..._args: any[]): Auth => null;

export const signInWithCustomToken = async (..._args: any[]): Promise<UserCredential> =>
    unreachable("signInWithCustomToken");

export const signInAnonymously = async (..._args: any[]): Promise<UserCredential> =>
    unreachable("signInAnonymously");

export const signInWithEmailAndPassword = async (..._args: any[]): Promise<UserCredential> =>
    unreachable("signInWithEmailAndPassword");

export const createUserWithEmailAndPassword = async (..._args: any[]): Promise<UserCredential> =>
    unreachable("createUserWithEmailAndPassword");

export const sendEmailVerification = async (..._args: any[]): Promise<void> =>
    unreachable("sendEmailVerification");

export const sendPasswordResetEmail = async (..._args: any[]): Promise<void> =>
    unreachable("sendPasswordResetEmail");

export const signInWithPopup = async (..._args: any[]): Promise<UserCredential> =>
    unreachable("signInWithPopup");

export const linkWithCredential = async (..._args: any[]): Promise<UserCredential> =>
    unreachable("linkWithCredential");

export const onAuthStateChanged = (..._args: any[]): (() => void) => () => {/* no-op unsubscribe */};

export const signOut = async (..._args: any[]): Promise<void> => unreachable("signOut");

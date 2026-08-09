import type {IAuthProvider, IAuthUser} from "./IAuthProvider";

const OSS_DUMMY_UID = "stemstudio-local-user";
const OSS_DUMMY_TOKEN = "stemstudio-token";

const ossLocalUser: IAuthUser = {
    uid: OSS_DUMMY_UID,
    email: "local@stemstudio.invalid",
    displayName: "Local User",
    photoURL: null,
    isAnonymous: false,
    emailVerified: true,
    async getIdToken() {
        return OSS_DUMMY_TOKEN;
    },
};

const unsupported = (op: string): never => {
    throw new Error(`AuthProvider.${op} is not supported in this build`);
};

/**
 * Default AuthProvider. It surfaces a stable "local user" with the dummy
 * `stemstudio-token` so backend requests still authenticate against the
 * ai-server's local auth middleware. Sign-in / sign-up / OAuth methods all
 * reject because this repository has no identity system to delegate to.
 */
export class NullAuthProvider implements IAuthProvider {
    private user: IAuthUser | null = ossLocalUser;
    private readonly listeners = new Set<(user: IAuthUser | null) => void>();

    getCurrentUser(): IAuthUser | null {
        return this.user;
    }

    onAuthStateChanged(cb: (user: IAuthUser | null) => void): () => void {
        // Defer the initial callback so callers like checkPlayerExists()
        // that capture `unsubscribe = onAuthStateChanged(cb)` and then call
        // `unsubscribe()` inside `cb` don't hit a TDZ — the `const
        // unsubscribe = ...` assignment must complete before `cb` runs.
        Promise.resolve().then(() => cb(this.user));
        this.listeners.add(cb);
        return () => {
            this.listeners.delete(cb);
        };
    }

    async signInAnonymously(): Promise<IAuthUser> {
        // The open-source app treats every session as the same local user.
        return ossLocalUser;
    }

    async signInWithCustomToken(): Promise<IAuthUser> {
        return unsupported("signInWithCustomToken");
    }

    async signInWithEmailAndPassword(): Promise<IAuthUser> {
        return unsupported("signInWithEmailAndPassword");
    }

    async createUserWithEmailAndPassword(): Promise<IAuthUser> {
        return unsupported("createUserWithEmailAndPassword");
    }

    async signInWithGoogle(): Promise<IAuthUser> {
        return unsupported("signInWithGoogle");
    }

    async signInWithOAuth(): Promise<IAuthUser> {
        return unsupported("signInWithOAuth");
    }

    async sendEmailVerification(): Promise<void> {
        return unsupported("sendEmailVerification");
    }

    async sendPasswordResetEmail(): Promise<void> {
        return unsupported("sendPasswordResetEmail");
    }

    async linkAnonymousToEmailPassword(): Promise<IAuthUser> {
        return unsupported("linkAnonymousToEmailPassword");
    }

    async signOut(): Promise<void> {
        const wasUser = this.user;
        this.user = null;
        if (wasUser) {
            for (const listener of this.listeners) listener(null);
        }
    }
}

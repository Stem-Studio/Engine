/**
 * Tests for the OSS auth provider factory. The default provider is the local
 * dummy identity accepted by the ai-server, while tests and embedders can
 * still inject a custom provider through `setAuthProvider()`.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import type {IAuthProvider, IAuthUser} from "./IAuthProvider";

const importFresh = async () => {
    vi.resetModules();
    return import("./authProviderFactory");
};

const stubProvider = (overrides: Partial<IAuthProvider> = {}): IAuthProvider => ({
    getCurrentUser: () => null,
    onAuthStateChanged: () => () => undefined,
    signInAnonymously: vi.fn(),
    signInWithCustomToken: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInWithOAuth: vi.fn(),
    sendEmailVerification: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    linkAnonymousToEmailPassword: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
});

beforeEach(() => {
    vi.resetModules();
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("getAuthProvider", () => {
    it("falls back to NullAuthProvider when no provider is registered", async () => {
        const {getAuthProvider, setAuthProvider} = await importFresh();
        setAuthProvider(undefined);
        const provider = getAuthProvider();
        const user = provider.getCurrentUser();
        expect(user).not.toBeNull();
        expect(user!.uid).toBe("stemstudio-local-user");
    });

    it("returns the local user with stemstudio-token", async () => {
        const {getAuthProvider, setAuthProvider} = await importFresh();
        setAuthProvider(undefined);
        const user = getAuthProvider().getCurrentUser();
        expect(user).not.toBeNull();
        const token = await user!.getIdToken();
        expect(token).toBe("stemstudio-token");
    });

    it("honors an explicitly registered provider over the default", async () => {
        const {getAuthProvider, setAuthProvider} = await importFresh();
        const customUser: IAuthUser = {
            uid: "custom",
            email: "x@x",
            displayName: null,
            photoURL: null,
            isAnonymous: false,
            emailVerified: true,
            getIdToken: async () => "custom-token",
        };
        setAuthProvider(stubProvider({getCurrentUser: () => customUser}));
        const token = await getAuthProvider().getCurrentUser()!.getIdToken();
        expect(token).toBe("custom-token");
    });

    it("setAuthProvider(undefined) resets to the local default", async () => {
        const {getAuthProvider, setAuthProvider} = await importFresh();
        setAuthProvider(stubProvider());
        expect(getAuthProvider().getCurrentUser()).toBeNull();
        setAuthProvider(undefined);
        expect(getAuthProvider().getCurrentUser()?.uid).toBe("stemstudio-local-user");
    });
});

describe("integration with NullAuthProvider", () => {
    it("local dummy user satisfies the IAuthUser shape", async () => {
        const {getAuthProvider, setAuthProvider} = await importFresh();
        setAuthProvider(undefined);
        const user = getAuthProvider().getCurrentUser()!;
        expect(user.uid).toBe("stemstudio-local-user");
        expect(user.isAnonymous).toBe(false);
        expect(user.emailVerified).toBe(true);
        expect(typeof user.getIdToken).toBe("function");
    });

    it("signInAnonymously is a no-op that returns the same dummy user", async () => {
        const {getAuthProvider, setAuthProvider} = await importFresh();
        setAuthProvider(undefined);
        const provider = getAuthProvider();
        const current = provider.getCurrentUser();
        const signed = await provider.signInAnonymously();
        expect(signed.uid).toBe(current!.uid);
    });
});

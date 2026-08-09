import {getAuthProvider} from "../../../auth";
import {getRemoteDocStore} from "../../../data";
import {IUser} from "../../types";

const unixSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Generate or retrieve persistent guest user data
 */
export function getGuestPlayer(): IUser {
    console.log("👤 [AuthUtils] getGuestUserData() - Starting");

    // Generate or retrieve persistent guest ID
    let guestId = localStorage.getItem("guestUserId");
    if (!guestId) {
        guestId = crypto.randomUUID();
        localStorage.setItem("guestUserId", guestId);
        console.log("👤 [AuthUtils] Generated new guest ID:", guestId.slice(0, 8));
    } else {
        console.log("👤 [AuthUtils] Using existing guest ID:", guestId.slice(0, 8));
    }

    const userData: IUser = {
        id: guestId,
        firebaseId: guestId,
        avatar: "",
        email: `guest_${guestId.slice(0, 8)}@${window.location.host}`,
        username: `Guest_${guestId.slice(0, 8)}`,
        name: "Guest Player",
        token: null,
        platform: "guest",
    };

    console.log("👤 [AuthUtils] Generated guest user data:", {
        id: userData.id.slice(0, 8) + "...",
        username: userData.username,
        email: userData.email,
        name: userData.name,
    });

    return userData;
}

/**
 * Sign in anonymously with Firebase
 */
export async function registerAnonymousPlayer(): Promise<IUser | null> {
    try {
        console.log("🔐 [AuthUtils] signInAnonymously() - Starting anonymous authentication...");
        const authUser = await getAuthProvider().signInAnonymously();
        if (!authUser) {
            console.error("🔐 [AuthUtils] Anonymous sign-in returned no user");
            return null;
        }

        console.log("🔐 [AuthUtils] Anonymous auth successful, user UID:", authUser.uid.slice(0, 8));

        const idToken = await authUser.getIdToken();
        const user: IUser = {
            id: authUser.uid,
            firebaseId: authUser.uid,
            email: null,
            name: "Anonymous User",
            username: `guest_${authUser.uid.slice(0, 8)}`,
            avatar: null,
            token: idToken,
            platform: "anonymous",
        };

        const store = getRemoteDocStore();
        console.log("🔐 [AuthUtils] Checking if anonymous user exists in remote store...");
        const existing = await store.getDoc("users", authUser.uid);

        if (!existing) {
            console.log("🔐 [AuthUtils] Creating new anonymous user in remote store...");
            await store.setDoc("users", authUser.uid, {
                ...user,
                isAnonymous: true,
                memberSince: unixSeconds(),
            });
            console.log("🔐 [AuthUtils] Anonymous user created in remote store");
        } else {
            console.log("🔐 [AuthUtils] Anonymous user already exists in remote store");
        }

        console.log("✅ [AuthUtils] Anonymous authentication successful, user:", {
            id: user.id.slice(0, 8) + "...",
            username: user.username,
            name: user.name,
        });

        return user;
    } catch (error) {
        console.error("❌ [AuthUtils] Anonymous sign-in failed:", error);
        return null;
    }
}

/**
 * Check if a user is already authenticated with Firebase
 * Returns a promise that resolves with the current user or null
 */
export async function checkPlayerExists(): Promise<IUser | null> {
    return new Promise(resolve => {
        console.log("🔍 [AuthUtils] checkExistingAuth() - Checking for existing authentication...");

        const provider = getAuthProvider();

        // Set up auth state change listener with timeout
        const timeoutId = setTimeout(() => {
            console.log("⏰ [AuthUtils] Auth state check timed out, resolving with null");
            unsubscribe();
            resolve(null);
        }, 3000); // 3 second timeout

        const unsubscribe = provider.onAuthStateChanged(async authUser => {
            clearTimeout(timeoutId);
            unsubscribe();

            if (authUser) {
                console.log("✅ [AuthUtils] Found existing user:", {
                    uid: authUser.uid.slice(0, 8) + "...",
                    isAnonymous: authUser.isAnonymous,
                    email: authUser.email,
                    displayName: authUser.displayName,
                });

                const idToken = await authUser.getIdToken();

                const user: IUser = {
                    id: authUser.uid,
                    firebaseId: authUser.uid,
                    email: authUser.email,
                    name: authUser.displayName || (authUser.isAnonymous ? "Anonymous User" : "User"),
                    username:
                        authUser.email?.split("@")[0] ||
                        (authUser.isAnonymous
                            ? `guest_${authUser.uid.slice(0, 8)}`
                            : `user_${authUser.uid.slice(0, 8)}`),
                    avatar: authUser.photoURL,
                    token: idToken,
                    platform: "firebase",
                };

                resolve(user);
            } else {
                console.log("ℹ️ [AuthUtils] No existing user found");
                resolve(null);
            }
        });
    });
}

/**
 * Check if the current user is authenticated (not anonymous)
 */
export function playerIsRegistered(): boolean {
    const currentUser = getAuthProvider().getCurrentUser();
    if (!currentUser) return false;
    return !currentUser.isAnonymous;
}

/**
 * Check if the current user is anonymous
 */
export function playerIsAnonymous(): boolean {
    return getAuthProvider().getCurrentUser()?.isAnonymous || false;
}

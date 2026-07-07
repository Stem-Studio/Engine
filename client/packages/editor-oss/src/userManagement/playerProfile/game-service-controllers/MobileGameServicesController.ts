/**
 * Mobile Game Services Controller
 *
 * Handles Apple Game Center and Google Play Games Services integration
 * Similar to DiscordController but for native mobile game services
 */

import {BaseGameServiceController, GameServiceSettings} from "./BaseGameServiceController";
import {authenticateWithGameCenter} from "@stem/network/api/gamecenter";
import EngineRuntime from "../../../EngineRuntime";
import {getAuthProvider} from "../../../auth";
import {IUser} from "../../types";
import {GameServiceType} from "../../utils/PlatformDetector";
import {capacitorMobileServices} from "../capacitor-mobile-wrapper";
import {createMobileGameServiceEmail} from "./MobileGameServiceIdentity";

/**
 * Handles mobile game services authentication and operations
 */
export class MobileGameServicesController extends BaseGameServiceController {
    protected settings: GameServiceSettings;
    protected activeService: GameServiceType;
    constructor(engine: EngineRuntime, settings: GameServiceSettings, activeService: GameServiceType) {
        const platform = activeService === GameServiceType.GAME_CENTER ? "gameCenter" : "googlePlay";
        super(engine, {controllerName: "MobileGameServicesController", settings, platform: platform});
        this.settings = settings;
        this.activeService = activeService;
    }

    /**
     * Initialize mobile game services SDK - Implementation of abstract method
     */
    protected async initializeSDK(): Promise<void> {
        // Mobile SDK initialization handled by capacitor wrapper
    }

    /**
     * Setup mobile game services authentication - Implementation of abstract method
     */
    protected async setupAuthentication(): Promise<void> {
        try {
            await this.authenticate();
        } catch (error) {
            this.logError("Authentication setup failed:", error);
            throw error;
        }
    }

    /**
     * Setup mobile game features - Implementation of abstract method
     */
    protected setupGameFeatures(): void {
        // Mobile game features like leaderboards, achievements, cloud save are set up here
    }

    private regenerateToken = async (): Promise<string | null> => {
        const user = getAuthProvider().getCurrentUser();
        if (user) {
            try {
                return await user.getIdToken(true);
            } catch (error) {
                console.error("Error regenerating token:", error);
                return null;
            }
        }
        console.error("No user is currently signed in.");
        return null;
    };

    /**
     * Main authentication flow
     */
    private async authenticate(): Promise<void> {
        if (this.isAuthenticated()) {
            return;
        }

        try {
            // Step 1: Sign in to Game Center/Google Play to get native player data
            const nativePlayer = await capacitorMobileServices.signIn(this.activeService);
            if (!nativePlayer) {
                throw new Error(`${this.activeService} sign-in returned null player`);
            }

            // Step 2: Get credentials for Firebase authentication
            type GameCenterAuthData = {
                playerID: string, //GKLocalPlayer.local.gamePlayerID ?? "",
                publicKeyURL: string, //publicKeyUrl.absoluteString,
                signature: string, //signature.base64EncodedString(),
                salt: string, //salt.base64EncodedString(),
                timestamp: number, //timestamp,
                displayName: string //GKLocalPlayer.local.displayName ?? "",
                bundleId: string //Bundle.main.bundleIdentifier,
                avatar?: string
            }

            type CredentialData = {
                providerId: string;
                credential: GameCenterAuthData;
            };

            let credentialData: CredentialData = undefined as any;

            if (this.activeService === GameServiceType.GAME_CENTER) {
                credentialData = await capacitorMobileServices.getGameCenterCredential();
            } else if (this.activeService === GameServiceType.GOOGLE_PLAY) {
                const serverClientId = process.env.REACT_APP_GOOGLE_PLAY_SERVER_CLIENT_ID;
                if (!serverClientId) {
                    throw new Error("serverClientId is required for Google Play Games authentication");
                }
                //credentialData = await capacitorMobileServices.getGooglePlayCredential(serverClientId) as CredentialData;
                credentialData = {
                    providerId: "playgames.google.com",
                    credential: {
                        playerID: nativePlayer.player_id,
                        displayName: nativePlayer.player_name,
                        avatar: nativePlayer.avatar_url,
                        bundleId: nativePlayer.bundleId,
                    } as GameCenterAuthData,
                };
            } else {
                throw new Error(`Unsupported service: ${this.activeService}`);
            }

            if (!credentialData.credential.playerID) {
                throw new Error(`${this.activeService} credential is missing playerID`);
            }

            // Step 3: Sign in to Firebase with the credential
            const fbAuthData = await authenticateWithGameCenter({
                player_id: credentialData.credential.playerID,
                bundle_id: credentialData.credential.bundleId,
                public_key_url: credentialData.credential.publicKeyURL,
                signature: credentialData.credential.signature,
                salt: credentialData.credential.salt,
                timestamp: credentialData.credential.timestamp,
                display_name: credentialData.credential.displayName,
            });

            // Return combined player data (Firebase UID + native player info)
            const user: IUser = {
                id: credentialData.credential.playerID,
                username: credentialData.credential.playerID,
                name: credentialData.credential.displayName,
                email: createMobileGameServiceEmail(
                    this.activeService,
                    credentialData.credential.displayName,
                    credentialData.credential.playerID,
                ),
                firebaseId: fbAuthData?.user.user_id,
                avatar: null,
                token: fbAuthData?.id_token,
                isGuest: false,
                platform: this.platform,
            };

            this.handleUserAuthenticated(user);
            console.log("User authenticated:", user);

        } catch (error) {
            this.logError("signInWithFirebaseCredentials() - Failed:", error);
            this.logError(`Authentication failed for ${this.activeService}:`, error);
            super.handleAuthenticationFailure(error);
        }
    }

    /**
     * Submit score to leaderboard
     * @param leaderboardId
     * @param score
     */
    async submitScore(leaderboardId: string, score: number): Promise<boolean> {
        try {
            if (!capacitorMobileServices) {
                return false;
            }

            await capacitorMobileServices.submitScore(this.activeService, leaderboardId, score);
            return true;
        } catch (error) {
            this.logError(`Failed to submit score:`, error);
            return false;
        }
    }

    /**
     * Unlock achievement
     * @param achievementId
     */
    async unlockAchievement(achievementId: string): Promise<boolean> {
        try {
            if (!capacitorMobileServices) {
                return false;
            }

            await capacitorMobileServices.unlockAchievement(achievementId);
            return true;
        } catch (error) {
            this.logError(`Failed to unlock achievement:`, error);
            return false;
        }
    }

    /**
     * Show leaderboard UI
     * @param leaderboardId
     */
    async showLeaderboard(leaderboardId: string): Promise<boolean> {
        try {
            if (!capacitorMobileServices) {
                return false;
            }

            await capacitorMobileServices.showLeaderboard(leaderboardId);
            return true;
        } catch (error) {
            this.logError(`Failed to show leaderboard:`, error);
            return false;
        }
    }

    /**
     * Show achievements UI
     */
    async showAchievements(): Promise<boolean> {
        try {
            if (!capacitorMobileServices) {
                return false;
            }

            await capacitorMobileServices.showAchievements();
            return true;
        } catch (error) {
            this.logError(`Failed to show achievements:`, error);
            return false;
        }
    }

    /**
     * Increment achievement progress (for incremental achievements)
     * @param achievementId
     * @param steps
     */
    async incrementAchievementProgress(achievementId: string, steps: number): Promise<boolean> {
        try {
            if (!capacitorMobileServices) {
                this.logWarn("Mobile game services not available");
                return false;
            }

            // This would need to be implemented in the capacitor wrapper
            // For now, just unlock the achievement if steps > 0
            if (steps > 0) {
                return await this.unlockAchievement(achievementId);
            }
            return true;
        } catch (error) {
            this.logError(`Failed to increment achievement progress:`, error);
            return false;
        }
    }
}

export default MobileGameServicesController;

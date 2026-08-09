/**
 * Unified Game Services Controller
 *
 * Master controller that manages all game services (Discord, Game Center, Google Play)
 * with intelligent platform detection and service prioritization.
 */

import {uuid} from "@gltf-transform/core";

import EngineRuntime from "../../EngineRuntime";
import EventBus from "../../behaviors/event/EventBus";
import {showToast} from "../../showToast";
import {IUser} from "../types";
import PlatformDetector, {GameServiceType, PlatformInfo, PlatformType} from "../utils/PlatformDetector";
import type {DiscordController as DiscordControllerType} from "./game-service-controllers/DiscordController";
import type CrazyGamesControllerType from "./game-service-controllers/CrazyGamesController";
import type EmailPasswordControllerType from "./game-service-controllers/EmailPasswordController";
import type {MobileGameServicesController as MobileGameServicesControllerType} from "./game-service-controllers/MobileGameServicesController";
import type SteamControllerType from "./game-service-controllers/SteamController";

export interface UnifiedGameUser {
    id: string;
    name: string;
    email?: string
    avatarUrl?: string;
    service: GameServiceType;
    platform: string;
}

export interface UnifiedGameServicesSettings {
    discord?: {
        enabled: boolean;
        scopes: string[];
        isRequiredToPlay: boolean;
    };
    steam?: {
        enabled: boolean;
        appId?: string;
        achievements?: string[];
        leaderboards?: string[];
    };
    mobile?: {
        enabled: boolean;
        leaderboards: string[];
        achievements: string[];
        cloudSave: boolean;
        gameCenterId?: string;
        playGamesId?: string;
    };
    crazyGames?: {
        enabled: boolean;
        gameId?: string;
        gameSecret?: string;
        features?: {
            leaderboards?: boolean;
            achievements?: boolean;
            socialFeatures?: boolean;
        };
    };
    emailPassword?: {
        enabled: boolean;
        allowRegistration: boolean;
        requireEmailVerification: boolean;
    };
    fallback?: {
        allowAnonymousFirebase: boolean;
    };
}

/**
 * Manages all game services with platform-aware selection
 */
export class UnifiedGameServicesController {
    private engine: EngineRuntime;
    private discordController: DiscordControllerType | null = null;
    private mobileController: MobileGameServicesControllerType | null = null;
    private crazyGamesController: CrazyGamesControllerType | null = null;
    private steamController: SteamControllerType | null = null;
    private emailPasswordController: EmailPasswordControllerType | null = null;
    private activeService: GameServiceType = GameServiceType.NONE;
    private isInitialized = false;
    private currentUser: UnifiedGameUser | null = null;
    private platformInfo: PlatformInfo;

    constructor(engine: EngineRuntime) {
        this.engine = engine;
        this.platformInfo = PlatformDetector.getPlatformInfo();

        // Constructor - services will be initialized based on platform
    }

    /**
     * Initialize the unified game services
     */
    async start(): Promise<void> {
        if (this.isInitialized) {
            // Already initialized
            return;
        }

        if (!this.engine.isPlaying) {
            return; // Editor mode - services not initialized
        }

        // Initialize the appropriate service controllers
        await this.initializeControllers();

        // Determine and activate the appropriate service
        this.activeService = await this.determineActiveService();

        console.log("AUTH: active service: "+this.activeService);

        if (this.activeService === GameServiceType.NONE) {
            this.currentUser = null;
            return;
        }

        await this.attemptServiceAuthentication(this.activeService);

        this.setupEventListeners();
        this.isInitialized = true;
    }

    /**
     * Stop the unified game services
     */
    stop(): void {
        this.removeEventListeners();

        if (this.discordController) {
            this.discordController.stop();
            this.discordController = null;
        }

        if (this.mobileController) {
            this.mobileController.stop();
            this.mobileController = null;
        }

        if (this.crazyGamesController) {
            this.crazyGamesController.stop();
            this.crazyGamesController = null;
        }

        if (this.steamController) {
            this.steamController.stop();
            this.steamController = null;
        }

        if (this.emailPasswordController) {
            this.emailPasswordController.stop();
            this.emailPasswordController = null;
        }

        this.activeService = GameServiceType.NONE;
        this.currentUser = null;
        this.isInitialized = false;
    }

    /**
     * Initialize service controllers based on platform
     */
    private async initializeControllers(): Promise<void> {
        const settings = this.getServicesSettings();

        // Get sceneId from app - this is the only place we access it
        // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
        const sceneId = this.engine.editor?.sceneID!;

        // Initialize Discord controller if enabled and should be initialized
        // Logic: Initialize Discord if:
        // 1. Inside Discord: Always initialize (ignore isRequiredToPlay, we get token from SDK)
        // 2. Outside Discord: Initialize if isRequiredToPlay is true (use OAuth flow)
        const shouldInitializeDiscord = this.platformInfo.isDiscord || settings.discord?.isRequiredToPlay;
        if (settings.discord?.enabled && shouldInitializeDiscord) {
            try {
                const {DiscordController} = await import("./game-service-controllers/DiscordController");
                this.discordController = new DiscordController(this.engine, {
                    isRequiredToPlay: settings.discord.isRequiredToPlay,
                    scopes: settings.discord.scopes as any[],
                    sceneId: sceneId, // Pass sceneId
                });
                // Discord controller initialized successfully
            } catch {
                // Failed to initialize Discord controller
            }
        } else if (settings.discord?.enabled) {
            // Discord not required for this platform
        }

        // Initialize mobile controller if available and enabled
        if (
            settings.mobile?.enabled &&
            (PlatformDetector.isGameCenterAvailable(this.platformInfo.type) ||
                PlatformDetector.isGooglePlayAvailable(this.platformInfo.type))
        ) {
            try {
                const {MobileGameServicesController} = await import("./game-service-controllers/MobileGameServicesController");
                const activeService = PlatformDetector.isGameCenterAvailable(this.platformInfo.type)
                    ? GameServiceType.GAME_CENTER
                    : GameServiceType.GOOGLE_PLAY;
                this.mobileController = new MobileGameServicesController(
                    this.engine,
                    {
                        leaderboards: settings.mobile.leaderboards || [],
                        achievements: settings.mobile.achievements || [],
                        cloudSave: settings.mobile.cloudSave || false,
                        sceneId: sceneId, // Pass sceneId
                    },
                    activeService,
                );
                // Mobile controller initialized
            } catch {
                // Failed to initialize mobile controller
            }
        }

        // Initialize CrazyGames controller if available and enabled
        if (settings.crazyGames?.enabled && PlatformDetector.isCrazyGamesAvailable(this.platformInfo.type)) {
            try {
                const {default: CrazyGamesController} = await import("./game-service-controllers/CrazyGamesController");
                this.crazyGamesController = new CrazyGamesController(this.engine, {
                    gameId: settings.crazyGames.gameId,
                    gameSecret: settings.crazyGames.gameSecret,
                    features: settings.crazyGames.features,
                    sceneId: sceneId, // Pass sceneId
                });
                // CrazyGames controller initialized
            } catch {
                // Failed to initialize CrazyGames controller
            }
        }

        // Initialize Steam controller if available and enabled
        if (settings.steam?.enabled) {
            try {
                const {default: SteamController} = await import("./game-service-controllers/SteamController");
                if (SteamController.isAvailable()) {
                    this.steamController = new SteamController(this.engine, {
                        sceneId: sceneId, // Pass sceneId
                    });
                    // Steam controller initialized
                }
            } catch {
                // Failed to initialize Steam controller
            }
        }

        // Initialize Email/Password controller if enabled
        if (settings.emailPassword?.enabled) {
            try {
                const {default: EmailPasswordController} = await import("./game-service-controllers/EmailPasswordController");
                this.emailPasswordController = new EmailPasswordController(this.engine, {
                    allowRegistration: settings.emailPassword.allowRegistration,
                    requireEmailVerification: settings.emailPassword.requireEmailVerification,
                    sceneId: sceneId, // Pass sceneId
                });
                // Email/Password controller initialized
            } catch {
                // Failed to initialize Email/Password controller
            }
        }
    }

    /**
     * Determine which service should be active based on platform and settings
     * Following the user's specified priority order:
     * 1. Editor mode check FIRST
     * 2. Player support check SECOND
     * 3. Platform-specific authentication priority
     */
    private async determineActiveService(): Promise<GameServiceType> {
        const settings = this.getServicesSettings();

        // STEP 1: Editor mode check FIRST (before everything else)
        if (!this.engine.isPlaying) {
            return GameServiceType.NONE;
        }

        // STEP 2: Player support check SECOND
        const playerSupport = this.engine.editor?.scene?.userData?.playerSupport;
        const playerSupportEnabled = playerSupport?.enabled !== false; // Default to true for backward compatibility

        if (!playerSupportEnabled) {
            return GameServiceType.NONE;
        }

        // STEP 3: Platform-specific authentication priority (for play mode only)

        // Priority 1: Discord when running in Discord and enabled
        if (this.platformInfo.type === PlatformType.DISCORD && settings.discord?.enabled && this.discordController) {
            return GameServiceType.DISCORD;
        }

        // Priority 2: CrazyGames when running in CrazyGames and enabled
        if (
            this.platformInfo.type === PlatformType.CRAZYGAMES &&
            settings.crazyGames?.enabled &&
            this.crazyGamesController
        ) {
            return GameServiceType.CRAZYGAMES;
        }

        // Priority 3: Steam when running in Electron, Steam is enabled, and SDK available
        if (this.platformInfo.type === PlatformType.ELECTRON && playerSupportEnabled) {
            if (settings.steam?.enabled && this.steamController) {
                return GameServiceType.STEAM;
            }
            // Electron without Steam enabled/available - fall through to other auth methods
        }

        // Priority 4: Game Center on iOS when player settings enabled
        if (
            this.platformInfo.type === PlatformType.CAPACITOR_IOS &&
            settings.mobile?.enabled &&
            this.mobileController
        ) {
            return GameServiceType.GAME_CENTER;
        }

        // Priority 5: Google Play on Android when player settings enabled
        if (
            this.platformInfo.type === PlatformType.CAPACITOR_ANDROID &&
            settings.mobile?.enabled &&
            this.mobileController
        ) {
            return GameServiceType.GOOGLE_PLAY;
        }

        if (settings.emailPassword?.enabled) {
            return GameServiceType.EMAIL_PASSWORD;
        }

        // For platforms other than Browser/Electron, return NONE if no platform service matched
        if (
            this.platformInfo.type !== PlatformType.BROWSER &&
            this.platformInfo.type !== PlatformType.ELECTRON
        ) {
            // No platform-specific service available for mobile/other platforms
            return GameServiceType.NONE;
        }

        // Browser and Electron can fall through to Firebase/Discord auth
        // Check if Discord is required to play
        if (settings.discord?.isRequiredToPlay && settings.discord?.enabled && this.discordController) {
            return GameServiceType.DISCORD;
        }

        const authManager = this.engine.authManager;
        if (authManager && authManager.checkExistingAuth) {
            const existingUser = await authManager.checkExistingAuth();

            if (existingUser && !authManager.isAnonymous()) {
                return GameServiceType.FIREBASE;
            }
        }

        if (settings.fallback?.allowAnonymousFirebase) {
            return GameServiceType.FIREBASE_ANONYMOUS;
        }

        // No platform-specific service available - use persistent guest
        return GameServiceType.PERSISTENT_GUEST;
    }

    /**
     * Attempt to authenticate with a specific service
     * @param service - The service to authenticate with
     * @param isFallback - Whether this is a fallback attempt
     */
    private async attemptServiceAuthentication(service: GameServiceType, isFallback = false): Promise<void> {
        switch (service) {
            case GameServiceType.DISCORD:
                if (this.discordController) {
                    await this.discordController.start();
                    this.currentUser = this.discordController.getCurrentUser();
                    this.activeService = GameServiceType.DISCORD;
                    return;
                }
                break;

            case GameServiceType.CRAZYGAMES:
                if (this.crazyGamesController) {
                    await this.crazyGamesController.start();
                    this.activeService = GameServiceType.CRAZYGAMES;
                    return;
                }
                break;

            case GameServiceType.STEAM:
                await this.authenticateSteam(isFallback);
                return;

            case GameServiceType.EMAIL_PASSWORD:
                if (this.emailPasswordController) {
                    await this.emailPasswordController.start();
                    this.activeService = GameServiceType.EMAIL_PASSWORD;
                    return;
                }
                break;

            case GameServiceType.GAME_CENTER:
            case GameServiceType.GOOGLE_PLAY:
                if (this.mobileController) {
                    const user = await this.mobileController.start();
                    this.handleAuthenticatedUserSuccess(user);
                    this.activeService = service;
                    return;
                }
                break;

            case GameServiceType.FIREBASE:
                try {
                    const authManager = this.engine.authManager;
                    if (authManager && authManager.checkExistingAuth) {
                        const existingUser = await authManager.checkExistingAuth();
                        if (existingUser && !authManager.isAnonymous()) {
                            this.handleAuthenticatedUserSuccess(existingUser);
                            return;
                        }
                    }
                } catch {
                    // Error checking existing authentication
                }

            //if firebase was enabled and there is no existing user which should not happen, we should follow through to anonymous
            // eslint-disable-next-line no-fallthrough
            case GameServiceType.FIREBASE_ANONYMOUS: {
                const {registerAnonymousPlayer} = await import("./game-service-controllers/GuestController");
                const user = await registerAnonymousPlayer();
                if (user) {
                    this.handleAnonymousAuthSuccess(user);
                    return;
                }
                break;
            }

            case GameServiceType.PERSISTENT_GUEST:
                await this.createPersistentGuestUser();
                return;

            default:
                break;
        }

        throw new Error(`Failed to activate service: ${service} - Controller not available`);
    }

    /**
     * Authenticate with Discord
     * @param isFallback - Whether this is a fallback attempt
     */
    private async authenticateDiscord(isFallback = false): Promise<void> {
        if (!this.discordController) {
            const error = new Error("Discord controller not available");
            EventBus.instance.send("discordAuthFailed", {
                error,
                service: GameServiceType.DISCORD,
                platform: "Discord",
                isFallback,
            });
            throw error;
        }

        try {
            await this.discordController.start();
            this.activeService = GameServiceType.DISCORD;
        } catch (error) {
            EventBus.instance.send("discordAuthFailed", {
                error,
                service: GameServiceType.DISCORD,
                platform: "Discord",
                isFallback,
            });
            throw error;
        }
    }

    /**
     * Authenticate with CrazyGames
     * @param isFallback - Whether this is a fallback attempt
     */
    private async authenticateCrazyGames(isFallback = false): Promise<void> {
        if (!this.crazyGamesController) {
            const error = new Error("CrazyGames controller not available");
            EventBus.instance.send("crazyGamesAuthFailed", {
                error,
                service: GameServiceType.CRAZYGAMES,
                platform: "CrazyGames",
                isFallback,
            });
            throw error;
        }

        try {
            await this.crazyGamesController.start();
        } catch (error) {
            // CrazyGames authentication failed
            EventBus.instance.send("crazyGamesAuthFailed", {
                error,
                service: GameServiceType.CRAZYGAMES,
                platform: "CrazyGames",
                isFallback,
            });
            throw error;
        }
    }

    /**
     * Authenticate with Steam - extracted to avoid duplication
     * @param isFallback - Whether this is a fallback attempt
     */
    private async authenticateSteam(isFallback = false): Promise<void> {
        if (!this.steamController) {
            const error = new Error("Steam controller not available");
            EventBus.instance.send("steamAuthFailed", {
                error,
                service: GameServiceType.STEAM,
                platform: "Steam",
                isFallback,
            });
            throw error;
        }

        try {
            await this.steamController.start();
        } catch (error) {
            // Steam authentication failed
            EventBus.instance.send("steamAuthFailed", {
                error,
                service: GameServiceType.STEAM,
                platform: "Steam",
                isFallback,
            });
            throw error;
        }
    }

    /**
     * Handle existing authenticated Firebase user
     * @param user
     */
    private handleAuthenticatedUserSuccess(user: any): void {
        console.log("handleAuthenticatedUserSuccess", user);
        this.currentUser = {
            id: user.id || user.firebaseId || user.uid,
            name: user.name || user.username || user.displayName || "Authenticated User",
            avatarUrl: user.avatar || user.photoURL || undefined,
            service: GameServiceType.FIREBASE,
            platform: "Firebase",
            email: user.email,
        };

        this.activeService = GameServiceType.FIREBASE;
        EventBus.instance.send("gameServices.authenticated", this.currentUser);
    }

    /**
     * Handle successful anonymous authentication
     * @param user
     */
    private handleAnonymousAuthSuccess(user: IUser): void {
        this.currentUser = {
            id: user.id ?? user.firebaseId,
            name: user.name || user.username || "Anonymous User",
            avatarUrl: user.avatar || undefined,
            service: GameServiceType.FIREBASE_ANONYMOUS,
            platform: "Firebase Anonymous",
        };

        // Set user in application auth manager
        this.engine.authManager?.setUser(user);
        this.engine.authManager?.setAuthToken(user.token || null);

        this.activeService = GameServiceType.FIREBASE_ANONYMOUS;
        EventBus.instance.send("gameServices.authenticated", this.currentUser);
    }

    /**
     * Create a persistent guest user as final fallback
     */
    private async createPersistentGuestUser(): Promise<void> {
        // Use the centralized guest user data from AuthUtils
        const {getGuestPlayer} = await import("./game-service-controllers/GuestController");
        const guestData = getGuestPlayer();

        this.currentUser = {
            id: guestData.id,
            name: guestData.name ?? `guest-${uuid().slice(0, 6)}`,
            avatarUrl: guestData.avatar || undefined,
            service: GameServiceType.NONE,
            platform: "Guest",
        };

        this.activeService = GameServiceType.NONE;
        EventBus.instance.send("gameServices.authenticated", this.currentUser);

        showToast({
            type: "info",
            title: "Playing as Guest",
            body: "You're playing as a guest. Some features may be limited.",
        });
    }

    /**
     * Get game services settings from scene userData
     */
    private getServicesSettings(): UnifiedGameServicesSettings {
        //debugger;
        const userData = this.engine.editor?.scene?.userData;

        return {
            discord: userData?.discordIntegration || {enabled: false, scopes: [], isRequiredToPlay: false},
            steam: userData?.steamIntegration || {
                enabled: true, // Default to true for Steam when on Electron platform
                appId: userData?.steamIntegration?.appId,
                achievements: userData?.steamIntegration?.achievements || [],
                leaderboards: userData?.steamIntegration?.leaderboards || [],
            },
            mobile: userData?.mobileGameServices || {
                enabled: false,
                leaderboards: [],
                achievements: [],
                cloudSave: false,
            },
            crazyGames: userData?.crazyGames || {
                enabled: false,
            },
            emailPassword: userData?.emailPassword || {
                enabled: false,
                allowRegistration: false,
                requireEmailVerification: false,
            },
            fallback: {
                allowAnonymousFirebase: this.engine.editor?.allowAnonymousFirebase ?? false,
            },
        };
    }

    /**
     * Setup event listeners for cross-service communication
     */
    private setupEventListeners(): void {
        // Listen for Discord events
        EventBus.instance.subscribe("discordAuthSuccess", this.handleDiscordAuthSuccess.bind(this));
        EventBus.instance.subscribe("discordAuthFailed", this.handleDiscordAuthFailed.bind(this));

        // Listen for mobile game services events
        EventBus.instance.subscribe("mobileGameServices.authenticated", this.handleMobileAuthSuccess.bind(this));
        EventBus.instance.subscribe("mobileGameServices.authFailed", this.handleMobileAuthFailed.bind(this));

        // Listen for Steam events
        EventBus.instance.subscribe("steamAuthSuccess", this.handleSteamAuthSuccess.bind(this));
        EventBus.instance.subscribe("steamAuthFailed", this.handleSteamAuthFailed.bind(this));

        // Listen for CrazyGames events
        EventBus.instance.subscribe("crazyGamesAuthSuccess", this.handleCrazyGamesAuthSuccess.bind(this));
        EventBus.instance.subscribe("crazyGamesAuthFailed", this.handleCrazyGamesAuthFailed.bind(this));

        // Listen for Email/Password events
        EventBus.instance.subscribe("emailPasswordAuthSuccess", this.handleEmailPasswordAuthSuccess.bind(this));
        EventBus.instance.subscribe("emailPasswordAuthFailed", this.handleEmailPasswordAuthFailed.bind(this));

        // Listen for game events
        this.engine.on("gameStarted", this.handleGameStarted.bind(this));
        this.engine.on("gameEnded", this.handleGameEnded.bind(this));
        // Note: scoreUpdated is not a registered event in EventList, so we can't listen for it
    }

    /**
     * Remove event listeners
     */
    private removeEventListeners(): void {
        EventBus.instance.unsubscribe("discordAuthSuccess");
        EventBus.instance.unsubscribe("discordAuthFailed");
        EventBus.instance.unsubscribe("mobileGameServices.authenticated");
        EventBus.instance.unsubscribe("mobileGameServices.authFailed");
        EventBus.instance.unsubscribe("steamAuthSuccess");
        EventBus.instance.unsubscribe("steamAuthFailed");
        EventBus.instance.unsubscribe("crazyGamesAuthSuccess");
        EventBus.instance.unsubscribe("crazyGamesAuthFailed");
        EventBus.instance.unsubscribe("emailPasswordAuthSuccess");
        EventBus.instance.unsubscribe("emailPasswordAuthFailed");

        this.engine.on("gameStarted", null);
        this.engine.on("gameEnded", null);
        // Note: scoreUpdated is not a registered event in EventList, so we don't need to remove it
    }

    /**
     * Generic handler for authentication success from any service
     * @param data - Authentication data containing user info and service type
     * @param serviceType - The service type that authenticated
     * @param platformName - Display name of the platform
     */
    private async handleGenericAuthSuccess(
        data: any,
        serviceType: GameServiceType,
        platformName: string,
    ): Promise<void> {
        // params kept for call-site parity; auth payload is read from currentUser
        if (data && serviceType && platformName) { /* no-op */ }
        EventBus.instance.send("gameServices.authenticated", this.currentUser);
    }

    /**
     * Handle Discord authentication success
     * @param user
     */
    private async handleDiscordAuthSuccess(user: any): Promise<void> {
        await this.handleGenericAuthSuccess(user, GameServiceType.DISCORD, "Discord");
    }

    /**
     * Generic handler for authentication failure from any service
     * @param error - Error data
     * @param serviceType - The service type that failed
     * @param platformName - Display name of the platform
     * @param additionalData - Any additional data specific to the service
     */
    private handleGenericAuthFailed(
        error: any,
        serviceType: GameServiceType,
        platformName: string,
        additionalData?: any,
    ): void {
        // Determine if we should process this failure
        const shouldProcess =
            this.activeService === serviceType ||
            serviceType === GameServiceType.EMAIL_PASSWORD || // Email/Password errors always processed
            serviceType === GameServiceType.STEAM && (error?.isFallback || additionalData?.isFallback) || // Steam fallback
            serviceType === GameServiceType.GAME_CENTER ||
            serviceType === GameServiceType.GOOGLE_PLAY; // Mobile services

        if (shouldProcess) {
            EventBus.instance.send("gameServices.authFailed", {
                service: serviceType,
                error: error?.error || error,
                ...additionalData,
            });
        }
    }

    /**
     * Handle Discord authentication failure
     * @param error
     */
    private handleDiscordAuthFailed(error: any): void {
        this.handleGenericAuthFailed(error, GameServiceType.DISCORD, "Discord");
    }

    /**
     * Handle mobile game services authentication success
     * @param user
     */
    private async handleMobileAuthSuccess(user: any): Promise<void> {
        const serviceType =
            this.activeService === GameServiceType.GAME_CENTER
                ? GameServiceType.GAME_CENTER
                : GameServiceType.GOOGLE_PLAY;
        const platformName = this.activeService === GameServiceType.GAME_CENTER ? "Game Center" : "Google Play";
        await this.handleGenericAuthSuccess(user, serviceType, platformName);
    }

    /**
     * Handle mobile game services authentication failure
     * @param error
     */
    private handleMobileAuthFailed(error: any): void {
        const serviceType =
            this.activeService === GameServiceType.GAME_CENTER
                ? GameServiceType.GAME_CENTER
                : GameServiceType.GOOGLE_PLAY;
        const platformName = this.activeService === GameServiceType.GAME_CENTER ? "Game Center" : "Google Play";
        this.handleGenericAuthFailed(error, serviceType, platformName);
    }

    /**
     * Handle Steam authentication success
     * @param user
     */
    private async handleSteamAuthSuccess(user: any): Promise<void> {
        // Note: Steam user is already set in attemptServiceAuthentication
        // This is just for consistency with other services
        if (this.activeService !== GameServiceType.STEAM) {
            await this.handleGenericAuthSuccess(user, GameServiceType.STEAM, "Steam");
        }
    }

    /**
     * Handle Steam authentication failure
     * @param error
     */
    private handleSteamAuthFailed(error: any): void {
        this.handleGenericAuthFailed(error, GameServiceType.STEAM, "Steam", {isFallback: error?.isFallback});
    }

    /**
     * Handle CrazyGames authentication success
     * @param user
     */
    private async handleCrazyGamesAuthSuccess(user: any): Promise<void> {
        await this.handleGenericAuthSuccess(user, GameServiceType.CRAZYGAMES, "CrazyGames");
    }

    /**
     * Handle CrazyGames authentication failure
     * @param error
     */
    private handleCrazyGamesAuthFailed(error: any): void {
        this.handleGenericAuthFailed(error, GameServiceType.CRAZYGAMES, "CrazyGames");
    }

    /**
     * Handle Email/Password authentication success
     * @param data
     */
    private async handleEmailPasswordAuthSuccess(data: any): Promise<void> {
        await this.handleGenericAuthSuccess(data, GameServiceType.EMAIL_PASSWORD, "Email/Password");
    }

    /**
     * Handle Email/Password authentication failure
     * @param data
     */
    private handleEmailPasswordAuthFailed(data: any): void {
        this.handleGenericAuthFailed(data.error || data, GameServiceType.EMAIL_PASSWORD, "Email/Password", {
            email: data?.email,
            type: data?.type,
        });
    }

    /**
     * Handle game started event
     */
    private handleGameStarted(): void {
        //debugger;
        const settings = this.getServicesSettings();
        const isAuthRequired =
            this.activeService === GameServiceType.DISCORD && settings.discord?.isRequiredToPlay ||
            this.activeService !== GameServiceType.NONE && !this.currentUser;

        if (isAuthRequired && !this.currentUser) {
            this.showAuthenticationRequired();
        }
    }

    /**
     * Handle game ended event
     * @param gameData
     */
    private handleGameEnded(gameData?: any): void {
        // Submit final score if available
        if (gameData?.score && this.currentUser) {
            this.submitScore("main_leaderboard", gameData.score);
        }
    }

    /**
     * Handle score update event
     * @param scoreData
     */
    private handleScoreUpdated(scoreData: any): void {
        // Submit score to active service
        if (this.currentUser && scoreData.leaderboardId && scoreData.score) {
            this.submitScore(scoreData.leaderboardId, scoreData.score);
        }
    }

    /**
     * Show authentication required message
     */
    private showAuthenticationRequired(): void {
        const serviceName = this.getActiveServiceName();

        showToast({
            type: "info",
            title: "Authentication Required",
            body: `Please sign in to ${serviceName} to continue playing.`,
        });
    }

    /**
     * Public API: Submit score to leaderboard
     * @param leaderboardId
     * @param score
     */
    async submitScore(leaderboardId: string, score: number): Promise<boolean> {
        if (!this.currentUser) {
            return false;
        }

        try {
            switch (this.activeService) {
                case GameServiceType.DISCORD:
                    // Discord doesn't have native leaderboards, but we can send an event
                    EventBus.instance.send("discord.scoreSubmitted", {leaderboardId, score});
                    return true;

                case GameServiceType.CRAZYGAMES:
                    if (this.crazyGamesController) {
                        return await this.crazyGamesController.submitScore(leaderboardId, score);
                    }
                    break;

                case GameServiceType.STEAM:
                    // Steam doesn't have leaderboards in Greenworks, but we can send an event
                    EventBus.instance.send("steam.scoreSubmitted", {leaderboardId, score});
                    return true;

                case GameServiceType.GAME_CENTER:
                case GameServiceType.GOOGLE_PLAY:
                    if (this.mobileController) {
                        return await this.mobileController.submitScore(leaderboardId, score);
                    }
                    break;

                default:
                    return false;
            }
        } catch {
            // Score submission failed
        }

        return false;
    }

    /**
     * Public API: Unlock achievement
     * @param achievementId
     */
    async unlockAchievement(achievementId: string): Promise<boolean> {
        if (!this.currentUser) {
            return false;
        }

        try {
            switch (this.activeService) {
                case GameServiceType.DISCORD:
                    // Discord doesn't have native achievements, but we can send an event
                    EventBus.instance.send("discord.achievementUnlocked", {achievementId});
                    return true;

                case GameServiceType.CRAZYGAMES:
                    if (this.crazyGamesController) {
                        return await this.crazyGamesController.unlockAchievement(achievementId);
                    }
                    break;

                case GameServiceType.STEAM:
                    // Steam achievements are handled by the Steam client
                    showToast({
                        type: "info",
                        title: "Achievement",
                        body: "Steam achievements are managed through the Steam client.",
                    });
                    EventBus.instance.send("steam.achievementUnlocked", {achievementId});
                    return true;

                case GameServiceType.GAME_CENTER:
                case GameServiceType.GOOGLE_PLAY:
                    if (this.mobileController) {
                        return await this.mobileController.unlockAchievement(achievementId);
                    }
                    break;

                default:
                    return false;
            }
        } catch {
            // Achievement unlock failed
        }

        return false;
    }

    /**
     * Public API: Show leaderboards
     * @param leaderboardId
     */
    async showLeaderboards(leaderboardId?: string): Promise<boolean> {
        try {
            switch (this.activeService) {
                case GameServiceType.DISCORD:
                    showToast({
                        type: "info",
                        title: "Leaderboards",
                        body: "Discord leaderboards coming soon!",
                    });
                    return true;

                case GameServiceType.CRAZYGAMES:
                    showToast({
                        type: "info",
                        title: "Leaderboards",
                        body: "CrazyGames leaderboards are managed by the platform!",
                    });
                    return true;

                case GameServiceType.STEAM:
                    showToast({
                        type: "info",
                        title: "Leaderboards",
                        body: "Steam leaderboards coming soon!",
                    });
                    return true;

                case GameServiceType.GAME_CENTER:
                case GameServiceType.GOOGLE_PLAY:
                    if (this.mobileController) {
                        return await this.mobileController.showLeaderboard(leaderboardId || "main_leaderboard");
                    }
                    break;

                default:
                    showToast({
                        type: "info",
                        title: "Leaderboards",
                        body: "Leaderboards are not available on this platform.",
                    });
                    return false;
            }
        } catch {
            // Failed to show leaderboards
        }

        return false;
    }

    /**
     * Public API: Show achievements
     */
    async showAchievements(): Promise<boolean> {
        try {
            switch (this.activeService) {
                case GameServiceType.DISCORD:
                    showToast({
                        type: "info",
                        title: "Achievements",
                        body: "Discord achievements coming soon!",
                    });
                    return true;

                case GameServiceType.CRAZYGAMES:
                    showToast({
                        type: "info",
                        title: "Achievements",
                        body: "CrazyGames achievements are managed by the platform!",
                    });
                    return true;

                case GameServiceType.STEAM:
                    showToast({
                        type: "info",
                        title: "Achievements",
                        body: "Steam achievements are managed through the Steam client.",
                    });
                    return true;

                case GameServiceType.GAME_CENTER:
                case GameServiceType.GOOGLE_PLAY:
                    if (this.mobileController) {
                        return await this.mobileController.showAchievements();
                    }
                    break;

                default:
                    showToast({
                        type: "info",
                        title: "Achievements",
                        body: "Achievements are not available on this platform.",
                    });
                    return false;
            }
        } catch {
            // Failed to show achievements
        }

        return false;
    }

    /**
     * Get information about the current service
     */
    getActiveService(): GameServiceType {
        return this.activeService;
    }

    /**
     * Get the name of the active service
     */
    getActiveServiceName(): string {
        switch (this.activeService) {
            case GameServiceType.DISCORD:
                return "Discord";
            case GameServiceType.STEAM:
                return "Steam";
            case GameServiceType.GAME_CENTER:
                return "Game Center";
            case GameServiceType.GOOGLE_PLAY:
                return "Google Play Games";
            case GameServiceType.FIREBASE:
                return "Firebase";
            case GameServiceType.FIREBASE_ANONYMOUS:
                return "Anonymous";
            default:
                return "None";
        }
    }

    /**
     * Get current authenticated user
     */
    getCurrentUser(): UnifiedGameUser | null {
        return this.currentUser;
    }

    /**
     * Check if any service is available
     * Returns true if there's an active platform service OR a valid user (including Firebase anonymous/guest)
     */
    isAnyServiceAvailable(): boolean {
        // Platform-specific services (Discord, Game Center, Google Play)
        if (this.activeService !== GameServiceType.NONE) {
            return true;
        }

        // Firebase anonymous authentication or guest user fallback
        return this.currentUser !== null;
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated(): boolean {
        return this.currentUser !== null;
    }

    /**
     * Check if the controller has been initialized
     */
    getIsInitialized(): boolean {
        return this.isInitialized;
    }

    /**
     * Check if email/password authentication is enabled
     */
    isEmailPasswordEnabled(): boolean {
        const settings = this.engine.editor?.scene?.userData;
        return settings?.emailPassword?.enabled || false;
    }

    /**
     * Check if CrazyGames authentication is available and enabled
     */
    isCrazyGamesEnabled(): boolean {
        const settings = this.engine.editor?.scene?.userData;
        return settings?.crazyGames?.enabled || false;
    }

    /**
     * Get CrazyGames controller
     */
    getCrazyGamesController(): CrazyGamesControllerType | null {
        return this.crazyGamesController;
    }

    /**
     * Authenticate with Email/Password
     * @param email - Email address
     * @param password - Password
     * @returns Promise<boolean> - Success status
     */
    async authenticateWithEmailPassword(email: string, password: string): Promise<boolean> {
        if (!this.emailPasswordController) {
            console.error("Email/Password authentication not available");
            return false;
        }

        try {
            const user = await this.emailPasswordController.signIn(email, password);
            if (user) {
                await this.handleEmailPasswordAuthSuccess({
                    id: user.id,
                    name: user.name || "User",
                    email: email,
                });
                return true;
            }
        } catch (error) {
            this.handleEmailPasswordAuthFailed(error);
        }
        return false;
    }

    /**
     * Register with Email/Password
     * @param email - Email address
     * @param password - Password
     * @param displayName - Optional display name
     * @returns Promise<boolean> - Success status
     */
    async registerWithEmailPassword(email: string, password: string, displayName?: string): Promise<boolean> {
        if (!this.emailPasswordController) {
            console.error("Email/Password registration not available");
            return false;
        }

        try {
            const user = await this.emailPasswordController.register(email, password, displayName);
            if (user) {
                await this.handleEmailPasswordAuthSuccess({
                    id: user.id,
                    name: user.name || displayName || "User",
                    email: email,
                    isNewUser: true,
                });
                return true;
            }
        } catch (error) {
            this.handleEmailPasswordAuthFailed(error);
        }
        return false;
    }

    /**
     * Link anonymous account to Email/Password
     * @param email - Email address
     * @param password - Password
     * @returns Promise<boolean> - Success status
     */
    async linkAnonymousToEmailPassword(email: string, password: string): Promise<boolean> {
        if (!this.emailPasswordController) {
            console.error("Email/Password linking not available");
            return false;
        }

        try {
            const user = await this.emailPasswordController.linkAnonymousAccount(email, password);
            if (user) {
                await this.handleEmailPasswordAuthSuccess({
                    id: user.id,
                    name: user.name || "User",
                    email: email,
                    wasAnonymous: true,
                });
                return true;
            }
        } catch (error) {
            this.handleEmailPasswordAuthFailed(error);
        }
        return false;
    }

    /**
     * Authenticate with Steam
     * @returns Promise<boolean> - Success status
     */
    async authenticateWithSteam(): Promise<boolean> {
        try {
            await this.authenticateSteam();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Authenticate with Discord
     * @returns Promise<boolean> - Success status
     */
    async authenticateWithDiscord(): Promise<boolean> {
        try {
            await this.authenticateDiscord();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Authenticate with CrazyGames
     * @returns Promise<boolean> - Success status
     */
    async authenticateWithCrazyGames(): Promise<boolean> {
        try {
            await this.authenticateCrazyGames();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if current user can be upgraded from anonymous to authenticated
     * @returns boolean - True if user is anonymous and can be upgraded
     */
    canUpgradeAnonymousAccount(): boolean {
        return this.activeService === GameServiceType.FIREBASE_ANONYMOUS && this.currentUser !== null;
    }

    /**
     * Get available upgrade options for anonymous users
     * @returns Array of available authentication methods
     */
    getAvailableAccountUpgrades(): GameServiceType[] {
        if (!this.canUpgradeAnonymousAccount()) {
            return [];
        }

        const availableUpgrades: GameServiceType[] = [];

        // Email/password is always available if enabled
        if (this.isEmailPasswordEnabled()) {
            availableUpgrades.push(GameServiceType.EMAIL_PASSWORD);
        }

        // CrazyGames if available and enabled
        if (this.isCrazyGamesEnabled() && this.crazyGamesController) {
            availableUpgrades.push(GameServiceType.CRAZYGAMES);
        }

        // Platform-specific services
        const platformInfo = PlatformDetector.getPlatformInfo();
        if (platformInfo.gameServices.gameCenter) {
            availableUpgrades.push(GameServiceType.GAME_CENTER);
        }
        if (platformInfo.gameServices.googlePlay) {
            availableUpgrades.push(GameServiceType.GOOGLE_PLAY);
        }
        if (platformInfo.gameServices.discord) {
            availableUpgrades.push(GameServiceType.DISCORD);
        }

        return availableUpgrades;
    }
}

export default UnifiedGameServicesController;

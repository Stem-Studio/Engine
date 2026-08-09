/**
 * Enhanced Platform Detection Utility
 *
 * Provides comprehensive platform detection for determining which game services
 * are available and should be used based on the current runtime environment.
 */

import {DetectDevice} from "../../utils/DetectDevice";
import {isInCrazyGamesEnvironment, isInDiscordEnvironment} from "../playerProfile/discordEnvironment";

export enum PlatformType {
    BROWSER = "browser",
    DISCORD = "discord",
    CAPACITOR_IOS = "capacitor_ios",
    CAPACITOR_ANDROID = "capacitor_android",
    ELECTRON = "electron",
    CRAZYGAMES = "crazygames",
    UNKNOWN = "unknown",
}

export enum GameServiceType {
    DISCORD = "discord",
    GAME_CENTER = "game_center",
    GOOGLE_PLAY = "google_play",
    STEAM = "steam",
    CRAZYGAMES = "crazygames",
    FIREBASE = "firebase",
    FIREBASE_ANONYMOUS = "firebase_anonymous",
    EMAIL_PASSWORD = "email_password",
    PERSISTENT_GUEST = "persistent_guest",
    NONE = "none",
}

export interface GameServiceAvailability {
    discord: boolean;
    gameCenter: boolean;
    googlePlay: boolean;
    steam: boolean;
    crazyGames: boolean;
}

export interface PlatformInfo {
    type: PlatformType;
    os: string;
    browser: string;
    isCapacitor: boolean;
    isDiscord: boolean;
    isElectron: boolean;
    isMobile: boolean;
    gameServices: GameServiceAvailability;
    preferredService: GameServiceType;
}

export class PlatformDetector {
    // Static cache for platform info
    private static cache: {
        platformInfo: PlatformInfo | null;
        lastDetected: number;
    } = {platformInfo: null, lastDetected: 0};

    private static readonly CACHE_DURATION = 60000; // 1 minute (only used in dev mode)

    /**
     * Check if running in Discord embedded app
     */
    static isDiscord(): boolean {
        return isInDiscordEnvironment();
    }

    /**
     * Check if running in CrazyGames environment
     */
    static isCrazyGames(): boolean {
        return isInCrazyGamesEnvironment();
    }

    /**
     * Check if running in Electron
     */
    static isElectron(): boolean {
        console.debug("🔍 [PlatformDetector] isElectron() - Starting detection");

        // First check URL parameter (most reliable for our Electron wrapper)
        const urlParams = new URLSearchParams(window.location.search);
        const platformParam = urlParams.get("platform");
        console.debug(`🔍 [PlatformDetector] URL platform parameter: "${platformParam}"`);

        if (platformParam === "electron") {
            console.debug("✅ [PlatformDetector] Electron detected via URL parameter");
            return true;
        }

        // Fallback: Check for Electron environment variables and globals
        const hasRequire = false; //!!(window as any).require; - returns true in the browser
        const hasElectron = !!(window as any).electron;
        const hasElectronUserAgent = navigator.userAgent.includes("Electron");

        console.debug(
            `🔍 [PlatformDetector] Electron environment - hasRequire: ${hasRequire}, hasElectron: ${hasElectron}, hasElectronUserAgent: ${hasElectronUserAgent}`,
        );

        const result = hasRequire || hasElectron || hasElectronUserAgent;
        console.debug(`🔍 [PlatformDetector] isElectron() result: ${result}`);
        return result;
    }

    /**
     * Check if running in Capacitor native app
     */
    static isCapacitor(): boolean {
        console.debug("🔍 [PlatformDetector] isCapacitor() - Starting detection");

        // First check URL parameter (most reliable for actual native apps)
        const urlParams = new URLSearchParams(window.location.search);
        const platformParam = urlParams.get("platform");
        console.debug(`🔍 [PlatformDetector] URL platform parameter: "${platformParam}"`);

        if (platformParam === "capacitor") {
            console.debug("✅ [PlatformDetector] Capacitor detected via URL parameter");
            return true;
        }

        // Fallback: Check for Capacitor globals (less reliable, can be spoofed)
        const hasCapacitor = !!(window as any).Capacitor;
        const hasNativePlatform = !!(window as any).Capacitor?.isNativePlatform?.();
        console.debug(
            `🔍 [PlatformDetector] Capacitor globals - hasCapacitor: ${hasCapacitor}, hasNativePlatform: ${hasNativePlatform}`,
        );

        const result = hasCapacitor && hasNativePlatform;
        console.debug(`🔍 [PlatformDetector] isCapacitor() result: ${result}`);
        return result;
    }

    /**
     * Get the current platform type
     */
    static getPlatformType(): PlatformType {
        console.debug("🔍 [PlatformDetector] getPlatformType() - Starting");

        // Check for override first (development only)
        const override = this.getPlatformOverride();
        if (override) {
            console.debug(`🔧 [PlatformDetector] Using override: ${override}`);
            return override;
        }

        const isCapacitorResult = this.isCapacitor();
        console.debug(`🔍 [PlatformDetector] isCapacitor() returned: ${isCapacitorResult}`);

        if (isCapacitorResult) {
            const os = DetectDevice.getOS();
            console.debug(`🔍 [PlatformDetector] Detected OS in Capacitor: ${os}`);

            if (os === "iOS" || os === "macOS") { //iphone and ipad respectively
                console.debug("📱 [PlatformDetector] Platform type: CAPACITOR_IOS");
                return PlatformType.CAPACITOR_IOS;
            } else if (os === "Android") {
                console.debug("🤖 [PlatformDetector] Platform type: CAPACITOR_ANDROID");
                return PlatformType.CAPACITOR_ANDROID;
            } else {
                console.debug(`⚠️ [PlatformDetector] Capacitor detected but unknown OS: ${os}`);
            }
        }

        if (this.isDiscord()) {
            console.debug("🎮 [PlatformDetector] Platform type: DISCORD");
            return PlatformType.DISCORD;
        }

        if (this.isCrazyGames()) {
            console.debug("🎲 [PlatformDetector] Platform type: CRAZYGAMES");
            return PlatformType.CRAZYGAMES;
        }

        if (this.isElectron()) {
            console.debug("💻 [PlatformDetector] Platform type: ELECTRON");
            return PlatformType.ELECTRON;
        }

        if (typeof window !== "undefined" && window.location) {
            console.debug("🌐 [PlatformDetector] Platform type: BROWSER");
            return PlatformType.BROWSER;
        }

        console.debug("❓ [PlatformDetector] Platform type: UNKNOWN");
        return PlatformType.UNKNOWN;
    }

    /**
     * Check Game Center availability
     * Available on iOS in Capacitor apps
     * @param platformType
     */
    static isGameCenterAvailable(platformType: PlatformType): boolean {
        return platformType === PlatformType.CAPACITOR_IOS;
    }

    /**
     * Check Google Play Games availability
     * Available on Android in Capacitor apps
     * @param platformType
     */
    static isGooglePlayAvailable(platformType: PlatformType): boolean {
        return platformType === PlatformType.CAPACITOR_ANDROID;
    }

    /**
     * Check Steam availability
     * Available in Electron apps when Steam client is running and SDK initialized
     * @param platformType
     */
    static isSteamAvailable(platformType: PlatformType): boolean {
        if (platformType !== PlatformType.ELECTRON) {
            return false;
        }

        // Check for contextBridge-exposed Steam API (from preload script)
        const steamAPI = (window as any).steamAPI;
        if (steamAPI && typeof steamAPI.isAvailable === "function") {
            const available = steamAPI.isAvailable();
            console.debug("🎮 [PlatformDetector] Steam availability via preload:", available);
            return available;
        }

        console.debug("🎮 [PlatformDetector] Steam API not exposed (preload may not be loaded)");
        return false;
    }

    /**
     * Check CrazyGames availability
     * Available when running in CrazyGames environment
     * @param platformType
     */
    static isCrazyGamesAvailable(platformType: PlatformType): boolean {
        return platformType === PlatformType.CRAZYGAMES && isInCrazyGamesEnvironment();
    }

    /**
     * Get all available game services for current platform
     * @param platformType
     */
    static getGameServiceAvailability(platformType: PlatformType): GameServiceAvailability {
        return {
            discord: isInDiscordEnvironment(),
            gameCenter: this.isGameCenterAvailable(platformType),
            googlePlay: this.isGooglePlayAvailable(platformType),
            steam: this.isSteamAvailable(platformType),
            crazyGames: this.isCrazyGamesAvailable(platformType),
        };
    }

    /**
     * Get the preferred game service based on platform priority:
     * 1. Discord (when running in Discord)
     * 2. CrazyGames (when running in CrazyGames)
     * 3. Steam (when running in Electron with Steam)
     * 4. Game Center (when running on iOS Capacitor)
     * 5. Google Play (when running on Android Capacitor)
     * 6. None (when in browser or no services available)
     * @param platformType
     */
    static getPreferredGameService(platformType: PlatformType): GameServiceType {
        console.debug("🎮 [PlatformDetector] getPreferredGameService() - Starting");

        // Priority 1: Discord when running in Discord
        if (platformType === PlatformType.DISCORD) {
            console.debug("🎮 [PlatformDetector] Preferred service: DISCORD");
            return GameServiceType.DISCORD;
        }

        // Priority 2: CrazyGames when running in CrazyGames
        if (platformType === PlatformType.CRAZYGAMES) {
            console.debug("🎲 [PlatformDetector] Preferred service: CRAZYGAMES");
            return GameServiceType.CRAZYGAMES;
        }

        // Priority 3: Steam when running in Electron with Steam
        if (platformType === PlatformType.ELECTRON && this.isSteamAvailable(platformType)) {
            console.debug("🎮 [PlatformDetector] Preferred service: STEAM");
            return GameServiceType.STEAM;
        }

        // Priority 4: Game Center on iOS
        if (platformType === PlatformType.CAPACITOR_IOS) {
            console.debug("🎮 [PlatformDetector] Preferred service: GAME_CENTER");
            return GameServiceType.GAME_CENTER;
        }

        // Priority 5: Google Play on Android
        if (platformType === PlatformType.CAPACITOR_ANDROID) {
            console.debug("🎮 [PlatformDetector] Preferred service: GOOGLE_PLAY");
            return GameServiceType.GOOGLE_PLAY;
        }

        // No services for browser/electron without steam/unknown
        console.debug("🎮 [PlatformDetector] Preferred service: NONE");
        return GameServiceType.NONE;
    }

    /**
     * Get comprehensive platform information (cached)
     */
    static getPlatformInfo(): PlatformInfo {
        this.refreshCacheIfNeeded();
        return this.cache.platformInfo!;
    }

    /**
     * Get comprehensive platform information (fresh detection)
     */
    private static detectPlatformInfo(): PlatformInfo {
        const platformType = this.getPlatformType();
        const gameServices = this.getGameServiceAvailability(platformType);

        return {
            type: platformType,
            os: DetectDevice.getOS(),
            browser: DetectDevice.getBrowser(),
            isCapacitor: this.isCapacitor(),
            isDiscord: this.isDiscord(),
            isElectron: this.isElectron(),
            isMobile: DetectDevice.isMobile(),
            gameServices,
            preferredService: this.getPreferredGameService(platformType),
        };
    }

    /**
     * Smart cache refresh - only refreshes in development mode on browser
     */
    private static refreshCacheIfNeeded(): void {
        const now = Date.now();
        const cacheAge = now - this.cache.lastDetected;

        // Always refresh if cache is empty
        if (this.cache.lastDetected === 0) {
            this.refreshCache();
            return;
        }

        // Only refresh in development mode on browser platform
        const shouldRefresh =
            process.env.NODE_ENV === "development" &&
            typeof window !== "undefined" &&
            window.location &&
            cacheAge > this.CACHE_DURATION;

        if (shouldRefresh) {
            console.debug("🔄 [PlatformDetector] Refreshing cache (dev mode)");
            this.refreshCache();
        }
    }

    /**
     * Force refresh the cache
     */
    static refreshCache(): void {
        console.debug("🔄 [PlatformDetector] Refreshing platform detection cache");

        this.cache.platformInfo = this.detectPlatformInfo();
        this.cache.lastDetected = Date.now();

        console.debug("✅ [PlatformDetector] Cache refreshed:", {
            platformType: this.cache.platformInfo.type,
            gameServiceType: this.cache.platformInfo.preferredService,
            isCapacitor: this.cache.platformInfo.isCapacitor,
        });
    }

    /**
     * Check if any game services are available
     * @param platformType
     */
    static hasAnyGameServices(platformType: PlatformType): boolean {
        const availability = this.getGameServiceAvailability(platformType);
        return (
            availability.discord ||
            availability.gameCenter ||
            availability.googlePlay ||
            availability.steam ||
            availability.crazyGames
        );
    }

    /**
     * Check if we're in a mobile Capacitor environment
     */
    static isMobileCapacitor(): boolean {
        const platformInfo = this.getPlatformInfo();
        return (
            platformInfo.isCapacitor &&
            (platformInfo.type === PlatformType.CAPACITOR_IOS || platformInfo.type === PlatformType.CAPACITOR_ANDROID)
        );
    }

    /**
     * Check if mobile game services should be available
     */
    static shouldHaveMobileGameServices(): boolean {
        const platformInfo = this.getPlatformInfo();
        return (
            this.isMobileCapacitor() &&
            (platformInfo.preferredService === GameServiceType.GAME_CENTER ||
                platformInfo.preferredService === GameServiceType.GOOGLE_PLAY)
        );
    }

    /**
     * Get human-readable platform description
     */
    static getPlatformDescription(): string {
        const info = this.getPlatformInfo();

        switch (info.type) {
            case PlatformType.DISCORD:
                return "Discord Embedded App";
            case PlatformType.CRAZYGAMES:
                return "CrazyGames Platform";
            case PlatformType.CAPACITOR_IOS:
                return "iOS Mobile App";
            case PlatformType.CAPACITOR_ANDROID:
                return "Android Mobile App";
            case PlatformType.BROWSER:
                return `${info.browser} Browser`;
            case PlatformType.ELECTRON:
                return "Desktop App (Electron)";
            default:
                return "Unknown Platform";
        }
    }

    /**
     * Log platform detection information for debugging
     */
    static logPlatformInfo(): void {
        const info = this.getPlatformInfo();

        console.debug("🔍 Platform Detection Results:");
        console.debug(`  Platform: ${this.getPlatformDescription()}`);
        console.debug(`  OS: ${info.os}`);
        console.debug(`  Mobile: ${info.isMobile ? "Yes" : "No"}`);
        console.debug(`  Game Services Available:`);
        console.debug(`    Discord: ${info.gameServices.discord ? "✅" : "❌"}`);
        console.debug(`    CrazyGames: ${info.gameServices.crazyGames ? "✅" : "❌"}`);
        console.debug(`    Game Center: ${info.gameServices.gameCenter ? "✅" : "❌"}`);
        console.debug(`    Google Play: ${info.gameServices.googlePlay ? "✅" : "❌"}`);
        console.debug(`    Steam: ${info.gameServices.steam ? "✅" : "❌"}`);
        console.debug(`  Preferred Service: ${info.preferredService}`);
    }

    /**
     * Force override platform detection for testing
     * Only works in development mode
     * @param platformType
     */
    static overridePlatform(platformType: PlatformType): void {
        if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
            console.warn("Platform override only works in development mode");
            return;
        }

        (window as any).__PLATFORM_OVERRIDE = platformType;
        console.debug(`🔧 Platform override set to: ${platformType}`);
    }

    /**
     * Clear platform override
     */
    static clearPlatformOverride(): void {
        delete (window as any).__PLATFORM_OVERRIDE;
        console.debug("🔧 Platform override cleared");
    }

    /**
     * Check if platform override is active (development only)
     */
    private static getPlatformOverride(): PlatformType | null {
        if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
            return null;
        }

        return (window as any).__PLATFORM_OVERRIDE || null;
    }
}

export default PlatformDetector;

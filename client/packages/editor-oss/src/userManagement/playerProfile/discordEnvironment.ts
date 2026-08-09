let isInsideDiscordCached: boolean | undefined;

export function isInDiscordEnvironment() {
    if (isInsideDiscordCached === undefined) {
        isInsideDiscordCached = (typeof location !== "undefined" && location.host?.includes("discordsays.com")) || false;
    }

    return isInsideDiscordCached;
}

export function getDiscordClientIdFromUrl() {
    return location.host.split(".")[0];
}

export function isInCrazyGamesEnvironment() {
    const hasCrazyGamesSDK = typeof window !== "undefined" && !!(window as any).CrazyGames;
    const isCrazyGamesDomain =
        typeof window !== "undefined" &&
        (window.location.hostname.includes("crazygames.com") || window.location.hostname.includes("crazygames."));
    const platformParam =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("platform") === "crazygames";

    return hasCrazyGamesSDK || isCrazyGamesDomain || platformParam;
}

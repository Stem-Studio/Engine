export enum GAME_CATEGORY {
    FPS = "FPS",
    OBBY = "Obby",
    MULTIPLAYER = "Multiplayer",
    SANDBOX = "Sandbox",
    COMPETITIVE = "Competitive",
    SIMULATION = "Simulation",
    VIBE = "Vibe",
}

export const TAGS = [
    GAME_CATEGORY.FPS,
    GAME_CATEGORY.OBBY,
    GAME_CATEGORY.MULTIPLAYER,
    GAME_CATEGORY.SANDBOX,
    GAME_CATEGORY.COMPETITIVE,
    GAME_CATEGORY.SIMULATION,
    GAME_CATEGORY.VIBE,
];

/**
 * Community / social channel URLs. The previous hardcoded values pointed
 * at the Erth.AI community; in this repository or fork deployments these don't apply.
 * Configure via env vars so each deployment can wire its own channels (or
 * omit them entirely — consumers should check for empty strings before
 * rendering a button).
 *
 *   REACT_APP_DISCORD_URL        - Discord invite (e.g. https://discord.gg/abc)
 *   REACT_APP_DISCORD_SERVER_URL - Discord server invite (canonical form)
 *   REACT_APP_X_URL              - X / Twitter profile
 *   REACT_APP_YOUTUBE_URL        - YouTube channel
 */
export const DISCORD_LINK = process.env.REACT_APP_DISCORD_URL ?? "";
export const DISCORD_SERVER_LINK = process.env.REACT_APP_DISCORD_SERVER_URL ?? "";
export const X_LINK = process.env.REACT_APP_X_URL ?? "";
export const YOUTUBE_LINK = process.env.REACT_APP_YOUTUBE_URL ?? "";

/**
 * External destinations rendered in footers and the dashboard. Each one is
 * empty by default — the consuming component hides the link when its value
 * is "". Configure via env vars to wire up a deployment's own destinations.
 *
 *   REACT_APP_BLOG_URL      - blog landing page
 *   REACT_APP_FORUM_URL     - community forum
 *   REACT_APP_DOCS_URL      - documentation host (root URL)
 *   REACT_APP_ABOUT_URL     - external "About" page if served off-origin
 */
export const BLOG_LINK = process.env.REACT_APP_BLOG_URL ?? "";
export const FORUM_LINK = process.env.REACT_APP_FORUM_URL ?? "";
export const DOCS_LINK = process.env.REACT_APP_DOCS_URL ?? "";
export const ABOUT_LINK = process.env.REACT_APP_ABOUT_URL ?? "";

/** Returns the configured social links, filtered to just the ones set. */
export const getConfiguredSocialLinks = (): Array<{kind: "discord" | "x" | "youtube"; url: string}> =>
    [
        {kind: "discord" as const, url: DISCORD_LINK},
        {kind: "x" as const, url: X_LINK},
        {kind: "youtube" as const, url: YOUTUBE_LINK},
    ].filter(entry => !!entry.url);

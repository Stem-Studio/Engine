import {GameServiceType} from "../../utils/PlatformDetector";

const EMAIL_DOMAIN = "erthgames.com";
const MAX_LOCAL_PART_LENGTH = 64;
const MAX_DISPLAY_SEGMENT_LENGTH = 24;
const MAX_PLAYER_SEGMENT_PREFIX_LENGTH = 20;

const trimHyphens = (value: string): string => value.replace(/^-+|-+$/g, "");

export const sanitizeMobileGameServiceEmailSegment = (
    value: string | null | undefined,
    fallback: string,
    maxLength = Number.POSITIVE_INFINITY,
): string => {
    const sanitized = trimHyphens(
        String(value ?? "")
            .toLowerCase()
            .replace(/[ ._]/g, "-")
            .replace(/[^a-z0-9-]/g, "")
            .replace(/--+/g, "-"),
    );

    const segment = sanitized || fallback;
    return trimHyphens(segment.slice(0, maxLength)) || fallback;
};

const stableHash = (value: string): string => {
    let hash = 0x811c9dc5;

    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(36);
};

const createPlayerSegment = (playerID: string): string => {
    const sanitizedPlayerID = sanitizeMobileGameServiceEmailSegment(
        playerID,
        "player",
        MAX_PLAYER_SEGMENT_PREFIX_LENGTH,
    );

    return `${sanitizedPlayerID}-${stableHash(playerID)}`;
};

export const createMobileGameServiceEmail = (
    service: GameServiceType,
    displayName: string | null | undefined,
    playerID: string,
): string => {
    const serviceSegment = sanitizeMobileGameServiceEmailSegment(service, "mobile");
    const displaySegment = sanitizeMobileGameServiceEmailSegment(
        displayName,
        "player",
        MAX_DISPLAY_SEGMENT_LENGTH,
    );
    const playerSegment = createPlayerSegment(playerID);
    const localPart = `${serviceSegment}_${displaySegment}_${playerSegment}`.slice(0, MAX_LOCAL_PART_LENGTH);

    return `${trimHyphens(localPart)}@${EMAIL_DOMAIN}`;
};

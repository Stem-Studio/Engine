import {describe, expect, it} from "vitest";
import {GameServiceType} from "../../utils/PlatformDetector";
import {
    createMobileGameServiceEmail,
    sanitizeMobileGameServiceEmailSegment,
} from "./MobileGameServiceIdentity";

describe("MobileGameServiceIdentity", () => {
    it("creates distinct emails for users with the same display name", () => {
        const firstEmail = createMobileGameServiceEmail(GameServiceType.GAME_CENTER, "Sam Player", "player-1");
        const secondEmail = createMobileGameServiceEmail(GameServiceType.GAME_CENTER, "Sam Player", "player-2");

        expect(firstEmail).not.toBe(secondEmail);
        expect(firstEmail).toContain("sam-player");
        expect(secondEmail).toContain("sam-player");
    });

    it("sanitizes display and player ids into email-safe segments", () => {
        const email = createMobileGameServiceEmail(
            GameServiceType.GOOGLE_PLAY,
            " Player.Name_#42 ",
            "Google Player:/ABC 123",
        );

        expect(email).toMatch(/^google-play_player-name-42_google-playerabc-123-[a-z0-9]+@erthgames\.com$/);
    });

    it("keeps generated local parts within the email limit", () => {
        const email = createMobileGameServiceEmail(
            GameServiceType.GAME_CENTER,
            "A Very Long Native Display Name That Would Otherwise Overflow The Local Part",
            "native-provider-player-id-with-a-very-long-stable-identifier",
        );
        const localPart = email.split("@")[0]!;

        expect(localPart.length).toBeLessThanOrEqual(64);
    });

    it("uses deterministic fallback segments instead of random identity text", () => {
        expect(sanitizeMobileGameServiceEmailSegment("", "player")).toBe("player");
        expect(sanitizeMobileGameServiceEmailSegment("!!!", "player")).toBe("player");
    });
});

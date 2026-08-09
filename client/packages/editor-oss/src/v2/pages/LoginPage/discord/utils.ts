import type {IDiscordUser} from "@stem/network/api/discord";

export default class DiscordUtils {
    public static async getUserDataFromToken(_authToken: string): Promise<IDiscordUser> {
        throw new Error("Discord sign-in is not available in this local app.");
    }
}

import {isInDiscordEnvironment} from "../userManagement/playerProfile/discordEnvironment";

export const REACT_APP_MULTIPLAYER_SERVER_URL = isInDiscordEnvironment()
    ? `wss://${window.location.host}/.proxy/multiplayer`
    : process.env.REACT_APP_MULTIPLAYER_SERVER_URL
      ? process.env.REACT_APP_MULTIPLAYER_SERVER_URL
      : "ws://localhost:2567";

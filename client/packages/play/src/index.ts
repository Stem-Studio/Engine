// Initialize custom logger early in application startup
import {initializeLogger} from "@web-shared/utils/Logger";
import "@web-shared/polyfills";
// Side-effect import: keeps the historical bootstrap path alive and
// registers open-source browser integrations.
import "@web-shared/bootstrap/integrated";
import EngineRuntime from "@web-shared/EngineRuntime";
import {AppEntrypoint, setAppEntrypoint} from "@web-shared/entrypoint";
import {isInDiscordEnvironment} from "@web-shared/userManagement/playerProfile/discordEnvironment";
import {getQueryString} from "@web-shared/utils/QueryStringUtils";
import {createBackendAdapter} from "@stem/network";

setAppEntrypoint(AppEntrypoint.PLAY);

// Unregister service workers when ?nosw=1 is set (e.g. Discord embeds that block SW).
if (getQueryString("nosw") && "serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const reg of registrations) {
            reg.unregister();
        }
    }).catch(() => {});
}

const startPlayer = (_sceneID: string) => {
    const container = document.getElementById("container")!;
    const backendAdapter = createBackendAdapter("play");
    const app = new EngineRuntime(container, {
        server: backendAdapter.server,
        enableCache: true,
        isPlayModeOnly: true,
    });
    void app.init();
};

const start = async () => {
    const pathnameSegments = window.location.pathname.split("/").filter(Boolean);
    const rawPathProjectId = pathnameSegments[0] === "play" ? pathnameSegments[pathnameSegments.length - 1] : null;
    const pathSceneId = rawPathProjectId?.startsWith("id-")
        ? (rawPathProjectId.match(/^id-([^-]+)/)?.[1] ?? rawPathProjectId)
        : rawPathProjectId;

    let sceneID = pathSceneId || getQueryString("sceneID");
    if (isInDiscordEnvironment()) {
        try {
            const discordAppId = location.host.split(".")[0];
            const mappingResponse = await fetch(`/.proxy/resolveSceneId/${discordAppId}`);
            const mappingData = await mappingResponse.json();
            console.info(`Discord -> Stem Studio Mapping ${JSON.stringify(mappingData)}`);
            sceneID = mappingData["game_id"];
        } catch (error) {
            alert("Error while loading the project: " + error);
            console.error("Error while loading the project: " + error);
        }
    }

    if (sceneID) {
        startPlayer(sceneID);
    }
};

initializeLogger(); // Uses environment-based defaults

void start();

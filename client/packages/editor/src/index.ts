// This is needed by old build system.
import "@web-shared/polyfills";
// Side-effect import: keeps the historical bootstrap path alive and
// registers open-source browser integrations.
import "@web-shared/bootstrap/integrated";

import EngineRuntime from "@web-shared/EngineRuntime";
import {AppEntrypoint, setAppEntrypoint} from "@web-shared/entrypoint";
import {createBackendAdapter} from "@stem/network";
import {initializeLogger, LogLevel} from "@web-shared/utils/Logger";

setAppEntrypoint(AppEntrypoint.EDITOR);
initializeLogger(undefined, LogLevel.LOG); // Editor: show all logs by default

const container = document.getElementById("container");
const backendAdapter = createBackendAdapter("editor");
const app = new EngineRuntime(container!, {
    server: backendAdapter.server,
    enableCache: true,
    isPlayModeOnly: false,
});

void app.init();

/**
 * Open-source browser integration bootstrap.
 *
 * The local app only registers integrations that are available in this
 * repository. Today that means the browser-direct playground copilot.
 */

import {isPlaygroundMode} from "@web-shared/playgroundMode";

const playgroundCopilotRegistrationModules = import.meta.glob(
    "../../../editor-oss/src/copilot/registerPlaygroundCopilot.ts",
);

if (isPlaygroundMode()) {
    const loadRegisterPlaygroundCopilot =
        playgroundCopilotRegistrationModules["../../../editor-oss/src/copilot/registerPlaygroundCopilot.ts"];

    if (loadRegisterPlaygroundCopilot) {
        void loadRegisterPlaygroundCopilot().then(module => {
            const {registerPlaygroundCopilot} =
                module as typeof import("@stem/editor-oss/copilot/registerPlaygroundCopilot");
            registerPlaygroundCopilot();
        });
    }
}

export {};

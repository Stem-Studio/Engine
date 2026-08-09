// Wires the browser-direct copilot into the editor when it runs inside the
// public-site playground. Called once from the compatibility bootstrap.
//
// Outside the playground this is a no-op: the copilot seam stays empty (the
// panel hides itself) unless a fork registers its own provider.

import {isPlaygroundMode} from "@web-shared/playgroundMode";

let registered = false;

export function registerPlaygroundCopilot(): void {
    if (registered || !isPlaygroundMode()) return;
    registered = true;

    void installPlaygroundCopilot();
}

async function installPlaygroundCopilot(): Promise<void> {
    const [{setCopilotProviderFactory}, {DirectCopilotProvider}, {refreshCopilotKeysMarker}] = await Promise.all([
        import("./copilotProviderFactory"),
        import("./DirectCopilotProvider"),
        import("./playgroundCopilotKeys"),
    ]);

    // Prime the synchronous key-presence marker so the editor-mode resolver
    // can decide between AI-focused and advanced layout on the first scene
    // load. If this loses the race, AI-prompt projects simply open in
    // advanced mode until the next load — the intended fallback.
    void refreshCopilotKeysMarker();
    setCopilotProviderFactory(() => new DirectCopilotProvider());
}

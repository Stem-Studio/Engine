type ScriptImportActivityListener = (inProgress: boolean) => void;

type ScriptImportActivityState = {
    activeImportCount: number;
    listeners: Set<ScriptImportActivityListener>;
};

const SCRIPT_IMPORT_ACTIVITY_KEY = "__stemScriptImportActivity";

const getScriptImportActivityState = (): ScriptImportActivityState => {
    const root = globalThis as typeof globalThis & {
        [SCRIPT_IMPORT_ACTIVITY_KEY]?: ScriptImportActivityState;
    };

    root[SCRIPT_IMPORT_ACTIVITY_KEY] ??= {
        activeImportCount: 0,
        listeners: new Set<ScriptImportActivityListener>(),
    };

    return root[SCRIPT_IMPORT_ACTIVITY_KEY];
};

const notifyScriptImportActivity = (): void => {
    const {listeners} = getScriptImportActivityState();
    const inProgress = isScriptImportInProgress();
    for (const listener of listeners) {
        listener(inProgress);
    }
};

export function isScriptImportInProgress(): boolean {
    return getScriptImportActivityState().activeImportCount > 0;
}

export function beginScriptImportActivity(): () => void {
    let ended = false;
    const state = getScriptImportActivityState();
    state.activeImportCount += 1;
    notifyScriptImportActivity();

    return () => {
        if (ended) return;
        ended = true;
        const state = getScriptImportActivityState();
        state.activeImportCount = Math.max(0, state.activeImportCount - 1);
        notifyScriptImportActivity();
    };
}

export function subscribeScriptImportActivity(listener: ScriptImportActivityListener): () => void {
    const {listeners} = getScriptImportActivityState();
    listeners.add(listener);
    listener(isScriptImportInProgress());

    return () => {
        listeners.delete(listener);
    };
}

export function resetScriptImportActivityForTests(): void {
    const state = getScriptImportActivityState();
    state.activeImportCount = 0;
    state.listeners.clear();
}

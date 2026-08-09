import {useEffect, useReducer} from "react";

import EngineRuntime from "../EngineRuntime";
import Editor from "../editor/Editor";
import global from "../global";

/**
 * Bridges the editor's imperative objectSelected / objectChanged events
 * into React state so that components re-render when the selection changes.
 *
 * Returns `selected` (always read fresh from editor) plus a monotonically
 * increasing `selectionVersion` that can be used as a dependency-array key.
 * @param namespace
 */
export function useEditorSelection(namespace: string) {
    const app = global.app as EngineRuntime;
    const editor = app?.editor as Editor;

    // A simple counter – incrementing it forces a re-render.
    const [selectionVersion, increment] = useReducer((n: number) => n + 1, 0);

    useEffect(() => {
        if (!app) return;

        app.on(`objectSelected.${namespace}`, increment);
        app.on(`objectArraySelected.${namespace}`, increment);
        app.on(`objectChanged.${namespace}`, increment);
        app.on(`cadModeChanged.${namespace}`, increment);
        app.on(`cadToolChanged.${namespace}`, increment);
        app.on(`cadSelectionModeChanged.${namespace}`, increment);
        app.on(`cadSelectionShapeChanged.${namespace}`, increment);
        app.on(`cadAxisConstraintChanged.${namespace}`, increment);
        app.on(`cadSelectionChanged.${namespace}`, increment);

        // If the event already fired before we mounted (e.g. returning from
        // play mode), force one render so we pick up the current selection.
        increment();

        return () => {
            app.on(`objectSelected.${namespace}`, null);
            app.on(`objectArraySelected.${namespace}`, null);
            app.on(`objectChanged.${namespace}`, null);
            app.on(`cadModeChanged.${namespace}`, null);
            app.on(`cadToolChanged.${namespace}`, null);
            app.on(`cadSelectionModeChanged.${namespace}`, null);
            app.on(`cadSelectionShapeChanged.${namespace}`, null);
            app.on(`cadAxisConstraintChanged.${namespace}`, null);
            app.on(`cadSelectionChanged.${namespace}`, null);
        };
    }, [app, namespace]);

    const selected = editor?.selected ?? null;

    return {selected, selectionVersion, editor, app};
}

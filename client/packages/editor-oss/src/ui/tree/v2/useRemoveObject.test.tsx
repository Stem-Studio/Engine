import {afterEach, describe, expect, it, vi} from "vitest";
import {act, cleanup, renderHook} from "@testing-library/react";
import type {MouseEvent} from "react";
import * as THREE from "three";

import History from "../../../command/History";
import global from "../../../global";
import {
    commitPlanCadSceneData,
    createDefaultPlanCadData,
    createPlanCadPart,
    createPlanCadRectangleSlab,
    createPlanCadRectangleZone,
    createPlanCadWall,
    findPlanCadRoot,
    getPlanCadSceneData,
    installPlanCadSceneSync,
} from "../../../editor/assets/v2/PlanMode/planCadEditorBridge";
import {useRemoveObject} from "./useRemoveObject";

vi.mock("../../../context/AssetResolutionContext", () => ({
    useAssetResolutionContext: () => ({context: {}}),
}));

vi.mock("../../../editor/models/hooks/models", () => ({
    useCreateModelRevision: () => vi.fn(),
}));

vi.mock("../../../editor/asset-management/hooks/useChangeModelRevision", () => ({
    useChangeModelRevision: () => vi.fn(),
}));

vi.mock("@stem/network/api/asset", () => ({
    getAsset: vi.fn(),
}));

function createPopulatedPlanCadData() {
    return createPlanCadPart(
        createPlanCadRectangleZone(
            createPlanCadRectangleSlab(
                createPlanCadWall(
                    createDefaultPlanCadData(),
                    {x: 0, z: 0},
                    {x: 5, z: 0},
                ),
                {x: 0, z: 0},
                {x: 5, z: 4},
            ),
            {x: 0.5, z: 0.5},
            {x: 2.5, z: 2.5},
        ),
        {x: 1.5, z: 1.5},
        {partPresetId: "sofa"},
    );
}

async function flushPlanCadSync() {
    await Promise.resolve();
    await Promise.resolve();
}

function createEditorHarness() {
    const scene = new THREE.Scene();
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const editor: any = {
        scene,
        selected: null,
        addObject: vi.fn(async (object: THREE.Object3D, parent?: THREE.Object3D) => {
            (parent ?? scene).add(object);
            app.call("objectAdded", editor, object);
            app.call("sceneGraphChanged", editor);
        }),
        removeObject: vi.fn((object: THREE.Object3D) => {
            object.parent?.remove(object);
            app.call("objectRemoved", editor, object);
            app.call("sceneGraphChanged", editor);
        }),
        objectByUuid: vi.fn((uuid: string) => {
            let result: THREE.Object3D | undefined;
            scene.traverse((object) => {
                if (!result && object.uuid === uuid) result = object;
            });
            return result;
        }),
        execute: vi.fn((command: unknown, optionalName?: string) =>
            editor.history.execute(command, optionalName),
        ),
        select: vi.fn((object: THREE.Object3D | null) => {
            editor.selected = object;
            app.call("objectSelected", editor, object);
        }),
    };
    const app: any = {
        editor,
        on: vi.fn((eventName: string, handler: ((...args: unknown[]) => void) | null) => {
            if (handler) handlers.set(eventName, handler);
            else handlers.delete(eventName);
        }),
        call: vi.fn((eventName: string, ...args: unknown[]) => {
            for (const [registeredName, handler] of handlers) {
                if (registeredName.split(".")[0] === eventName) handler(...args);
            }
        }),
    };
    editor.history = new History(editor);
    global.app = app;
    return {app, editor, scene};
}

describe("useRemoveObject BIM deletion", () => {
    afterEach(() => {
        cleanup();
        global.app = null;
        vi.restoreAllMocks();
    });

    it("clears BIM plan data and does not recreate the root when deleting BIM Plan from the outliner", async () => {
        const {app, editor, scene} = createEditorHarness();
        const disposeSync = installPlanCadSceneSync(app);
        await commitPlanCadSceneData(editor, createPopulatedPlanCadData());
        const root = findPlanCadRoot(scene);
        expect(root).toBeTruthy();
        editor.execute.mockClear();

        const {result} = renderHook(() => useRemoveObject());
        const event = {stopPropagation: vi.fn()} as unknown as MouseEvent<HTMLDivElement>;

        await act(async () => {
            await result.current(event, root!.uuid);
            await flushPlanCadSync();
        });

        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(getPlanCadSceneData(scene)).toBeNull();
        expect(findPlanCadRoot(scene)).toBeNull();
        expect(editor.execute).toHaveBeenCalledTimes(1);
        expect(editor.execute.mock.calls[0]?.[0]?.type).toBe("PlanCadSceneDataCommand");

        app.call("historyChanged", editor);
        app.call("objectChanged", editor, scene);
        await flushPlanCadSync();

        expect(getPlanCadSceneData(scene)).toBeNull();
        expect(findPlanCadRoot(scene)).toBeNull();
        disposeSync();
    });
});

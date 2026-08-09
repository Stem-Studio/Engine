import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, render, screen, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import * as THREE from "three";

import global from "@stem/editor-oss/global";
import {ProjectTab} from "./ProjectTab";

vi.mock("@stem/editor-oss/context", () => ({
    useAppGlobalContext: () => ({
        activeRightPanel: "None",
        setActiveRightPanel: vi.fn(),
    }),
}));

vi.mock("../../../../../../ui/tree/v2/Tree", () => ({
    Tree: ({data}: {data: Array<{value: string; text: string; children?: unknown[]}>}) => {
        const renderNode = (node: {value: string; text: string; children?: any[]}): ReactNode => (
            <li key={node.value} data-testid={`project-tree-node-${node.text}`}>
                {node.text}
                {node.children?.length ? <ul>{node.children.map(renderNode)}</ul> : null}
            </li>
        );
        return <ul data-testid="project-tree">{data.map(renderNode)}</ul>;
    },
}));

vi.mock("../../../../../../editor/prefabs/hooks/prefabs", () => ({
    useConvertToPrefab: () => vi.fn(),
    useEditPrefab: () => vi.fn(),
    useRevertPrefab: () => vi.fn(),
    useSavePrefab: () => vi.fn(),
}));

vi.mock("../../../../../../editor/prefabs/hooks/exportImportStem", () => ({
    useExportStem: () => vi.fn(),
}));

vi.mock("../../../../../../editor/models/hooks/ungroupModelAsset", () => ({
    useUngroupModelAsset: () => vi.fn(),
}));

function createProjectTabHarness() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.name = "Camera";
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const app = {
        userId: "user-1",
        editor: {
            scene,
            camera,
            selected: null,
            sceneLockedItems: [],
            lambdaConfigRegistry: {getConfig: vi.fn()},
            objectByUuid: vi.fn((uuid: string) => {
                if (uuid === scene.uuid) return scene;
                if (uuid === camera.uuid) return camera;
                let result: THREE.Object3D | undefined;
                scene.traverse((object) => {
                    if (!result && object.uuid === uuid) result = object;
                });
                return result;
            }),
            select: vi.fn(),
            focusByUUID: vi.fn(),
        },
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
    global.app = app as any;
    return {app, scene};
}

describe("ProjectTab object removal refresh", () => {
    afterEach(() => {
        cleanup();
        global.app = null;
        vi.restoreAllMocks();
    });

    it("removes generated BIM Plan nodes from the tree on objectRemoved events", async () => {
        const {app, scene} = createProjectTabHarness();
        const root = new THREE.Group();
        root.name = "BIM Plan";
        root.userData.isRuntimeOnly = true;
        root.userData.isPlanCadManaged = true;
        root.userData.isPlanCadRoot = true;
        scene.add(root);

        render(<ProjectTab isVisible />);

        await screen.findByTestId("project-tree-node-BIM Plan");

        scene.remove(root);
        app.call("objectRemoved", app.editor, root);

        await waitFor(() => {
            expect(screen.queryByTestId("project-tree-node-BIM Plan")).toBeNull();
        });
    });
});

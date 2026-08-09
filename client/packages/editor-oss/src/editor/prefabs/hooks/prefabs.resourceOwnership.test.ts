import {renderHook} from "@testing-library/react";
import {
    BoxGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Texture,
} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {
    resetGpuResourceOwnershipForTests,
} from "@stem/editor-oss/core/resources/GpuResourceOwnership";
import MeshUtils from "@stem/editor-oss/utils/MeshUtils";

const hoisted = vi.hoisted(() => ({
    loadPrefab: vi.fn(),
    showToast: vi.fn(),
    insertedObjects: [] as Object3D[],
    globalMock: {
        app: {
            editor: {
                execute: vi.fn(),
            },
        },
    },
}));

vi.mock("@stem/network/api/asset", () => ({
    AssetType: {Prefab: "prefab"},
    forkAsset: vi.fn(),
    getAsset: vi.fn(),
}));
vi.mock("@stem/network/api/scene", () => ({
    saveScene: vi.fn(),
}));
vi.mock("@stem/editor-oss/context/AssetResolutionContext", () => ({
    useAssetResolutionContext: () => ({setAssetRevision: vi.fn()}),
}));
vi.mock("@stem/editor-oss/editor/asset-management/hooks/assets", () => ({
    useAddEditorDependencies: () => ({mutateAsync: vi.fn()}),
    useCreateAssetRevisionWithData: () => ({mutateAsync: vi.fn()}),
    useCreateAssetWithData: () => ({mutateAsync: vi.fn()}),
}));
vi.mock("@stem/editor-oss/editor/asset-management/hooks/useReplaceAsset", () => ({
    useReplaceAsset: () => vi.fn(),
}));
vi.mock("@stem/editor-oss/editor/assets/v2/common/hooks/useCanEditAsset", () => ({
    useCanEditAsset: () => ({canFork: true}),
}));
vi.mock("@stem/editor-oss/editor/models/hooks/models", () => ({
    useCreateThumbnailDerivative: () => vi.fn(),
}));
vi.mock("@stem/editor-oss/global", () => ({default: hoisted.globalMock}));
vi.mock("@stem/editor-oss/prefab/serialization", () => ({
    serializePrefab: vi.fn(),
}));
vi.mock("@stem/editor-oss/prefab/util", () => ({
    canConvertToPrefab: vi.fn(),
    checkPrefabUnlock: vi.fn(),
    getPrefabEditRevisionId: vi.fn(),
    getPrefabId: (object: Object3D) => object.userData?.prefabId ?? null,
    isPrefab: (object: Object3D) => Boolean(object.userData?.prefabId),
    isPrefabUnlocked: (object: Object3D) => Boolean(object.userData?.prefabEditRevisionId),
    isPrefabUnlockedInScene: vi.fn(),
    loadPrefab: (...args: unknown[]) => hoisted.loadPrefab(...args),
    lockPrefab: vi.fn(),
    PrefabConversionError: {None: "none"},
    setPrefabId: (object: Object3D, prefabId: string | null) => {
        if (prefabId) {
            object.userData.prefabId = prefabId;
        } else {
            delete object.userData.prefabId;
        }
    },
    unlockPrefab: vi.fn(),
}));
vi.mock("@stem/editor-oss/showToast", () => ({
    showToast: (...args: unknown[]) => hoisted.showToast(...args),
}));
vi.mock("@stem/editor-oss/utils/Converter", () => ({
    default: {dataURLtoFile: vi.fn()},
}));
vi.mock("@stem/editor-oss/utils/ElementsUtils", () => ({
    ElementsUtils: {confirm: vi.fn()},
}));
vi.mock("@stem/editor-oss/utils/ModelUtils", () => ({
    ModelUtils: {createThumbnailFromModel: vi.fn()},
}));
vi.mock("@stem/editor-oss/utils/SceneUtil", () => ({
    getScene: vi.fn(),
    traverseSceneDepthFirst: (object: Object3D, visitor: (object: Object3D) => boolean | void) => {
        const stack: Object3D[] = [object];
        while (stack.length > 0) {
            const current = stack.pop()!;
            const shouldTraverse = visitor(current);
            if (shouldTraverse === false) continue;
            for (let index = current.children.length - 1; index >= 0; index--) {
                stack.push(current.children[index]!);
            }
        }
    },
}));
vi.mock("@stem/editor-oss/v2/pages/services", () => ({
    generateUniqueName: vi.fn((name: string) => name),
    getObjectNamesInScene: vi.fn(() => new Set<string>()),
}));
vi.mock("@stem/editor-oss/editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/constants", () => ({
    THUMBNAIL_SIZE: 256,
}));
vi.mock("@stem/editor-oss/command/Commands", () => ({
    AddObjectCommand: class AddObjectCommand {
        type = "add";
        constructor(public object: Object3D, public parent?: Object3D) {}
    },
    RemoveObjectCommand: class RemoveObjectCommand {
        type = "remove";
        constructor(public object: Object3D) {}
    },
}));

import {useUpdatePrefabInstances} from "./prefabs";

const createPrefabTemplate = () => {
    const root = new Group();
    root.userData.prefabId = "prefab-1";
    const geometry = new BoxGeometry();
    const texture = new Texture();
    const material = new MeshStandardMaterial({map: texture});
    root.add(new Mesh(geometry, material));

    return {
        root,
        disposeGeometry: vi.spyOn(geometry, "dispose"),
        disposeMaterial: vi.spyOn(material, "dispose"),
        disposeTexture: vi.spyOn(texture, "dispose"),
    };
};

describe("useUpdatePrefabInstances GPU resource ownership", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetGpuResourceOwnershipForTests();
        hoisted.insertedObjects.length = 0;
        hoisted.globalMock.app.editor.execute.mockImplementation(async (command: {
            type: string;
            object: Object3D;
            parent?: Object3D;
        }) => {
            if (command.type === "remove") {
                command.object.parent?.remove(command.object);
            } else {
                command.parent?.add(command.object);
                hoisted.insertedObjects.push(command.object);
            }
        });
    });

    afterEach(() => {
        for (const object of hoisted.insertedObjects) {
            MeshUtils.dispose(object);
        }
        resetGpuResourceOwnershipForTests();
        vi.restoreAllMocks();
    });

    it("retains inserted clones before disposing the temporary loaded prefab", async () => {
        const scene = new Group();
        const target = new Group();
        target.userData.prefabId = "prefab-1";
        scene.add(target);
        const template = createPrefabTemplate();
        hoisted.loadPrefab.mockResolvedValue(template.root);

        const {result} = renderHook(() => useUpdatePrefabInstances());

        await result.current(scene, "prefab-1");

        expect(hoisted.insertedObjects).toHaveLength(1);
        expect(template.disposeGeometry).not.toHaveBeenCalled();
        expect(template.disposeMaterial).not.toHaveBeenCalled();
        expect(template.disposeTexture).not.toHaveBeenCalled();

        MeshUtils.dispose(hoisted.insertedObjects.pop()!);

        expect(template.disposeGeometry).toHaveBeenCalledOnce();
        expect(template.disposeMaterial).toHaveBeenCalledOnce();
        expect(template.disposeTexture).toHaveBeenCalledOnce();
    });
});

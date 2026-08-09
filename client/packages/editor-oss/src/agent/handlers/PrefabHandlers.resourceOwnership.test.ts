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
} from "../../core/resources/GpuResourceOwnership";
import MeshUtils from "../../utils/MeshUtils";

const hoisted = vi.hoisted(() => ({
    loadPrefab: vi.fn(),
    insertedObjects: [] as Object3D[],
}));

vi.mock("@stem/network/api/asset", () => ({
    AssetType: {Prefab: "prefab"},
    createAssetDerivativeWithData: vi.fn(),
    getAsset: vi.fn(),
}));
vi.mock("@stem/network/api/scene", () => ({
    saveScene: vi.fn(),
}));
vi.mock("../../editor/asset-management/hooks/assets", () => ({
    createAsset: vi.fn(),
}));
vi.mock("../../prefab/serialization", () => ({
    serializePrefab: vi.fn(),
}));
vi.mock("../../prefab/util", () => ({
    loadPrefab: (...args: unknown[]) => hoisted.loadPrefab(...args),
    setPrefabId: (object: Object3D, prefabId: string | null) => {
        if (prefabId) {
            object.userData.prefabId = prefabId;
        } else {
            delete object.userData.prefabId;
        }
    },
}));
vi.mock("../../showToast", () => ({
    showToast: vi.fn(),
}));
vi.mock("../../global", () => ({
    default: {app: {call: vi.fn()}},
}));
vi.mock("../../utils/Converter", () => ({
    default: {dataURLtoFile: vi.fn()},
}));
vi.mock("../../utils/ModelUtils", () => ({
    ModelUtils: {createThumbnailFromModel: vi.fn()},
}));
vi.mock("../../utils/SceneTraverser", async importOriginal => {
    const actual = await importOriginal<typeof import("../../utils/SceneTraverser")>();
    return {
        ...actual,
        findObjectByUuidOrNameDepthFirst: vi.fn(),
    };
});
vi.mock("../../utils/SceneUtil", () => ({
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
vi.mock("../../v2/pages/services", () => ({
    generateUniqueName: vi.fn((name: string) => name),
    getObjectNamesInScene: vi.fn(() => new Set<string>()),
}));
vi.mock("../../editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/constants", () => ({
    THUMBNAIL_SIZE: 256,
}));
vi.mock("../../command/Commands", () => ({
    AddObjectCommand: class AddObjectCommand {
        type = "add";
        constructor(public object: Object3D, public parent?: Object3D) {}
    },
    RemoveObjectCommand: class RemoveObjectCommand {
        type = "remove";
        constructor(public object: Object3D) {}
    },
}));

import {PrefabHandlers} from "./PrefabHandlers";

const createPrefabTemplate = () => {
    const root = new Group();
    root.userData.prefabId = "prefab-1";
    root.userData.prefabRevisionId = "rev-1";
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

describe("PrefabHandlers GPU resource ownership", () => {
    let editor: {
        scene: Object3D;
        execute: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        resetGpuResourceOwnershipForTests();
        hoisted.insertedObjects.length = 0;
        editor = {
            scene: new Group(),
            execute: vi.fn(async (command: {
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
            }),
        };
    });

    afterEach(() => {
        for (const object of hoisted.insertedObjects) {
            MeshUtils.dispose(object);
        }
        resetGpuResourceOwnershipForTests();
        vi.restoreAllMocks();
    });

    it("retains handler-inserted clones before disposing the temporary loaded prefab", async () => {
        const target = new Group();
        target.name = "target";
        target.userData.prefabId = "prefab-1";
        target.userData.prefabRevisionId = "old-rev";
        editor.scene.add(target);
        const template = createPrefabTemplate();
        hoisted.loadPrefab.mockResolvedValue(template.root);
        const handlers = new PrefabHandlers({editor, scene: editor.scene} as never);

        await (handlers as unknown as {
            updatePrefabInstances(scene: Object3D, prefabId: string): Promise<void>;
        }).updatePrefabInstances(editor.scene, "prefab-1");

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

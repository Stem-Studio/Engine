import {afterEach, describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import Editor from "./Editor";
import {getPreferredDrillDownChild, isSceneHierarchyNode} from "./selectionHierarchy";

type SelectableEditorTestDouble = Editor & {
    engine: {userId: string; call: ReturnType<typeof vi.fn>};
};

const makeSelectableEditor = (scene: THREE.Scene) => {
    const editor = Object.create(Editor.prototype) as any;

    Object.defineProperty(editor, "scene", {
        configurable: true,
        get: () => scene,
    });

    editor.selected = null;
    editor.sceneConfig = {
        isCollaborative: false,
        isSandbox: false,
        isMultiplayer: false,
    };
    editor.engine = {userId: "user-1", call: vi.fn()};
    editor.component = {setState: vi.fn()};
    editor.cadMode = false;
    editor.cadEditedObjectUuid = null;

    return editor as SelectableEditorTestDouble;
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe("Editor selection hierarchy", () => {
    it("keeps current selection when child nodes are hidden from the scene hierarchy", () => {
        const root = new THREE.Object3D();
        root.name = "ImportedModel";
        root.userData = {isStemObject: true};

        const armature = new THREE.Object3D();
        armature.name = "Armature";
        armature.userData = {isRuntimeOnly: true};

        const mesh = new THREE.Object3D();
        mesh.name = "Body";
        mesh.userData = {isRuntimeOnly: true};
        (mesh as THREE.Object3D & {geometry?: object}).geometry = {};

        root.add(armature);
        armature.add(mesh);

        expect(getPreferredDrillDownChild(root)).toBe(root);
    });

    it("still drills down to child objects that are visible in the scene hierarchy", () => {
        const root = new THREE.Object3D();
        root.name = "ImportedModel";
        root.userData = {isStemObject: true};

        const childGroup = new THREE.Object3D();
        childGroup.name = "VisibleChild";
        childGroup.userData = {isStemObject: true};

        root.add(childGroup);

        expect(getPreferredDrillDownChild(root)).toBe(childGroup);
    });

    it("treats generated BIM groups as scene hierarchy nodes even when runtime-only", () => {
        const root = new THREE.Object3D();
        root.name = "BIM Plan";
        root.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadManaged: true,
            isPlanCadRoot: true,
        };

        const childGroup = new THREE.Object3D();
        childGroup.name = "BIM Wall";
        childGroup.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadManaged: true,
            planNodeId: "wall-1",
        };

        root.add(childGroup);

        expect(isSceneHierarchyNode(root)).toBe(true);
        expect(isSceneHierarchyNode(childGroup)).toBe(true);
        expect(getPreferredDrillDownChild(root)).toBe(childGroup);
    });

    it("treats BIM groups with equivalent metadata as hierarchy nodes without requiring isPlanCadManaged", () => {
        const root = new THREE.Object3D();
        root.name = "BIM Plan";
        root.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            managedBy: "BIM Plan",
            sceneTreeBadge: "BIM",
        };

        expect(isSceneHierarchyNode(root)).toBe(true);
        expect(getPreferredDrillDownChild(root)).toBe(root);
    });

    it("treats runtime BIM wrapper groups as hierarchy nodes when descendants carry BIM metadata", () => {
        const wrapper = new THREE.Object3D();
        wrapper.name = "BIM Wrapper";
        wrapper.userData = {
            isRuntimeOnly: true,
            isSelectable: true,
        };

        const wall = new THREE.Object3D();
        wall.name = "BIM Wall";
        wall.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadManaged: true,
            planNodeId: "wall-1",
        };
        wrapper.add(wall);

        const dynamicRoot = new THREE.Object3D();
        dynamicRoot.name = "[Dynamic]";
        dynamicRoot.add(wrapper);

        expect(isSceneHierarchyNode(wrapper)).toBe(true);
        expect(getPreferredDrillDownChild(wrapper)).toBe(wall);
        expect(isSceneHierarchyNode(dynamicRoot)).toBe(false);
    });

    it("selects BIM groups under dynamic roots without requiring isPlanCadManaged", () => {
        const scene = new THREE.Scene();
        const dynamicRoot = new THREE.Object3D();
        dynamicRoot.name = "[Dynamic]";
        const bimGroup = new THREE.Object3D();
        bimGroup.name = "BIM Group";
        bimGroup.userData = {
            isRuntimeOnly: true,
            managedBy: "BIM Plan",
            sceneTreeBadge: "BIM",
        };
        dynamicRoot.add(bimGroup);
        scene.add(dynamicRoot);

        const editor = makeSelectableEditor(scene);

        editor.select(bimGroup);

        expect(editor.selected).toBe(bimGroup);
        expect(editor.engine.call).toHaveBeenCalledWith("objectSelected", editor, bimGroup, undefined);
    });

    it("normalizes one-object BIM array selections so groups keep transform/property UI", () => {
        const scene = new THREE.Scene();
        const dynamicRoot = new THREE.Object3D();
        dynamicRoot.name = "[Dynamic]";
        const bimGroup = new THREE.Object3D();
        bimGroup.name = "BIM Group";
        bimGroup.userData = {
            isRuntimeOnly: true,
            managedBy: "BIM Plan",
            sceneTreeBadge: "BIM",
        };
        dynamicRoot.add(bimGroup);
        scene.add(dynamicRoot);

        const editor = makeSelectableEditor(scene);

        editor.select([bimGroup]);

        expect(editor.selected).toBe(bimGroup);
        expect(editor.component?.setState).toHaveBeenCalledWith({showRightPanel: true});
        expect(editor.engine.call).toHaveBeenCalledWith("objectSelected", editor, bimGroup, undefined);
    });

    it("exits mesh CAD mode before selecting a BIM group for transforms", () => {
        const scene = new THREE.Scene();
        const editedMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const bimGroup = new THREE.Object3D();
        bimGroup.name = "BIM Group";
        bimGroup.userData = {
            isRuntimeOnly: true,
            managedBy: "BIM Plan",
            sceneTreeBadge: "BIM",
        };
        scene.add(editedMesh, bimGroup);

        const editor = makeSelectableEditor(scene);
        editor.cadMode = true;
        editor.cadEditedObjectUuid = editedMesh.uuid;
        const exitCADMode = vi.fn(() => {
            editor.cadMode = false;
            editor.cadEditedObjectUuid = null;
        });
        editor.exitCADMode = exitCADMode as typeof editor.exitCADMode;

        editor.select(bimGroup);

        expect(exitCADMode).toHaveBeenCalledWith({notifySelection: false});
        expect(editor.selected).toBe(bimGroup);
        expect(editor.engine.call).toHaveBeenCalledWith("objectSelected", editor, bimGroup, undefined);
    });

    it("keeps ordinary object selection blocked while mesh CAD mode edits another mesh", () => {
        const scene = new THREE.Scene();
        const editedMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const ordinaryGroup = new THREE.Object3D();
        ordinaryGroup.userData = {isStemObject: true};
        scene.add(editedMesh, ordinaryGroup);

        const editor = makeSelectableEditor(scene);
        editor.cadMode = true;
        editor.cadEditedObjectUuid = editedMesh.uuid;
        const exitCADMode = vi.fn();
        editor.exitCADMode = exitCADMode as typeof editor.exitCADMode;

        editor.select(ordinaryGroup);

        expect(exitCADMode).not.toHaveBeenCalled();
        expect(editor.selected).toBeNull();
        expect(editor.engine.call).not.toHaveBeenCalled();
    });

    it("selects BIM node objects without requiring isPlanCadManaged", () => {
        const scene = new THREE.Scene();
        const root = new THREE.Object3D();
        root.name = "BIM Root";
        root.userData = {
            isRuntimeOnly: true,
            isPlanCadRoot: true,
        };
        const wall = new THREE.Object3D();
        wall.name = "BIM Wall";
        wall.userData = {
            isRuntimeOnly: true,
            planNodeId: "wall-1",
            planNodeType: "wall",
        };
        root.add(wall);
        scene.add(root);

        const editor = makeSelectableEditor(scene);

        editor.select(wall);

        expect(editor.selected).toBe(wall);
        expect(editor.engine.call).toHaveBeenCalledWith("objectSelected", editor, wall, undefined);
    });

    it("selects BIM wrapper groups when descendants carry BIM metadata", () => {
        const scene = new THREE.Scene();
        const dynamicRoot = new THREE.Object3D();
        dynamicRoot.name = "[Dynamic]";
        const wrapper = new THREE.Object3D();
        wrapper.name = "BIM Wrapper";
        wrapper.userData = {
            isRuntimeOnly: true,
            isSelectable: true,
        };
        const wall = new THREE.Object3D();
        wall.userData = {
            isPlanCadManaged: true,
            planNodeId: "wall-1",
        };
        wrapper.add(wall);
        dynamicRoot.add(wrapper);
        scene.add(dynamicRoot);

        const editor = makeSelectableEditor(scene);

        editor.select(wrapper);

        expect(editor.selected).toBe(wrapper);
        expect(editor.engine.call).toHaveBeenCalledWith("objectSelected", editor, wrapper, undefined);
    });

    it("uses iterative scene lookups for uuid and userData ID selection paths", () => {
        const scene = new THREE.Scene();
        const parent = new THREE.Object3D();
        const target = new THREE.Object3D();
        target.userData.ID = "model-id";
        parent.add(target);
        scene.add(parent);

        const editor = makeSelectableEditor(scene) as any;
        const camera = new THREE.PerspectiveCamera();
        Object.defineProperty(editor, "camera", {
            configurable: true,
            get: () => camera,
        });
        editor.select = vi.fn();
        editor.focus = vi.fn();
        const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traverse should not be used for editor lookup");
        });

        expect(editor.objectByUuid(target.uuid)).toBe(target);
        expect(editor.modelByID("model-id")).toBe(target);

        editor.selectByUuid(target.uuid);
        expect(editor.select).toHaveBeenCalledWith(target);

        editor.selectByUuid([target.uuid, camera.uuid]);
        expect(editor.select).toHaveBeenLastCalledWith([target, camera]);

        editor.focusByUUID(target.uuid);
        expect(editor.focus).toHaveBeenCalledWith(target);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("collects camera look-at candidates iteratively and excludes the player subtree", () => {
        const scene = new THREE.Scene();
        const player = new THREE.Object3D();
        player.name = "Player";
        const playerChild = new THREE.Object3D();
        playerChild.name = "PlayerChild";
        player.add(playerChild);
        const target = new THREE.Object3D();
        target.name = "Target";
        scene.add(player, target);

        const editor = makeSelectableEditor(scene) as any;
        const camera = new THREE.PerspectiveCamera();
        Object.defineProperty(editor, "camera", {
            configurable: true,
            get: () => camera,
        });
        editor.engine = {
            ...editor.engine,
            game: {player},
        };

        let intersectedObjects: THREE.Object3D[] = [];
        const intersectSpy = vi.spyOn(THREE.Raycaster.prototype, "intersectObjects")
            .mockImplementation((objects: THREE.Object3D[]) => {
                intersectedObjects = objects;
                return [];
            });
        const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traverse should not be used for camera look-at collection");
        });

        const point = editor.getCameraLookAtPoint(10);

        expect(point).toBeInstanceOf(THREE.Vector3);
        expect(intersectSpy).toHaveBeenCalledOnce();
        expect(intersectedObjects).toContain(target);
        expect(intersectedObjects).not.toContain(player);
        expect(intersectedObjects).not.toContain(playerChild);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("finds nested texture currentSrc without recursive traversal", () => {
        const scene = new THREE.Scene();
        const texture = new THREE.Texture({currentSrc: "texture-url.png"});
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(),
            new THREE.MeshBasicMaterial({map: texture}),
        );
        const parent = new THREE.Object3D();
        parent.add(mesh);
        scene.add(parent);
        const editor = makeSelectableEditor(scene) as any;
        const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traverse should not be used for texture lookup");
        });

        expect(editor.getTextureCurrentSrcByUUID(parent, texture.uuid)).toBe("texture-url.png");
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("removes preview boxes without recursive traversal", () => {
        const scene = new THREE.Scene();
        const target = new THREE.Object3D();
        target.userData.physics = {enable_preview: true};
        scene.add(target);
        const sceneHelpers = new THREE.Object3D();
        const previewBox = new THREE.Object3D();
        previewBox.userData.previewBoxId = target.uuid;
        sceneHelpers.add(previewBox);
        const editor = makeSelectableEditor(scene) as any;
        Object.defineProperty(editor, "sceneHelpers", {
            configurable: true,
            get: () => sceneHelpers,
        });
        const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traverse should not be used for preview box cleanup");
        });

        editor.removePreviewBoxes();

        expect(target.userData.physics.enable_preview).toBe(false);
        expect(previewBox.parent).toBeNull();
        expect(editor.engine.call).toHaveBeenCalledWith("objectChanged", editor, editor);
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});

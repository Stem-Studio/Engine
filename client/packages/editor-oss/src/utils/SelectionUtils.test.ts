import {
    BoxGeometry,
    Group,
    GridHelper,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    PointLight,
    Scene,
    Vector2,
} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import global from "../global";
import {DYNAMIC_ROOT_NAME} from "@stem/editor-oss/scene/dynamicRoots";
import {canSelectObject, findObjectsInRectangle, getNonSelectableReason} from "./SelectionUtils";

const makeApp = (overrides: {
    scene?: Object3D | null;
    camera?: Object3D | null;
    sceneLockedItems?: string[] | ReadonlySet<string>;
    mode?: string;
    playerUuid?: string;
}) => ({
    editor: {
        scene: overrides.scene ?? null,
        camera: overrides.camera ?? null,
        sceneLockedItems: overrides.sceneLockedItems,
    },
    mode: overrides.mode,
    game: overrides.playerUuid ? {player: {uuid: overrides.playerUuid}} : undefined,
});

function addDeepObjectChain(root: Object3D, depth = 12_000): Object3D {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        current.add(child);
        current = child;
    }

    return current;
}

describe("SelectionUtils.getNonSelectableReason", () => {
    it("rejects null/undefined", () => {
        expect(getNonSelectableReason(null, makeApp({}))).toBe("null-object");
        expect(getNonSelectableReason(undefined, makeApp({}))).toBe("null-object");
    });

    it("rejects helpers and gizmos by tag", () => {
        const helper = new Object3D();
        (helper as Object3D & {tag?: string}).tag = "helper";
        const gizmo = new Object3D();
        (gizmo as Object3D & {tag?: string}).tag = "gizmo";

        expect(getNonSelectableReason(helper, makeApp({}))).toBe("tag-helper");
        expect(getNonSelectableReason(gizmo, makeApp({}))).toBe("tag-gizmo");
    });

    it("rejects the editor scene and camera", () => {
        const scene = new Scene();
        const camera = new PerspectiveCamera();

        expect(getNonSelectableReason(scene, makeApp({scene, camera}))).toBe("editor-scene");
        expect(getNonSelectableReason(camera, makeApp({scene, camera}))).toBe("editor-camera");
    });

    it("rejects GridHelper instances", () => {
        const grid = new GridHelper(10, 10);
        expect(getNonSelectableReason(grid, makeApp({}))).toBe("grid-helper");
    });

    it("rejects objects whose uuid is in sceneLockedItems", () => {
        const obj = new Mesh();
        const app = makeApp({sceneLockedItems: [obj.uuid]});
        expect(getNonSelectableReason(obj, app)).toBe("locked-item");
    });

    it("accepts set-backed sceneLockedItems for repeated selection checks", () => {
        const obj = new Mesh();
        const app = makeApp({sceneLockedItems: new Set([obj.uuid])});
        expect(getNonSelectableReason(obj, app)).toBe("locked-item");
    });

    it("rejects the player object", () => {
        const obj = new Mesh();
        const app = makeApp({playerUuid: obj.uuid});
        expect(getNonSelectableReason(obj, app)).toBe("player-object");
    });

    it("rejects isSelectable=false objects in play mode", () => {
        const obj = new Mesh();
        obj.userData.isSelectable = false;
        expect(getNonSelectableReason(obj, makeApp({mode: "play"}))).toBe("isSelectable-false-in-play-mode");
    });

    it("allows isSelectable=false objects in edit mode", () => {
        const obj = new Mesh();
        obj.userData.isSelectable = false;
        expect(getNonSelectableReason(obj, makeApp({mode: "edit"}))).toBeNull();
    });

    it("rejects dynamic and scene-helper infrastructure in edit mode", () => {
        const dynamicRoot = new Group();
        dynamicRoot.name = DYNAMIC_ROOT_NAME;
        dynamicRoot.userData.isRuntimeOnly = true;

        const helperRoot = new Group();
        helperRoot.name = "SceneHelpers";
        helperRoot.userData.isRuntimeOnly = true;
        helperRoot.userData.isSceneHelperRoot = true;

        const helperMesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        helperMesh.userData.isRuntimeOnly = true;
        helperMesh.userData.isSceneHelper = true;

        dynamicRoot.add(helperRoot);
        helperRoot.add(helperMesh);

        expect(getNonSelectableReason(dynamicRoot, makeApp({mode: "edit"}))).toBe("hidden-hierarchy");
        expect(getNonSelectableReason(helperRoot, makeApp({mode: "edit"}))).toBe("hidden-hierarchy");
        expect(getNonSelectableReason(helperMesh, makeApp({mode: "edit"}))).toBe("hidden-hierarchy");
    });

    it("allows runtime BIM wrapper groups when descendants carry BIM metadata", () => {
        const wrapper = new Group();
        wrapper.userData.isRuntimeOnly = true;

        const planObject = new Group();
        planObject.userData.isPlanCadManaged = true;
        planObject.userData.planNodeId = "wall-1";
        wrapper.add(planObject);

        expect(getNonSelectableReason(wrapper, makeApp({mode: "edit"}))).toBeNull();
    });

    it("rejects runtime wrapper groups when descendants do not carry BIM metadata", () => {
        const wrapper = new Group();
        wrapper.userData.isRuntimeOnly = true;

        const ordinaryChild = new Group();
        wrapper.add(ordinaryChild);

        expect(getNonSelectableReason(wrapper, makeApp({mode: "edit"}))).toBe("hidden-hierarchy");
    });

    it("allows ordinary meshes", () => {
        const obj = new Mesh();
        expect(getNonSelectableReason(obj, makeApp({}))).toBeNull();
    });

    it("tolerates a null app and editor", () => {
        const obj = new Mesh();
        expect(getNonSelectableReason(obj, null)).toBeNull();
        expect(getNonSelectableReason(obj, {editor: null})).toBeNull();
    });
});

describe("SelectionUtils.canSelectObject", () => {
    it("is true when there is no rejection reason", () => {
        const obj = new Mesh();
        expect(canSelectObject(obj, makeApp({}))).toBe(true);
    });

    it("is false when any rule rejects", () => {
        const grid = new GridHelper(10, 10);
        expect(canSelectObject(grid, makeApp({}))).toBe(false);
    });

    it("narrows the type when true", () => {
        const obj: Object3D | null = new Mesh();
        if (canSelectObject(obj, makeApp({}))) {
            expect(obj.uuid).toBeDefined();
        }
    });
});

describe("SelectionUtils.findObjectsInRectangle", () => {
    // Orthographic camera (-1..1, -1..1) at z=5 looking at origin.
    // World (0,0,0) projects to NDC (0, 0), which lands at viewport center.
    const makeCamera = () => {
        const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
        cam.position.set(0, 0, 5);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();
        return cam;
    };

    const VIEWPORT = {left: 0, top: 0, width: 100, height: 100};

    const makeMeshAt = (x: number, y: number, z = 0, size = 0.2) => {
        const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial());
        mesh.position.set(x, y, z);
        mesh.updateMatrixWorld(true);
        return mesh;
    };

    it("returns an empty array when the rect misses everything", () => {
        const scene = new Scene();
        scene.add(makeMeshAt(0, 0));
        scene.updateMatrixWorld(true);

        const found = findObjectsInRectangle({
            scene,
            camera: makeCamera(),
            viewport: VIEWPORT,
            start: new Vector2(80, 80),
            end: new Vector2(95, 95),
            app: makeApp({}),
        });

        expect(found).toEqual([]);
    });

    it("selects a mesh whose projection lies inside the rect (left-to-right)", () => {
        const scene = new Scene();
        const mesh = makeMeshAt(0, 0);
        scene.add(mesh);
        scene.updateMatrixWorld(true);

        const found = findObjectsInRectangle({
            scene,
            camera: makeCamera(),
            viewport: VIEWPORT,
            start: new Vector2(40, 40),
            end: new Vector2(60, 60),
            app: makeApp({}),
        });

        expect(found).toContain(mesh);
        expect(found).toHaveLength(1);
    });

    it("selects meshes in deep hierarchies without recursive scene traversal", () => {
        const scene = new Scene();
        const leaf = addDeepObjectChain(scene);
        const mesh = makeMeshAt(0, 0);
        leaf.add(mesh);
        const traverseSpy = vi.spyOn(scene, "traverse");

        const found = findObjectsInRectangle({
            scene,
            camera: makeCamera(),
            viewport: VIEWPORT,
            start: new Vector2(40, 40),
            end: new Vector2(60, 60),
            app: makeApp({}),
        });

        expect(found).toContain(mesh);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("requires every corner inside on left-to-right drag", () => {
        // Mesh projection corners are (~45, ~45), (~45, ~55), (~55, ~45), (~55, ~55).
        // Rect (43,43)→(50,50) cleanly contains only the (45,45) corner, so the
        // left-to-right "all corners inside" rule should reject the mesh.
        const scene = new Scene();
        scene.add(makeMeshAt(0, 0));
        scene.updateMatrixWorld(true);

        const found = findObjectsInRectangle({
            scene,
            camera: makeCamera(),
            viewport: VIEWPORT,
            start: new Vector2(43, 43),
            end: new Vector2(50, 50),
            app: makeApp({}),
        });

        expect(found).toEqual([]);
    });

    it("accepts any-corner-inside on right-to-left drag", () => {
        // Same partial-overlap rect drawn right-to-left (end.x < start.x):
        // exactly one projected corner sits inside, so `some(insideRect)` accepts.
        const scene = new Scene();
        const mesh = makeMeshAt(0, 0);
        scene.add(mesh);
        scene.updateMatrixWorld(true);

        const found = findObjectsInRectangle({
            scene,
            camera: makeCamera(),
            viewport: VIEWPORT,
            start: new Vector2(50, 50),
            end: new Vector2(43, 43),
            app: makeApp({}),
        });

        expect(found).toContain(mesh);
    });

    it("selects a Light when its center is inside the rect", () => {
        const scene = new Scene();
        const light = new PointLight();
        light.position.set(0, 0, 0);
        light.updateMatrixWorld(true);
        scene.add(light);
        scene.updateMatrixWorld(true);

        const found = findObjectsInRectangle({
            scene,
            camera: makeCamera(),
            viewport: VIEWPORT,
            start: new Vector2(40, 40),
            end: new Vector2(60, 60),
            app: makeApp({}),
        });

        expect(found).toContain(light);
    });

    it("filters out objects rejected by canSelectObject (locked items)", () => {
        const scene = new Scene();
        const locked = makeMeshAt(0, 0);
        scene.add(locked);
        scene.updateMatrixWorld(true);

        const found = findObjectsInRectangle({
            scene,
            camera: makeCamera(),
            viewport: VIEWPORT,
            start: new Vector2(40, 40),
            end: new Vector2(60, 60),
            app: makeApp({sceneLockedItems: [locked.uuid]}),
        });

        expect(found).toEqual([]);
    });

    it("converts large locked-item arrays once during rectangle selection", () => {
        const scene = new Scene();
        const locked = makeMeshAt(0, 0);
        scene.add(locked);
        scene.updateMatrixWorld(true);
        const lockedItems = [
            "locked-0",
            "locked-1",
            "locked-2",
            "locked-3",
            "locked-4",
            "locked-5",
            "locked-6",
            locked.uuid,
        ];
        const includes = vi.spyOn(lockedItems, "includes");

        const found = findObjectsInRectangle({
            scene,
            camera: makeCamera(),
            viewport: VIEWPORT,
            start: new Vector2(40, 40),
            end: new Vector2(60, 60),
            app: makeApp({sceneLockedItems: lockedItems}),
        });

        expect(found).toEqual([]);
        expect(includes).not.toHaveBeenCalled();
    });

    it("promotes generated BIM wall segment meshes to their owner group without global editor state", () => {
        const previousApp = global.app;
        global.app = null;

        const scene = new Scene();
        const wallGroup = new Group();
        wallGroup.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadManaged: true,
            planNodeId: "wall-1",
            planNodeType: "wall",
            managedBy: "BIM Plan",
        };
        const wallSegment = makeMeshAt(0, 0);
        wallSegment.userData = {
            isRuntimeOnly: true,
            isPlanCadGeneratedChild: true,
            planCadOwnerNodeId: "wall-1",
            planCadOwnerNodeType: "wall",
        };
        wallGroup.add(wallSegment);
        scene.add(wallGroup);
        scene.updateMatrixWorld(true);

        const found = findObjectsInRectangle({
            scene,
            camera: makeCamera(),
            viewport: VIEWPORT,
            start: new Vector2(40, 40),
            end: new Vector2(60, 60),
            app: makeApp({}),
        });

        global.app = previousApp;
        expect(found).toEqual([wallGroup]);
    });

    describe("with editor scene set on global (partToMesh promotion)", () => {
        let prevApp: typeof global.app;

        beforeEach(() => {
            prevApp = global.app;
        });

        afterEach(() => {
            global.app = prevApp;
        });

        it("promotes leaf meshes to the topmost isStemObject ancestor and dedupes", () => {
            const scene = new Scene();
            const root = new Object3D();
            root.userData.isStemObject = true;
            const leafA = makeMeshAt(-0.05, 0);
            const leafB = makeMeshAt(0.05, 0);
            root.add(leafA, leafB);
            scene.add(root);
            scene.updateMatrixWorld(true);

            // partToMesh reads global.app.editor.scene — give it a fake one
            // so the isStemObject walk runs.
            global.app = {
                editor: {scene} as never,
            } as never;

            const found = findObjectsInRectangle({
                scene,
                camera: makeCamera(),
                viewport: VIEWPORT,
                start: new Vector2(40, 40),
                end: new Vector2(60, 60),
                app: makeApp({}),
            });

            expect(found).toEqual([root]);
        });

        it("promotes imported BIM model children to the managed BIM group", () => {
            const scene = new Scene();
            const bimGroup = new Object3D();
            bimGroup.userData = {
                isStemObject: true,
                isRuntimeOnly: true,
                isPlanCadManaged: true,
                planNodeId: "item-1",
                managedBy: "BIM Plan",
            };
            const importedRoot = new Object3D();
            importedRoot.userData = {
                isStemObject: true,
                isRuntimeOnly: true,
            };
            const leaf = makeMeshAt(0, 0);
            leaf.userData.isRuntimeOnly = true;
            leaf.userData.isPlanCadExternalModelChild = true;
            importedRoot.add(leaf);
            bimGroup.add(importedRoot);
            scene.add(bimGroup);
            scene.updateMatrixWorld(true);

            global.app = {
                editor: {scene} as never,
            } as never;

            const found = findObjectsInRectangle({
                scene,
                camera: makeCamera(),
                viewport: VIEWPORT,
                start: new Vector2(40, 40),
                end: new Vector2(60, 60),
                app: makeApp({}),
            });

            expect(found).toEqual([bimGroup]);
        });
    });
});

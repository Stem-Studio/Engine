import {Box3, BoxGeometry, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, Vector3} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    globalMock: {app: null},
}));

vi.mock("../global", () => ({
    default: hoisted.globalMock,
}));

import SelectHelper from "./SelectHelper";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

class BoundsOnlyObject extends Object3D {
    getBoundingBox(_centersOnly = false) {
        return new Box3(
            new Vector3(-1, -2, -3),
            new Vector3(1, 2, 3),
        );
    }
}

class ThrowingBoundsObject extends Object3D {
    getBoundingBox(_centersOnly = false) {
        throw new Error("getBoundingBox should not be called for GS selection bounds");
    }
}

function addDeepObjectChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        child.name = `deep-${i}`;
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("SelectHelper billboard selection bounds", () => {
    beforeEach(() => {
        hoisted.globalMock.app = {
            userId: "local-user",
            editor: {isSandbox: false},
            isPlaying: false,
        } as never;
    });

    it("uses stable billboard bounds when the billboard wrapper has no geometry", () => {
        const helper = new SelectHelper();
        const billboard = new Object3D();

        billboard.userData = {
            isBillboard: true,
            billboardSelectionBounds: {
                width: 12.7,
                height: 7.2,
                depth: 0.001,
            },
        };
        billboard.position.set(5, 2, -3);
        billboard.rotation.y = Math.PI / 2;
        billboard.scale.set(2, 3, 1);
        billboard.updateMatrixWorld(true);

        const box = helper.getSelectionBox(billboard, true);

        expect(box).not.toBeNull();

        const center = box!.getCenter(new Vector3());
        const size = box!.getSize(new Vector3());

        expect(center.x).toBeCloseTo(5);
        expect(center.y).toBeCloseTo(2);
        expect(center.z).toBeCloseTo(-3);
        expect(size.y).toBeCloseTo(21.6);
        expect(size.x).toBeCloseTo(0.001, 5);
        expect(size.z).toBeCloseTo(25.4);
    });

    it("uses getBoundingBox bounds when the selected object has no geometry", () => {
        const helper = new SelectHelper();
        const root = new Object3D();
        const splatLike = new BoundsOnlyObject();

        root.rotation.y = Math.PI / 2;
        root.scale.set(2, 1, 3);
        splatLike.position.set(4, 0, 0);
        root.add(splatLike);
        root.updateMatrixWorld(true);

        const box = helper.getSelectionBox(root, true);

        expect(box).not.toBeNull();

        const center = box!.getCenter(new Vector3());
        const size = box!.getSize(new Vector3());

        expect(center.x).toBeCloseTo(0);
        expect(center.y).toBeCloseTo(0);
        expect(center.z).toBeCloseTo(-8);
        expect(size.x).toBeCloseTo(18);
        expect(size.y).toBeCloseTo(4);
        expect(size.z).toBeCloseTo(4);
    });

    it("skips bbox computation for gaussian splat objects", () => {
        const helper = new SelectHelper();
        const gsRoot = new Object3D();
        const gsChild = new ThrowingBoundsObject();

        gsChild.userData.__isGaussianSplat = true;
        gsRoot.position.set(2, 3, 4);
        gsRoot.add(gsChild);
        gsRoot.updateMatrixWorld(true);

        const withoutFallback = helper.getSelectionBox(gsRoot, false);
        const withFallback = helper.getSelectionBox(gsRoot, true);

        expect(withoutFallback).toBeNull();
        expect(withFallback).not.toBeNull();

        const center = withFallback!.getCenter(new Vector3());
        expect(center.x).toBeCloseTo(2);
        expect(center.y).toBeCloseTo(3);
        expect(center.z).toBeCloseTo(4);
    });

    it("reuses caller-provided box targets on hot selection paths", () => {
        const helper = new SelectHelper();

        const billboard = new Object3D();
        billboard.userData = {
            isBillboard: true,
            billboardSelectionBounds: {
                width: 2,
                height: 4,
                depth: 1,
            },
        };
        billboard.position.set(3, 4, 5);
        billboard.updateMatrixWorld(true);

        const billboardTarget = new Box3();
        expect(helper.getBillboardSelectionBox(billboard, billboardTarget)).toBe(billboardTarget);

        const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
        mesh.position.set(7, 0, 0);
        mesh.updateMatrixWorld(true);

        const objectTarget = new Box3();
        expect(helper.getObjectWorldSelectionBox(mesh, objectTarget)).toBe(objectTarget);
        expect(objectTarget.getCenter(new Vector3()).x).toBeCloseTo(7);

        const fallback = new Object3D();
        fallback.position.set(9, 1, 2);
        fallback.updateMatrixWorld(true);

        const fallbackTarget = new Box3();
        expect(helper.createFallbackSelectionBox(fallback, fallbackTarget)).toBe(fallbackTarget);
        expect(fallbackTarget.getCenter(new Vector3()).x).toBeCloseTo(9);
    });

    it("focuses generated groups on their geometry instead of the group origin", () => {
        const target = new Vector3();
        const update = vi.fn();
        hoisted.globalMock.app = {
            editor: {
                controls: {
                    current: {
                        controls: {target, update},
                    },
                },
            },
        } as never;

        const helper = new SelectHelper();
        const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
        camera.position.set(0, 0, 10);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);

        const generatedGroup = new Object3D();
        const wall = new Mesh(new BoxGeometry(4, 3, 0.2), new MeshBasicMaterial());
        wall.position.set(40, 1.5, -12);
        generatedGroup.add(wall);
        generatedGroup.updateMatrixWorld(true);

        helper.focusCameraOnObject(camera, generatedGroup);

        expect(target.x).toBeCloseTo(40);
        expect(target.y).toBeCloseTo(1.5);
        expect(target.z).toBeCloseTo(-12);
        expect(camera.position.x).toBeCloseTo(40);
        expect(update).toHaveBeenCalledTimes(1);
    });
});

describe("SelectHelper transform control ownership", () => {
    const getTransformControlsMock = () =>
        (hoisted.globalMock.app as unknown as {
            transformControls: {detach: ReturnType<typeof vi.fn>; visible: boolean};
        }).transformControls;

    beforeEach(() => {
        hoisted.globalMock.app = {
            userId: "local-user",
            editor: {
                isSandbox: false,
                outlinePass: {selectedObjects: []},
            },
            isPlaying: false,
            call: vi.fn(),
            transformControls: {
                detach: vi.fn(),
                visible: true,
            },
        } as never;
    });

    it("keeps the custom gizmo attached while replacing a single selection", () => {
        const helper = new SelectHelper();
        const previous = new Object3D();
        const next = new Object3D();

        helper.sceneHelpers = new Scene();
        helper.selectedObject = previous;
        vi.spyOn(helper, "createSelectionBox").mockReturnValue(null);
        vi.spyOn(helper, "updateSelectionBox").mockImplementation(() => {});

        helper.onObjectSelected(next);

        const transformControls = getTransformControlsMock();
        expect(transformControls.detach).not.toHaveBeenCalled();
        expect(transformControls.visible).toBe(true);
        expect(helper.selectedObject).toBe(next);
    });

    it("keeps the custom gizmo attached while replacing selection with an array", () => {
        const helper = new SelectHelper();
        const previous = new Object3D();
        const first = new Object3D();
        const second = new Object3D();

        helper.sceneHelpers = new Scene();
        helper.selectedObject = previous;
        vi.spyOn(helper, "createSelectionBox").mockReturnValue(null);
        vi.spyOn(helper, "updateSelectionBoxes").mockImplementation(() => {});

        helper.onObjectArraySelected([first, second]);

        const transformControls = getTransformControlsMock();
        expect(transformControls.detach).not.toHaveBeenCalled();
        expect(transformControls.visible).toBe(true);
        expect(helper.selectedObjects).toEqual([first, second]);
    });

    it("still hides the custom gizmo when the selection is cleared", () => {
        const helper = new SelectHelper();
        const previous = new Object3D();
        const app = hoisted.globalMock.app as unknown as {call: ReturnType<typeof vi.fn>};

        helper.selectedObject = previous;

        helper.onObjectSelected(null);

        const transformControls = getTransformControlsMock();
        expect(transformControls.detach).toHaveBeenCalledTimes(1);
        expect(transformControls.visible).toBe(false);
        expect(helper.selectedObject).toBeNull();
        expect(app.call).toHaveBeenCalledTimes(1);
        expect(app.call).toHaveBeenCalledWith("objectUnoutlined", helper, previous);
    });
});

describe("SelectHelper event subscriptions", () => {
    beforeEach(() => {
        hoisted.globalMock.app = {
            userId: "local-user",
            editor: {
                isSandbox: false,
                outlinePass: null,
            },
            isPlaying: false,
            on: vi.fn(),
            call: vi.fn(),
        } as never;
    });

    it("does not subscribe an empty afterRender hook and wires mouseup cleanup symmetrically", () => {
        const addEventListener = vi.spyOn(document, "addEventListener").mockImplementation(() => {});
        const removeEventListener = vi.spyOn(document, "removeEventListener").mockImplementation(() => {});
        const app = hoisted.globalMock.app as unknown as {on: ReturnType<typeof vi.fn>};
        const helper = new SelectHelper();

        helper.start();

        expect(app.on).toHaveBeenCalledWith(`animate.${helper.id}`, expect.any(Function));
        expect(app.on).not.toHaveBeenCalledWith(`afterRender.${helper.id}`, expect.any(Function));
        expect(addEventListener).toHaveBeenCalledWith("mouseup", helper.boundMouseUp);
        expect(addEventListener).toHaveBeenCalledWith("keydown", helper.boundKeyDown);

        helper.stop();

        expect(app.on).toHaveBeenCalledWith(`animate.${helper.id}`, null);
        expect(app.on).not.toHaveBeenCalledWith(`afterRender.${helper.id}`, null);
        expect(removeEventListener).toHaveBeenCalledWith("mouseup", helper.boundMouseUp);
        expect(removeEventListener).toHaveBeenCalledWith("keydown", helper.boundKeyDown);
    });
});

describe("SelectHelper selection bounds refresh", () => {
    beforeEach(() => {
        hoisted.globalMock.app = {
            userId: "local-user",
            editor: {
                isSandbox: false,
                outlinePass: null,
            },
            isPlaying: false,
            transformControls: {
                dragging: false,
            },
            on: vi.fn(),
            call: vi.fn(),
        } as never;
    });

    it("skips unchanged selected bounds on animate while still updating labels", () => {
        const helper = new SelectHelper();
        const object = new Object3D();
        const camera = new PerspectiveCamera();
        const labelHelper = {
            updateLabelPresentation: vi.fn(),
        };
        const updateSelectionBoxes = vi.spyOn(helper, "updateSelectionBoxes").mockImplementation(() => {});

        helper.selectedObject = object;
        helper.camera = camera;
        helper.selectionBoxes = [labelHelper];

        helper.onAnimate();
        helper.onAnimate();

        expect(updateSelectionBoxes).toHaveBeenCalledTimes(1);
        expect(updateSelectionBoxes).toHaveBeenCalledWith(object);
        expect(labelHelper.updateLabelPresentation).toHaveBeenCalledTimes(2);

        object.position.set(2, 0, 0);
        helper.onAnimate();

        expect(updateSelectionBoxes).toHaveBeenCalledTimes(2);
        expect(updateSelectionBoxes).toHaveBeenLastCalledWith(object);
        expect(labelHelper.updateLabelPresentation).toHaveBeenCalledTimes(3);
    });

    it("keeps selected bounds live while transform controls are dragging", () => {
        const app = hoisted.globalMock.app as unknown as {
            transformControls: {dragging: boolean};
        };
        const helper = new SelectHelper();
        const object = new Object3D();
        const updateSelectionBoxes = vi.spyOn(helper, "updateSelectionBoxes").mockImplementation(() => {});

        helper.selectedObject = object;
        app.transformControls.dragging = true;

        helper.onAnimate();
        helper.onAnimate();

        expect(updateSelectionBoxes).toHaveBeenCalledTimes(2);
        expect(updateSelectionBoxes).toHaveBeenNthCalledWith(1, object);
        expect(updateSelectionBoxes).toHaveBeenNthCalledWith(2, object);
    });

    it("refreshes selected group bounds when a child object changes", () => {
        const helper = new SelectHelper();
        const root = new Object3D();
        const child = new Object3D();
        const updateSelectionBoxes = vi.spyOn(helper, "updateSelectionBoxes").mockImplementation(() => {});

        root.add(child);
        helper.selectedObject = root;

        helper.onObjectChanged(child);

        expect(updateSelectionBoxes).toHaveBeenCalledTimes(1);
        expect(updateSelectionBoxes).toHaveBeenCalledWith(root);
        expect(helper.selectionBoundsDirty).toBe(false);
    });

    it("drops removed objects from multi-selection without clearing remaining objects", () => {
        const app = hoisted.globalMock.app as unknown as {call: ReturnType<typeof vi.fn>};
        const helper = new SelectHelper();
        const removed = new Object3D();
        const remaining = new Object3D();
        const updateSelectionBoxes = vi.spyOn(helper, "updateSelectionBoxes").mockImplementation(() => {});
        const rememberSelectionMatrices = vi.spyOn(helper, "rememberSelectionMatrices").mockImplementation(() => {});
        const unselect = vi.spyOn(helper, "unselect");

        helper.selectedObjects = [removed, remaining];

        helper.onObjectRemoved(removed);

        expect(app.call).toHaveBeenCalledTimes(1);
        expect(app.call).toHaveBeenCalledWith("objectUnoutlined", helper, removed);
        expect(helper.selectedObjects).toEqual([remaining]);
        expect(updateSelectionBoxes).toHaveBeenCalledWith([remaining]);
        expect(rememberSelectionMatrices).toHaveBeenCalledWith([remaining]);
        expect(helper.selectionBoundsDirty).toBe(false);
        expect(unselect).not.toHaveBeenCalled();
    });
});

describe("SelectHelper deep hierarchy traversal", () => {
    beforeEach(() => {
        hoisted.globalMock.app = {
            userId: "local-user",
            editor: {
                isSandbox: true,
                outlinePass: null,
            },
            isPlaying: false,
            transformControls: {
                detach: vi.fn(),
                visible: true,
            },
            on: vi.fn(),
            call: vi.fn(),
        } as never;
    });

    it("toggles sandbox camera-collision markers without recursive Object3D traversal", () => {
        const helper = new SelectHelper();
        const root = new Object3D();
        const leaf = addDeepObjectChain(root);
        const traverse = vi.spyOn(root, "traverse");
        vi.spyOn(helper, "createSelectionBox").mockReturnValue(null);
        vi.spyOn(helper, "updateSelectionBox").mockImplementation(() => {});

        expect(() => helper.onObjectSelected(root, true)).not.toThrow();

        expect(traverse).not.toHaveBeenCalled();
        expect(root.userData.tempDisableCameraCollision).toBe(true);
        expect(leaf.userData.tempDisableCameraCollision).toBe(true);

        expect(() => helper.onObjectDeselected(root)).not.toThrow();

        expect(traverse).not.toHaveBeenCalled();
        expect(root.userData.tempDisableCameraCollision).toBeUndefined();
        expect(leaf.userData.tempDisableCameraCollision).toBeUndefined();
    });

    it("refreshes collaborator selection boxes in deep scenes without recursive scene traversal", () => {
        vi.useFakeTimers();
        try {
            const helper = new SelectHelper();
            const scene = new Scene();
            const leaf = addDeepObjectChain(scene);
            leaf.userData.selectedBy = "remote-user";
            helper.scene = scene;
            helper.sceneHelpers = {
                add: vi.fn(),
                remove: vi.fn(),
            } as never;
            const traverse = vi.spyOn(scene, "traverse");
            vi.spyOn(helper, "applyObbToHelper").mockReturnValue(true);

            helper.updateOtherUserSelections();

            expect(() => vi.runOnlyPendingTimers()).not.toThrow();
            expect(traverse).not.toHaveBeenCalled();
            expect((helper.sceneHelpers as unknown as {add: ReturnType<typeof vi.fn>}).add).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("hides non-selected objects in deep scenes without recursive stack growth", () => {
        const helper = new SelectHelper();
        const root = new Object3D();
        const leaf = addDeepObjectChain(root);
        const sibling = new Object3D();
        root.add(sibling);

        expect(() => helper.hideNonSelectedObjects(root, leaf, root)).not.toThrow();

        expect(root.visible).toBe(true);
        expect(leaf.visible).toBe(true);
        expect(sibling.visible).toBe(false);

        helper.showNonSelectedObjects();

        expect(sibling.visible).toBe(true);
    });
});

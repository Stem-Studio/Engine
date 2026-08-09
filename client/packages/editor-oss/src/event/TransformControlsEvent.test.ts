import {afterEach, describe, expect, it, vi} from "vitest";
import {BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Scene, Vector3} from "three";

import global from "../global";
import TransformUtils from "../utils/TransformUtils";
import TransformControlsEvent from "./TransformControlsEvent";

function createApp({cadMode = false, selected = null}: {cadMode?: boolean; selected?: Object3D | null} = {}) {
    return {
        disableClickEvents: false,
        sceneHelpers: new Scene(),
        editor: {
            cadMode,
            scene: new Scene(),
            selected,
            sceneLockedItems: [],
            pauseObject: vi.fn(),
            resumeObject: vi.fn(),
            retargetObjectBehaviors: vi.fn(),
            transformControls: null,
        },
        on: vi.fn(),
        transformControls: null,
    };
}

function createTransformControlsStub() {
    return {
        setSpace: vi.fn(),
        attach: vi.fn(),
        detach: vi.fn(),
        getMode: vi.fn(() => "translate"),
        visible: false,
    };
}

describe("TransformControlsEvent BIM selections", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
        vi.restoreAllMocks();
    });

    it("allows BIM groups to use transform controls while CAD mode is active", () => {
        const bimGroup = new Object3D();
        bimGroup.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            managedBy: "BIM Plan",
            sceneTreeBadge: "BIM",
        };

        const app = createApp({cadMode: true, selected: bimGroup});
        global.app = app as never;
        const event = new TransformControlsEvent();
        const transformControls = createTransformControlsStub();
        event.transformControls = transformControls as never;

        expect(event.canEnableTransformation([bimGroup])).toBeTruthy();

        event.objectsSelected([bimGroup]);

        expect(transformControls.attach).toHaveBeenCalledWith(event.transformHelper);
        expect(transformControls.visible).toBe(true);
        expect(app.sceneHelpers.children).toContain(event.transformHelper);
        expect(app.editor.pauseObject).toHaveBeenCalledWith(bimGroup);
    });

    it("disposes transform controls helpers and listeners on stop", () => {
        const app = createApp();
        global.app = app as never;
        const event = new TransformControlsEvent();
        const helper = new Object3D();
        const transformControls = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            detach: vi.fn(),
            dispose: vi.fn(),
            getHelper: vi.fn(() => helper),
        };
        const documentAdd = vi.spyOn(document, "addEventListener").mockImplementation(() => {});
        const documentRemove = vi.spyOn(document, "removeEventListener").mockImplementation(() => {});

        app.sceneHelpers.add(helper);
        event.transformControls = transformControls as never;
        app.transformControls = transformControls as never;
        app.editor.transformControls = transformControls as never;

        event.listenTransformControlEvents();
        event.listenTransformControlEvents();
        event.listenKeyboardEvents();
        event.listenKeyboardEvents();

        expect(transformControls.addEventListener).toHaveBeenCalledTimes(3);
        expect(documentAdd).toHaveBeenCalledTimes(2);

        event.stop();

        expect(transformControls.removeEventListener).toHaveBeenCalledTimes(3);
        expect(documentRemove).toHaveBeenCalledTimes(2);
        expect(transformControls.detach).toHaveBeenCalledTimes(1);
        expect(transformControls.dispose).toHaveBeenCalledTimes(1);
        expect(helper.parent).toBeNull();
        expect(app.transformControls).toBeNull();
        expect(app.editor.transformControls).toBeNull();
    });

    it("allows BIM wrapper groups when BIM metadata is on descendants", () => {
        const wrapper = new Object3D();
        wrapper.userData = {
            isRuntimeOnly: true,
            isSelectable: true,
        };
        const bimChild = new Object3D();
        bimChild.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadManaged: true,
            planNodeId: "wall-1",
        };
        wrapper.add(bimChild);

        const app = createApp({cadMode: true, selected: wrapper});
        global.app = app as never;
        const event = new TransformControlsEvent();
        const transformControls = createTransformControlsStub();
        event.transformControls = transformControls as never;

        expect(event.canEnableTransformation([wrapper])).toBeTruthy();

        event.objectsSelected([wrapper]);

        expect(transformControls.attach).toHaveBeenCalledWith(event.transformHelper);
        expect(transformControls.visible).toBe(true);
        expect(app.sceneHelpers.children).toContain(event.transformHelper);
        expect(app.editor.pauseObject).toHaveBeenCalledWith(wrapper);
    });

    it("allows full BIM plan groups without requiring isPlanCadManaged", () => {
        const bimGroup = new Object3D();
        bimGroup.userData = {
            isRuntimeOnly: true,
            isSelectable: true,
            planCad: {
                schema: "stem.planCad.v1",
                rootNodeIds: ["site-main"],
                nodes: {
                    "site-main": {
                        id: "site-main",
                        type: "site",
                        parentId: null,
                        name: "Site",
                        visible: true,
                    },
                },
            },
        };

        const app = createApp({cadMode: true, selected: bimGroup});
        global.app = app as never;
        const event = new TransformControlsEvent();
        const transformControls = createTransformControlsStub();
        event.transformControls = transformControls as never;

        event.objectsSelected([bimGroup]);

        expect(transformControls.attach).toHaveBeenCalledWith(event.transformHelper);
        expect(transformControls.visible).toBe(true);
        expect(app.sceneHelpers.children).toContain(event.transformHelper);
        expect(app.editor.pauseObject).toHaveBeenCalledWith(bimGroup);
    });

    it("allows legacy named BIM groups without managed flags", () => {
        const bimGroup = new Object3D();
        bimGroup.name = "BIM Group";
        bimGroup.userData = {
            isRuntimeOnly: true,
            isSelectable: true,
        };

        const app = createApp({cadMode: true, selected: bimGroup});
        global.app = app as never;
        const event = new TransformControlsEvent();
        const transformControls = createTransformControlsStub();
        event.transformControls = transformControls as never;

        expect(event.canEnableTransformation([bimGroup])).toBeTruthy();

        event.objectsSelected([bimGroup]);

        expect(transformControls.attach).toHaveBeenCalledWith(event.transformHelper);
        expect(transformControls.visible).toBe(true);
        expect(app.sceneHelpers.children).toContain(event.transformHelper);
        expect(app.editor.pauseObject).toHaveBeenCalledWith(bimGroup);
    });

    it("uses the BIM group bounds center for the transform gizmo pivot", () => {
        const bimGroup = new Object3D();
        bimGroup.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadRoot: true,
            managedBy: "BIM Plan",
        };
        const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
        mesh.position.set(10, 0, 0);
        bimGroup.add(mesh);

        const app = createApp({cadMode: true, selected: bimGroup});
        global.app = app as never;
        const event = new TransformControlsEvent();
        event.transformControls = createTransformControlsStub() as never;

        event.objectsSelected([bimGroup]);

        const helper = event.transformHelper!;
        expect(helper.position.distanceTo(new Vector3(10, 0, 0))).toBeLessThan(1e-15);

        mesh.position.set(14, 0, 0);
        helper.updateMatrixWorld(true);

        expect(helper.position.distanceTo(new Vector3(14, 0, 0))).toBeLessThan(1e-15);
    });

    it("transforms the selected BIM group when the custom gizmo moves", async () => {
        const bimGroup = new Object3D();
        bimGroup.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadRoot: true,
            managedBy: "BIM Plan",
        };
        const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
        mesh.position.set(10, 0, 0);
        bimGroup.add(mesh);

        const app = createApp({cadMode: true, selected: bimGroup});
        global.app = app as never;
        const event = new TransformControlsEvent();
        event.transformControls = {
            ...createTransformControlsStub(),
            getMode: vi.fn(() => "translate"),
            space: "world",
        } as never;

        event.objectsSelected([bimGroup]);
        await event.beginTransformation();

        event.transformHelper!.position.set(14, 0, 0);
        event.transformHelper!.updateMatrixWorld(true);
        event.updateTransforms();

        expect(bimGroup.position.distanceTo(new Vector3(4, 0, 0))).toBeLessThan(1e-15);
        expect(mesh.getWorldPosition(new Vector3()).distanceTo(new Vector3(14, 0, 0))).toBeLessThan(1e-15);
    });

    it("keeps ordinary single-object gizmos anchored to the object origin", () => {
        const group = new Object3D();
        group.userData = {isStemObject: true};
        group.position.set(2, 0, 0);
        const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
        mesh.position.set(10, 0, 0);
        group.add(mesh);

        const app = createApp({selected: group});
        global.app = app as never;
        const event = new TransformControlsEvent();
        event.transformControls = createTransformControlsStub() as never;

        event.objectsSelected([group]);

        const helper = event.transformHelper!;
        expect(helper.position.distanceTo(new Vector3(2, 0, 0))).toBeLessThan(1e-15);
    });

    it("keeps non-BIM objects blocked from global transform controls during CAD mode", () => {
        const meshObject = new Object3D();

        global.app = createApp({cadMode: true, selected: meshObject}) as never;
        const event = new TransformControlsEvent();
        event.transformControls = createTransformControlsStub() as never;

        expect(event.canEnableTransformation([meshObject])).toBe(false);
    });

    it("does not disable an active BIM transform selection on CAD mode changes", () => {
        const bimRoot = new Object3D();
        bimRoot.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadRoot: true,
            isPlanCadManaged: true,
            managedBy: "BIM Plan",
        };

        global.app = createApp({cadMode: true, selected: bimRoot}) as never;
        const event = new TransformControlsEvent();
        const objectsSelected = vi.spyOn(event, "objectsSelected").mockImplementation(() => {});
        const disableTransformation = vi.spyOn(event, "disableTransformation").mockImplementation(() => {});

        event.onCADModeChanged({enabled: true, object: bimRoot});

        expect(objectsSelected).toHaveBeenCalledWith([bimRoot]);
        expect(disableTransformation).not.toHaveBeenCalled();
    });

    it("refreshes selected object references in place when objects are updated", () => {
        global.app = createApp() as never;
        const event = new TransformControlsEvent();
        const first = new Object3D();
        const second = new Object3D();
        const refreshedSecond = new Object3D();
        (refreshedSecond as Object3D & {uuid: string}).uuid = second.uuid;
        const selectedObjects = [first, second];
        event.selectedObjects = selectedObjects;
        const updateGizmoPosition = vi.spyOn(event, "updateGizmoPosition").mockImplementation(() => {});

        event.onObjectUpdated(refreshedSecond);

        expect(event.selectedObjects).toBe(selectedObjects);
        expect(event.selectedObjects).toEqual([first, refreshedSecond]);
        expect(updateGizmoPosition).toHaveBeenCalledTimes(1);
    });

    it("reuses transform scratch targets while applying gizmo translation updates", () => {
        global.app = createApp() as never;
        const event = new TransformControlsEvent();
        const transformControls = {
            ...createTransformControlsStub(),
            getMode: vi.fn(() => "translate"),
            space: "world",
        };
        event.transformControls = transformControls as never;

        const object = new Object3D();
        const helper = new Object3D();
        event.transformHelper = helper;
        event.initializeTransforms([object]);

        const getWorldTransformSpy = vi.spyOn(TransformUtils, "getWorldTransform");
        const calculateDeltaMatrixSpy = vi.spyOn(TransformUtils, "calculateDeltaMatrix");

        helper.position.set(5, 0, 0);
        helper.updateMatrixWorld(true);

        event.updateTransforms();

        expect(object.position.distanceTo(new Vector3(5, 0, 0))).toBeLessThan(1e-15);
        expect(getWorldTransformSpy).toHaveBeenCalledWith(helper, event.currentHelperTransform);
        expect(calculateDeltaMatrixSpy).toHaveBeenCalledWith(
            event.transformHelperInitialState,
            event.currentHelperTransform,
            event.deltaMatrix,
        );

        const currentHelperTransform = event.currentHelperTransform;
        const deltaMatrix = event.deltaMatrix;
        const newWorldMatrix = event.newWorldMatrix;

        helper.position.set(7, 0, 0);
        helper.updateMatrixWorld(true);

        event.updateTransforms();

        expect(object.position.distanceTo(new Vector3(7, 0, 0))).toBeLessThan(1e-15);
        expect(event.currentHelperTransform).toBe(currentHelperTransform);
        expect(event.deltaMatrix).toBe(deltaMatrix);
        expect(event.newWorldMatrix).toBe(newWorldMatrix);
    });
});

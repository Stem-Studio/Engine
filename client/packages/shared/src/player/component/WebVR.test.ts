import {BufferGeometry, MeshBasicMaterial, Object3D, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    createButton: vi.fn(),
    createControllerModel: vi.fn(),
    createHandModel: vi.fn(),
    setPath: vi.fn(),
}));

vi.mock("../../webvr/VRButton", () => ({
    default: {
        createButton: hoisted.createButton,
    },
}));

vi.mock("../../webvr/XRControllerModelFactory", () => ({
    default: class XRControllerModelFactory {
        createControllerModel(controllerGrip: Object3D) {
            return hoisted.createControllerModel(controllerGrip);
        }
    },
}));

vi.mock("../../webvr/XRHandModelFactory", () => ({
    XRHandModelFactory: class XRHandModelFactory {
        setPath(path: string) {
            hoisted.setPath(path);
            return this;
        }

        createHandModel(hand: Object3D, profile: string) {
            return hoisted.createHandModel(hand, profile);
        }
    },
}));

import WebVR from "./WebVR";

function makeTrackedObject() {
    const object = new Object3D();
    vi.spyOn(object, "addEventListener");
    vi.spyOn(object, "removeEventListener");
    return object;
}

function createHarness() {
    const button = document.createElement("button");
    hoisted.createButton.mockReturnValue(button);
    hoisted.createControllerModel.mockImplementation(() => new Object3D());
    hoisted.createHandModel.mockImplementation(() => new Object3D());
    const container = document.createElement("div");
    document.body.appendChild(container);
    const controllers = [makeTrackedObject(), makeTrackedObject()];
    const grips = [new Object3D(), new Object3D()];
    const hands = [new Object3D(), new Object3D()];
    const renderer = {
        xr: {
            enabled: false,
            getController: vi.fn((index: number) => controllers[index]),
            getControllerGrip: vi.fn((index: number) => grips[index]),
            getHand: vi.fn((index: number) => hands[index]),
        },
    };
    const app = {
        options: {enableVR: true},
        container,
        call: vi.fn(),
    };

    return {
        app,
        button,
        container,
        controllers,
        grips,
        hands,
        renderer,
        scene: new Scene(),
        webvr: new WebVR(app),
    };
}

describe("WebVR", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = "";
        hoisted.createButton.mockReset();
        hoisted.createControllerModel.mockReset();
        hoisted.createHandModel.mockReset();
        hoisted.setPath.mockReset();
    });

    it("removes controller listeners, helper objects, scene group, and button on dispose", async () => {
        const {app, button, container, controllers, grips, hands, renderer, scene, webvr} = createHarness();
        const controller0 = controllers[0]!;
        const controller1 = controllers[1]!;
        const grip0 = grips[0]!;
        const grip1 = grips[1]!;
        const hand0 = hands[0]!;
        const hand1 = hands[1]!;

        await webvr.create(scene, {}, renderer);
        expect(renderer.xr.enabled).toBe(true);
        expect(container.contains(button)).toBe(true);
        expect(scene.getObjectByName("vr-controls")).toBeTruthy();
        expect(controller0.addEventListener).toHaveBeenCalledTimes(4);
        expect(controller1.addEventListener).toHaveBeenCalledTimes(4);
        expect(controller0.children).toHaveLength(1);
        expect(controller1.children).toHaveLength(1);
        const controllerLine0 = controller0.children[0] as any;
        const controllerLine1 = controller1.children[0] as any;
        expect(controllerLine0.geometry).not.toBe(controllerLine1.geometry);
        const disposeLine0 = vi.spyOn(controllerLine0.geometry, "dispose");
        const disposeLine1 = vi.spyOn(controllerLine1.geometry, "dispose");
        expect(grip0.children).toHaveLength(1);
        expect(grip1.children).toHaveLength(1);
        expect(hand0.children).toHaveLength(1);
        expect(hand1.children).toHaveLength(1);

        webvr.dispose();

        expect(renderer.xr.enabled).toBe(false);
        expect(container.contains(button)).toBe(false);
        expect(scene.getObjectByName("vr-controls")).toBeUndefined();
        expect(controller0.removeEventListener).toHaveBeenCalledTimes(4);
        expect(controller1.removeEventListener).toHaveBeenCalledTimes(4);
        expect(controller0.children).toHaveLength(0);
        expect(controller1.children).toHaveLength(0);
        expect(disposeLine0).toHaveBeenCalledTimes(1);
        expect(disposeLine1).toHaveBeenCalledTimes(1);
        expect(grip0.children).toHaveLength(0);
        expect(grip1.children).toHaveLength(0);
        expect(hand0.children).toHaveLength(0);
        expect(hand1.children).toHaveLength(0);
        expect(app.call).not.toHaveBeenCalled();
    });

    it("does not add controls if disposed before WebVR modules finish loading", async () => {
        const {app, container, controllers, grips, hands, renderer, scene, webvr} = createHarness();
        const controller0 = controllers[0]!;
        const controller1 = controllers[1]!;
        const grip0 = grips[0]!;
        const grip1 = grips[1]!;
        const hand0 = hands[0]!;
        const hand1 = hands[1]!;

        const createPromise = webvr.create(scene, {}, renderer);
        webvr.dispose();
        await createPromise;

        expect(renderer.xr.enabled).toBe(false);
        expect(container.children).toHaveLength(0);
        expect(scene.getObjectByName("vr-controls")).toBeUndefined();
        expect(controller0.children).toHaveLength(0);
        expect(controller1.children).toHaveLength(0);
        expect(grip0.children).toHaveLength(0);
        expect(grip1.children).toHaveLength(0);
        expect(hand0.children).toHaveLength(0);
        expect(hand1.children).toHaveLength(0);
        expect(hoisted.createControllerModel).not.toHaveBeenCalled();
        expect(hoisted.createHandModel).not.toHaveBeenCalled();
    });

    it("does nothing when VR is disabled", async () => {
        const {app, renderer, scene, webvr} = createHarness();
        app.options.enableVR = false;

        await webvr.create(scene, {}, renderer);

        expect(renderer.xr.enabled).toBe(false);
        expect(hoisted.createButton).not.toHaveBeenCalled();
    });

    it("disposes deep controller resources without Three recursive traversal", () => {
        const {webvr} = createHarness();
        const root = new Object3D();
        const traverse = vi.spyOn(root, "traverse");
        let cursor = root;
        for (let i = 0; i < 12000; i++) {
            const child = new Object3D();
            cursor.add(child);
            cursor = child;
        }
        const geometry = new BufferGeometry();
        const material = new MeshBasicMaterial();
        const geometryDispose = vi.spyOn(geometry, "dispose");
        const materialDispose = vi.spyOn(material, "dispose");
        Object.assign(cursor, {geometry, material});

        webvr.disposeObjectResources(root);

        expect(traverse).not.toHaveBeenCalled();
        expect(geometryDispose).toHaveBeenCalledTimes(1);
        expect(materialDispose).toHaveBeenCalledTimes(1);
    });
});

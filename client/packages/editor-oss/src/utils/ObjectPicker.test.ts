import {afterEach, describe, expect, it, vi} from "vitest";
import {
    Object3D,
    PerspectiveCamera,
    Scene,
    Vector3,
    type Intersection,
    type Raycaster,
    type WebGLRenderer,
} from "three";

import ObjectPicker, {PickerType} from "./ObjectPicker";

type ObjectPickerInternals = {
    pointerClicked: boolean;
    pointerMoved: boolean;
    pointerX: number;
    pointerY: number;
    raycaster: Raycaster;
    raycastHits: Array<Intersection<Object3D>>;
};

function createViewportRect(): DOMRect {
    return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        toJSON: () => ({}),
    } as DOMRect;
}

function createPicker() {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const renderer = {} as WebGLRenderer;
    const picker = new ObjectPicker(renderer, scene, camera, createViewportRect());
    return {
        scene,
        camera,
        picker,
        internals: picker as unknown as ObjectPickerInternals,
    };
}

describe("ObjectPicker", () => {
    const pickers: ObjectPicker[] = [];

    afterEach(() => {
        while (pickers.length > 0) {
            pickers.pop()?.dispose();
        }
        vi.restoreAllMocks();
    });

    it("does not raycast click events when no callbacks are registered", () => {
        const {picker, internals} = createPicker();
        pickers.push(picker);
        const intersectObjects = vi.spyOn(internals.raycaster, "intersectObjects");

        internals.pointerClicked = true;
        internals.pointerX = 50;
        internals.pointerY = 50;

        picker.update();

        expect(intersectObjects).not.toHaveBeenCalled();
    });

    it("does not raycast pointer events outside the viewport", () => {
        const {picker, internals} = createPicker();
        pickers.push(picker);
        const callback = vi.fn();
        const intersectObjects = vi.spyOn(internals.raycaster, "intersectObjects");
        picker.on(PickerType.CLICK, callback);

        internals.pointerClicked = true;
        internals.pointerX = 150;
        internals.pointerY = 50;

        picker.update();

        expect(intersectObjects).not.toHaveBeenCalled();
        expect(callback).not.toHaveBeenCalled();
    });

    it("still raycasts inside the viewport and reuses its intersection buffer", () => {
        const {scene, picker, internals} = createPicker();
        pickers.push(picker);
        const object = new Object3D();
        scene.add(object);
        const callback = vi.fn();
        const hit = {
            object,
            distance: 1,
            point: new Vector3(),
        } as Intersection<Object3D>;
        const intersectObjects = vi.spyOn(internals.raycaster, "intersectObjects").mockImplementation(
            (_objects: Object3D[], _recursive?: boolean, target?: Array<Intersection<Object3D>>) => {
                expect(target).toBe(internals.raycastHits);
                target?.push(hit);
                return target ?? [hit];
            },
        );
        picker.on(PickerType.HOVER, callback);

        internals.pointerMoved = true;
        internals.pointerX = 50;
        internals.pointerY = 50;

        picker.update();

        expect(intersectObjects).toHaveBeenCalledWith(scene.children, true, internals.raycastHits);
        expect(callback).toHaveBeenCalledWith(object, object);
        expect(internals.raycastHits).toHaveLength(0);
    });

    it("resolves the scene object once when click and hover callbacks share a pick result", () => {
        const {scene, picker, internals} = createPicker();
        pickers.push(picker);
        const root = new Object3D();
        const child = new Object3D();
        root.add(child);
        scene.add(root);
        const clickCallback = vi.fn();
        const hoverCallback = vi.fn();
        const hit = {
            object: child,
            distance: 1,
            point: new Vector3(),
        } as Intersection<Object3D>;
        vi.spyOn(internals.raycaster, "intersectObjects").mockImplementation(
            (_objects: Object3D[], _recursive?: boolean, target?: Array<Intersection<Object3D>>) => {
                target?.push(hit);
                return target ?? [hit];
            },
        );
        const getSceneObject = vi.spyOn(picker as unknown as {getSceneObject(origin: Object3D): Object3D | null}, "getSceneObject");
        picker.on(PickerType.CLICK, clickCallback);
        picker.on(PickerType.HOVER, hoverCallback);

        internals.pointerClicked = true;
        internals.pointerX = 50;
        internals.pointerY = 50;

        picker.update();

        expect(getSceneObject).toHaveBeenCalledTimes(1);
        expect(clickCallback).toHaveBeenCalledWith(child, root);
        expect(hoverCallback).toHaveBeenCalledWith(child, root);
    });
});

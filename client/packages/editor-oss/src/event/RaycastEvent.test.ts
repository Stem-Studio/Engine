import {afterEach, describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import global from "../global";
import RaycastEvent from "./RaycastEvent";

function createMouseEvent(target: EventTarget, offsetX: number, offsetY: number): MouseEvent {
    const event = new MouseEvent("mouseup", {bubbles: true, cancelable: true});
    Object.defineProperties(event, {
        target: {value: target},
        offsetX: {value: offsetX},
        offsetY: {value: offsetY},
    });
    return event;
}

function createApp() {
    const domElement = document.createElement("canvas");
    Object.defineProperties(domElement, {
        clientWidth: {value: 100},
        clientHeight: {value: 100},
    });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const orthCamera = new THREE.OrthographicCamera();
    const app = {
        editor: {
            renderer: {domElement},
            view: "perspective",
            camera,
            orthCamera,
            scene,
        },
        on: vi.fn(),
        call: vi.fn(),
    };

    return app;
}

describe("RaycastEvent", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
        vi.restoreAllMocks();
    });

    it("reuses its intersection buffer and emits hit events", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const raycastEvent = new RaycastEvent();
        const hit = {object: new THREE.Object3D(), distance: 1, point: new THREE.Vector3(1, 0, 1)};

        const intersectObjects = vi.spyOn(raycastEvent.raycaster, "intersectObjects").mockImplementation(
            (_objects: THREE.Object3D[], _recursive?: boolean, target?: THREE.Intersection[]) => {
                expect(target).toBe(raycastEvent.intersections);
                target?.push(hit as THREE.Intersection);
                return target ?? [hit as THREE.Intersection];
            },
        );

        raycastEvent.onMouseDown(createMouseEvent(app.editor.renderer.domElement, 12, 16));
        const mouseUp = createMouseEvent(app.editor.renderer.domElement, 12, 16);
        raycastEvent.onMouseUp(mouseUp);

        expect(intersectObjects).toHaveBeenCalledWith(app.editor.scene.children, true, raycastEvent.intersections);
        expect(app.call).toHaveBeenCalledWith("raycast", raycastEvent, hit, mouseUp);
        expect(app.call).toHaveBeenCalledWith("intersect", raycastEvent, hit, mouseUp, raycastEvent.intersections);
    });

    it("reuses its ground point for miss raycasts", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const raycastEvent = new RaycastEvent();

        vi.spyOn(raycastEvent.raycaster, "intersectObjects").mockImplementation(
            (_objects: THREE.Object3D[], _recursive?: boolean, target?: THREE.Intersection[]) => target ?? [],
        );
        vi.spyOn(raycastEvent.raycaster.ray, "intersectPlane").mockImplementation((_plane, target) => {
            target?.set(4, 0, 8);
            return target ?? null;
        });
        vi.spyOn(raycastEvent.raycaster.ray, "distanceSqToPoint").mockReturnValue(80);

        raycastEvent.onMouseDown(createMouseEvent(app.editor.renderer.domElement, 20, 24));
        const mouseUp = createMouseEvent(app.editor.renderer.domElement, 20, 24);
        raycastEvent.onMouseUp(mouseUp);

        expect(app.call).toHaveBeenCalledWith(
            "raycast",
            raycastEvent,
            {
                point: raycastEvent.groundPoint,
                distance: 80,
                object: null,
            },
            mouseUp,
        );
        expect(app.call).not.toHaveBeenCalledWith("intersect", expect.anything(), expect.anything(), expect.anything(), expect.anything());
    });

    it("clears pending click state when mouseup happens away from the renderer", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const raycastEvent = new RaycastEvent();
        const otherTarget = document.createElement("div");
        const intersectObjects = vi.spyOn(raycastEvent.raycaster, "intersectObjects");

        raycastEvent.onMouseDown(createMouseEvent(app.editor.renderer.domElement, 12, 16));
        raycastEvent.onMouseUp(createMouseEvent(otherTarget, 12, 16));
        raycastEvent.onMouseUp(createMouseEvent(app.editor.renderer.domElement, 12, 16));

        expect(intersectObjects).not.toHaveBeenCalled();
        expect(app.call).not.toHaveBeenCalled();
    });
});

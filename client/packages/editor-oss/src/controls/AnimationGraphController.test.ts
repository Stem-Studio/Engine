import {describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import {AnimationGraphController, type AnimationGraphData} from "./AnimationGraphController";

function createController() {
    const controller = new AnimationGraphController();
    controller.game = {
        camera: null,
    } as unknown as NonNullable<AnimationGraphController["game"]>;
    return controller;
}

describe("AnimationGraphController", () => {
    it("uses the engine frame delta when provided", () => {
        const controller = createController();
        const update = vi.fn();
        controller.graphs = [
            {
                object: new THREE.Object3D(),
                graph: {update} as unknown as AnimationGraphData["graph"],
            },
        ];
        const getDelta = vi.fn(() => 10);

        controller.update({getDelta}, 0.125);

        expect(getDelta).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(0.125);
    });

    it("falls back to the supplied clock for legacy callers", () => {
        const controller = createController();
        const update = vi.fn();
        controller.graphs = [
            {
                object: new THREE.Object3D(),
                graph: {update} as unknown as AnimationGraphData["graph"],
            },
        ];

        controller.update({getDelta: vi.fn(() => 0.2)});

        expect(update).toHaveBeenCalledWith(0.2);
    });

    it("keeps distance-throttle animation hashes out of serialized userData", () => {
        const controller = createController();
        const camera = new THREE.PerspectiveCamera();
        camera.updateMatrixWorld();
        (controller.game as {camera: THREE.Camera}).camera = camera;
        const object = new THREE.Object3D();
        object.position.set(60, 0, 0);
        object.updateMatrixWorld();
        controller.graphs = [
            {
                object,
                graph: {update: vi.fn()} as unknown as AnimationGraphData["graph"],
            },
        ];

        controller.update(undefined, 0.016);

        expect(object.userData._animHash).toBeDefined();
        expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_animHash")).toBe(false);
        expect(JSON.stringify(object.userData)).not.toContain("_animHash");
    });

    it("does not redefine already hidden animation hashes on later updates", () => {
        const controller = createController();
        const camera = new THREE.PerspectiveCamera();
        camera.updateMatrixWorld();
        (controller.game as {camera: THREE.Camera}).camera = camera;
        const object = new THREE.Object3D();
        object.position.set(60, 0, 0);
        object.updateMatrixWorld();
        controller.graphs = [
            {
                object,
                graph: {update: vi.fn()} as unknown as AnimationGraphData["graph"],
            },
        ];

        controller.update(undefined, 0.016);
        expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_animHash")).toBe(false);

        const definePropertySpy = vi.spyOn(Object, "defineProperty");

        controller.update(undefined, 0.016);

        expect(definePropertySpy).not.toHaveBeenCalled();
        definePropertySpy.mockRestore();
    });

    it("preserves legacy animation hash values while making them non-enumerable", () => {
        const controller = createController();
        const camera = new THREE.PerspectiveCamera();
        camera.updateMatrixWorld();
        (controller.game as {camera: THREE.Camera}).camera = camera;
        const object = new THREE.Object3D();
        object.userData._animHash = 0;
        object.position.set(60, 0, 0);
        object.updateMatrixWorld();
        const update = vi.fn();
        controller.graphs = [
            {
                object,
                graph: {update} as unknown as AnimationGraphData["graph"],
            },
        ];

        expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_animHash")).toBe(true);

        controller.update(undefined, 0.016);

        expect(update).not.toHaveBeenCalled();
        expect(object.userData._animHash).toBe(0);
        expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_animHash")).toBe(false);
    });
});

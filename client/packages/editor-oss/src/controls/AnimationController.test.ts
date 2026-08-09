import {afterEach, describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import global from "../global";
import {AnimationController, type StoredAnimationData} from "./AnimationController";

function createStartedController() {
    const controller = new AnimationController();
    controller.game = {
        isGameStarted: () => true,
        camera: null,
        engine: null,
    } as unknown as NonNullable<AnimationController["game"]>;
    return controller;
}

function addMockAnimation(controller: AnimationController, root: THREE.Object3D, speed = 1) {
    const update = vi.fn();
    controller.animations = [
        {
            mixer: {
                getRoot: () => root,
                update,
            } as unknown as StoredAnimationData["mixer"],
            speed,
            actions: [],
            blends: [],
            paused: false,
        } satisfies StoredAnimationData,
    ];
    return update;
}

function addDeepObjectChain(root: THREE.Object3D, depth = 12_000): THREE.Object3D {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new THREE.Object3D();
        current.add(child);
        current = child;
    }

    return current;
}

describe("AnimationController", () => {
    afterEach(() => {
        global.app = null;
        vi.restoreAllMocks();
    });

    it("uses the engine frame delta when provided", () => {
        const controller = createStartedController();
        const root = new THREE.Object3D();
        const update = addMockAnimation(controller, root, 2);
        const getDelta = vi.fn(() => 10);
        controller.clock = {getDelta};

        controller.update(0.25);

        expect(getDelta).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(0.5);
    });

    it("falls back to its local clock for legacy callers", () => {
        const controller = createStartedController();
        const root = new THREE.Object3D();
        const update = addMockAnimation(controller, root, 3);
        controller.clock = {getDelta: vi.fn(() => 0.1)};

        controller.update();

        expect(update.mock.calls[0]?.[0]).toBeCloseTo(0.3);
    });

    it("keeps distance-throttle animation hashes out of serialized userData", () => {
        const controller = createStartedController();
        const camera = new THREE.PerspectiveCamera();
        camera.updateMatrixWorld();
        (controller.game as {camera: THREE.Camera}).camera = camera;
        const root = new THREE.Object3D();
        root.position.set(60, 0, 0);
        root.updateMatrixWorld();
        addMockAnimation(controller, root);

        controller.update(0.016);

        expect(root.userData._animHash).toBeDefined();
        expect(Object.prototype.propertyIsEnumerable.call(root.userData, "_animHash")).toBe(false);
        expect(JSON.stringify(root.userData)).not.toContain("_animHash");
    });

    it("does not redefine already hidden animation hashes on later updates", () => {
        const controller = createStartedController();
        const camera = new THREE.PerspectiveCamera();
        camera.updateMatrixWorld();
        (controller.game as {camera: THREE.Camera}).camera = camera;
        const root = new THREE.Object3D();
        root.position.set(60, 0, 0);
        root.updateMatrixWorld();
        addMockAnimation(controller, root);

        controller.update(0.016);
        expect(Object.prototype.propertyIsEnumerable.call(root.userData, "_animHash")).toBe(false);

        const definePropertySpy = vi.spyOn(Object, "defineProperty");

        controller.update(0.016);

        expect(definePropertySpy).not.toHaveBeenCalled();
        definePropertySpy.mockRestore();
    });

    it("preserves legacy animation hash values while making them non-enumerable", () => {
        const controller = createStartedController();
        const camera = new THREE.PerspectiveCamera();
        camera.updateMatrixWorld();
        (controller.game as {camera: THREE.Camera}).camera = camera;
        const root = new THREE.Object3D();
        root.userData._animHash = 0;
        root.position.set(60, 0, 0);
        root.updateMatrixWorld();
        const update = addMockAnimation(controller, root);

        expect(Object.prototype.propertyIsEnumerable.call(root.userData, "_animHash")).toBe(true);

        controller.update(0.016);

        expect(update).not.toHaveBeenCalled();
        expect(root.userData._animHash).toBe(0);
        expect(Object.prototype.propertyIsEnumerable.call(root.userData, "_animHash")).toBe(false);
    });

    it("disposes animations in deep scenes without recursive scene traversal", () => {
        const controller = new AnimationController();
        const scene = new THREE.Scene();
        const leaf = addDeepObjectChain(scene);
        const stopAllAction = vi.fn();
        const uncacheRoot = vi.fn();
        const mixerRoot = new THREE.Object3D();
        leaf.userData.animation = {
            mixer: {
                stopAllAction,
                uncacheRoot,
                getRoot: () => mixerRoot,
            } as unknown as StoredAnimationData["mixer"],
            speed: 1,
            actions: [],
            blends: [],
            paused: false,
        } satisfies StoredAnimationData;
        const traverseSpy = vi.spyOn(scene, "traverse");
        const off = vi.fn();
        controller.game = {
            scene,
        } as unknown as NonNullable<AnimationController["game"]>;
        global.app = {
            on: off,
        } as any;

        controller.dispose();

        expect(stopAllAction).toHaveBeenCalledTimes(1);
        expect(uncacheRoot).toHaveBeenCalledWith(mixerRoot);
        expect(leaf.userData.animation).toBeUndefined();
        expect(traverseSpy).not.toHaveBeenCalled();
        expect(off).toHaveBeenCalledWith("gameStarted.AnimationController", null);
    });
});

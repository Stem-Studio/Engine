import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import CharacterBehavior from "./CharacterBehavior";

const createBehavior = (target: THREE.Object3D) => {
    const behavior = new CharacterBehavior(target, "character", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes: {},
    });

    (behavior as any).game = {
        engine: {
            isGameMenuOpen: false,
        },
    };
    (behavior as any).isActive = true;

    return behavior;
};

describe("CharacterBehavior", () => {
    it("collects directional lights without recursive scene property lookup", () => {
        const scene = new THREE.Scene();
        let cursor: THREE.Object3D = scene;
        for (let i = 0; i < 12_000; i++) {
            const child = new THREE.Object3D();
            cursor.add(child);
            cursor = child;
        }
        const light = new THREE.DirectionalLight();
        cursor.add(light);
        const behavior = createBehavior(new THREE.Object3D());
        (behavior as any).game.scene = scene;
        const getObjectsByProperty = vi.spyOn(scene, "getObjectsByProperty").mockImplementation(() => {
            throw new Error("recursive property lookup should not be used");
        });

        const result = (behavior as any).collectDirectionalLights();

        expect(result).toEqual([light]);
        expect(getObjectsByProperty).not.toHaveBeenCalled();
    });

    it("updates active character lights and controller without changing light-follow behavior", () => {
        const target = new THREE.Object3D();
        target.position.set(2, 3, 4);
        const behavior = createBehavior(target);

        const firstLight = new THREE.DirectionalLight();
        firstLight.position.set(0, 10, 0);
        firstLight.target.position.set(5, 0, 0);
        const secondLight = new THREE.DirectionalLight();
        secondLight.position.set(10, 0, 0);
        secondLight.target.position.set(0, 0, 0);
        const firstTargetUpdate = vi.spyOn(firstLight.target, "updateMatrixWorld");
        const secondTargetUpdate = vi.spyOn(secondLight.target, "updateMatrixWorld");
        const controllerUpdate = vi.fn();

        (behavior as any).directionalLights = [firstLight, secondLight];
        (behavior as any).characterControl = {update: controllerUpdate};

        behavior.update(0.016);

        expect(firstLight.position.toArray()).toEqual([-3, 13, 4]);
        expect(secondLight.position.toArray()).toEqual([12, 3, 4]);
        expect(firstLight.target.position.toArray()).toEqual([2, 3, 4]);
        expect(secondLight.target.position.toArray()).toEqual([2, 3, 4]);
        expect(firstTargetUpdate).toHaveBeenCalledOnce();
        expect(secondTargetUpdate).toHaveBeenCalledOnce();
        expect(controllerUpdate).toHaveBeenCalledWith(0.016);
    });

    it("preserves controller ownership when reactivating a character", () => {
        const target = new THREE.Object3D();
        const behavior = createBehavior(target);
        const setPlayer = vi.fn();
        (behavior as any).isActive = false;
        (behavior as any).controlType = "OrbitControls";
        (behavior as any).game = {
            engine: {isGameMenuOpen: false},
            cameraControl: {start: vi.fn()},
            setPlayer,
        };
        (behavior as any).setPlayerControls = vi.fn();
        (behavior as any).characterSwap = {reset: vi.fn()};

        behavior.onEvent("character:activate", null);

        expect(setPlayer).toHaveBeenCalledWith(target, {controllerManaged: true});
    });
});

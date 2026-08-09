import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import RandomizedSpawnerBehavior from "./RandomizedSpawnerBehavior";

const createRandomizedSpawnerBehavior = (target: THREE.Object3D, attributes: Record<string, unknown> = {}) =>
    new RandomizedSpawnerBehavior(target, "randomizedSpawner", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes,
    });

afterEach(() => {
    vi.restoreAllMocks();
});

describe("RandomizedSpawnerBehavior", () => {
    it("skips per-frame collision bounds when no prefab entries are configured", () => {
        const target = new THREE.Object3D();
        const behavior = createRandomizedSpawnerBehavior(target, {
            startOnTrigger: false,
            randomList: [{prefabId: "", probability: 100}],
        });
        const setFromObject = vi.spyOn(THREE.Box3.prototype, "setFromObject");

        behavior.init({
            player: new THREE.Object3D(),
            scene: new THREE.Scene(),
        } as any);

        behavior.update();

        expect(setFromObject).not.toHaveBeenCalled();
    });
});

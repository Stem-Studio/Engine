import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import SpawnBehavior from "./SpawnBehavior";

const createSpawnBehavior = (target: THREE.Object3D, attributes: Record<string, unknown> = {}) =>
    new SpawnBehavior(target, "spawn", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes,
    });

afterEach(() => {
    vi.restoreAllMocks();
});

describe("SpawnBehavior", () => {
    it("skips per-frame collision bounds when no prefab is configured", () => {
        const target = new THREE.Object3D();
        const behavior = createSpawnBehavior(target, {startOnTrigger: false});
        const setFromObject = vi.spyOn(THREE.Box3.prototype, "setFromObject");

        behavior.init({
            player: new THREE.Object3D(),
            scene: new THREE.Scene(),
        } as any);

        behavior.update();

        expect(setFromObject).not.toHaveBeenCalled();
    });
});

import * as THREE from "three";
import {describe, expect, it} from "vitest";

import SpawnPointBehavior from "./SpawnPointBehavior";

const createSpawnPointBehavior = (target: THREE.Object3D, attributes: Record<string, unknown> = {}) =>
    new SpawnPointBehavior(target, "spawnpoint", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes,
    });

describe("SpawnPointBehavior", () => {
    it("writes and clears structured spawn point metadata", () => {
        const target = new THREE.Object3D();
        const behavior = createSpawnPointBehavior(target, {slot: 2, spawnType: "team"});

        behavior.onAdded();

        expect(target.userData.isSpawnPoint).toBe(true);
        expect(target.userData.spawnPoint).toEqual({slot: 2, type: "team"});

        behavior.onRemoved();

        expect(target.userData.isSpawnPoint).toBeUndefined();
        expect(target.userData.spawnPoint).toBeUndefined();
    });

    it("syncs the editor marker after target transform changes", () => {
        const target = new THREE.Object3D();
        const editor = {sceneHelpers: new THREE.Group()} as any;
        const behavior = createSpawnPointBehavior(target, {slot: 0, spawnType: "normal"});

        behavior.onEditorAdded(editor);
        const marker = editor.sceneHelpers.children[0] as THREE.Object3D;

        target.position.set(3, 4, 5);
        target.rotation.set(0, Math.PI / 2, 0);
        behavior.onEditorUpdate();

        expect(marker.position.distanceTo(target.position)).toBeLessThan(1e-12);
        expect(marker.quaternion.angleTo(target.quaternion)).toBeLessThan(1e-12);

        behavior.onEditorRemoved();

        expect(editor.sceneHelpers.children).toHaveLength(0);
        expect(target.userData.isSpawnPoint).toBeUndefined();
    });
});

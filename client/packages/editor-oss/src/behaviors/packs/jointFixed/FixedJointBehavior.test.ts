import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import FixedJointBehavior from "./FixedJointBehavior";

const createGame = (scene: THREE.Scene) => ({
    scene,
    physics: {
        addFixedJoint: vi.fn(),
        removeJoint: vi.fn(),
    },
});

describe("FixedJointBehavior", () => {
    it("removes the joint it added when stopped", () => {
        const scene = new THREE.Scene();
        const objectA = new THREE.Object3D();
        const objectB = new THREE.Object3D();
        scene.add(objectA, objectB);

        const game = createGame(scene);
        const behavior = new FixedJointBehavior(objectA, "jointFixed", {
            gameObject: {target: objectA} as any,
            erth: {} as any,
            attributes: {
                objectB: objectB.uuid,
                collisionEnabled: false,
            },
        });
        behavior.init(game as any);

        behavior.onStart();
        behavior.onStop();

        expect(game.physics.addFixedJoint).toHaveBeenCalledOnce();
        expect(game.physics.removeJoint).toHaveBeenCalledWith(objectA.uuid, objectB.uuid);
    });
});

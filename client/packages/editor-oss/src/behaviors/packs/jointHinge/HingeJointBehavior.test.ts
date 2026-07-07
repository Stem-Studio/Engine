import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import HingeJointBehavior from "./HingeJointBehavior";

const createGame = (scene: THREE.Scene) => ({
    scene,
    physics: {
        addHingeJoint: vi.fn(),
        removeJoint: vi.fn(),
    },
});

describe("HingeJointBehavior", () => {
    it("removes the joint it added when stopped", () => {
        const scene = new THREE.Scene();
        const objectA = new THREE.Object3D();
        const objectB = new THREE.Object3D();
        scene.add(objectA, objectB);

        const game = createGame(scene);
        const behavior = new HingeJointBehavior(objectA, "jointHinge", {
            gameObject: {target: objectA} as any,
            erth: {} as any,
            attributes: {
                objectB: objectB.uuid,
                collisionEnabled: true,
                axis: {x: 0, y: 1, z: 0},
                angularLimitEnabled: false,
                angularLimit: {x: 0, y: 0, z: 0},
                motorEnabled: false,
                motorSpeed: 0,
                motorTorque: 0,
            },
        });
        behavior.init(game as any);

        behavior.onStart();
        behavior.onStop();

        expect(game.physics.addHingeJoint).toHaveBeenCalledOnce();
        expect(game.physics.removeJoint).toHaveBeenCalledWith(objectA.uuid, objectB.uuid);
    });
});

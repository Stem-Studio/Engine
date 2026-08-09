import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import Point2PointJointBehavior from "./Point2PointJointBehavior";

const createGame = (scene: THREE.Scene) => ({
    scene,
    getObjectByUUID: (uuid: string) => scene.getObjectByProperty("uuid", uuid) ?? null,
    physics: {
        addPoint2PointJoint: vi.fn(),
        removeJoint: vi.fn(),
    },
});

describe("Point2PointJointBehavior", () => {
    it("removes the joint it added when stopped", () => {
        const scene = new THREE.Scene();
        const objectA = new THREE.Object3D();
        const objectB = new THREE.Object3D();
        scene.add(objectA, objectB);

        const game = createGame(scene);
        const behavior = new Point2PointJointBehavior(objectA, "jointPoint2Point", {
            gameObject: {target: objectA} as any,
            erth: {} as any,
            attributes: {
                objectB: objectB.uuid,
                collisionEnabled: true,
                pivotA: {x: 0, y: 0, z: 0},
                pivotB: {x: 1, y: 0, z: 0},
            },
        });
        behavior.init(game as any);

        behavior.onStart();
        behavior.onStop();

        expect(game.physics.addPoint2PointJoint).toHaveBeenCalledOnce();
        expect(game.physics.removeJoint).toHaveBeenCalledWith(objectA.uuid, objectB.uuid);
    });
});

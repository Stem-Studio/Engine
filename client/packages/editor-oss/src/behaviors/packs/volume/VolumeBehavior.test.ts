import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import VolumeBehavior, {VOLUME_TYPES} from "./VolumeBehavior";
import {CollisionType} from "../../../physics/common/physicsConfig";

const createVolumeBehavior = (
    target: THREE.Object3D,
    volumeType: VOLUME_TYPES,
    game: any,
) => {
    const behavior = new VolumeBehavior(target, "volume", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes: {
            volumeOptions: {volumeType},
        },
    });
    behavior.init(game);
    return behavior;
};

const createGame = () => ({
    engine: {
        addPhysicsObject: vi.fn(),
        removePhysicsObject: vi.fn(),
    },
    collisionDetector: {
        addListener: vi.fn(),
        deleteListener: vi.fn(),
    },
});

describe("VolumeBehavior", () => {
    it("auto-applies kinematic physics for blocking volumes without existing physics", () => {
        const target = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const game = createGame();
        const behavior = createVolumeBehavior(target, VOLUME_TYPES.BLOCKING, game);

        behavior.onStart();

        expect(target.userData.physics.enabled).toBe(true);
        expect(target.userData.physics.ctype).toBe(CollisionType.Kinematic);
        expect(target.userData.physics.mass).toBe(0);
        expect(game.engine.addPhysicsObject).toHaveBeenCalledWith(target);
        expect(game.collisionDetector.addListener).not.toHaveBeenCalled();

        behavior.onStop();

        expect(game.engine.removePhysicsObject).toHaveBeenCalledWith(target);
        expect(target.userData.physics).toBeUndefined();
    });

    it("does not override existing physics on blocking volumes", () => {
        const target = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        target.userData.physics = {
            enabled: true,
            ctype: CollisionType.Static,
            mass: 0,
            shape: "btBoxShape",
        };
        const game = createGame();
        const behavior = createVolumeBehavior(target, VOLUME_TYPES.BLOCKING, game);

        behavior.onStart();

        expect(target.userData.physics.ctype).toBe(CollisionType.Static);
        expect(game.engine.addPhysicsObject).not.toHaveBeenCalled();
    });

    it("registers collision listeners for non-blocking volumes", () => {
        const target = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const game = createGame();
        const behavior = createVolumeBehavior(target, VOLUME_TYPES.KILL_VOLUME, game);

        behavior.onStart();

        expect(game.collisionDetector.addListener).toHaveBeenCalledOnce();
        expect(game.engine.addPhysicsObject).not.toHaveBeenCalled();

        behavior.onStop();

        expect(game.collisionDetector.deleteListener).toHaveBeenCalledWith(target);
    });
});

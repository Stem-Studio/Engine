import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import CollisionDetector, {type CollisionContext} from "./CollisionDetector";
import {COLLISION_TYPE} from "@stem/editor-oss/types/editor";

const createDetector = () => {
    let physicsCollisionListener: ((collision: {uuid: string; listenerId: string}) => void) | undefined;
    const physics = {
        detectCollisionsForObject: vi.fn(),
    };
    const source = {
        addCollisionListener: vi.fn((listener: (collision: {uuid: string; listenerId: string}) => void) => {
            physicsCollisionListener = listener;
        }),
    };

    return {
        detector: new CollisionDetector(physics as any, source as any),
        physics,
        emitPhysicsCollision: (uuid: string, listenerId: string) => physicsCollisionListener?.({uuid, listenerId}),
    };
};

describe("CollisionDetector", () => {
    it("passes target and player objects to distance callbacks", () => {
        const {detector} = createDetector();
        const target = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const player = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const callback = vi.fn<(context: CollisionContext) => void>();

        detector.setPlayer(player);
        detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                useBoundingBoxes: true,
                callback,
            },
            false,
        );

        detector.update();

        expect(callback).toHaveBeenCalledWith(
            expect.objectContaining({
                target,
                other: player,
                source: "distance",
            }),
        );
    });

    it("passes target and player objects to physics callbacks", () => {
        const {detector, emitPhysicsCollision} = createDetector();
        const target = new THREE.Object3D();
        const player = new THREE.Object3D();
        const callback = vi.fn<(context: CollisionContext) => void>();

        detector.setPlayer(player);
        const listenerId = detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                callback,
            },
            true,
        );

        emitPhysicsCollision(target.uuid, listenerId);
        detector.update();

        expect(callback).toHaveBeenCalledWith(
            expect.objectContaining({
                target,
                other: player,
                source: "physics",
                collision: {uuid: target.uuid, listenerId},
            }),
        );
    });

    it("does not distance-check physics listeners when non-physics listeners exist", () => {
        const {detector} = createDetector();
        const player = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const physicsTarget = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const distanceTarget = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const physicsCallback = vi.fn();
        const distanceCallback = vi.fn();

        detector.setPlayer(player);
        detector.addListener(
            physicsTarget,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                useBoundingBoxes: true,
                callback: physicsCallback,
            },
            true,
        );
        detector.addListener(
            distanceTarget,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                useBoundingBoxes: true,
                callback: distanceCallback,
            },
            false,
        );

        detector.update();

        expect(distanceCallback).toHaveBeenCalledOnce();
        expect(physicsCallback).not.toHaveBeenCalled();
    });
});

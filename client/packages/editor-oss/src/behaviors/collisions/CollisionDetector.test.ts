import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import CollisionDetector, {type CollisionContext} from "./CollisionDetector";
import {COLLISION_TYPE} from "@stem/editor-oss/types/editor";
import BoundingBoxUtil from "@stem/editor-oss/utils/BoundingBoxUtil";

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

    it("dispatches physics collisions through the listener id index", () => {
        const {detector, emitPhysicsCollision} = createDetector();
        const target = new THREE.Object3D();
        const callback = vi.fn<(context: CollisionContext) => void>();

        const listenerId = detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                callback,
            },
            true,
        );
        const listeners = (detector as any).objectsWithPhysics.get(target) as Array<unknown>;
        const findSpy = vi.spyOn(listeners, "find");

        emitPhysicsCollision(target.uuid, listenerId);
        detector.update();

        expect(callback).toHaveBeenCalledOnce();
        expect(findSpy).not.toHaveBeenCalled();
    });

    it("keeps remaining physics listeners registered after deleting one listener", () => {
        const {detector, emitPhysicsCollision} = createDetector();
        const target = new THREE.Object3D();
        const player = new THREE.Object3D();
        const removedCallback = vi.fn();
        const remainingCallback = vi.fn<(context: CollisionContext) => void>();

        detector.setPlayer(player);
        const removedListenerId = detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                callback: removedCallback,
            },
            true,
        );
        const remainingListenerId = detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                callback: remainingCallback,
            },
            true,
        );

        detector.deleteListener(target, removedListenerId);
        emitPhysicsCollision(target.uuid, remainingListenerId);
        detector.update();

        expect(removedCallback).not.toHaveBeenCalled();
        expect(remainingCallback).toHaveBeenCalledWith(
            expect.objectContaining({
                target,
                other: player,
                source: "physics",
            }),
        );
    });

    it("keeps physics listeners registered when deleting a distance listener on the same target", () => {
        const {detector, emitPhysicsCollision} = createDetector();
        const target = new THREE.Object3D();
        const player = new THREE.Object3D();
        const physicsCallback = vi.fn<(context: CollisionContext) => void>();

        detector.setPlayer(player);
        const physicsListenerId = detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                callback: physicsCallback,
            },
            true,
        );
        const distanceListenerId = detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                callback: vi.fn(),
            },
            false,
        );

        detector.deleteListener(target, distanceListenerId);
        emitPhysicsCollision(target.uuid, physicsListenerId);
        detector.update();

        expect(physicsCallback).toHaveBeenCalledWith(
            expect.objectContaining({
                target,
                other: player,
                source: "physics",
            }),
        );
    });

    it("uses squared distance checks for distance-mode proximity", () => {
        const {detector} = createDetector();
        const target = new THREE.Object3D();
        const player = new THREE.Object3D();
        target.position.set(0, 0, 0);
        player.position.set(3, 4, 0);
        const distanceTo = vi.spyOn(target.position, "distanceTo");

        expect(detector.isColliding(target, player, false, 5)).toBe(true);
        expect(detector.isColliding(target, player, false, 4.99)).toBe(false);
        expect(distanceTo).not.toHaveBeenCalled();
    });

    it("uses world positions for distance checks below transformed parents", () => {
        const {detector} = createDetector();
        const targetParent = new THREE.Object3D();
        const target = new THREE.Object3D();
        const player = new THREE.Object3D();
        targetParent.position.x = 100;
        targetParent.add(target);

        expect(detector.isColliding(target, player, false, 2)).toBe(false);

        const playerParent = new THREE.Object3D();
        playerParent.position.x = 99;
        player.position.x = 1;
        playerParent.add(player);
        expect(detector.isColliding(target, player, false, 0.01)).toBe(true);
    });

    it("refreshes ancestor and descendant transforms for bounding-box checks", () => {
        const {detector} = createDetector();
        const targetParent = new THREE.Object3D();
        const target = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const targetChild = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const player = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        target.add(targetChild);
        targetParent.add(target);
        targetParent.position.x = 10;
        targetChild.position.x = -10;

        expect(detector.isColliding(target, player, true)).toBe(true);
    });

    it("refreshes world positions after a collision callback moves a parent", () => {
        const {detector} = createDetector();
        const target = new THREE.Object3D();
        const playerParent = new THREE.Object3D();
        const player = new THREE.Object3D();
        player.position.x = 1;
        playerParent.add(player);
        const firstCallback = vi.fn(() => {
            playerParent.position.x = 100;
        });
        const secondCallback = vi.fn();
        detector.setPlayer(player);
        detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                distanceThreshold: 2,
                callback: firstCallback,
            },
            false,
        );
        detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                distanceThreshold: 3,
                callback: secondCallback,
            },
            false,
        );

        detector.update();

        expect(firstCallback).toHaveBeenCalledOnce();
        expect(secondCallback).not.toHaveBeenCalled();
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

    it("reuses distance collision results for matching listeners on the same target", () => {
        const {detector} = createDetector();
        const target = new THREE.Object3D();
        const player = new THREE.Object3D();
        const firstCallback = vi.fn();
        const secondCallback = vi.fn();
        target.position.set(0, 0, 0);
        player.position.set(1, 0, 0);
        detector.setPlayer(player);
        detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                distanceThreshold: 2,
                callback: firstCallback,
            },
            false,
        );
        detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                distanceThreshold: 2,
                callback: secondCallback,
            },
            false,
        );
        const isColliding = vi.spyOn(detector, "isColliding");

        detector.update();

        expect(isColliding).toHaveBeenCalledTimes(1);
        expect(firstCallback).toHaveBeenCalledOnce();
        expect(secondCallback).toHaveBeenCalledOnce();
    });

    it("clears reusable distance collision results between targets", () => {
        const {detector} = createDetector();
        const firstTarget = new THREE.Object3D();
        const secondTarget = new THREE.Object3D();
        const player = new THREE.Object3D();
        const firstCallback = vi.fn();
        const firstDuplicateCallback = vi.fn();
        const secondCallback = vi.fn();
        const secondDuplicateCallback = vi.fn();

        firstTarget.position.set(0, 0, 0);
        secondTarget.position.set(10, 0, 0);
        player.position.set(1, 0, 0);
        detector.setPlayer(player);
        detector.addListener(firstTarget, {type: COLLISION_TYPE.WITH_PLAYER, distanceThreshold: 2, callback: firstCallback}, false);
        detector.addListener(firstTarget, {type: COLLISION_TYPE.WITH_PLAYER, distanceThreshold: 2, callback: firstDuplicateCallback}, false);
        detector.addListener(secondTarget, {type: COLLISION_TYPE.WITH_PLAYER, distanceThreshold: 2, callback: secondCallback}, false);
        detector.addListener(secondTarget, {type: COLLISION_TYPE.WITH_PLAYER, distanceThreshold: 2, callback: secondDuplicateCallback}, false);
        const isColliding = vi.spyOn(detector, "isColliding");

        detector.update();

        expect(isColliding).toHaveBeenCalledTimes(2);
        expect(firstCallback).toHaveBeenCalledOnce();
        expect(firstDuplicateCallback).toHaveBeenCalledOnce();
        expect(secondCallback).not.toHaveBeenCalled();
        expect(secondDuplicateCallback).not.toHaveBeenCalled();
    });

    it("keeps distinct distance thresholds independent while caching listener checks", () => {
        const {detector} = createDetector();
        const target = new THREE.Object3D();
        const player = new THREE.Object3D();
        const nearCallback = vi.fn();
        const farCallback = vi.fn();
        target.position.set(0, 0, 0);
        player.position.set(3, 0, 0);
        detector.setPlayer(player);
        detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                distanceThreshold: 2,
                callback: nearCallback,
            },
            false,
        );
        detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                distanceThreshold: 4,
                callback: farCallback,
            },
            false,
        );
        const isColliding = vi.spyOn(detector, "isColliding");

        detector.update();

        expect(isColliding).toHaveBeenCalledTimes(2);
        expect(nearCallback).not.toHaveBeenCalled();
        expect(farCallback).toHaveBeenCalledOnce();
    });

    it("reuses bounding-box collision checks for listeners on the same target", () => {
        const {detector} = createDetector();
        const target = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const player = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const firstCallback = vi.fn();
        const secondCallback = vi.fn();
        detector.setPlayer(player);
        detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                useBoundingBoxes: true,
                distanceThreshold: 1,
                callback: firstCallback,
            },
            false,
        );
        detector.addListener(
            target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                useBoundingBoxes: true,
                distanceThreshold: 100,
                callback: secondCallback,
            },
            false,
        );
        const isColliding = vi.spyOn(detector, "isColliding");

        detector.update();

        expect(isColliding).toHaveBeenCalledTimes(1);
        expect(firstCallback).toHaveBeenCalledOnce();
        expect(secondCallback).toHaveBeenCalledOnce();
    });

    it("reuses the player bounding box while scanning non-colliding distance targets", () => {
        const {detector} = createDetector();
        const firstTarget = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const secondTarget = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const player = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const firstCallback = vi.fn();
        const secondCallback = vi.fn();
        firstTarget.position.set(10, 0, 0);
        secondTarget.position.set(20, 0, 0);
        detector.setPlayer(player);
        detector.addListener(
            firstTarget,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                useBoundingBoxes: true,
                callback: firstCallback,
            },
            false,
        );
        detector.addListener(
            secondTarget,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                useBoundingBoxes: true,
                callback: secondCallback,
            },
            false,
        );
        const getBox = vi.spyOn(BoundingBoxUtil, "updateAndGetBox");

        detector.update();

        expect(getBox.mock.calls.filter(([object]) => object === player)).toHaveLength(1);
        expect(firstCallback).not.toHaveBeenCalled();
        expect(secondCallback).not.toHaveBeenCalled();
    });

    it("recomputes the player bounding box after distance collision callbacks", () => {
        const {detector} = createDetector();
        const firstTarget = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const secondTarget = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const player = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const firstCallback = vi.fn(() => {
            player.position.set(20, 0, 0);
            player.updateMatrixWorld(true);
        });
        const secondCallback = vi.fn();
        secondTarget.position.set(20, 0, 0);
        detector.setPlayer(player);
        detector.addListener(
            firstTarget,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                useBoundingBoxes: true,
                callback: firstCallback,
            },
            false,
        );
        detector.addListener(
            secondTarget,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                useBoundingBoxes: true,
                callback: secondCallback,
            },
            false,
        );
        const getBox = vi.spyOn(BoundingBoxUtil, "updateAndGetBox");

        detector.update();

        expect(getBox.mock.calls.filter(([object]) => object === player)).toHaveLength(2);
        expect(firstCallback).toHaveBeenCalledOnce();
        expect(secondCallback).toHaveBeenCalledOnce();
    });

    it("checks deeply nested bounding boxes without recursive traversal", () => {
        const {detector} = createDetector();
        const target = new THREE.Object3D();
        let cursor = target;
        for (let i = 0; i < 12000; i++) {
            const child = new THREE.Object3D();
            cursor.add(child);
            cursor = child;
        }
        cursor.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
        const player = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());

        expect(detector.isColliding(target, player, true)).toBe(true);
    });
});

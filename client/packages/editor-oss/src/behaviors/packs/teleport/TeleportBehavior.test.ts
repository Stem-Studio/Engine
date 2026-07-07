import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import TeleportBehavior from "./TeleportBehavior";

describe("TeleportBehavior", () => {
    it("teleports the collision object from the callback context", () => {
        const trigger = new THREE.Object3D();
        const teleportTarget = new THREE.Object3D();
        teleportTarget.position.set(4, 5, 6);
        teleportTarget.rotation.set(0, Math.PI / 2, 0);
        const collidingObject = new THREE.Object3D();
        const scene = new THREE.Scene();
        scene.add(trigger, teleportTarget, collidingObject);
        const characterBehavior = {
            setPosition: vi.fn(),
            setAngle: vi.fn(),
        };
        const game = {
            scene,
            player: undefined,
            cameraControl: {resetCamera: vi.fn()},
            behaviorManager: {
                getTargetBehaviorsById: vi.fn((target: THREE.Object3D, id: string) =>
                    target === collidingObject && id === "character" ? [characterBehavior] : [],
                ),
            },
        };
        const behavior = new TeleportBehavior(trigger, "teleport", {
            gameObject: {target: trigger} as any,
            erth: {} as any,
            attributes: {
                teleportTargetUuid: teleportTarget.uuid,
            },
        });
        behavior.init(game as any);

        behavior.onCollision({
            target: trigger,
            other: collidingObject,
            listener: {} as any,
            source: "distance",
        });

        expect(game.behaviorManager.getTargetBehaviorsById).toHaveBeenCalledWith(collidingObject, "character");
        expect(characterBehavior.setPosition).toHaveBeenCalledWith(expect.objectContaining({x: 4, y: 5, z: 6}));
        expect(characterBehavior.setAngle).toHaveBeenCalledWith(expect.any(Number));
        expect(game.cameraControl.resetCamera).toHaveBeenCalledOnce();
    });
});

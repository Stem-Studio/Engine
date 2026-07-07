import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import JumppadBehavior, {CalculationMode} from "./JumppadBehavior";

describe("JumppadBehavior", () => {
    it("applies impulse to the collision object from the callback context", () => {
        const pad = new THREE.Object3D();
        const collidingObject = new THREE.Object3D();
        collidingObject.userData.physics = {enabled: true};
        const physics = {applyImpulseToPlayer: vi.fn()};
        const behavior = new JumppadBehavior(pad, "jumppad", {
            gameObject: {target: pad} as any,
            erth: {} as any,
            attributes: {
                strength: 12,
                strengthMode: CalculationMode.FIXED,
                enableAngle: false,
            },
        });
        behavior.init({
            collisionDetector: {physics},
            player: undefined,
        } as any);

        behavior.onCollision({
            target: pad,
            other: collidingObject,
            listener: {} as any,
            source: "distance",
        });

        expect(physics.applyImpulseToPlayer).toHaveBeenCalledWith(
            collidingObject.uuid,
            expect.objectContaining({x: 0, y: 12, z: 0}),
        );
    });
});

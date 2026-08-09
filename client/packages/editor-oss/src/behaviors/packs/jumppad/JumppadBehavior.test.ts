import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import JumppadBehavior, {CalculationMode} from "./JumppadBehavior";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("JumppadBehavior", () => {
    it("applies impulse to the collision object from the callback context", () => {
        const pad = new THREE.Object3D();
        const collidingObject = new THREE.Object3D();
        collidingObject.userData.physics = {enabled: true};
        const physics = {applyImpulseToPlayer: vi.fn()};
        const behavior = new JumppadBehavior(pad, "jumppad", {
            gameObject: {target: pad} as never,
            erth: {} as never,
            attributes: {
                strength: 12,
                strengthMode: CalculationMode.FIXED,
                enableAngle: false,
            },
        });
        behavior.init({
            collisionDetector: {physics},
            player: undefined,
        } as never);

        behavior.onCollision({
            target: pad,
            other: collidingObject,
            listener: {} as never,
            source: "distance",
        });

        expect(physics.applyImpulseToPlayer).toHaveBeenCalledWith(
            collidingObject.uuid,
            expect.objectContaining({x: 0, y: 12, z: 0}),
        );
    });

    it("reuses its impulse vector across activations while recalculating values", () => {
        const pad = new THREE.Object3D();
        const collidingObject = new THREE.Object3D();
        collidingObject.userData.physics = {enabled: true};
        const physics = {applyImpulseToPlayer: vi.fn()};
        const behavior = new JumppadBehavior(pad, "jumppad", {
            gameObject: {target: pad} as never,
            erth: {} as never,
            attributes: {
                strength: 10,
                strengthMode: CalculationMode.FIXED,
                enableAngle: false,
            },
        });
        behavior.init({
            collisionDetector: {physics},
            player: undefined,
        } as never);
        vi.spyOn(Date, "now")
            .mockReturnValueOnce(1000)
            .mockReturnValueOnce(1600);

        behavior.onCollision({
            target: pad,
            other: collidingObject,
            listener: {} as never,
            source: "distance",
        });
        behavior.attributes.strength = 15;
        behavior.onCollision({
            target: pad,
            other: collidingObject,
            listener: {} as never,
            source: "distance",
        });

        const firstImpulse = physics.applyImpulseToPlayer.mock.calls[0]?.[1] as THREE.Vector3;
        const secondImpulse = physics.applyImpulseToPlayer.mock.calls[1]?.[1] as THREE.Vector3;
        expect(firstImpulse).toBe(secondImpulse);
        expect(secondImpulse).toEqual(expect.objectContaining({x: 0, y: 15, z: 0}));
    });
});

import * as THREE from "three";
import {Easing} from "@tweenjs/tween.js";
import {describe, expect, it} from "vitest";

import TweenAnimationBehavior from "./TweenAnimationBehavior";

describe("TweenAnimationBehavior", () => {
    it("interpolates rotation with quaternion slerp", () => {
        const target = new THREE.Object3D();
        target.rotation.set(Math.PI * 0.8, Math.PI * 0.45, -Math.PI * 0.25);
        const startQuaternion = target.quaternion.clone();
        const endQuaternion = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
                target.rotation.x + THREE.MathUtils.degToRad(140),
                target.rotation.y + THREE.MathUtils.degToRad(170),
                target.rotation.z + THREE.MathUtils.degToRad(-120),
                target.rotation.order,
            ),
        );
        const behavior = new TweenAnimationBehavior(target, "tween", {
            gameObject: {target} as any,
            erth: {} as any,
            attributes: {
                rotate: {x: 140, y: 170, z: -120},
            },
        });

        const config = (behavior as any).getAnimationConfig();
        const update = (behavior as any).createUpdateFunction(config);
        update(0.5);

        const expected = startQuaternion.clone().slerp(endQuaternion, 0.5);
        expect(target.quaternion.angleTo(expected)).toBeLessThan(1e-6);
        expect(Math.abs(target.quaternion.length() - 1)).toBeLessThan(1e-6);
    });

    it("keeps named easing lookup and linear fallback behavior", () => {
        const target = new THREE.Object3D();
        const behavior = new TweenAnimationBehavior(target, "tween", {
            gameObject: {target} as any,
            erth: {} as any,
            attributes: {},
        });

        expect((behavior as any).getEasingFunction("quadOut")).toBe(Easing.Quadratic.Out);
        expect((behavior as any).getEasingFunction("unknown")).toBe(Easing.Linear.None);
    });
});

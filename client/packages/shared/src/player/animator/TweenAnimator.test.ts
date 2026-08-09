import {describe, expect, it, vi} from "vitest";
import {Object3D, Scene} from "three";

import TweenAnimator from "./TweenAnimator.js";

function createLinearAnimation(target: Object3D) {
    target.userData.triggerMovement = false;
    target.userData.startOnTrigger = false;

    return {
        type: "Tween",
        target: target.uuid,
        model: target,
        beginTime: 0,
        endTime: 10,
        loop: false,
        loopType: null,
        data: {
            ease: "linear",
            beginPositionX: 0,
            beginPositionY: 0,
            beginPositionZ: 0,
            endPositionX: 10,
            endPositionY: 0,
            endPositionZ: 0,
            beginRotationX: 0,
            beginRotationY: 0,
            beginRotationZ: 0,
            endRotationX: 0,
            endRotationY: 0,
            endRotationZ: 0,
            beginScaleX: 1,
            beginScaleY: 1,
            beginScaleZ: 1,
            endScaleX: 1,
            endScaleY: 1,
            endScaleZ: 1,
        },
    };
}

describe("TweenAnimator", () => {
    it("caches resolved tween targets without Three recursive lookup every frame", async () => {
        const scene = new Scene();
        const target = new Object3D();
        scene.add(target);
        const animation = createLinearAnimation(target);
        const animator = new TweenAnimator({});
        await animator.create(scene, null, null, [{name: "base", id: "0", animations: [animation]}]);
        const getObjectByProperty = vi.spyOn(scene, "getObjectByProperty");
        const traverse = vi.spyOn(scene, "traverse");

        animator.update(null, 0, 5);
        animator.update(null, 0, 6);

        expect(getObjectByProperty).not.toHaveBeenCalled();
        expect(traverse).not.toHaveBeenCalled();
        expect(target.position.x).toBeCloseTo(6);
    });

    it("re-resolves a cached target iteratively when the object is replaced in the scene", async () => {
        const scene = new Scene();
        const original = new Object3D();
        scene.add(original);
        const animation = createLinearAnimation(original);
        const animator = new TweenAnimator({});
        await animator.create(scene, null, null, [{name: "base", id: "0", animations: [animation]}]);
        const getObjectByProperty = vi.spyOn(scene, "getObjectByProperty");
        const traverse = vi.spyOn(scene, "traverse");

        animator.update(null, 0, 5);

        const replacement = new Object3D();
        replacement.uuid = original.uuid;
        replacement.userData.triggerMovement = false;
        replacement.userData.startOnTrigger = false;
        scene.remove(original);
        scene.add(replacement);
        animation.model = replacement;

        animator.update(null, 0, 7);

        expect(getObjectByProperty).not.toHaveBeenCalled();
        expect(traverse).not.toHaveBeenCalled();
        expect(original.position.x).toBeCloseTo(5);
        expect(replacement.position.x).toBeCloseTo(7);
    });

    it("removes animations in place and clears removed target cache entries", async () => {
        const scene = new Scene();
        const first = new Object3D();
        const second = new Object3D();
        scene.add(first, second);
        const firstAnimation = createLinearAnimation(first);
        const secondAnimation = createLinearAnimation(second);
        const layerAnimations = [firstAnimation, secondAnimation];
        const layer = {name: "base", id: "0", animations: layerAnimations};
        const animator = new TweenAnimator({});
        await animator.create(scene, null, null, [layer]);
        animator.resolveAnimationTarget(firstAnimation);

        animator.removeAnimationByTargetUuid("base", "0", first.uuid);

        expect(layer.animations).toBe(layerAnimations);
        expect(layer.animations).toEqual([secondAnimation]);
        expect(animator.targetCache.has(firstAnimation)).toBe(false);
    });
});

import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import FollowBehavior from "./FollowBehavior";

const createFollowBehavior = (
    target: THREE.Object3D,
    followTarget: THREE.Object3D,
    attributes: Record<string, unknown> = {},
) => {
    const scene = new THREE.Scene();
    scene.add(target, followTarget);

    const behavior = new FollowBehavior(target, "follow", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes: {
            followTargetUuid: followTarget.uuid,
            distance: 1,
            speed: 0.5,
            rotate: false,
            startOnTrigger: false,
            ...attributes,
        },
    });

    behavior.init({
        scene,
        getObjectByUUID: (uuid: string) => scene.getObjectByProperty("uuid", uuid) ?? null,
    } as any);
    return behavior;
};

describe("FollowBehavior", () => {
    it("moves toward the follow target without overshooting the configured alpha", () => {
        const target = new THREE.Object3D();
        const followTarget = new THREE.Object3D();
        followTarget.position.set(10, 0, 0);
        const behavior = createFollowBehavior(target, followTarget);

        behavior.update(1);

        expect(target.position.x).toBeCloseTo(5);
        expect(target.position.y).toBeCloseTo(0);
        expect(target.position.z).toBeCloseTo(0);
    });

    it("uses squared distance checks for follow range comparisons", () => {
        const target = new THREE.Object3D();
        const followTarget = new THREE.Object3D();
        followTarget.position.set(10, 0, 0);
        const behavior = createFollowBehavior(target, followTarget);
        const distanceTo = vi.spyOn(target.position, "distanceTo");
        const distanceToSquared = vi.spyOn(target.position, "distanceToSquared");

        behavior.update(1);

        expect(distanceTo).not.toHaveBeenCalled();
        expect(distanceToSquared).toHaveBeenCalledOnce();
        expect(target.position.x).toBeCloseTo(5);
    });

    it("updates DirectionalLight targets using the retained light offset", () => {
        const light = new THREE.DirectionalLight();
        light.position.set(1, 2, 3);
        const followTarget = new THREE.Object3D();
        followTarget.position.set(5, 0, 0);
        const behavior = createFollowBehavior(light, followTarget);

        behavior.update(1);

        expect(light.target.position.x).toBeCloseTo(5);
        expect(light.target.position.y).toBeCloseTo(0);
        expect(light.target.position.z).toBeCloseTo(0);
        expect(light.position.x).toBeCloseTo(1);
        expect(light.position.y).toBeCloseTo(2);
        expect(light.position.z).toBeCloseTo(3);

        followTarget.position.set(6, 0, 0);
        behavior.update(1);

        expect(light.target.position.x).toBeCloseTo(6);
        expect(light.position.x).toBeCloseTo(2);
        expect(light.position.y).toBeCloseTo(2);
        expect(light.position.z).toBeCloseTo(3);
    });
});

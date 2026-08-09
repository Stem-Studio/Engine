import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import BillboardBehavior from "./BillboardBehavior";

type BillboardBehaviorHarness = Record<string, unknown> & {
    v1: THREE.Vector3;
    screenPosition: THREE.Vector2;
    intersections: THREE.Intersection<THREE.Object3D>[];
    isObjectBehindCamera(el: THREE.Object3D, camera: THREE.Camera): boolean;
    isObjectVisible(
        el: THREE.Object3D,
        camera: THREE.Camera,
        raycaster: THREE.Raycaster,
        occlude: THREE.Object3D[],
    ): boolean;
};

function createBehavior(target: THREE.Object3D): BillboardBehaviorHarness {
    return new BillboardBehavior(target, "billboard", {
        gameObject: {target} as never,
        erth: {} as never,
        attributes: {},
    }) as unknown as BillboardBehaviorHarness;
}

function makeIntersection(object: THREE.Object3D, distance: number): THREE.Intersection<THREE.Object3D> {
    return {
        distance,
        point: new THREE.Vector3(),
        object,
    };
}

describe("BillboardBehavior visibility raycast", () => {
    it("reuses projection and raycast buffers without changing distance semantics", () => {
        const target = new THREE.Object3D();
        target.position.set(0, 0, -5);
        target.updateMatrixWorld(true);

        const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
        camera.position.set(0, 0, 0);
        camera.lookAt(0, 0, -1);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        const blocker = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const behavior = createBehavior(target);
        const reusableIntersections = [makeIntersection(blocker, 99)];
        behavior.intersections = reusableIntersections;
        const distanceTo = vi.spyOn(behavior.v1, "distanceTo");
        const distanceToSquared = vi.spyOn(behavior.v1, "distanceToSquared");

        const raycaster = {
            ray: {origin: new THREE.Vector3()},
            setFromCamera: vi.fn((screenPosition: THREE.Vector2) => {
                expect(screenPosition).toBe(behavior.screenPosition);
                raycaster.ray.origin.set(0, 0, 0);
            }),
            intersectObjects: vi.fn(
                (_objects: THREE.Object3D[], _recursive: boolean, targetHits: THREE.Intersection<THREE.Object3D>[]) => {
                    expect(targetHits).toBe(reusableIntersections);
                    expect(targetHits).toHaveLength(0);
                    targetHits.push(makeIntersection(blocker, 10));
                    return targetHits;
                },
            ),
        };

        const visible = behavior.isObjectVisible(
            target,
            camera,
            raycaster as unknown as THREE.Raycaster,
            [blocker],
        );

        expect(visible).toBe(true);
        expect(distanceToSquared).toHaveBeenCalledWith(raycaster.ray.origin);
        expect(distanceTo).not.toHaveBeenCalled();
        expect(raycaster.setFromCamera).toHaveBeenCalledTimes(1);
        expect(raycaster.intersectObjects).toHaveBeenCalledWith([blocker], true, reusableIntersections);
    });

    it("uses camera-facing dot product instead of angleTo for behind-camera tests", () => {
        const target = new THREE.Object3D();
        const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
        camera.position.set(0, 0, 0);
        camera.lookAt(0, 0, -1);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        const behavior = createBehavior(target);
        const angleTo = vi.spyOn(behavior.v1, "angleTo");

        target.position.set(0, 0, -5);
        target.updateMatrixWorld(true);
        expect(behavior.isObjectBehindCamera(target, camera)).toBe(false);

        target.position.set(0, 0, 5);
        target.updateMatrixWorld(true);
        expect(behavior.isObjectBehindCamera(target, camera)).toBe(true);
        expect(angleTo).not.toHaveBeenCalled();
    });
});

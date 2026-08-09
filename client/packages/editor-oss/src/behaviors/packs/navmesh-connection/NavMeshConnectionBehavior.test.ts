import * as THREE from "three";
import {describe, expect, it} from "vitest";

import NavMeshConnectionBehavior from "./NavMeshConnectionBehavior";

const createBehavior = () => {
    const scene = new THREE.Scene();
    const sceneHelpers = new THREE.Group();
    const start = new THREE.Object3D();
    const end = new THREE.Object3D();
    start.name = "Start";
    end.name = "End";
    end.position.set(0, 0, 10);
    scene.add(start, end);

    const behavior = new NavMeshConnectionBehavior(start, "navmesh-connection", {
        gameObject: {target: start} as any,
        erth: {} as any,
        attributes: {
            targetObject: end.uuid,
            showConnection: true,
            bidirectional: true,
            radius: 0.5,
        },
    });

    behavior.onEditorAdded({scene, sceneHelpers} as any);
    return {behavior, scene, sceneHelpers, start, end};
};

describe("NavMeshConnectionBehavior", () => {
    it("updates existing editor visualization arrows without recreating them", () => {
        const {behavior, scene, sceneHelpers, start, end} = createBehavior();
        const visualization = sceneHelpers.children[0] as THREE.Group;
        const forwardArrow = visualization.children[0] as THREE.ArrowHelper;
        const backwardArrow = visualization.children[1] as THREE.ArrowHelper;

        start.position.set(1, 0, 0);
        end.position.set(1, 0, 4);
        scene.updateMatrixWorld(true);

        behavior.onEditorUpdate();

        expect(sceneHelpers.children[0]).toBe(visualization);
        expect(visualization.children[0]).toBe(forwardArrow);
        expect(visualization.children[1]).toBe(backwardArrow);
        expect(forwardArrow.position.toArray()).toEqual([1, 0, 0]);
        expect(backwardArrow.position.toArray()).toEqual([1, 0, 4]);
    });
});

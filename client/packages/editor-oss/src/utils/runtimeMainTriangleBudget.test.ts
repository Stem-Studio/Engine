import {BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene} from "three";

import {
    applyRuntimeMainTriangleBudget,
    restoreRuntimeMainTriangleBudget,
} from "./runtimeMainTriangleBudget";

function runtimeUnit(name: string, x: number, triangles = 12): Group {
    const unit = new Group();
    unit.name = name;
    unit.position.x = x;
    const geometry = new BoxGeometry(1, 1, 1);
    if (triangles !== 12) geometry.setDrawRange(0, triangles * 3);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.userData.isRuntimeOnly = true;
    unit.add(mesh);
    return unit;
}

function setupScene() {
    const scene = new Scene();
    const runtimeRoot = new Group();
    runtimeRoot.name = "RuntimeRoot";
    runtimeRoot.userData.isRuntimeOnly = true;
    scene.add(runtimeRoot);
    scene.userData.rendering = {
        runtimeMainTriangleBudget: {enabled: true, fallbackOnly: true, maxTriangles: 12},
    };
    return {scene, runtimeRoot};
}

describe("runtimeMainTriangleBudget", () => {
    it("requires opt-in and skips the real WebGPU path", () => {
        const {scene, runtimeRoot} = setupScene();
        const unit = runtimeUnit("far", 100);
        runtimeRoot.add(unit);
        const skipped = applyRuntimeMainTriangleBudget(scene, {isWebGPU: true});
        expect(skipped.enabled).toBe(false);
        expect(skipped.skippedWebGPU).toBe(true);
        expect(unit.visible).toBe(true);
    });

    it("hides complete visual units under the fallback triangle cap and restores them", () => {
        const {scene, runtimeRoot} = setupScene();
        const near = runtimeUnit("near", 5);
        const farA = runtimeUnit("far-a", 100);
        const farB = runtimeUnit("far-b", 110);
        runtimeRoot.add(near, farA, farB);
        const camera = new PerspectiveCamera();
        camera.position.set(0, 0, 0);

        const stats = applyRuntimeMainTriangleBudget(scene, {camera});
        expect(stats.unitsConsidered).toBe(3);
        expect(stats.unitsDisabled).toBe(2);
        expect(near.visible).toBe(true);
        expect([farA.visible, farB.visible].filter(Boolean)).toHaveLength(0);

        restoreRuntimeMainTriangleBudget(scene);
        expect(near.visible).toBe(true);
        expect(farA.visible).toBe(true);
        expect(farB.visible).toBe(true);
    });

    it("preserves hero and explicitly disabled units, and reconsiders on repeat", () => {
        const {scene, runtimeRoot} = setupScene();
        const hero = runtimeUnit("Player", 100);
        const disabled = runtimeUnit("disabled", 120);
        disabled.userData.disableRuntimeMainTriangleBudget = true;
        const ordinary = runtimeUnit("ordinary", 140);
        runtimeRoot.add(hero, disabled, ordinary);
        const first = applyRuntimeMainTriangleBudget(scene);
        expect(first.unitsPreserved).toBe(1);
        expect(disabled.visible).toBe(true);
        expect(hero.visible).toBe(true);
        expect(ordinary.visible).toBe(false);

        scene.userData.rendering.runtimeMainTriangleBudget.maxTriangles = 24;
        const second = applyRuntimeMainTriangleBudget(scene, {reconsiderHidden: true});
        expect(second.unitsDisabled).toBe(0);
        expect(ordinary.visible).toBe(true);
    });

    it("does not resurrect hidden units during stabilization and honors descendant markers", () => {
        const {scene, runtimeRoot} = setupScene();
        const preserved = runtimeUnit("decoration", 100);
        preserved.children[0]!.userData.runtimeMainPreserve = true;
        const hidden = runtimeUnit("hidden", 140);
        runtimeRoot.add(preserved, hidden);
        applyRuntimeMainTriangleBudget(scene);
        expect(preserved.visible).toBe(true);
        expect(hidden.visible).toBe(false);

        const late = runtimeUnit("late", 160);
        runtimeRoot.add(late);
        applyRuntimeMainTriangleBudget(scene);
        expect(hidden.visible).toBe(false);
        expect(late.visible).toBe(false);
        restoreRuntimeMainTriangleBudget(scene);
        expect(hidden.visible).toBe(true);
        expect(late.visible).toBe(true);
    });
});

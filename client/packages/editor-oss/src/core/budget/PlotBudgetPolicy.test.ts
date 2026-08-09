import {describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import {
    collectPlotBudgetStats,
    getPlotBudgetMetadata,
    getPlotBudgetOptionsFromQuality,
    isPlotBudgetCandidate,
    PlotBudgetManager,
    PlotBudgetPolicy,
} from "./PlotBudgetPolicy";
import type {IQualitySettings} from "../quality/interfaces/IQualityManager";
import {traverseObjectDepthFirstWithConsumers} from "../../utils/SceneTraverser";

function createCamera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
}

function createStaticPlot(name: string, z: number): THREE.Object3D {
    const root = new THREE.Group();
    root.name = name;
    root.userData.isStemObject = true;
    root.position.set(0, 0, z);
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    root.updateMatrixWorld(true);
    return root;
}

function createPlotWithLod(name: string, z: number, distance = 10): {root: THREE.Group; lod: THREE.LOD; high: THREE.Mesh; low: THREE.Mesh} {
    const root = new THREE.Group();
    root.name = name;
    root.userData.isStemObject = true;
    root.position.set(0, 0, z);
    const lod = new THREE.LOD();
    lod.userData.authored = `${name}-lod`;
    const high = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const low = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    high.userData.authored = `${name}-high`;
    low.userData.authored = `${name}-low`;
    lod.addLevel(high, 0);
    lod.addLevel(low, distance);
    root.add(lod);
    root.updateMatrixWorld(true);
    return {root, lod, high, low};
}

function createDeepStaticPlot(depth: number): THREE.Object3D {
    const root = new THREE.Group();
    root.name = "deep-root";
    root.userData.isStemObject = true;
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new THREE.Group();
        child.name = `deep-${i}`;
        current.add(child);
        current = child;
    }

    current.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    return root;
}

describe("PlotBudgetPolicy", () => {
    it("moves static plot roots from near to mid to far to culled by distance", () => {
        const camera = createCamera();
        const plot = createStaticPlot("plot", -5);
        const policy = new PlotBudgetPolicy({
            isMobile: true,
            nearDistance: 5,
            midDistance: 10,
            farDistance: 20,
            cullDistance: 30,
            offscreenCullDistance: 30,
        });

        expect(policy.decide(plot, camera).state).toBe("near");

        plot.position.z = -15;
        plot.updateMatrixWorld(true);
        expect(policy.decide(plot, camera).state).toBe("mid");

        plot.position.z = -25;
        plot.updateMatrixWorld(true);
        expect(policy.decide(plot, camera).state).toBe("far");

        plot.position.z = -35;
        plot.updateMatrixWorld(true);
        const decision = policy.decide(plot, camera);
        expect(decision.state).toBe("culled");
        policy.applyVisibilityState(plot, decision);
        expect(plot.visible).toBe(false);

        plot.position.z = -5;
        plot.updateMatrixWorld(true);
        const restored = policy.decide(plot, camera);
        policy.applyVisibilityState(plot, restored);
        expect(restored.state).toBe("near");
        expect(plot.visible).toBe(true);
    });

    it("registers safe static roots and excludes behavior roots", () => {
        const scene = new THREE.Scene();
        const staticRoot = createStaticPlot("static", -10);
        const behaviorRoot = createStaticPlot("behavior", -10);
        behaviorRoot.userData.behaviors = [{id: "example"}];
        scene.add(staticRoot, behaviorRoot);

        const manager = new PlotBudgetManager(scene, {isMobile: true});

        expect(manager.getRegisteredCount()).toBe(1);
        expect(getPlotBudgetMetadata(staticRoot)?.enabled).toBe(true);
        expect(getPlotBudgetMetadata(behaviorRoot)?.enabled).toBeUndefined();
    });

    it("classifies candidate trees without rewalking through Object3D.traverse", () => {
        const root = new THREE.Group();
        root.userData.isStemObject = true;
        const runtimeChild = new THREE.Group();
        runtimeChild.userData.behaviors = [{id: "example"}];
        runtimeChild.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
        root.add(runtimeChild);
        const traverse = vi.spyOn(root, "traverse");

        expect(isPlotBudgetCandidate(root)).toBe(false);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("collects plot stats for deep hierarchy without Object3D.traverse", () => {
        const root = createDeepStaticPlot(12000);
        const traverse = vi.spyOn(root, "traverse");

        const stats = collectPlotBudgetStats(root);

        expect(stats.triangles).toBeGreaterThan(0);
        expect(stats.bounds.x).toBeGreaterThan(0);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("registers and unregisters deep plot roots without recursive traversal", () => {
        const root = createDeepStaticPlot(12000);
        const traverse = vi.spyOn(root, "traverse");
        const manager = new PlotBudgetManager(undefined, {isMobile: true});

        manager.registerObjectTree(root);
        expect(manager.getRegisteredCount()).toBe(1);

        manager.unregisterObjectTree(root);
        expect(manager.getRegisteredCount()).toBe(0);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("short-circuits nested plot candidates through the node registration hook", () => {
        const root = createStaticPlot("root", -10) as THREE.Group;
        const nested = createStaticPlot("nested", -10);
        root.add(nested);
        const manager = new PlotBudgetManager(undefined, {isMobile: true});

        traverseObjectDepthFirstWithConsumers(root, [node => manager.registerObjectNode(node)]);
        expect(manager.getRegisteredCount()).toBe(1);

        manager.unregisterObjectTree(root);
        expect(manager.getRegisteredCount()).toBe(0);
    });

    it("progressively rebuilds large scenes without synchronous all-root registration", async () => {
        const scene = new THREE.Scene();
        for (let i = 0; i < 70; i++) {
            scene.add(createStaticPlot(`plot-${i}`, -10));
        }
        const yieldToFrame = vi.fn(async () => {});
        const manager = new PlotBudgetManager(undefined, {isMobile: true});

        await manager.rebuildProgressive(scene, {
            batchSize: 10,
            frameBudgetMs: 1_000_000,
            yieldToFrame,
        });

        expect(manager.getRegisteredCount()).toBe(70);
        expect(yieldToFrame).toHaveBeenCalled();
    });

    it("yields while progressively registering one deep plot root", async () => {
        const scene = new THREE.Scene();
        const root = createDeepStaticPlot(70);
        scene.add(root);
        const yieldToFrame = vi.fn(async () => {});
        const manager = new PlotBudgetManager(undefined, {isMobile: true});

        await manager.rebuildProgressive(scene, {
            batchSize: 10,
            frameBudgetMs: 1_000_000,
            yieldToFrame,
        });

        expect(manager.getRegisteredCount()).toBe(1);
        expect(getPlotBudgetMetadata(root)?.stats?.triangles).toBeGreaterThan(0);
        expect(yieldToFrame).toHaveBeenCalled();
        expect(yieldToFrame.mock.calls.length).toBeLessThan(12);
    });

    it("collects multi-material plot draw calls without duplicating textures", () => {
        const root = new THREE.Group();
        const sharedTexture = new THREE.Texture({width: 32, height: 32});
        const materials = [
            new THREE.MeshBasicMaterial({map: sharedTexture}),
            new THREE.MeshBasicMaterial({map: sharedTexture}),
        ];
        root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials));
        root.updateMatrixWorld(true);

        const stats = collectPlotBudgetStats(root);

        expect(stats.drawCalls).toBe(2);
        expect(stats.textureCount).toBe(1);
    });

    it("updates plot roots in batches", () => {
        const camera = createCamera();
        const scene = new THREE.Scene();
        const a = createStaticPlot("a", -40);
        const b = createStaticPlot("b", -40);
        const c = createStaticPlot("c", -40);
        scene.add(a, b, c);

        const manager = new PlotBudgetManager(scene, {
            isMobile: true,
            batchSize: 1,
            nearDistance: 5,
            midDistance: 10,
            farDistance: 20,
            cullDistance: 30,
            offscreenCullDistance: 30,
        });

        manager.update(camera);
        expect(a.visible).toBe(false);
        expect(b.visible).toBe(true);
        expect(c.visible).toBe(true);

        manager.update(camera);
        expect(b.visible).toBe(false);
        expect(c.visible).toBe(true);
    });

    it("prepares camera state once per manager update batch", () => {
        const camera = createCamera();
        const updateMatrixWorld = vi.spyOn(camera, "updateMatrixWorld");
        const scene = new THREE.Scene();
        scene.add(createStaticPlot("a", -40), createStaticPlot("b", -40), createStaticPlot("c", -40));

        const manager = new PlotBudgetManager(scene, {
            isMobile: true,
            batchSize: 3,
            nearDistance: 5,
            midDistance: 10,
            farDistance: 20,
            cullDistance: 30,
            offscreenCullDistance: 30,
        });

        manager.update(camera);

        expect(updateMatrixWorld).toHaveBeenCalledTimes(1);
    });

    it("reads plot world position once per distance and visibility decision", () => {
        const camera = createCamera();
        const plot = createStaticPlot("plot", -20);
        const getWorldPosition = vi.spyOn(plot, "getWorldPosition");
        const policy = new PlotBudgetPolicy({isMobile: true});

        policy.decide(plot, camera);

        expect(getWorldPosition).toHaveBeenCalledTimes(1);
    });

    it("unregisters swapped plot roots without stale indexes", () => {
        const scene = new THREE.Scene();
        const first = createStaticPlot("first", -10);
        const second = createStaticPlot("second", -10);
        const third = createStaticPlot("third", -10);
        const lod = new THREE.LOD();
        lod.addLevel(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()), 0);
        lod.addLevel(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()), 100);
        third.add(lod);
        third.updateMatrixWorld(true);
        scene.add(first, second, third);

        const manager = new PlotBudgetManager(scene, {isMobile: true});

        expect(manager.getRegisteredCount()).toBe(3);
        expect(lod.autoUpdate).toBe(false);

        manager.unregisterObjectTree(second);
        expect(manager.getRegisteredCount()).toBe(2);

        manager.unregisterObjectTree(third);
        expect(manager.getRegisteredCount()).toBe(1);
        expect(lod.autoUpdate).toBe(true);

        manager.unregisterObjectTree(first);
        expect(manager.getRegisteredCount()).toBe(0);
    });

    it("disables renderer LOD auto-update and applies quality distance multiplier", () => {
        const camera = createCamera();
        const scene = new THREE.Scene();
        const root = new THREE.Group();
        root.userData.isStemObject = true;
        const lod = new THREE.LOD();
        lod.addLevel(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()), 0);
        lod.addLevel(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()), 100);
        root.add(lod);
        root.position.z = -10;
        scene.add(root);
        root.updateMatrixWorld(true);

        const manager = new PlotBudgetManager(scene, {
            isMobile: true,
            batchSize: 1,
            lodDistanceMultiplier: 0.5,
        });

        expect(lod.autoUpdate).toBe(false);
        manager.update(camera);
        expect(lod.levels[1]!.distance).toBe(50);

        manager.dispose();
        expect(lod.autoUpdate).toBe(true);
    });

    it("registers authored THREE.LODs with the runtime controller", () => {
        const camera = createCamera();
        const scene = new THREE.Scene();
        const {root, lod, high, low} = createPlotWithLod("authored-lod", -5, 10);
        scene.add(root);

        const manager = new PlotBudgetManager(scene, {
            isMobile: true,
            batchSize: 1,
            nearDistance: 5,
            midDistance: 20,
            farDistance: 40,
            cullDistance: 80,
            offscreenCullDistance: 80,
        });

        expect(lod.autoUpdate).toBe(false);
        expect(high.visible).toBe(true);
        expect(low.visible).toBe(false);

        manager.update(camera);

        expect(manager.getLodDiagnostics().registeredGroups).toBe(1);
        expect(manager.getLodDiagnostics().appliedTransitions).toBe(0);
        expect(high.visible).toBe(true);
        expect(low.visible).toBe(false);
    });

    it("budgets runtime LOD transitions across visible plots", () => {
        const camera = createCamera();
        const scene = new THREE.Scene();
        const first = createPlotWithLod("first", -30, 10);
        const second = createPlotWithLod("second", -30, 10);
        scene.add(first.root, second.root);

        const manager = new PlotBudgetManager(scene, {
            isMobile: true,
            batchSize: 2,
            nearDistance: 5,
            midDistance: 40,
            farDistance: 80,
            cullDistance: 120,
            offscreenCullDistance: 120,
            lodTransitionBudget: 1,
            lodHysteresisRatio: 0,
        });

        manager.update(camera);

        const lowVisibleCount = [first.low.visible, second.low.visible].filter(Boolean).length;
        expect(lowVisibleCount).toBe(1);
        expect(manager.getLodDiagnostics().appliedTransitions).toBe(1);
        expect(manager.getLodDiagnostics().pendingTransitions).toBe(1);
    });

    it("updates runtime LOD thresholds when pressure distance scale changes", () => {
        const camera = createCamera();
        const scene = new THREE.Scene();
        const {root, high, low} = createPlotWithLod("pressure-lod", -80, 100);
        scene.add(root);

        const manager = new PlotBudgetManager(scene, {
            isMobile: true,
            batchSize: 1,
            nearDistance: 5,
            midDistance: 90,
            farDistance: 140,
            cullDistance: 180,
            offscreenCullDistance: 180,
            runtimeLodDistanceScale: 1,
            lodDistanceMultiplier: 1,
            lodHysteresisRatio: 0,
        });

        manager.update(camera);
        expect(high.visible).toBe(true);
        expect(low.visible).toBe(false);

        manager.configure({runtimeLodDistanceScale: 0.5});
        manager.update(camera);

        expect(high.visible).toBe(false);
        expect(low.visible).toBe(true);
    });

    it("does not transition LOD groups while their plot is culled", () => {
        const camera = createCamera();
        const scene = new THREE.Scene();
        const {root, high, low} = createPlotWithLod("culled-lod", -80, 10);
        scene.add(root);

        const manager = new PlotBudgetManager(scene, {
            isMobile: true,
            batchSize: 1,
            nearDistance: 5,
            midDistance: 10,
            farDistance: 20,
            cullDistance: 30,
            offscreenCullDistance: 30,
            lodHysteresisRatio: 0,
        });

        manager.update(camera);

        expect(root.visible).toBe(false);
        expect(high.visible).toBe(true);
        expect(low.visible).toBe(false);
        expect(manager.getLodDiagnostics().disabledGroups).toBe(1);
        expect(manager.getLodDiagnostics().appliedTransitions).toBe(0);
    });

    it("falls back to native THREE.LOD updates when runtime bounds are unavailable", () => {
        const camera = createCamera();
        const scene = new THREE.Scene();
        const root = new THREE.Group();
        root.userData.isStemObject = true;
        root.position.z = -30;
        const lod = new THREE.LOD();
        const high = new THREE.Object3D();
        const low = new THREE.Object3D();
        lod.addLevel(high, 0);
        lod.addLevel(low, 10);
        root.add(lod);
        scene.add(root);
        root.updateMatrixWorld(true);

        const manager = new PlotBudgetManager(scene, {
            isMobile: true,
            batchSize: 1,
            nearDistance: 5,
            midDistance: 40,
            farDistance: 80,
            cullDistance: 120,
            offscreenCullDistance: 120,
            lodHysteresisRatio: 0,
        });

        manager.update(camera);

        expect(manager.getLodDiagnostics().registeredGroups).toBe(0);
        expect(high.visible).toBe(false);
        expect(low.visible).toBe(true);
        expect(lod.autoUpdate).toBe(true);
    });

    it("restores runtime LOD state on unregister", () => {
        const scene = new THREE.Scene();
        const {root, lod, high, low} = createPlotWithLod("restore-lod", -30, 10);
        scene.add(root);

        const manager = new PlotBudgetManager(scene, {isMobile: true, batchSize: 1});

        expect(lod.autoUpdate).toBe(false);
        expect(high.visible).toBe(true);
        expect(low.visible).toBe(false);

        manager.unregisterObjectTree(root);

        expect(lod.autoUpdate).toBe(true);
        expect(high.visible).toBe(true);
        expect(low.visible).toBe(true);
        expect(manager.getRegisteredCount()).toBe(0);
    });

    it("does not write runtime LOD metadata into authored LOD userData", () => {
        const camera = createCamera();
        const scene = new THREE.Scene();
        const {root, lod, high, low} = createPlotWithLod("userdata-lod", -30, 10);
        scene.add(root);

        const manager = new PlotBudgetManager(scene, {isMobile: true, batchSize: 1});
        manager.update(camera);

        expect(lod.userData).toEqual({authored: "userdata-lod-lod"});
        expect(high.userData).toEqual({authored: "userdata-lod-high"});
        expect(low.userData).toEqual({authored: "userdata-lod-low"});
    });

    it("derives tighter mobile plot budgets from low quality settings", () => {
        const lowQuality = getPlotBudgetOptionsFromQuality(
            {
                rendering: {
                    textureQuality: "low",
                    lodBias: 2,
                    pixelRatio: 0.6,
                },
                scene: {
                    viewDistance: 300,
                    lodDistances: [30, 90, 180],
                    cullingAggressiveness: 1,
                },
            } as IQualitySettings,
            {isMobile: true},
        );
        const highQuality = getPlotBudgetOptionsFromQuality(
            {
                rendering: {
                    textureQuality: "high",
                    lodBias: 0,
                    pixelRatio: 1,
                },
                scene: {
                    viewDistance: 300,
                    lodDistances: [30, 90, 180],
                    cullingAggressiveness: 0,
                },
            } as IQualitySettings,
            {isMobile: true},
        );

        expect(lowQuality.nearDistance).toBeLessThan(highQuality.nearDistance!);
        expect(lowQuality.cullDistance).toBeLessThan(highQuality.cullDistance!);
        expect(lowQuality.lodDistanceMultiplier).toBeLessThan(highQuality.lodDistanceMultiplier!);
        expect(lowQuality.heavyTextureBytesLimit).toBeLessThan(highQuality.heavyTextureBytesLimit!);
    });

    it("tightens plot distance and LOD thresholds under runtime budget pressure", () => {
        const camera = createCamera();
        const scene = new THREE.Scene();
        const root = new THREE.Group();
        root.userData.isStemObject = true;
        const lod = new THREE.LOD();
        lod.addLevel(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()), 0);
        lod.addLevel(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()), 100);
        root.add(lod);
        root.position.z = -18;
        scene.add(root);
        root.updateMatrixWorld(true);

        const manager = new PlotBudgetManager(scene, {
            isMobile: true,
            batchSize: 1,
            nearDistance: 5,
            midDistance: 20,
            farDistance: 40,
            cullDistance: 80,
            offscreenCullDistance: 80,
            lodDistanceMultiplier: 1,
            runtimeDistanceScale: 0.6,
            runtimeLodDistanceScale: 0.5,
        });

        manager.update(camera);

        expect(getPlotBudgetMetadata(root)?.state).toBe("mid");
        expect(lod.levels[1]!.distance).toBe(50);
    });
});

import {describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import {createRuntimeLodAdapter, RuntimeLodController} from "./RuntimeLodController";

function createCamera(z = 0): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.position.set(0, 0, z);
    camera.lookAt(0, 0, z - 1);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
}

function createLevelObjects(count = 3): THREE.Mesh[] {
    return Array.from({length: count}, () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
}

function createController(nowValues?: number[]): RuntimeLodController {
    let index = 0;
    return new RuntimeLodController({
        defaultDistances: [10, 30, 60],
        maxTransitionsPerFrame: 8,
        hysteresisRatio: 0.1,
        now: () => nowValues?.[Math.min(index++, nowValues.length - 1)] ?? index++,
    });
}

describe("RuntimeLodController", () => {
    it("registers runtime-only LOD groups and toggles level visibility without touching serialized userData", () => {
        const levels = createLevelObjects();
        levels[1]!.visible = false;
        levels[2]!.visible = false;
        const root = new THREE.Group();
        root.userData.serializedName = "authored";
        root.add(...levels);

        const controller = createController();
        const handle = controller.registerGroup({
            id: "crate",
            root,
            levels: [
                {id: "high", object: levels[0]},
                {id: "mid", object: levels[1]},
                {id: "low", object: levels[2]},
            ],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -5), 1),
        });

        expect(handle.id).toBe("crate");
        expect(levels.map(level => level.visible)).toEqual([true, false, false]);
        expect(root.userData).toEqual({serializedName: "authored"});
    });

    it("uses distance thresholds with hysteresis to avoid oscillation at boundaries", () => {
        const levels = createLevelObjects();
        const controller = createController();
        controller.registerGroup({
            id: "sign",
            levels: levels.map((object, index) => ({id: `lod-${index}`, object})),
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -10.5), 1),
        });

        controller.update(createCamera());
        let diagnostics = controller.getDiagnostics();
        expect(controller.getCurrentLevelIndex("sign")).toBe(0);
        expect(diagnostics.appliedTransitions).toBe(0);

        controller.unregisterGroup("sign");
        controller.registerGroup({
            id: "sign",
            levels: levels.map((object, index) => ({id: `lod-${index}`, object})),
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -11.2), 1),
        });

        controller.update(createCamera());
        diagnostics = controller.getDiagnostics();
        expect(controller.getCurrentLevelIndex("sign")).toBe(1);
        expect(diagnostics.appliedTransitions).toBe(1);

        controller.unregisterGroup("sign");
        controller.registerGroup({
            id: "sign",
            initialLevel: 1,
            levels: levels.map((object, index) => ({id: `lod-${index}`, object})),
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -9.5), 1),
        });

        controller.update(createCamera());
        diagnostics = controller.getDiagnostics();
        expect(controller.getCurrentLevelIndex("sign")).toBe(1);
        expect(diagnostics.appliedTransitions).toBe(0);

        controller.unregisterGroup("sign");
        controller.registerGroup({
            id: "sign",
            initialLevel: 1,
            levels: levels.map((object, index) => ({id: `lod-${index}`, object})),
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -8.8), 1),
        });

        controller.update(createCamera());
        diagnostics = controller.getDiagnostics();
        expect(controller.getCurrentLevelIndex("sign")).toBe(0);
        expect(diagnostics.appliedTransitions).toBe(1);
    });

    it("jumps directly to the correct tier on camera teleport", () => {
        const controller = createController();
        controller.registerGroup({
            id: "tower",
            levels: [{id: "high"}, {id: "mid"}, {id: "low"}],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -100), 5),
        });

        controller.update(createCamera());
        const diagnostics = controller.getDiagnostics();

        expect(controller.getCurrentLevelIndex("tower")).toBe(2);
        expect(diagnostics.appliedTransitions).toBe(1);
        expect(diagnostics.currentTierCounts[2]).toBe(1);
    });

    it("derives rooted bounds once in root-local space", () => {
        const root = new THREE.Group();
        root.position.set(0, 0, -8);
        root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
        root.updateMatrixWorld(true);

        const controller = new RuntimeLodController({
            defaultDistances: [10],
            hysteresisRatio: 0,
            now: () => 0,
        });
        controller.registerGroup({
            id: "rooted",
            root,
            levels: [{id: "high"}, {id: "low"}],
        });

        controller.update(createCamera());

        expect(controller.getCurrentLevelIndex("rooted")).toBe(0);
        expect(controller.getDiagnostics().appliedTransitions).toBe(0);
    });

    it("combines projected screen size and distance when choosing the target level", () => {
        const controller = new RuntimeLodController({
            defaultDistances: [100, 250],
            hysteresisRatio: 0,
            now: () => 0,
        });
        controller.registerGroup({
            id: "hero",
            levels: [
                {id: "high", minScreenHeightRatio: 0.2},
                {id: "mid", minScreenHeightRatio: 0.08},
                {id: "low", minScreenHeightRatio: 0},
            ],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -40), 3),
        });

        controller.update(createCamera());
        expect(controller.getCurrentLevelIndex("hero")).toBe(1);
    });

    it("evaluates projected screen size for orthographic cameras", () => {
        const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
        camera.position.set(0, 0, 0);
        camera.lookAt(0, 0, -1);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        const controller = new RuntimeLodController({
            defaultDistances: [100, 250],
            hysteresisRatio: 0,
            now: () => 0,
        });
        controller.registerGroup({
            id: "ortho-hero",
            levels: [
                {id: "high", minScreenHeightRatio: 0.4},
                {id: "mid", minScreenHeightRatio: 0.15},
                {id: "low", minScreenHeightRatio: 0},
            ],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -40), 2),
        });

        controller.update(camera);

        expect(controller.getCurrentLevelIndex("ortho-hero")).toBe(1);
    });

    it("prioritizes the most visually wrong transitions when the frame budget is tight", () => {
        const controller = new RuntimeLodController({
            defaultDistances: [10, 30],
            maxTransitionsPerFrame: 1,
            hysteresisRatio: 0,
            now: () => 0,
        });
        controller.registerGroup({
            id: "tiny-far",
            levels: [{id: "high"}, {id: "mid"}, {id: "low"}],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -20), 1),
        });
        controller.registerGroup({
            id: "large-far",
            levels: [{id: "high"}, {id: "mid"}, {id: "low"}],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -20), 5),
        });

        controller.update(createCamera());
        const diagnostics = controller.getDiagnostics();

        expect(diagnostics.appliedTransitions).toBe(1);
        expect(diagnostics.pendingTransitions).toBe(1);
        expect(diagnostics.skippedTransitions).toBe(1);
        expect(controller.getCurrentLevelIndex("large-far")).toBe(1);
        expect(controller.getCurrentLevelIndex("tiny-far")).toBe(0);
    });

    it("keeps the current tier when target residency is not ready", () => {
        const controller = createController();
        const isLevelResident = vi.fn((_group, level) => level.id !== "low");
        controller.registerGroup({
            id: "tree",
            levels: [{id: "high"}, {id: "mid"}, {id: "low"}],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -80), 2),
            isLevelResident,
        });

        controller.update(createCamera());
        const diagnostics = controller.getDiagnostics();

        expect(controller.getCurrentLevelIndex("tree")).toBe(0);
        expect(diagnostics.residencyBlockedTransitions).toBe(1);
        expect(diagnostics.appliedTransitions).toBe(0);
        expect(isLevelResident).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "tree",
                currentLevelIndex: 0,
                targetLevelIndex: 2,
                targetLevelId: "low",
            }),
            expect.objectContaining({id: "low"}),
        );
    });

    it("fails open for missing camera or missing bounds", () => {
        const controller = createController();
        controller.registerGroup({
            id: "unbounded",
            levels: [{id: "high"}, {id: "low"}],
        });

        controller.update(createCamera());
        let diagnostics = controller.getDiagnostics();
        expect(controller.getCurrentLevelIndex("unbounded")).toBe(0);
        expect(diagnostics.missingInputGroups).toBe(1);
        expect(diagnostics.appliedTransitions).toBe(0);

        controller.update(null);
        diagnostics = controller.getDiagnostics();
        expect(controller.getCurrentLevelIndex("unbounded")).toBe(0);
        expect(diagnostics.missingInputGroups).toBe(1);
    });

    it("does not evaluate or transition in disabled mode", () => {
        const controller = new RuntimeLodController({enabled: false, now: () => 0});
        controller.registerGroup({
            id: "disabled",
            levels: [{id: "high"}, {id: "low"}],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -500), 1),
        });

        controller.update(createCamera());
        const diagnostics = controller.getDiagnostics();

        expect(controller.getCurrentLevelIndex("disabled")).toBe(0);
        expect(diagnostics.disabledGroups).toBe(1);
        expect(diagnostics.appliedTransitions).toBe(0);
    });

    it("unregisters and disposes groups while restoring author-visible level state", () => {
        const levels = createLevelObjects(2);
        levels[0]!.visible = false;
        levels[1]!.visible = true;
        const controller = new RuntimeLodController({defaultDistances: [1], hysteresisRatio: 0, now: () => 0});

        controller.registerGroup({
            id: "rock",
            initialLevel: "low",
            levels: [
                {id: "high", object: levels[0]},
                {id: "low", object: levels[1]},
            ],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -10), 1),
        });
        expect(levels.map(level => level.visible)).toEqual([false, true]);

        expect(controller.unregisterGroup("rock")).toBe(true);
        expect(levels.map(level => level.visible)).toEqual([false, true]);
        expect(controller.unregisterGroup("rock")).toBe(false);

        controller.registerGroup({
            id: "rock",
            levels: [
                {id: "high", object: levels[0]},
                {id: "low", object: levels[1]},
            ],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -10), 1),
        });
        controller.dispose();

        expect(controller.getDiagnostics().registeredGroups).toBe(0);
        expect(levels.map(level => level.visible)).toEqual([false, true]);
    });

    it("reports stable deterministic diagnostics for no-op updates", () => {
        const controller = createController([10, 10.25, 11, 11.25]);
        controller.registerGroup({
            id: "stable",
            levels: [{id: "high"}, {id: "mid"}, {id: "low"}],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -2), 1),
        });

        controller.update(createCamera());
        const first = controller.getDiagnostics();
        controller.update(createCamera());
        const second = controller.getDiagnostics();

        expect(first).toMatchObject({
            registeredGroups: 1,
            enabledGroups: 1,
            pendingTransitions: 0,
            appliedTransitions: 0,
            skippedTransitions: 0,
            residencyBlockedTransitions: 0,
            missingInputGroups: 0,
            lastUpdateCostMs: 0.25,
            lastUpdateSerial: 1,
        });
        expect(second).toMatchObject({
            registeredGroups: 1,
            enabledGroups: 1,
            pendingTransitions: 0,
            appliedTransitions: 0,
            skippedTransitions: 0,
            residencyBlockedTransitions: 0,
            missingInputGroups: 0,
            lastUpdateCostMs: 0.25,
            lastUpdateSerial: 2,
        });
        expect(first.lastUpdateSerial).toBe(1);
    });

    it("exposes an adapter API for later runtime integration", () => {
        const adapter = createRuntimeLodAdapter({now: () => 0});
        const handle = adapter.registerGroup({
            id: "adapter-group",
            levels: [{id: "high"}, {id: "low"}],
            bounds: new THREE.Sphere(new THREE.Vector3(0, 0, -100), 1),
        });

        adapter.update(createCamera(), {maxTransitions: 1});

        expect(handle.id).toBe("adapter-group");
        expect(adapter.getCurrentLevelIndex("adapter-group")).toBe(1);
        expect(adapter.getDiagnostics().appliedTransitions).toBe(1);
        adapter.dispose();
    });
});

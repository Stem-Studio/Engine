import {
    BoxGeometry,
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    InstancedMesh,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    PerspectiveCamera,
    Scene,
} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {SCENE_HELPERS_ROOT_NAME} from "@stem/editor-oss/scene/dynamicRoots";

import {
    isRuntimeSceneRevealPendingOrActive,
    markRuntimeSceneRevealPending,
    prepareRuntimeSceneReveal,
    RUNTIME_SCENE_REVEAL_PENDING_KEY,
} from "./runtimeSceneReveal";

function makeMesh(runtimeOnly = false): Mesh {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.userData.isRuntimeOnly = runtimeOnly;
    return mesh;
}

function makeInstancedMesh(count: number): InstancedMesh {
    return new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), count);
}

function makeMeshWithTriangles(triangleCount: number): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(triangleCount * 9), 3));
    return new Mesh(geometry, new MeshBasicMaterial());
}

const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0));

function countVisible(objects: Mesh[]): number {
    return objects.filter(object => object.visible).length;
}

describe("runtimeSceneReveal", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        delete (globalThis as {__STEM_RUNTIME_REVEAL_FRAME_HISTORY__?: unknown}).__STEM_RUNTIME_REVEAL_FRAME_HISTORY__;
    });

    it("keeps frame-history allocations behind explicit reveal diagnostics", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        root.add(makeMesh());
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene);
        controller.start();
        callbacks.shift()?.(0);

        expect((globalThis as {__STEM_RUNTIME_REVEAL_FRAME_HISTORY__?: unknown}).__STEM_RUNTIME_REVEAL_FRAME_HISTORY__).toBeUndefined();
    });

    it("marks pending reveals and clears pending state when prepare resolves active state", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        root.add(makeMesh());
        scene.add(root);

        markRuntimeSceneRevealPending(scene);

        expect(scene.userData[RUNTIME_SCENE_REVEAL_PENDING_KEY]).toBe(true);
        expect(isRuntimeSceneRevealPendingOrActive(scene)).toBe(true);

        const controller = prepareRuntimeSceneReveal(scene);

        expect(scene.userData[RUNTIME_SCENE_REVEAL_PENDING_KEY]).toBeUndefined();
        expect(isRuntimeSceneRevealPendingOrActive(scene)).toBe(true);

        controller.restore();

        expect(isRuntimeSceneRevealPendingOrActive(scene)).toBe(false);
        expect(scene.userData[RUNTIME_SCENE_REVEAL_PENDING_KEY]).toBeUndefined();
    });

    it("hides runtime-only renderables and reveals them in frame batches", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const first = makeMesh();
        const second = makeMesh();
        const third = makeMesh();
        const authored = makeMesh();
        root.add(first, second, third);
        scene.add(root, authored);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {batchSize: 2, batchWeightBudget: 2});

        expect(controller.stats.hiddenObjects).toBe(3);
        expect(first.visible).toBe(false);
        expect(second.visible).toBe(false);
        expect(third.visible).toBe(false);
        expect(authored.visible).toBe(true);

        controller.start();
        expect(callbacks).toHaveLength(1);

        callbacks.shift()?.(16);
        expect(first.visible).toBe(true);
        expect(second.visible).toBe(true);
        expect(third.visible).toBe(false);
        expect(callbacks).toHaveLength(1);

        callbacks.shift()?.(32);
        expect(third.visible).toBe(true);
        expect(controller.stats.revealedObjects).toBe(3);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
    });

    it("can leave runtime-only renderables visible after a masked warmup", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const first = makeMesh();
        const second = makeMesh();
        root.add(first, second);
        scene.add(root);

        const controller = prepareRuntimeSceneReveal(scene, {
            includeRuntimeSceneRenderables: false,
        });

        expect(controller.stats.hiddenObjects).toBe(0);
        expect(first.visible).toBe(true);
        expect(second.visible).toBe(true);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
    });

    it("keeps the first rendered frame bounded and stages the remaining reveal", async () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const meshes = Array.from({length: 40}, () => makeMesh());
        root.add(...meshes);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 2,
            batchWeightBudget: 2,
        });

        expect(controller.stats.hiddenObjects).toBe(40);
        expect(countVisible(meshes)).toBe(0);

        await controller.revealInitialFrame();

        expect(callbacks).toHaveLength(0);
        expect(controller.stats.initialRevealBatchSize).toBe(2);
        expect(controller.stats.initialRevealWeightBudget).toBe(2);
        expect(controller.stats.initialRevealedObjects).toBe(2);
        expect(countVisible(meshes)).toBe(2);
        expect(scene.userData._runtimeSceneRevealActive).toBe(true);

        controller.start();
        callbacks.shift()?.(16);
        expect(countVisible(meshes)).toBe(4);

        await controller.revealInitialFrame();

        expect(controller.stats.initialRevealedObjects).toBe(2);
        expect(countVisible(meshes)).toBe(4);
    });

    it("uses an explicit scene override for limited initial reveal batches", async () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const meshes = Array.from({length: 10}, () => makeMesh());
        root.add(...meshes);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            initialRevealBatchSize: 3,
            initialRevealWeightBudget: 3,
        });

        await controller.revealInitialFrame();

        expect(callbacks).toHaveLength(0);
        expect(controller.stats.initialRevealBatchSize).toBe(3);
        expect(controller.stats.initialRevealWeightBudget).toBe(3);
        expect(controller.stats.initialRevealedObjects).toBe(3);
        expect(countVisible(meshes)).toBe(3);
    });

    it("does not pair medium meshes in the default reveal batch budget", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const first = makeMeshWithTriangles(300);
        const second = makeMeshWithTriangles(300);
        root.add(first, second);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene);
        controller.start();

        callbacks.shift()?.(16);
        expect(first.visible).toBe(true);
        expect(second.visible).toBe(false);

        callbacks.shift()?.(32);
        expect(second.visible).toBe(true);
    });

    it("scales implicit reveal work for large authored scenes", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const meshes = Array.from({length: 300}, () => makeMesh());
        root.add(...meshes);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene);

        expect(controller.stats.batchSize).toBe(8);
        expect(controller.stats.batchWeightBudget).toBe(8);

        controller.start();
        callbacks.shift()?.(16);

        expect(countVisible(meshes)).toBe(8);
        expect(controller.stats.revealedObjects).toBe(8);
    });

    it("can progressively reveal large static scene renderables without hiding behavior-owned objects", () => {
        const scene = new Scene();
        const staticLarge = makeMeshWithTriangles(2_000);
        const staticSmall = makeMeshWithTriangles(12);
        const behaviorRoot = new Group();
        behaviorRoot.userData.behaviors = [{id: "player", enabled: true}];
        const behaviorOwnedLarge = makeMeshWithTriangles(2_000);
        behaviorRoot.add(behaviorOwnedLarge);
        scene.add(staticLarge, staticSmall, behaviorRoot);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            includeStaticSceneRenderables: true,
            staticSceneTriangleThreshold: 1_024,
        });

        expect(controller.stats.hiddenObjects).toBe(1);
        expect(controller.stats.staticSceneHiddenObjects).toBe(1);
        expect(staticLarge.visible).toBe(false);
        expect(staticSmall.visible).toBe(true);
        expect(behaviorOwnedLarge.visible).toBe(true);

        controller.start();
        callbacks.shift()?.(16);

        expect(staticLarge.visible).toBe(true);
        expect(controller.stats.revealedObjects).toBe(1);
    });

    it("can include runtime-only renderables parented under cameras when configured", () => {
        const defaultScene = new Scene();
        const defaultCamera = new PerspectiveCamera();
        defaultCamera.userData.isRuntimeOnly = true;
        const defaultHudMesh = makeMesh();
        defaultCamera.add(defaultHudMesh);
        defaultScene.add(defaultCamera);

        const defaultController = prepareRuntimeSceneReveal(defaultScene);

        expect(defaultController.stats.hiddenObjects).toBe(0);
        expect(defaultHudMesh.visible).toBe(true);

        const scene = new Scene();
        const camera = new PerspectiveCamera();
        camera.userData.isRuntimeOnly = true;
        const hudMesh = makeMesh();
        camera.add(hudMesh);
        scene.add(camera);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            includeCameraRuntimeRenderables: true,
        });

        expect(controller.stats.hiddenObjects).toBe(1);
        expect(hudMesh.visible).toBe(false);

        controller.start();
        callbacks.shift()?.(16);

        expect(hudMesh.visible).toBe(true);
    });

    it("marks the scene while runtime reveal is active", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const mesh = makeMesh();
        root.add(mesh);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene);

        expect(scene.userData._runtimeSceneRevealActive).toBe(true);

        controller.start();
        callbacks.shift()?.(16);

        expect(mesh.visible).toBe(true);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
    });

    it("reveals instanced meshes at a low count before ramping to the target count", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const instanced = makeInstancedMesh(6);
        const second = makeMesh();
        root.add(instanced, second);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            instancedCountTriangleBudget: 24,
        });
        controller.start();

        callbacks.shift()?.(16);
        expect(instanced.visible).toBe(true);
        expect(instanced.count).toBe(1);
        expect(second.visible).toBe(false);
        expect(controller.stats.instancedCountRamps).toBe(1);

        controller.beforeRender();
        callbacks.shift()?.(32);
        expect(instanced.count).toBe(1);
        expect(second.visible).toBe(true);

        controller.beforeRender();
        callbacks.shift()?.(48);
        expect(instanced.count).toBe(3);

        controller.beforeRender();
        callbacks.shift()?.(64);
        expect(instanced.count).toBe(5);

        controller.beforeRender();
        callbacks.shift()?.(80);
        expect(instanced.count).toBe(6);
        expect(controller.stats.instancedCountRampFrames).toBe(3);

        controller.beforeRender();
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
    });

    it("clears active from beforeRender when the final instanced ramp target is acknowledged without another RAF", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const instanced = makeInstancedMesh(6);
        root.add(instanced);
        scene.add(root);

        let nextFrameId = 1;
        const callbacks = new Map<number, FrameRequestCallback>();
        const runNextFrame = (timestamp: number): void => {
            const nextFrame = callbacks.entries().next().value;
            expect(nextFrame).toBeDefined();
            const [frameId, callback] = nextFrame as [number, FrameRequestCallback];
            callbacks.delete(frameId);
            callback(timestamp);
        };
        const cancelAnimationFrame = vi.fn((frameId: number) => {
            callbacks.delete(frameId);
        });
        const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
            const frameId = nextFrameId;
            nextFrameId += 1;
            callbacks.set(frameId, callback);
            return frameId;
        });
        vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
        vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            instancedCountTriangleBudget: 24,
        });
        controller.start();

        runNextFrame(16);
        expect(instanced.visible).toBe(true);
        expect(instanced.count).toBe(1);

        controller.beforeRender();
        runNextFrame(32);
        expect(instanced.count).toBe(3);

        controller.beforeRender();
        runNextFrame(48);
        expect(instanced.count).toBe(5);

        controller.beforeRender();
        runNextFrame(64);
        expect(instanced.count).toBe(6);
        expect(scene.userData._runtimeSceneRevealActive).toBe(true);
        expect(callbacks.size).toBe(0);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(4);

        controller.beforeRender();

        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
        expect(callbacks.size).toBe(0);
        expect(cancelAnimationFrame).not.toHaveBeenCalled();
    });

    it("can keep legacy ramp-first instanced reveal ordering when configured", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const instanced = makeInstancedMesh(6);
        const second = makeMesh();
        root.add(instanced, second);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            instancedCountTriangleBudget: 24,
            rampInstancedCountsBeforeContinuingReveal: true,
        });
        controller.start();

        callbacks.shift()?.(16);
        expect(instanced.visible).toBe(true);
        expect(instanced.count).toBe(1);
        expect(second.visible).toBe(false);

        controller.beforeRender();
        callbacks.shift()?.(32);
        expect(instanced.count).toBe(3);
        expect(second.visible).toBe(false);

        controller.beforeRender();
        callbacks.shift()?.(48);
        expect(instanced.count).toBe(5);
        expect(second.visible).toBe(false);

        controller.beforeRender();
        callbacks.shift()?.(64);
        expect(instanced.count).toBe(6);
        expect(second.visible).toBe(false);

        controller.beforeRender();
        callbacks.shift()?.(80);
        expect(second.visible).toBe(true);
    });

    it("restores unfinished instanced reveal counts on teardown", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const instanced = makeInstancedMesh(8);
        root.add(instanced);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            instancedCountTriangleBudget: 24,
        });
        controller.start();
        callbacks.shift()?.(16);

        expect(instanced.visible).toBe(true);
        expect(instanced.count).toBe(1);

        controller.restore();

        expect(instanced.visible).toBe(true);
        expect(instanced.count).toBe(8);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
    });

    it("restores a staged instanced count when gameplay hides it before ramp completion", async () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const instanced = makeInstancedMesh(8);
        root.add(instanced);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            instancedCountTriangleBudget: 24,
        });

        await controller.revealInitialFrame();

        expect(instanced.visible).toBe(true);
        expect(instanced.count).toBe(1);
        expect(controller.stats.instancedCountRamps).toBe(1);

        instanced.visible = false;
        controller.start();
        callbacks.shift()?.(16);

        expect(instanced.visible).toBe(false);
        expect(instanced.count).toBe(8);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();

        controller.restore();

        expect(instanced.visible).toBe(false);
        expect(instanced.count).toBe(8);
    });

    it("keeps material-heavy runtime objects in their own reveal frame", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const heavy = makeMesh();
        const firstCheap = makeMesh();
        const secondCheap = makeMesh();
        root.add(heavy, firstCheap, secondCheap);
        scene.add(root);

        (heavy.material as MeshBasicMaterial & {isNodeMaterial?: boolean}).isNodeMaterial = true;
        Object.defineProperty(heavy.geometry.index, "count", {
            configurable: true,
            value: 3_000_000,
        });

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 3,
            batchWeightBudget: 8,
        });
        expect(controller.stats.batchWeightBudget).toBe(8);

        controller.start();
        callbacks.shift()?.(16);

        expect(heavy.visible).toBe(true);
        expect(firstCheap.visible).toBe(false);
        expect(secondCheap.visible).toBe(false);
        expect(callbacks).toHaveLength(1);

        callbacks.shift()?.(32);

        expect(firstCheap.visible).toBe(true);
        expect(secondCheap.visible).toBe(true);
    });

    it("preserves traversal reveal order by default", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const heavy = makeMesh();
        const cheap = makeMesh();
        root.add(heavy, cheap);
        scene.add(root);

        (heavy.material as MeshBasicMaterial & {isNodeMaterial?: boolean}).isNodeMaterial = true;
        Object.defineProperty(heavy.geometry.index, "count", {
            configurable: true,
            value: 3_000_000,
        });

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            batchWeightBudget: 16,
        });

        controller.start();
        callbacks.shift()?.(16);
        expect(heavy.visible).toBe(true);
        expect(cheap.visible).toBe(false);
    });

    it("can reveal cheaper runtime objects before heavier ones when configured", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const heavy = makeMesh();
        const cheap = makeMesh();
        root.add(heavy, cheap);
        scene.add(root);

        (heavy.material as MeshBasicMaterial & {isNodeMaterial?: boolean}).isNodeMaterial = true;
        Object.defineProperty(heavy.geometry.index, "count", {
            configurable: true,
            value: 3_000_000,
        });

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            batchWeightBudget: 16,
            orderByWeight: true,
        });

        expect(controller.stats.orderByWeight).toBe(true);

        controller.start();
        callbacks.shift()?.(16);
        expect(cheap.visible).toBe(true);
        expect(heavy.visible).toBe(false);

        callbacks.shift()?.(32);
        expect(heavy.visible).toBe(true);
    });

    it("backs off reveal batches after a long render gap", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const first = makeMesh();
        const second = makeMesh();
        root.add(first, second);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            targetFrameGapMs: 30,
            longFrameCooldownFrames: 3,
        });
        controller.start();

        callbacks.shift()?.(0);
        expect(first.visible).toBe(true);
        expect(second.visible).toBe(false);

        callbacks.shift()?.(120);
        callbacks.shift()?.(136);
        callbacks.shift()?.(152);
        expect(second.visible).toBe(false);
        expect(controller.stats.deferredFrames).toBe(3);

        callbacks.shift()?.(168);
        expect(second.visible).toBe(true);
    });

    it("uses revealed batch weight as a cooldown floor", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const heavy = makeMesh();
        const second = makeMesh();
        root.add(heavy, second);
        scene.add(root);

        (heavy.material as MeshBasicMaterial & {isNodeMaterial?: boolean}).isNodeMaterial = true;
        Object.defineProperty(heavy.geometry.index, "count", {
            configurable: true,
            value: 90_000,
        });

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            targetFrameGapMs: 100,
            longFrameCooldownFrames: 8,
        });
        controller.start();

        callbacks.shift()?.(0);
        expect(heavy.visible).toBe(true);
        expect(second.visible).toBe(false);

        callbacks.shift()?.(120);
        callbacks.shift()?.(136);
        callbacks.shift()?.(152);
        callbacks.shift()?.(168);
        callbacks.shift()?.(184);
        expect(second.visible).toBe(false);
        expect(controller.stats.deferredFrames).toBe(5);

        callbacks.shift()?.(200);
        expect(second.visible).toBe(true);
    });

    it("uses elapsed frame gaps to finish reveal without spending sparse RAFs in long cooldown", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const meshes = Array.from({length: 30}, () => makeMesh());
        root.add(...meshes);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            batchWeightBudget: 1,
            targetFrameGapMs: 100,
            longFrameCooldownFrames: 99,
            maxAdaptiveFrameBatchMultiplier: 12,
        });
        controller.start();

        callbacks.shift()?.(0);
        expect(countVisible(meshes)).toBe(1);

        callbacks.shift()?.(1_000);
        expect(countVisible(meshes)).toBe(11);
        expect(controller.stats.deferredFrames).toBe(0);

        callbacks.shift()?.(2_000);
        expect(countVisible(meshes)).toBe(21);

        callbacks.shift()?.(3_000);
        expect(countVisible(meshes)).toBe(30);
        expect(controller.stats.revealedObjects).toBe(30);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
    });

    it("forces completeness after the reveal wall-clock budget", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const meshes = Array.from({length: 4}, () => makeMesh());
        root.add(...meshes);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            batchWeightBudget: 1,
            maxRevealDurationMs: 100,
        });
        controller.start();

        callbacks.shift()?.(0);
        expect(countVisible(meshes)).toBe(1);

        callbacks.shift()?.(200);
        expect(countVisible(meshes)).toBe(4);
        expect(controller.stats.forcedCompletions).toBe(1);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
    });

    it("bounds wall-clock fallback completion across render frames", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const meshes = Array.from({length: 130}, () => makeMesh());
        root.add(...meshes);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            batchWeightBudget: 1,
            maxRevealDurationMs: 100,
        });
        controller.start();

        callbacks.shift()?.(0);
        expect(countVisible(meshes)).toBe(1);

        callbacks.shift()?.(200);
        expect(countVisible(meshes)).toBe(65);
        expect(scene.userData._runtimeSceneRevealActive).toBe(true);
        expect(controller.stats.forcedCompletions).toBe(1);

        callbacks.shift()?.(216);
        expect(countVisible(meshes)).toBe(129);
        expect(scene.userData._runtimeSceneRevealActive).toBe(true);

        callbacks.shift()?.(232);
        expect(countVisible(meshes)).toBe(130);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
    });

    it("backs off progressive instanced count ramps after long frames", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const instanced = makeInstancedMesh(8);
        root.add(instanced);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            targetFrameGapMs: 100,
            longFrameCooldownFrames: 2,
            instancedCountTriangleBudget: 24,
        });
        controller.start();

        callbacks.shift()?.(0);
        expect(instanced.visible).toBe(true);
        expect(instanced.count).toBe(1);

        controller.beforeRender();
        callbacks.shift()?.(16);
        expect(instanced.count).toBe(3);

        controller.beforeRender();
        callbacks.shift()?.(140);
        callbacks.shift()?.(156);
        expect(instanced.count).toBe(3);
        expect(controller.stats.deferredFrames).toBe(2);

        callbacks.shift()?.(172);
        expect(instanced.count).toBe(5);

        controller.beforeRender();
        callbacks.shift()?.(300);
        callbacks.shift()?.(316);
        expect(instanced.count).toBe(5);

        callbacks.shift()?.(332);
        expect(instanced.count).toBe(7);
    });

    it("does not let large instanced meshes starve the reveal queue", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const instanced = makeInstancedMesh(100);
        root.add(instanced);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene, {
            instancedCountTriangleBudget: 24,
        });

        expect(controller.stats.maxInstancedRampFrames).toBe(24);
        controller.start();
        callbacks.shift()?.(16);

        expect(instanced.visible).toBe(true);
        expect(instanced.count).toBe(100);
        expect(controller.stats.instancedCountRamps).toBe(0);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
    });

    it("keeps long-frame reveal diagnostics disabled by default", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const first = makeMesh();
        const second = makeMesh();
        root.add(first, second);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());
        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            targetFrameGapMs: 1,
            longFrameCooldownFrames: 1,
        });
        controller.start();

        callbacks.shift()?.(0);
        callbacks.shift()?.(20);

        expect(debugSpy).not.toHaveBeenCalledWith(
            "[RuntimeSceneReveal] Long frame after reveal batch",
            expect.any(String),
        );
        debugSpy.mockRestore();
    });

    it("logs and backs off once per revealed batch under sustained long frames", () => {
        const scene = new Scene();
        const root = new Group();
        root.name = "RuntimeRoot";
        root.userData.isRuntimeOnly = true;
        const first = makeMesh();
        const second = makeMesh();
        root.add(first, second);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());
        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

        const controller = prepareRuntimeSceneReveal(scene, {
            batchSize: 1,
            targetFrameGapMs: 30,
            longFrameCooldownFrames: 3,
            debugLongFrames: true,
            debugLongFrameLimit: 10,
        });
        controller.start();

        callbacks.shift()?.(0);
        expect(first.visible).toBe(true);
        expect(second.visible).toBe(false);

        callbacks.shift()?.(120);
        callbacks.shift()?.(190);
        callbacks.shift()?.(260);
        expect(second.visible).toBe(false);
        expect(controller.stats.deferredFrames).toBe(3);
        expect(debugSpy).toHaveBeenCalledTimes(1);

        callbacks.shift()?.(330);
        expect(second.visible).toBe(true);
        expect(debugSpy).toHaveBeenCalledTimes(1);

        const payload = JSON.parse(debugSpy.mock.calls[0]?.[1] as string);
        expect(payload.batch[0].runtimeRootName).toBe("RuntimeRoot");
        expect(payload.batch[0].userDataKeys).toContain("isRuntimeOnly");
        debugSpy.mockRestore();
    });

    it("precompiles a reveal batch before making it visible", async () => {
        const scene = new Scene();
        const root = new Group();
        root.name = "RuntimeRoot";
        root.userData.isRuntimeOnly = true;
        const mesh = makeMesh();
        root.add(mesh);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        let resolvePrecompile!: () => void;
        const precompileRevealBatch = vi.fn((
            _objects: unknown[],
            _batch: Array<{runtimeRootName: string | null}>,
        ) => new Promise<void>(resolve => {
            resolvePrecompile = resolve;
        }));

        const controller = prepareRuntimeSceneReveal(scene, {
            precompileRevealBatch,
        });
        controller.start();
        callbacks.shift()?.(16);

        expect(precompileRevealBatch).toHaveBeenCalledTimes(1);
        expect(precompileRevealBatch.mock.calls[0]?.[0]).toEqual([mesh]);
        expect(precompileRevealBatch.mock.calls[0]?.[1]?.[0]?.runtimeRootName).toBe("RuntimeRoot");
        expect(mesh.visible).toBe(false);

        resolvePrecompile();
        await flushMicrotasks();

        expect(mesh.visible).toBe(true);
        expect(controller.stats.revealedObjects).toBe(1);
    });

    it("can yield out of the reveal frame before precompiling a batch", async () => {
        vi.useFakeTimers();
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const mesh = makeMesh();
        root.add(mesh);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const precompileRevealBatch = vi.fn(() => Promise.resolve());
        const controller = prepareRuntimeSceneReveal(scene, {
            precompileRevealBatch,
            yieldBeforePrecompile: true,
        });

        controller.start();
        callbacks.shift()?.(16);

        expect(precompileRevealBatch).not.toHaveBeenCalled();
        expect(mesh.visible).toBe(false);

        await vi.runOnlyPendingTimersAsync();
        await Promise.resolve();
        await Promise.resolve();

        expect(precompileRevealBatch).toHaveBeenCalledTimes(1);
        expect(mesh.visible).toBe(true);
    });

    it("can skip detailed reveal summaries when precompile only needs objects", async () => {
        const scene = new Scene();
        const root = new Group();
        root.name = "RuntimeRoot";
        root.userData.isRuntimeOnly = true;
        const mesh = makeMesh();
        mesh.userData.scriptKey = "runtime-mesh";
        root.add(mesh);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const precompileRevealBatch = vi.fn((
            _objects: unknown[],
            _batch: Array<{runtimeRootName: string | null; triangles: number; materialType: string; userDataKeys: string[]}>,
        ) => Promise.resolve());

        const controller = prepareRuntimeSceneReveal(scene, {
            precompileRevealBatch,
            precompileRevealBatchNeedsSummary: false,
        });
        controller.start();
        callbacks.shift()?.(16);
        await flushMicrotasks();

        expect(precompileRevealBatch).toHaveBeenCalledTimes(1);
        expect(precompileRevealBatch.mock.calls[0]?.[0]).toEqual([mesh]);
        expect(precompileRevealBatch.mock.calls[0]?.[1]?.[0]).toEqual(expect.objectContaining({
            runtimeRootName: null,
            triangles: 0,
            materialType: "unknown",
            userDataKeys: [],
        }));
        expect(mesh.visible).toBe(true);
    });

    it("precompiles instanced reveal batches at the staged startup count", async () => {
        const scene = new Scene();
        const root = new Group();
        root.name = "RuntimeRoot";
        root.userData.isRuntimeOnly = true;
        const instanced = makeInstancedMesh(6);
        root.add(instanced);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const precompileRevealBatch = vi.fn(() => {
            expect(instanced.visible).toBe(false);
            expect(instanced.count).toBe(1);
            expect(instanced.instanceMatrix.updateRanges).toEqual([{start: 0, count: 96}]);
            return Promise.resolve();
        });

        const controller = prepareRuntimeSceneReveal(scene, {
            instancedInitialCount: 1,
            instancedCountTriangleBudget: 24,
            precompileRevealBatch,
        });
        controller.start();
        callbacks.shift()?.(16);
        await flushMicrotasks();

        expect(precompileRevealBatch).toHaveBeenCalledTimes(1);
        expect(instanced.visible).toBe(true);
        expect(instanced.count).toBe(1);
        expect(controller.stats.instancedCountRamps).toBe(1);

        instanced.count = 6;
        controller.beforeRender();
        expect(instanced.count).toBe(1);

        callbacks.shift()?.(32);
        expect(instanced.count).toBe(3);
        expect(instanced.instanceMatrix.updateRanges).toEqual([{start: 0, count: 96}]);
        instanced.count = 6;
        controller.beforeRender();
        expect(instanced.count).toBe(3);
    });

    it("stages instanced meshes whose counts are populated while hidden", async () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const instanced = makeInstancedMesh(6);
        instanced.count = 1;
        root.add(instanced);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const precompileRevealBatch = vi.fn(() => {
            expect(instanced.count).toBe(1);
            expect(instanced.instanceMatrix.updateRanges).toEqual([{start: 0, count: 96}]);
            return Promise.resolve();
        });

        const controller = prepareRuntimeSceneReveal(scene, {
            instancedInitialCount: 1,
            instancedCountTriangleBudget: 24,
            precompileRevealBatch,
        });
        controller.start();

        instanced.count = 6;
        callbacks.shift()?.(16);
        await flushMicrotasks();

        expect(precompileRevealBatch).toHaveBeenCalledTimes(1);
        expect(instanced.visible).toBe(true);
        expect(instanced.count).toBe(1);
        expect(controller.stats.instancedCountRamps).toBe(1);

        controller.beforeRender();
        callbacks.shift()?.(32);
        expect(instanced.count).toBe(3);
    });

    it("can progressively upload instanced ranges when configured", async () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const instanced = makeInstancedMesh(6);
        root.add(instanced);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const precompileRevealBatch = vi.fn(() => {
            expect(instanced.visible).toBe(false);
            expect(instanced.count).toBe(1);
            expect(instanced.instanceMatrix.updateRanges).toEqual([{start: 0, count: 16}]);
            return Promise.resolve();
        });

        const controller = prepareRuntimeSceneReveal(scene, {
            progressiveInstancedUploads: true,
            instancedCountTriangleBudget: 24,
            precompileRevealBatch,
        });
        controller.start();
        callbacks.shift()?.(16);
        await flushMicrotasks();

        expect(precompileRevealBatch).toHaveBeenCalledTimes(1);
        expect(instanced.visible).toBe(true);
        expect(instanced.count).toBe(1);

        controller.beforeRender();
        callbacks.shift()?.(32);
        expect(instanced.count).toBe(3);
        expect(instanced.instanceMatrix.updateRanges).toEqual([{start: 16, count: 32}]);
    });

    it("does not reveal from an async precompile after restore", async () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const mesh = makeMesh();
        root.add(mesh);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        let resolvePrecompile!: () => void;
        const controller = prepareRuntimeSceneReveal(scene, {
            precompileRevealBatch: () => new Promise<void>(resolve => {
                resolvePrecompile = resolve;
            }),
        });
        controller.start();
        callbacks.shift()?.(16);
        expect(mesh.visible).toBe(false);

        controller.restore();
        mesh.visible = false;
        resolvePrecompile();
        await flushMicrotasks();

        expect(mesh.visible).toBe(false);
    });

    it("restores a staged instanced count when play stops during async precompile", async () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const instanced = makeInstancedMesh(6);
        root.add(instanced);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        let resolvePrecompile!: () => void;
        const controller = prepareRuntimeSceneReveal(scene, {
            precompileRevealBatch: () => new Promise<void>(resolve => {
                resolvePrecompile = resolve;
            }),
        });
        controller.start();
        callbacks.shift()?.(16);
        expect(instanced.count).toBe(1);
        expect(instanced.visible).toBe(false);

        controller.restore();
        expect(instanced.count).toBe(6);
        expect(instanced.visible).toBe(true);

        instanced.visible = false;
        resolvePrecompile();
        await flushMicrotasks();

        expect(instanced.count).toBe(6);
        expect(instanced.visible).toBe(false);
    });

    it("skips scene helper and UI camera descendants", () => {
        const scene = new Scene();
        const runtimeRoot = new Group();
        runtimeRoot.userData.isRuntimeOnly = true;
        const runtimeMesh = makeMesh();
        runtimeRoot.add(runtimeMesh);

        const helperRoot = new Group();
        helperRoot.name = SCENE_HELPERS_ROOT_NAME;
        helperRoot.userData.isRuntimeOnly = true;
        helperRoot.userData.isSceneHelperRoot = true;
        const helperMesh = makeMesh();
        helperRoot.add(helperMesh);

        const uiCamera = new PerspectiveCamera();
        uiCamera.userData.isRuntimeOnly = true;
        const uiMesh = makeMesh();
        uiCamera.add(uiMesh);

        scene.add(runtimeRoot, helperRoot, uiCamera);

        const controller = prepareRuntimeSceneReveal(scene);

        expect(controller.stats.hiddenObjects).toBe(1);
        expect(runtimeMesh.visible).toBe(false);
        expect(helperMesh.visible).toBe(true);
        expect(uiMesh.visible).toBe(true);
    });

    it("prepares deeply nested runtime scenes without relying on the call stack", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        let cursor: Object3D = root;
        for (let i = 0; i < 12_000; i += 1) {
            const child = new Group();
            cursor.add(child);
            cursor = child;
        }
        const mesh = makeMesh();
        cursor.add(mesh);
        scene.add(root);

        const controller = prepareRuntimeSceneReveal(scene);

        expect(controller.stats.hiddenObjects).toBe(1);
        expect(mesh.visible).toBe(false);

        controller.restore();
        expect(mesh.visible).toBe(true);
    });

    it("restores hidden objects when play tears down before reveal finishes", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const mesh = makeMesh();
        root.add(mesh);
        scene.add(root);

        const cancelAnimationFrame = vi.fn();
        vi.stubGlobal("requestAnimationFrame", vi.fn(() => 123));
        vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

        const controller = prepareRuntimeSceneReveal(scene);
        controller.start();
        controller.restore();

        expect(cancelAnimationFrame).toHaveBeenCalledWith(123);
        expect(mesh.visible).toBe(true);
        expect(controller.stats.revealedObjects).toBe(1);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
    });

    it("does not override gameplay visibility after an object has been revealed", () => {
        const scene = new Scene();
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const mesh = makeMesh();
        root.add(mesh);
        scene.add(root);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = prepareRuntimeSceneReveal(scene);
        controller.start();
        callbacks.shift()?.(16);

        mesh.visible = false;
        controller.restore();

        expect(mesh.visible).toBe(false);
    });
});

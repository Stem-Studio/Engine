import {BoxGeometry, InstancedBufferAttribute, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {EngineRuntime} from "./EngineRuntime";

function createRuntimeWithRenderer() {
    const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
    const setAnimationLoop = vi.fn();
    (runtime as any).renderer = {setAnimationLoop};
    return {runtime, setAnimationLoop};
}

describe("EngineRuntime retired render scheduler compatibility", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("clears the startup mask after the first rendered frame even when HUD is disabled", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const hide = vi.fn();
        const completeLoading = vi.fn();
        (runtime as any).playerMask = {hide};
        (runtime as any).loadingManager = {completeLoading};
        (runtime as any).editor = {showHUD: false};
        (runtime as any).waitForFirstRenderedFrameAfterPaint = vi.fn(async () => undefined);

        await (runtime as any).completePlayerStartupLoadingAfterFirstRender();

        expect(hide).toHaveBeenCalledTimes(1);
        expect(completeLoading).toHaveBeenCalledTimes(1);
    });

    it("consumes a pre-armed first-frame handshake without installing a late listener", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const hide = vi.fn();
        const completeLoading = vi.fn();
        const waitForFirstFrame = vi.fn(async () => undefined);
        (runtime as any).playerMask = {hide};
        (runtime as any).loadingManager = {completeLoading};
        (runtime as any).waitForFirstRenderedFrameAfterPaint = waitForFirstFrame;

        await (runtime as any).completePlayerStartupLoadingAfterFirstRender(Promise.resolve());

        expect(waitForFirstFrame).not.toHaveBeenCalled();
        expect(hide).toHaveBeenCalledTimes(1);
        expect(completeLoading).toHaveBeenCalledTimes(1);
    });

    it("reveals the completed masked warmup without waiting for a deferred live callback", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const hide = vi.fn();
        const completeLoading = vi.fn();
        const yieldToNextPaint = vi.fn(async () => {});
        (runtime as any).playerMask = {hide};
        (runtime as any).loadingManager = {completeLoading};
        (runtime as any).runtimeStartupWarmupRendered = true;
        (runtime as any).yieldToNextPaint = yieldToNextPaint;

        await (runtime as any).completePlayerStartupLoadingAfterFirstRender();

        expect(yieldToNextPaint).not.toHaveBeenCalled();
        expect(hide).toHaveBeenCalledTimes(1);
        expect(completeLoading).toHaveBeenCalledTimes(1);
    });

    it("clears startup state when stopPlayer is called before isPlaying is set", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const hide = vi.fn();
        const completeLoading = vi.fn();
        (runtime as any).isPlaying = false;
        (runtime as any).isPaused = false;
        (runtime as any).playerMask = {hide};
        (runtime as any).loadingManager = {completeLoading};

        await runtime.stopPlayer({clearStartupMask: true});

        expect(hide).toHaveBeenCalledTimes(1);
        expect(completeLoading).toHaveBeenCalledTimes(1);
    });

    it("warms the active post-processing pipeline behind the startup mask", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const compileAsync = vi.fn(async () => {});
        const render = vi.fn();
        (runtime as any).renderer = {compileAsync};
        (runtime as any).camera = new PerspectiveCamera();
        (runtime as any)._scene = new Scene();
        (runtime as any).effectRenderer = {render};

        await (runtime as any).warmRendererForFirstFrame();

        expect(compileAsync).toHaveBeenCalledTimes(1);
        expect(render).toHaveBeenCalledTimes(1);
    });

    it("fences a WebGL fallback warmup before revealing the startup surface", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const compileAsync = vi.fn(async () => {});
        const render = vi.fn();
        const finish = vi.fn();
        (runtime as any).renderer = {
            compileAsync,
            backend: {isWebGLBackend: true},
            getContext: () => ({finish}),
        };
        (runtime as any).camera = new PerspectiveCamera();
        (runtime as any)._scene = new Scene();
        (runtime as any).effectRenderer = {render};

        await (runtime as any).warmRendererForFirstFrame();

        expect(render).toHaveBeenCalledTimes(1);
        expect(finish).toHaveBeenCalledTimes(1);
        expect((runtime as any).runtimeStartupWarmupRendered).toBe(true);
    });

    it("yields EngineRuntime startup through a normal animation frame and following task", async () => {
        vi.useFakeTimers();
        let frameCallback: FrameRequestCallback | undefined;
        const cancelAnimationFrame = vi.fn();
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            frameCallback = callback;
            return 31;
        }));
        vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const resolved = vi.fn();

        const pending = (runtime as any).yieldToNextPaint().then(resolved);
        frameCallback?.(16);
        await Promise.resolve();

        expect(resolved).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(0);
        await pending;

        expect(resolved).toHaveBeenCalledTimes(1);
        expect(cancelAnimationFrame).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("continues EngineRuntime startup when animation frames are stalled", async () => {
        vi.useFakeTimers();
        const cancelAnimationFrame = vi.fn();
        vi.stubGlobal("requestAnimationFrame", vi.fn(() => 52));
        vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const resolved = vi.fn();

        const pending = (runtime as any).yieldToNextPaint().then(resolved);
        await vi.advanceTimersByTimeAsync(99);
        expect(resolved).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await pending;

        expect(resolved).toHaveBeenCalledTimes(1);
        expect(cancelAnimationFrame).toHaveBeenCalledWith(52);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores EngineRuntime's late RAF loser without scheduling more work", async () => {
        vi.useFakeTimers();
        let frameCallback: FrameRequestCallback | undefined;
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            frameCallback = callback;
            return 88;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const resolved = vi.fn();

        const pending = (runtime as any).yieldToNextPaint().then(resolved);
        await vi.advanceTimersByTimeAsync(100);
        await pending;

        frameCallback?.(1_000);
        await vi.runAllTimersAsync();

        expect(resolved).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("starts the gameplay animation listener without the retired requestAnimationFrame warmup", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const on = vi.fn();
        const requestAnimationFrameSpy = vi
            .spyOn(globalThis, "requestAnimationFrame")
            .mockImplementation(() => 1);
        (runtime as any).isPlaying = true;
        (runtime as any).on = on;

        runtime.startAnimationLoop();
        runtime.startAnimationLoop();

        expect(on).toHaveBeenCalledTimes(1);
        expect(on).toHaveBeenCalledWith("animate.Application", expect.any(Function));
        expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
    });

    it("keeps scheduled render callback methods as no-op compatibility APIs", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const renderCallback = vi.fn();

        runtime.setScheduledRenderCallback(renderCallback);
        runtime.runScheduledRender({} as never, 1 / 60);

        expect(renderCallback).not.toHaveBeenCalled();
    });

    it("does not re-apply the same animation loop callback to the same renderer", () => {
        const {runtime, setAnimationLoop} = createRuntimeWithRenderer();
        const animationCallback = vi.fn();

        runtime.setLegacyAnimationLoopCallback(animationCallback);
        runtime.startScheduledAnimationLoop();
        runtime.startScheduledAnimationLoop();

        expect(setAnimationLoop).toHaveBeenCalledTimes(1);
        expect(setAnimationLoop).toHaveBeenCalledWith(animationCallback);
    });

    it("does not re-clear an already stopped animation loop", () => {
        const {runtime, setAnimationLoop} = createRuntimeWithRenderer();
        const animationCallback = vi.fn();

        runtime.setLegacyAnimationLoopCallback(animationCallback);
        runtime.startScheduledAnimationLoop();
        runtime.stopScheduledAnimationLoop();
        runtime.stopScheduledAnimationLoop();

        expect(setAnimationLoop).toHaveBeenCalledTimes(2);
        expect(setAnimationLoop).toHaveBeenNthCalledWith(1, animationCallback);
        expect(setAnimationLoop).toHaveBeenNthCalledWith(2, null);
    });

    it("updates the active renderer when the legacy animation loop callback changes", () => {
        const {runtime, setAnimationLoop} = createRuntimeWithRenderer();
        const firstCallback = vi.fn();
        const secondCallback = vi.fn();

        runtime.setLegacyAnimationLoopCallback(firstCallback);
        runtime.startScheduledAnimationLoop();
        runtime.setLegacyAnimationLoopCallback(secondCallback);
        runtime.setLegacyAnimationLoopCallback(secondCallback);

        expect(setAnimationLoop).toHaveBeenCalledTimes(2);
        expect(setAnimationLoop).toHaveBeenNthCalledWith(1, firstCallback);
        expect(setAnimationLoop).toHaveBeenNthCalledWith(2, secondCallback);
    });

    it("reattaches a callback published after the renderer loop was cleared", () => {
        const {runtime, setAnimationLoop} = createRuntimeWithRenderer();
        const animationCallback = vi.fn();

        runtime.setLegacyAnimationLoopCallback(animationCallback);
        runtime.startScheduledAnimationLoop();
        runtime.stopScheduledAnimationLoop();
        runtime.setLegacyAnimationLoopCallback(null);
        runtime.setLegacyAnimationLoopCallback(animationCallback);

        expect(setAnimationLoop).toHaveBeenCalledTimes(3);
        expect(setAnimationLoop).toHaveBeenNthCalledWith(1, animationCallback);
        expect(setAnimationLoop).toHaveBeenNthCalledWith(2, null);
        expect(setAnimationLoop).toHaveBeenNthCalledWith(3, animationCallback);
    });

    it("applies the current loop callback again after renderer replacement", () => {
        const {runtime, setAnimationLoop} = createRuntimeWithRenderer();
        const nextSetAnimationLoop = vi.fn();
        const animationCallback = vi.fn();

        runtime.setLegacyAnimationLoopCallback(animationCallback);
        runtime.startScheduledAnimationLoop();
        (runtime as any).renderer = {setAnimationLoop: nextSetAnimationLoop};
        runtime.startScheduledAnimationLoop();

        expect(setAnimationLoop).toHaveBeenCalledTimes(1);
        expect(nextSetAnimationLoop).toHaveBeenCalledTimes(1);
        expect(nextSetAnimationLoop).toHaveBeenCalledWith(animationCallback);
    });

    it("keeps start and stop safe before a renderer exists", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        (runtime as any).renderer = null;

        expect(() => runtime.startScheduledAnimationLoop()).not.toThrow();
        expect(() => runtime.stopScheduledAnimationLoop()).not.toThrow();
    });

    it("keeps object rendering support safe before a renderer exists", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        (runtime as any).renderer = null;
        const object = new Object3D();
        (object as any).isExtendedDirectionalLight = true;

        await expect(runtime.ensureObjectRenderingSupport(object)).resolves.toBeUndefined();
        expect((runtime as any).extendedDirectionalLightSupportPromise).toBeNull();
    });

    it("pauses render during editor mode transitions and resumes once", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const call = vi.fn();
        (runtime as any).options = {isPlayModeOnly: false};
        (runtime as any).call = call;

        const resume = (runtime as any).pauseRenderForModeTransition();
        resume();
        resume();

        expect(call).toHaveBeenCalledTimes(2);
        expect(call).toHaveBeenNthCalledWith(1, "pauseRender", runtime);
        expect(call).toHaveBeenNthCalledWith(2, "resumeRender", runtime);
    });

    it("does not pause render during play-only runtime startup", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const call = vi.fn();
        (runtime as any).options = {isPlayModeOnly: true};
        (runtime as any).call = call;

        const resume = (runtime as any).pauseRenderForModeTransition();
        resume();

        expect(call).not.toHaveBeenCalled();
    });

    it("waits for the first rendered frame through afterRender and a post-paint task", async () => {
        vi.useFakeTimers();
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const listeners = new Map<string, (...args: unknown[]) => void>();
        (runtime as any).on = vi.fn((name: string, handler: ((...args: unknown[]) => void) | null) => {
            if (handler) {
                listeners.set(name, handler);
            } else {
                listeners.delete(name);
            }
        });
        const requestAnimationFrameSpy = vi
            .spyOn(globalThis, "requestAnimationFrame")
            .mockImplementation(() => 1);

        const promise = (runtime as any).waitForFirstRenderedFrameAfterPaint(1000);
        const listener = listeners.get("afterRender.PlayStartupFirstFrame");

        expect(listener).toEqual(expect.any(Function));
        expect(requestAnimationFrameSpy).not.toHaveBeenCalled();

        listener?.();
        await vi.advanceTimersByTimeAsync(0);
        await expect(promise).resolves.toBeUndefined();
        expect(listeners.has("afterRender.PlayStartupFirstFrame")).toBe(false);
    });

    it("resolves from the renderer completion marker when the event dispatch is missed", async () => {
        vi.useFakeTimers();
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        (runtime as any).lastRenderedFrameAt = 0;
        (runtime as any).on = vi.fn();

        const promise = (runtime as any).waitForFirstRenderedFrameAfterPaint(1000);
        (runtime as any).lastRenderedFrameAt = Number.MAX_SAFE_INTEGER;

        await vi.advanceTimersByTimeAsync(16);
        await expect(promise).resolves.toBeUndefined();
        expect((runtime as any).on).toHaveBeenLastCalledWith("afterRender.PlayStartupFirstFrame", null);
    });

    it("waits for an in-flight app start before requiring renderer readiness", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        (runtime as any)._rendererInitPromise = null;
        (runtime as any).renderer = null;
        (runtime as any)._startPromise = Promise.resolve().then(() => {
            (runtime as any).renderer = {hasInitialized: () => true};
        });

        await expect((runtime as any).ensureRendererReady()).resolves.toBeUndefined();
    });

    it("still rejects renderer readiness when start was never requested", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        (runtime as any)._startPromise = null;
        (runtime as any)._rendererInitPromise = null;
        (runtime as any).renderer = null;
        (runtime as any).viewport = undefined;

        await expect((runtime as any).ensureRendererReady()).rejects.toThrow(
            "Renderer is not initialized. EngineRuntime.start(viewport) must complete before loading a scene.",
        );
    });

    it("prefers physics-owned max step settings over retired scheduler metadata", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;

        expect(
            (runtime as any).getLaunchPhysicsMaxSteps({
                physics: {maxStepsPerFrame: 5},
                scheduler: {maxFixedStepsPerFrame: 2},
            }),
        ).toBe(5);
    });

    it("falls back to retired scheduler max step metadata for older launch settings", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;

        expect(
            (runtime as any).getLaunchPhysicsMaxSteps({
                physics: {},
                scheduler: {maxFixedStepsPerFrame: 2},
            }),
        ).toBe(2);
    });

    it("progressively detects behavior ids before starting optional play subsystems", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const scene = new Scene();
        for (let i = 0; i < 300; i++) {
            scene.add(new Object3D());
        }
        const child = new Object3D();
        child.userData.behaviors = [{id: "aiNpc", uuid: "ai-npc-behavior", enabled: true}];
        scene.add(child);
        const yieldToNextPaint = vi.fn(async () => {});
        (runtime as any).yieldToNextPaint = yieldToNextPaint;

        await expect((runtime as any).sceneUsesBehaviorIdProgressive(scene, "aiNpc")).resolves.toBe(true);

        expect(yieldToNextPaint).toHaveBeenCalled();
    });

    it("checks deep object trees without Three recursive traversal", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const scene = new Scene();
        let cursor: Object3D = scene;
        for (let i = 0; i < 12000; i++) {
            const child = new Object3D();
            cursor.add(child);
            cursor = child;
        }
        cursor.userData.marker = true;
        const traverseSpy = vi.spyOn(scene, "traverse");

        expect((runtime as any).objectTreeHas(scene, (object: Object3D) => object.userData.marker === true)).toBe(true);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("short-circuits object tree checks after the first match", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const scene = new Scene();
        const first = new Object3D();
        const later = new Object3D();
        first.userData.marker = true;
        later.userData.marker = true;
        scene.add(first, later);
        const predicate = vi.fn((object: Object3D) => object.userData.marker === true);

        expect((runtime as any).objectTreeHas(scene, predicate)).toBe(true);

        expect(predicate).toHaveBeenCalledTimes(2);
        expect(predicate).toHaveBeenNthCalledWith(1, scene);
        expect(predicate).toHaveBeenNthCalledWith(2, first);
    });

    it("progressively normalizes local scenes before editor setScene", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const scene = new Scene();
        for (let i = 0; i < 70; i++) {
            scene.add(new Object3D());
        }
        const yieldToNextPaint = vi.fn(async () => {});
        const setScene = vi.fn(async () => {});
        const ensureSceneRenderingSupport = vi.fn(async () => {});

        (runtime as any)._scene = scene;
        (runtime as any).editor = {
            sceneID: "local-scene",
            setScene,
        };
        (runtime as any).ensureRendererReady = vi.fn(async () => {});
        (runtime as any).ensureSceneRenderingSupport = ensureSceneRenderingSupport;
        (runtime as any).yieldToNextPaint = yieldToNextPaint;
        (runtime as any).call = vi.fn();

        await runtime.setUpLocalScene();

        expect(yieldToNextPaint).toHaveBeenCalled();
        expect(ensureSceneRenderingSupport).toHaveBeenCalledWith(scene);
        expect(setScene).toHaveBeenCalledWith(scene, undefined, true);
        expect(yieldToNextPaint.mock.invocationCallOrder[0]!).toBeLessThan(setScene.mock.invocationCallOrder[0]!);
    });

    it("precompiles runtime instanced reveals with the actual instance buffers", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 10);
        mesh.name = "RuntimeGrass";
        mesh.count = 4;
        mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(10 * 3), 3);
        mesh.updateMatrixWorld(true);

        const proxy = (runtime as any).createRuntimeRevealCompileProxy(mesh) as InstancedMesh;

        expect(proxy).toBeInstanceOf(InstancedMesh);
        expect(proxy).not.toBe(mesh);
        expect(proxy.count).toBe(4);
        expect(proxy.geometry).toBe(mesh.geometry);
        expect(proxy.material).toBe(mesh.material);
        expect(proxy.instanceMatrix).toBe(mesh.instanceMatrix);
        expect(proxy.instanceColor).toBe(mesh.instanceColor);
    });

    it("keeps progressive instanced uploads explicit while honoring a sandbox override", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const scene = new Scene();
        const root = new Object3D();
        root.userData.isRuntimeOnly = true;
        const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 6);
        root.add(mesh);
        scene.add(root);
        scene.userData.rendering = {runtimeSceneReveal: {enabled: true}};

        (runtime as any)._scene = scene;
        (runtime as any).editor = {isSandbox: true};
        (runtime as any).runtimeSceneRevealController = null;
        (runtime as any).on = vi.fn();

        const controller = (runtime as any).prepareRuntimeSceneRevealForPlayStart();
        await controller.revealInitialFrame();

        expect(mesh.visible).toBe(true);
        expect(mesh.count).toBe(1);
        expect(mesh.instanceMatrix.updateRanges).toEqual([{start: 0, count: 96}]);

        controller.restore();
        mesh.visible = true;
        mesh.count = 6;
        mesh.instanceMatrix.clearUpdateRanges();

        (runtime as any).runtimeSceneRevealController = null;
        (runtime as any).scene.userData.rendering = {
            runtimeSceneReveal: {progressiveInstancedUploads: true},
        };
        const overriddenController = (runtime as any).prepareRuntimeSceneRevealForPlayStart();
        await overriddenController.revealInitialFrame();

        expect(mesh.instanceMatrix.updateRanges).toEqual([{start: 0, count: 16}]);
    });

    it("does not hide legacy non-sandbox scenes without explicit reveal tuning", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const scene = new Scene();
        const root = new Object3D();
        root.userData.isRuntimeOnly = true;
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        root.add(mesh);
        scene.add(root);

        (runtime as any)._scene = scene;
        (runtime as any).editor = {isSandbox: false};
        (runtime as any).runtimeSceneRevealController = null;
        (runtime as any).on = vi.fn();

        const controller = (runtime as any).prepareRuntimeSceneRevealForPlayStart();

        expect(controller.stats.enabled).toBe(false);
        expect(mesh.visible).toBe(true);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
    });

    it("stages large legacy scenes on the WebGL fallback", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const scene = new Scene();
        const root = new Object3D();
        root.userData.isRuntimeOnly = true;
        const geometry = new BoxGeometry(1, 1, 1);
        const material = new MeshBasicMaterial();
        for (let index = 0; index < 513; index++) {
            root.add(new Mesh(geometry, material));
        }
        scene.add(root);

        (runtime as any)._scene = scene;
        (runtime as any).editor = {isSandbox: false};
        (runtime as any).renderer = {backend: {isWebGLBackend: true}};
        (runtime as any).runtimeSceneRevealController = null;
        (runtime as any).on = vi.fn();

        const controller = (runtime as any).prepareRuntimeSceneRevealForPlayStart();

        expect(controller.stats.enabled).toBe(true);
        expect(controller.stats.initialRevealBatchSize).toBe(12);
        expect(controller.stats.batchSize).toBe(4);
        expect(controller.stats.maxCooldownDelayMs).toBe(0);
        expect(controller.stats.maxAdaptiveFrameBatchMultiplier).toBe(1);
        expect(scene.userData._runtimeSceneRevealActive).toBe(true);
    });

    it("keeps very large legacy WebGL scenes visible through masked warmup", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const scene = new Scene();
        const root = new Object3D();
        root.userData.isRuntimeOnly = true;
        const geometry = new BoxGeometry(1, 1, 1);
        const material = new MeshBasicMaterial();
        for (let index = 0; index < 1025; index++) {
            root.add(new Mesh(geometry, material));
        }
        scene.add(root);

        (runtime as any)._scene = scene;
        (runtime as any).editor = {isSandbox: false};
        (runtime as any).renderer = {backend: {isWebGLBackend: true}};
        (runtime as any).runtimeSceneRevealController = null;
        (runtime as any).on = vi.fn();

        const controller = (runtime as any).prepareRuntimeSceneRevealForPlayStart();

        expect(controller.stats.enabled).toBe(false);
        expect(scene.userData._runtimeSceneRevealActive).toBeUndefined();
        expect(root.children.every(child => child.visible)).toBe(true);
    });

    it("does not progressively reveal very large Playground scenes by default", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const scene = new Scene();
        const root = new Object3D();
        root.userData.isRuntimeOnly = true;
        const geometry = new BoxGeometry(1, 1, 1);
        const material = new MeshBasicMaterial();
        for (let index = 0; index < 1025; index++) {
            root.add(new Mesh(geometry, material));
        }
        scene.add(root);

        (runtime as any)._scene = scene;
        (runtime as any).editor = {isSandbox: true};
        (runtime as any).renderer = {backend: {isWebGLBackend: false}};
        (runtime as any).runtimeSceneRevealController = null;
        (runtime as any).on = vi.fn();

        const controller = (runtime as any).prepareRuntimeSceneRevealForPlayStart();

        expect(controller.stats.enabled).toBe(false);
        expect(root.children.every(child => child.visible)).toBe(true);
    });

    it("skips repeated runtime reveal precompile for the same material and geometry layout", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const compileAsync = vi.fn(async () => {});
        const material = new MeshStandardMaterial();
        const first = new Mesh(new BoxGeometry(1, 1, 1), material);
        const second = new Mesh(new BoxGeometry(2, 2, 2), material);
        first.updateMatrixWorld(true);
        second.updateMatrixWorld(true);

        (runtime as any).runtimeRevealPrecompileKeys = new WeakMap();
        (runtime as any).renderer = {compileAsync};
        (runtime as any).camera = new PerspectiveCamera();
        (runtime as any)._scene = new Scene();

        await (runtime as any).precompileRuntimeRevealBatch([first, second]);

        expect(compileAsync).toHaveBeenCalledTimes(1);
    });

    it("keeps distinct runtime reveal precompile entries for different renderable layouts", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const compileAsync = vi.fn(async () => {});
        const material = new MeshStandardMaterial();
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
        const instanced = new InstancedMesh(new BoxGeometry(1, 1, 1), material, 2);
        mesh.updateMatrixWorld(true);
        instanced.updateMatrixWorld(true);

        (runtime as any).runtimeRevealPrecompileKeys = new WeakMap();
        (runtime as any).renderer = {compileAsync};
        (runtime as any).camera = new PerspectiveCamera();
        (runtime as any)._scene = new Scene();

        await (runtime as any).precompileRuntimeRevealBatch([mesh, instanced]);

        expect(compileAsync).toHaveBeenCalledTimes(2);
    });

    it("does not cache failed runtime reveal precompile attempts", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const compileAsync = vi.fn()
            .mockRejectedValueOnce(new Error("compile failed"))
            .mockResolvedValueOnce(undefined);
        const material = new MeshStandardMaterial();
        const first = new Mesh(new BoxGeometry(1, 1, 1), material);
        const second = new Mesh(new BoxGeometry(2, 2, 2), material);
        first.updateMatrixWorld(true);
        second.updateMatrixWorld(true);

        (runtime as any).runtimeRevealPrecompileKeys = new WeakMap();
        (runtime as any).renderer = {compileAsync};
        (runtime as any).camera = new PerspectiveCamera();
        (runtime as any)._scene = new Scene();

        await expect((runtime as any).precompileRuntimeRevealBatch([first])).rejects.toThrow("compile failed");
        await (runtime as any).precompileRuntimeRevealBatch([second]);

        expect(compileAsync).toHaveBeenCalledTimes(2);
    });

    it("precompiles material-array runtime reveal meshes without sharing a single-material cache entry", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const compileAsync = vi.fn(async () => {});
        const firstMaterial = new MeshBasicMaterial();
        const first = new Mesh(new BoxGeometry(1, 1, 1), [firstMaterial, new MeshBasicMaterial()]);
        const second = new Mesh(new BoxGeometry(2, 2, 2), [firstMaterial, new MeshBasicMaterial()]);
        first.updateMatrixWorld(true);
        second.updateMatrixWorld(true);

        (runtime as any).runtimeRevealPrecompileKeys = new WeakMap();
        (runtime as any).renderer = {compileAsync};
        (runtime as any).camera = new PerspectiveCamera();
        (runtime as any)._scene = new Scene();

        await (runtime as any).precompileRuntimeRevealBatch([first, second]);

        expect(compileAsync).toHaveBeenCalledTimes(2);
    });

    it("skips runtime reveal precompile for cheap single basic-material meshes", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const compileAsync = vi.fn(async () => {});
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        mesh.updateMatrixWorld(true);

        (runtime as any).runtimeRevealPrecompileKeys = new WeakMap();
        (runtime as any).renderer = {compileAsync};
        (runtime as any).camera = new PerspectiveCamera();
        (runtime as any)._scene = new Scene();

        await (runtime as any).precompileRuntimeRevealBatch([mesh]);

        expect(compileAsync).not.toHaveBeenCalled();
    });

    it("runs runtime budget passes after a post-start paint", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const scene = new Scene();
        const yieldToNextPaint = vi.fn(async () => {});
        (globalThis as any).__stemPlayStartTimings = [];
        (runtime as any)._scene = scene;
        (runtime as any).isPlaying = true;
        (runtime as any).postStartupRuntimeBudgetToken = 7;
        (runtime as any).yieldToNextPaint = yieldToNextPaint;
        (runtime as any).qualitySystem = null;

        await (runtime as any).runPostStartupRuntimeBudgets(scene, 7);

        const phases = ((globalThis as any).__stemPlayStartTimings as Array<{phase: string}>).map(entry => entry.phase);
        expect(yieldToNextPaint).toHaveBeenCalled();
        expect(phases).toContain("postStart:runtimeMaterialBudget");
        expect(phases).toContain("postStart:runtimeInstancingBudget");
    });

    it("cancels stale post-start runtime budget passes before work begins", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const scene = new Scene();
        const yieldToNextPaint = vi.fn(async () => {});
        (globalThis as any).__stemPlayStartTimings = [];
        (runtime as any)._scene = scene;
        (runtime as any).isPlaying = false;
        (runtime as any).postStartupRuntimeBudgetToken = 3;
        (runtime as any).yieldToNextPaint = yieldToNextPaint;

        await (runtime as any).runPostStartupRuntimeBudgets(scene, 3);

        expect(yieldToNextPaint).toHaveBeenCalledTimes(1);
        expect((globalThis as any).__stemPlayStartTimings).toEqual([]);
    });
});

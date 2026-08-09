import {Scene} from "three";
import {describe, expect, it, vi} from "vitest";

import {ApplicationMode, EngineRuntime} from "./EngineRuntime";
import EventList from "./event/EventList";

const createStopHarness = (editorStop: () => Promise<void>) => {
    const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
    const scene = new Scene();
    const clearScene = vi.spyOn(scene, "clear");
    const editorClear = vi.fn();
    Object.assign(runtime as any, {
        editor: {stop: editorStop, clear: editorClear},
        _scene: scene,
        viewportDisposed: false,
        _mode: "idle",
        isPlaying: false,
        isPaused: false,
        setModePromise: Promise.resolve(),
        clearModes: vi.fn(),
        event: {stop: vi.fn()},
        helpers: null,
        renderer: null,
        rendererCSS: null,
        multiplayerClient: null,
        assetLoader: {clear: vi.fn()},
        assetInstanceManager: {dispose: vi.fn()},
        frameTimer: {dispose: vi.fn()},
    });
    return {runtime, clearScene, editorClear};
};

describe("EngineRuntime stop persistence barrier", () => {
    it("releases the active player session exactly once", () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const dispose = vi.fn();
        Object.assign(runtime as any, {playerSession: {dispose}});

        (runtime as any).disposePlayerSession("test");
        (runtime as any).disposePlayerSession("test");

        expect(dispose).toHaveBeenCalledOnce();
        expect((runtime as any).playerSession).toBeNull();
    });

    it("disposes a partially constructed player session after startup failure", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const dispose = vi.fn();
        const clearStartupMask = vi.fn();
        Object.assign(runtime as any, {
            isPlaying: false,
            isPaused: false,
            playerSession: {dispose},
            clearPlayerLoadMaskAfterStartupFailure: clearStartupMask,
            runtimeStartupActive: true,
            runtimeStartupWarmupRendered: true,
        });

        await runtime.stopPlayer({clearStartupMask: true});

        expect(dispose).toHaveBeenCalledOnce();
        expect((runtime as any).playerSession).toBeNull();
        expect(clearStartupMask).toHaveBeenCalledOnce();
    });

    it("awaits the editor's full local-save drain before clearing the scene", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const editorStop = vi.fn(async () => gate);
        const {runtime, clearScene, editorClear} = createStopHarness(editorStop);

        const stopping = runtime.stop();
        await Promise.resolve();

        expect(editorStop).toHaveBeenCalledWith({savePolicy: "flush"});
        expect(clearScene).not.toHaveBeenCalled();
        expect(editorClear).not.toHaveBeenCalled();

        release();
        await stopping;
        expect(clearScene).toHaveBeenCalledTimes(1);
        expect(editorClear).toHaveBeenCalledTimes(1);
    });

    it("does not dispose scene data when the local-save drain fails", async () => {
        const editorStop = vi.fn(async () => {
            throw new Error("disk unavailable");
        });
        const {runtime, clearScene, editorClear} = createStopHarness(editorStop);

        await expect(runtime.stop()).rejects.toThrow("disk unavailable");

        expect(clearScene).not.toHaveBeenCalled();
        expect(editorClear).not.toHaveBeenCalled();
        expect((runtime as any).viewportDisposed).toBe(false);
    });
});

describe("EngineRuntime editor transition save policy", () => {
    const createModeHarness = () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const exitMode = vi.fn(async () => undefined);
        const enterMode = vi.fn(async () => undefined);
        Object.assign(runtime as any, {
            _mode: ApplicationMode.EDIT,
            setModePromise: Promise.resolve(),
            exitMode,
            enterMode,
        });
        return {runtime, exitMode, enterMode};
    };

    it("uses flush for an ordinary edit-mode transition", async () => {
        const {runtime, exitMode} = createModeHarness();

        await runtime.setMode(ApplicationMode.PLAY);

        expect(exitMode).toHaveBeenCalledWith(ApplicationMode.EDIT, "flush");
    });

    it("exposes transition busy state until queued mode work fully settles", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const exitMode = vi.fn(async () => gate);
        Object.assign(runtime as any, {
            _mode: ApplicationMode.EDIT,
            setModePromise: Promise.resolve(),
            exitMode,
            enterMode: vi.fn(async () => undefined),
        });

        const transition = runtime.setMode(ApplicationMode.PLAY);
        await Promise.resolve();
        expect(runtime.isModeTransitioning).toBe(true);

        release();
        await transition;
        await (runtime as any).setModePromise;
        expect(runtime.isModeTransitioning).toBe(false);
    });

    it("passes the explicit discard policy used by Don't Save", async () => {
        const {runtime, exitMode} = createModeHarness();

        await runtime.setMode(ApplicationMode.PLAY, {editorSavePolicy: "discard"});

        expect(exitMode).toHaveBeenCalledWith(ApplicationMode.EDIT, "discard");
    });

    it("rejects a failed flush, keeps edit mode, and does not enter Play", async () => {
        const {runtime, exitMode, enterMode} = createModeHarness();
        exitMode.mockRejectedValueOnce(new Error("save failed"));

        await expect(runtime.setMode(ApplicationMode.PLAY)).rejects.toThrow("save failed");

        expect(runtime.mode).toBe(ApplicationMode.EDIT);
        expect(runtime.isModeTransitioning).toBe(false);
        expect(enterMode).not.toHaveBeenCalled();
    });

    it("holds the last Play frame until the restored Edit scene renders", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const resumeRender = vi.fn();
        const exitMode = vi.fn(async () => undefined);
        const enterMode = vi.fn(async () => undefined);
        const pauseRenderForModeTransition = vi.fn(() => resumeRender);
        const waitForRestoredEditFrameAfterResume = vi.fn(
            async (resume: () => void) => {
                expect(enterMode).toHaveBeenCalledWith(ApplicationMode.EDIT);
                resume();
                return true;
            },
        );
        Object.assign(runtime as any, {
            _mode: ApplicationMode.PLAY,
            setModePromise: Promise.resolve(),
            exitMode,
            enterMode,
            pauseRenderForModeTransition,
            waitForRestoredEditFrameAfterResume,
        });

        await runtime.setMode(ApplicationMode.EDIT);

        expect(pauseRenderForModeTransition).toHaveBeenCalledOnce();
        expect(exitMode).toHaveBeenCalledWith(ApplicationMode.PLAY, "flush");
        expect(waitForRestoredEditFrameAfterResume).toHaveBeenCalledWith(resumeRender, 8000);
        expect(resumeRender).toHaveBeenCalledOnce();
    });

    it("waits for the bounded restored-frame handshake before exposing local Edit", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const resumeRender = vi.fn();
        const exitMode = vi.fn(async () => undefined);
        const enterMode = vi.fn(async () => undefined);
        const pauseRenderForModeTransition = vi.fn(() => resumeRender);
        const waitForRestoredEditFrameAfterResume = vi.fn(
            async (resume: () => void) => {
                resume();
                return true;
            },
        );
        Object.assign(runtime as any, {
            _mode: ApplicationMode.PLAY,
            setModePromise: Promise.resolve(),
            exitMode,
            enterMode,
            pauseRenderForModeTransition,
            waitForRestoredEditFrameAfterResume,
            editor: {isSandbox: true, sceneID: "oss-local-scene"},
            _scene: Object.assign(new Scene(), {userData: {sceneId: "oss-local-scene"}}),
        });

        await runtime.setMode(ApplicationMode.EDIT);

        expect(waitForRestoredEditFrameAfterResume).toHaveBeenCalledWith(resumeRender, 3000);
        expect(resumeRender).toHaveBeenCalledOnce();
    });

    it("emits Edit readiness only after a real rendered frame", async () => {
        expect(EventList).toContain("editSceneFirstFrameReady");
        vi.useFakeTimers();
        try {
            const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
            const listeners = new Map<string, (() => void) | null>();
            const call = vi.fn();
            const resumeRender = vi.fn();
            Object.assign(runtime as any, {
                _mode: ApplicationMode.EDIT,
                on: vi.fn((name: string, listener: (() => void) | null) => {
                    listeners.set(name, listener);
                }),
                call,
            });

            const readiness = (runtime as any).waitForRestoredEditFrameAfterResume(
                resumeRender,
                1000,
            ) as Promise<boolean>;

            expect(resumeRender).toHaveBeenCalledOnce();
            expect(call).not.toHaveBeenCalledWith(
                "editSceneFirstFrameReady",
                expect.anything(),
                expect.anything(),
            );

            listeners.get("afterRender.EditTransitionFirstFrame")?.();
            await vi.runAllTimersAsync();

            await expect(readiness).resolves.toBe(true);
            expect(call).toHaveBeenCalledWith(
                "editSceneFirstFrameReady",
                runtime,
                {mode: ApplicationMode.EDIT},
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not report Edit readiness when the render handshake times out", async () => {
        vi.useFakeTimers();
        try {
            const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
            const call = vi.fn();
            Object.assign(runtime as any, {
                _mode: ApplicationMode.EDIT,
                on: vi.fn(),
                call,
            });

            const readiness = (runtime as any).waitForRestoredEditFrameAfterResume(
                vi.fn(),
                1000,
            ) as Promise<boolean>;
            await vi.advanceTimersByTimeAsync(1000);

            await expect(readiness).resolves.toBe(false);
            expect(call).not.toHaveBeenCalledWith(
                "editSceneFirstFrameReady",
                expect.anything(),
                expect.anything(),
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it("resolves Edit readiness from the renderer completion marker when the event is missed", async () => {
        vi.useFakeTimers();
        try {
            const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
            const call = vi.fn();
            Object.assign(runtime as any, {
                _mode: ApplicationMode.EDIT,
                lastRenderedFrameAt: 0,
                on: vi.fn(),
                call,
            });

            const readiness = (runtime as any).waitForRestoredEditFrameAfterResume(
                vi.fn(),
                1000,
            ) as Promise<boolean>;
            (runtime as any).lastRenderedFrameAt = Number.MAX_SAFE_INTEGER;

            await vi.advanceTimersByTimeAsync(16);

            await expect(readiness).resolves.toBe(true);
            expect(call).toHaveBeenCalledWith(
                "editSceneFirstFrameReady",
                runtime,
                {mode: ApplicationMode.EDIT},
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it("suppresses the black load mask while returning to Edit", async () => {
        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const stopPlayer = vi.fn(async () => undefined);
        const clearModes = vi.fn();
        Object.assign(runtime as any, {
            _mode: ApplicationMode.EDIT,
            stopPlayer,
            clearModes,
        });

        await (runtime as any).stopPlayMode();

        expect(stopPlayer).toHaveBeenCalledWith({preserveRenderedFrame: true});
        expect(clearModes).toHaveBeenCalledOnce();
    });
});

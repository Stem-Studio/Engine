import {Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {
    beginScriptImportActivity,
    resetScriptImportActivityForTests,
} from "../agent/script-tool/scriptImportActivity";
import global from "../global";
import {runtimeFrameTelemetry} from "../core/performance/RuntimeFrameTelemetry";
import RenderEvent from "./RenderEvent";

type CapturedRenderFrame = {rendererFrame: {calls: number}};
const renderTestGlobals = globalThis as typeof globalThis & {
    __STEM_CAPTURE_RENDER_FRAME_HISTORY__?: boolean;
    __STEM_RENDER_FRAME_DIAGNOSTICS__?: unknown;
    __STEM_RENDER_FRAME_HISTORY__?: CapturedRenderFrame[];
    __STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__?: () => unknown;
};

function addDeepObjectChain(root: Object3D, depth = 12_000): Object3D {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        current.add(child);
        current = child;
    }

    return current;
}

describe("RenderEvent", () => {
    afterEach(() => {
        global.app = null;
        delete renderTestGlobals.__STEM_RENDER_FRAME_DIAGNOSTICS__;
        delete renderTestGlobals.__STEM_RENDER_FRAME_HISTORY__;
        delete renderTestGlobals.__STEM_CAPTURE_RENDER_FRAME_HISTORY__;
        delete renderTestGlobals.__STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__;
        runtimeFrameTelemetry.reset();
        resetScriptImportActivityForTests();
        vi.restoreAllMocks();
    });

    it("installs pull-only subsystem diagnostics during the editor render lifecycle", () => {
        const getLodDiagnostics = vi.fn(() => ({registeredGroups: 3}));
        global.app = {
            game: {
                plotBudgetManager: {getLodDiagnostics},
            },
        } as any;

        new RenderEvent();

        expect(renderTestGlobals.__STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__).toBeTypeOf("function");
        expect(getLodDiagnostics).not.toHaveBeenCalled();

        const diagnostics = renderTestGlobals.__STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__?.() as any;

        expect(getLodDiagnostics).toHaveBeenCalledTimes(1);
        expect(diagnostics.lod.registeredGroups).toBe(3);
    });

    it("renders directly without the retired scheduler frame wrapper", () => {
        const scene = new Scene();
        const mesh = new Mesh(undefined, new MeshBasicMaterial());
        scene.add(mesh);

        const camera = new PerspectiveCamera();
        const appRenderer = {
            hasInitialized: vi.fn(() => true),
            info: {
                render: {calls: 10, triangles: 20, points: 30, lines: 40},
            },
            shadowMap: {
                enabled: false,
                type: 0,
                needsUpdate: false,
            },
        };
        const effectRenderer = {
            renderer: appRenderer,
            render: vi.fn(),
        };
        const app = {
            options: {sceneType: "DEFAULT"},
            renderer: appRenderer,
            scene,
            camera,
            editor: {
                useShadows: true,
                rendering: {shadowMapType: 2},
                scene: {userData: {}},
            },
            batchedRenderer: {update: vi.fn()},
            stats: {dom: {style: {display: "none"}}, update: vi.fn()},
            scheduleFrameRendering: vi.fn((renderFrame: () => void) => renderFrame()),
            call: vi.fn(),
            lastRendererFrameInfo: null,
        };

        global.app = app as any;

        const event = new RenderEvent() as any;
        event.renderer = effectRenderer;
        event.animate({} as any, 1 / 60);

        expect(app.scheduleFrameRendering).not.toHaveBeenCalled();
        expect(app.call).toHaveBeenNthCalledWith(1, "beforeRender", event, {}, 1 / 60);
        expect(effectRenderer.render).toHaveBeenCalledTimes(1);
        expect(app.lastRendererFrameInfo).toBe(event.lastRendererFrameInfo);
        expect(app.lastRendererFrameInfo).toEqual(expect.objectContaining({calls: 0, triangles: 0}));
        expect(app.call).toHaveBeenNthCalledWith(2, "afterRender", event, {}, 1 / 60);
        expect((app as any).lastRenderedFrameAt).toBeTypeOf("number");
        expect(app.batchedRenderer.update).toHaveBeenCalledWith(1 / 60);
        expect(appRenderer.shadowMap.enabled).toBe(true);
        expect(appRenderer.shadowMap.type).toBe(2);
        expect(appRenderer.shadowMap.needsUpdate).toBe(true);
        expect(camera.matrixWorldAutoUpdate).toBe(true);
        expect(camera.matrixAutoUpdate).toBe(true);

        const firstBreakdown = event.lastRenderBreakdown;
        const firstRendererFrameInfo = event.lastRendererFrameInfo;
        event.animate({} as any, 1 / 60);

        expect(event.lastRenderBreakdown).toBe(firstBreakdown);
        expect(event.lastRendererFrameInfo).toBe(firstRendererFrameInfo);
    });

    it("invalidates shadow material changes in deep scenes without recursive scene traversal", () => {
        const scene = new Scene();
        const leaf = addDeepObjectChain(scene);
        const material = new MeshBasicMaterial();
        const materialVersion = material.version;
        const mesh = new Mesh(undefined, material);
        leaf.add(mesh);
        const traverseSpy = vi.spyOn(scene, "traverse");

        const camera = new PerspectiveCamera();
        const appRenderer = {
            hasInitialized: vi.fn(() => true),
            shadowMap: {
                enabled: false,
                type: 0,
                needsUpdate: false,
            },
        };
        const effectRenderer = {
            renderer: appRenderer,
            render: vi.fn(),
        };
        const app = {
            options: {sceneType: "DEFAULT"},
            renderer: appRenderer,
            scene,
            camera,
            editor: {
                useShadows: true,
                rendering: {shadowMapType: 2},
                scene: {userData: {}},
            },
            batchedRenderer: {update: vi.fn()},
            stats: {dom: {style: {display: "none"}}, update: vi.fn()},
            call: vi.fn(),
        };

        global.app = app as any;

        const event = new RenderEvent() as any;
        event.renderer = effectRenderer;
        event.animate({} as any, 1 / 60);

        expect(material.version).toBeGreaterThan(materialVersion);
        expect(appRenderer.shadowMap.enabled).toBe(true);
        expect(appRenderer.shadowMap.type).toBe(2);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("runs the render callback directly from the animation loop", () => {
        const app = {
            options: {sceneType: "DEFAULT"},
            renderer: {hasInitialized: vi.fn(() => true)},
            call: vi.fn(),
            shouldScheduleFrameRendering: vi.fn(() => true),
        };

        global.app = app as any;

        const event = new RenderEvent() as any;
        event.clock = {getDelta: vi.fn(() => 1 / 30)};
        event.lastFrameTime = 0;
        event.frameInterval = 0;
        event.animate = vi.fn();
        event.runAnimationLoop();

        expect(app.call).toHaveBeenCalledWith("animate", event, event.clock, 1 / 30);
        expect(event.animate).toHaveBeenCalledWith(event.clock, 1 / 30);
        expect(app.shouldScheduleFrameRendering).not.toHaveBeenCalled();
    });

    it("records rendered and frame-cap-skipped callbacks from the engine loop", () => {
        const app = {
            options: {sceneType: "DEFAULT"},
            renderer: {hasInitialized: vi.fn(() => true)},
            call: vi.fn(),
        };
        global.app = app as any;

        const event = new RenderEvent() as any;
        event.clock = {getDelta: vi.fn(() => 1 / 30)};
        event.lastFrameTime = 0;
        event.frameInterval = 1000 / 30;
        event.animate = vi.fn(() => true);
        const recordRenderedFrame = vi.spyOn(runtimeFrameTelemetry, "recordRenderedFrame");
        const recordSkippedFrame = vi.spyOn(runtimeFrameTelemetry, "recordSkippedFrame");

        vi.spyOn(performance, "now")
            .mockReturnValueOnce(10)
            .mockReturnValueOnce(40)
            .mockReturnValueOnce(41)
            .mockReturnValueOnce(42)
            .mockReturnValueOnce(43);

        event.runAnimationLoop();
        event.runAnimationLoop();

        expect(recordSkippedFrame).toHaveBeenCalledWith("frame-cap", 10);
        expect(recordRenderedFrame).toHaveBeenCalledWith(43, 1, 1000 / 30);
    });

    it("excludes masked runtime-startup frames from interactive telemetry", () => {
        const app = {
            options: {sceneType: "DEFAULT"},
            renderer: {hasInitialized: vi.fn(() => true)},
            call: vi.fn(),
            isRuntimeStartupActive: vi.fn(() => true),
        };
        global.app = app as any;

        const event = new RenderEvent() as any;
        event.clock = {getDelta: vi.fn(() => 1 / 60)};
        event.lastFrameTime = 0;
        event.frameInterval = 0;
        event.animate = vi.fn(() => true);
        const recordRenderedFrame = vi.spyOn(runtimeFrameTelemetry, "recordRenderedFrame");

        event.runAnimationLoop();

        expect(recordRenderedFrame).not.toHaveBeenCalled();
    });

    it("records renderer-unavailable callbacks before the renderer initializes", () => {
        const app = {
            options: {sceneType: "DEFAULT"},
            renderer: {hasInitialized: vi.fn(() => false)},
            call: vi.fn(),
        };
        global.app = app as any;

        const event = new RenderEvent() as any;
        const recordSkippedFrame = vi.spyOn(runtimeFrameTelemetry, "recordSkippedFrame");
        vi.spyOn(performance, "now").mockReturnValue(1234);

        event.runAnimationLoop();

        expect(recordSkippedFrame).toHaveBeenCalledWith("renderer-unavailable", 1234);
        expect(app.call).not.toHaveBeenCalled();
        expect(runtimeFrameTelemetry.getSnapshot().sampleCount).toBe(0);
    });

    it("reports throttled long animation frame diagnostics with render-stage timing", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const app = {
            options: {sceneType: "DEFAULT"},
            mode: "edit",
            isPlaying: false,
            renderer: {
                hasInitialized: vi.fn(() => true),
                info: {
                    render: {calls: 12, triangles: 345, points: 67, lines: 8},
                    memory: {geometries: 9, textures: 10},
                },
            },
            call: vi.fn(),
        };

        global.app = app as any;

        const event = new RenderEvent() as any;
        event.lastRenderBreakdown = {
            rootTransformMs: 1,
            rendererSetupMs: 0,
            beforeRenderMs: 2,
            lightUpdateMs: 3,
            batchedRendererMs: 4,
            effectRenderMs: 5,
            afterRenderMs: 6,
            shadowSyncMs: 7,
            statsMs: 8,
            totalMs: 13,
        };
        event.lastRendererFrameInfo = {calls: 2, triangles: 34, points: 5, lines: 6};
        event.reportLongAnimationFrame({
            frameEnd: 3075,
            totalMs: 75,
            appAnimateMs: 62,
            renderEventMs: 13,
            deltaTime: 0.016,
        });

        expect(warn).toHaveBeenCalledWith(
            "[RenderEvent] Long animation frame",
            expect.objectContaining({
                totalMs: 75,
                appAnimateMs: 62,
                renderEventMs: 13,
                deltaTimeMs: 16,
                renderBreakdown: expect.objectContaining({
                    batchedRendererMs: 4,
                    effectRenderMs: 5,
                    shadowSyncMs: 7,
                }),
                renderer: expect.objectContaining({
                    calls: 12,
                    triangles: 345,
                    geometries: 9,
                    textures: 10,
                }),
                rendererFrame: expect.objectContaining({
                    calls: 2,
                    triangles: 34,
                    points: 5,
                    lines: 6,
                }),
            }),
        );
        expect(renderTestGlobals.__STEM_RENDER_FRAME_DIAGNOSTICS__).toEqual(
            expect.objectContaining({
                totalMs: 75,
                appAnimateMs: 62,
                renderEventMs: 13,
            }),
        );
        expect(event.longFrameRecoveryUntil).toBe(0);

        const firstDiagnostics = renderTestGlobals.__STEM_RENDER_FRAME_HISTORY__![0]!;
        event.lastRendererFrameInfo.calls = 99;
        event.reportLongAnimationFrame({
            frameEnd: 3150,
            totalMs: 75,
            appAnimateMs: 62,
            renderEventMs: 13,
            deltaTime: 0.016,
        });

        expect(firstDiagnostics.rendererFrame.calls).toBe(2);
        expect(renderTestGlobals.__STEM_RENDER_FRAME_HISTORY__![1]!.rendererFrame.calls).toBe(99);
    });

    it("throttles repeated edit-mode renders after a pathological long frame", () => {
        const app = {
            options: {sceneType: "DEFAULT"},
            mode: "edit",
            isPlaying: false,
            renderer: {hasInitialized: vi.fn(() => true)},
            call: vi.fn(),
        };

        global.app = app as any;

        const event = new RenderEvent() as any;
        event.updateLongFrameRecovery(1000, 2500);

        expect(event.shouldSkipForLongFrameRecovery(2000)).toBe(true);

        event.clock = {getDelta: vi.fn(() => 1 / 30)};
        event.lastFrameTime = 0;
        event.frameInterval = 0;
        event.animate = vi.fn();
        vi.spyOn(performance, "now").mockReturnValue(2000);

        event.runAnimationLoop();

        expect(app.call).not.toHaveBeenCalled();
        expect(event.animate).not.toHaveBeenCalled();
    });

    it("applies edit-mode recovery after expensive but non-pathological frames", () => {
        const app = {
            options: {sceneType: "DEFAULT"},
            mode: "edit",
            isPlaying: false,
            renderer: {hasInitialized: vi.fn(() => true)},
        };

        global.app = app as any;

        const event = new RenderEvent() as any;
        event.updateLongFrameRecovery(1000, 180);

        expect(event.longFrameRecoveryUntil).toBe(1250);
    });

    it("skips edit-mode rendering while a script import is active", () => {
        const app = {
            options: {sceneType: "DEFAULT"},
            mode: "edit",
            isPlaying: false,
            renderer: {hasInitialized: vi.fn(() => true)},
            call: vi.fn(),
        };
        const endImport = beginScriptImportActivity();
        vi.spyOn(performance, "now").mockReturnValue(2000);

        global.app = app as any;

        const event = new RenderEvent() as any;
        event.clock = {getDelta: vi.fn(() => 1 / 30)};
        event.lastFrameTime = 0;
        event.frameInterval = 0;
        event.animate = vi.fn();
        event.runAnimationLoop();

        expect(app.call).not.toHaveBeenCalled();
        expect(event.animate).not.toHaveBeenCalled();
        expect(event.clock.getDelta).toHaveBeenCalledTimes(1);
        expect(event.lastFrameTime).toBe(2000);

        endImport();
    });

    it("does not apply long-frame recovery while playing", () => {
        const app = {
            options: {sceneType: "DEFAULT"},
            mode: "play",
            isPlaying: true,
            renderer: {hasInitialized: vi.fn(() => true)},
        };

        global.app = app as any;

        const event = new RenderEvent() as any;
        event.updateLongFrameRecovery(1000, 2500);

        expect(event.longFrameRecoveryUntil).toBe(0);
    });

    it("starts and stops without wiring the retired scheduled render callback", () => {
        const app = {
            setLegacyAnimationLoopCallback: vi.fn(),
            stopScheduledAnimationLoop: vi.fn(),
            on: vi.fn(),
        };

        global.app = app as any;

        const event = new RenderEvent();
        event.start();
        event.stop();

        expect(app.setLegacyAnimationLoopCallback).toHaveBeenNthCalledWith(1, expect.any(Function));
        expect(app.setLegacyAnimationLoopCallback).toHaveBeenNthCalledWith(2, null);
        expect(app.stopScheduledAnimationLoop).toHaveBeenCalledTimes(1);
        expect(app.on).toHaveBeenCalledWith(`outlineObjects.${event.id}`, event.handleOutlineObjects);
        expect(app.on).toHaveBeenCalledWith(`outlineObjects.${event.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`pauseRender.${event.id}`, event.handlePauseRender);
        expect(app.on).toHaveBeenCalledWith(`pauseRender.${event.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`resumeRender.${event.id}`, event.handleResumeRender);
        expect(app.on).toHaveBeenCalledWith(`resumeRender.${event.id}`, null);
        expect(app.on).not.toHaveBeenCalledWith("outlineObjects", expect.any(Function));
    });

    it("keeps rendering paused until every nested pause has resumed", () => {
        global.app = {} as any;

        const event = new RenderEvent() as any;
        event.handlePauseRender();
        event.handlePauseRender();

        expect(event.running).toBe(false);
        expect(event.pauseDepth).toBe(2);

        event.handleResumeRender();

        expect(event.running).toBe(false);
        expect(event.pauseDepth).toBe(1);

        event.handleResumeRender();

        expect(event.running).toBe(true);
        expect(event.pauseDepth).toBe(0);

        event.handleResumeRender();

        expect(event.running).toBe(true);
        expect(event.pauseDepth).toBe(0);
    });

    it("resets both render and simulation timing across visibility changes", () => {
        const app = {resetSimulationClock: vi.fn()};
        global.app = app as any;
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        const event = new RenderEvent() as any;
        event.clock = {getDelta: vi.fn(() => 1)};

        event.handleVisibilityChange();

        expect(app.resetSimulationClock).toHaveBeenCalledOnce();
        expect(event.clock.getDelta).toHaveBeenCalledOnce();
        expect(event.running).toBe(false);
    });

    it("discards wall time across generic render pause and resume", () => {
        const app = {resetSimulationClock: vi.fn()};
        global.app = app as any;
        const event = new RenderEvent() as any;
        event.clock = {getDelta: vi.fn(() => 5)};

        event.handlePauseRender();
        event.handleResumeRender();

        expect(app.resetSimulationClock).toHaveBeenCalledTimes(2);
        expect(event.clock.getDelta).toHaveBeenCalledTimes(2);
        expect(event.running).toBe(true);
    });
});

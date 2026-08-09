import {describe, expect, it, vi} from "vitest";

import {FixedStepSimulationClock} from "./core/simulation/FixedStepSimulationClock";
import {EngineRuntime} from "./EngineRuntime";

function createHarness() {
    const calls: string[] = [];
    const frameContext = {};
    const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
    const physics = {
        beginSimulationFrame: vi.fn(() => calls.push("physics:frame")),
        fixedUpdate: vi.fn((_fixedDeltaTime: number): "completed" | "pending" | "dropped" => {
            calls.push("physics:fixed");
            return "completed";
        }),
        configureQuality: vi.fn(),
        setFixedStepCompletionListener: vi.fn(),
    };
    const game = {
        beginSimulationFrame: vi.fn((_delta, frame) => {
            calls.push(`game:begin:${frame.interpolationAlpha}`);
            return frameContext;
        }),
        fixedUpdate: vi.fn((_fixedDeltaTime?: number, _context?: unknown) => calls.push("game:fixed")),
        update: vi.fn(() => calls.push("game:variable")),
    };

    Object.assign(runtime as unknown as Record<string, unknown>, {
        isPlaying: true,
        simulationClock: new FixedStepSimulationClock({fixedHz: 60, maxStepsPerFrame: 3}),
        playerSession: {
            physics,
            game,
            aiWorldControl: {update: vi.fn(() => calls.push("ai:variable"))},
            animationControl: {update: vi.fn(() => calls.push("animation:variable"))},
            animationGraphControl: {update: vi.fn(() => calls.push("graph:variable"))},
            audioControl: {update: vi.fn(() => calls.push("audio:variable"))},
            playerEvent: {update: vi.fn(() => calls.push("events:variable"))},
        },
        handleWorkerFixedStepComplete: (EngineRuntime.prototype as any).completeWorkerFixedStep.bind(runtime),
    });

    return {runtime, physics, game, calls, frameContext};
}

describe("EngineRuntime authoritative fixed-step simulation", () => {
    it("runs physics before gameplay for every fixed step and variables once", () => {
        const {runtime, calls, game, frameContext} = createHarness();

        (runtime as unknown as {animate(clock: unknown, delta: number): void})
            .animate({}, 1 / 30);

        expect(calls).toEqual([
            "game:begin:0",
            "physics:frame",
            "physics:fixed",
            "game:fixed",
            "physics:fixed",
            "game:fixed",
            "ai:variable",
            "animation:variable",
            "graph:variable",
            "audio:variable",
            "game:variable",
            "events:variable",
        ]);
        expect(game.fixedUpdate).toHaveBeenCalledTimes(2);
        expect(game.update).toHaveBeenCalledWith({}, 1 / 30, frameContext);
    });

    it("runs no premature fixed step and exposes half-step interpolation", () => {
        const {runtime, physics, game} = createHarness();

        (runtime as unknown as {animate(clock: unknown, delta: number): void})
            .animate({}, 1 / 120);

        expect(physics.fixedUpdate).not.toHaveBeenCalled();
        expect(game.fixedUpdate).not.toHaveBeenCalled();
        expect(game.beginSimulationFrame).toHaveBeenCalledWith(
            1 / 120,
            expect.objectContaining({
                fixedStepCount: 0,
                interpolationAlpha: 0.5,
                fixedOverstep: 1 / 120,
            }),
        );
        expect(game.update).toHaveBeenCalledOnce();
    });

    it("defers worker gameplay until each acknowledged physics step", () => {
        const {runtime, physics, game, calls} = createHarness();
        physics.fixedUpdate.mockImplementation(() => {
            calls.push("physics:queued");
            return "pending";
        });

        (runtime as unknown as {animate(clock: unknown, delta: number): void})
            .animate({}, 1 / 30);

        expect(game.fixedUpdate).not.toHaveBeenCalled();
        expect(physics.fixedUpdate).toHaveBeenCalledTimes(2);
        const completionListener = physics.setFixedStepCompletionListener.mock.calls[0]?.[0];
        expect(completionListener).toEqual(expect.any(Function));

        completionListener?.(1 / 60);
        expect(game.update).not.toHaveBeenCalled();
        completionListener?.(1 / 60);

        expect(game.fixedUpdate).toHaveBeenCalledTimes(2);
        expect(game.fixedUpdate).toHaveBeenNthCalledWith(1, 1 / 60, expect.any(Object));
        expect(game.fixedUpdate).toHaveBeenNthCalledWith(2, 1 / 60, expect.any(Object));
        expect(calls.indexOf("game:variable")).toBeGreaterThan(calls.lastIndexOf("game:fixed"));
    });

    it("reconfigures both the clock and physics from quality settings", () => {
        const {runtime, physics} = createHarness();

        runtime.configureSimulationQuality({
            physics: {updateRate: 30, substeps: 2, maxStepsPerFrame: 2},
            scheduler: {fixedTimestepHz: 60, maxFixedStepsPerFrame: 3},
        });

        expect(physics.configureQuality).toHaveBeenCalledWith(30, 2, 2, true);
        const frame = (runtime as unknown as {
            simulationClock: FixedStepSimulationClock;
        }).simulationClock.advance(1 / 30);
        expect(frame.fixedDeltaTime).toBe(1 / 30);
        expect(frame.fixedStepCount).toBe(1);
    });

    it("forwards solver quality when a preset supplies it", () => {
        const {runtime, physics} = createHarness();

        runtime.configureSimulationQuality({
            physics: {updateRate: 60, substeps: 1, maxStepsPerFrame: 3, solverIterations: 8},
        });

        expect(physics.configureQuality).toHaveBeenCalledWith(60, 1, 3, true, true, 8);
    });

    it("discards simulation remainder when play is paused", () => {
        const {runtime, physics} = createHarness();
        const reset = vi.spyOn(
            (runtime as unknown as {simulationClock: FixedStepSimulationClock}).simulationClock,
            "reset",
        );
        Object.assign(runtime as unknown as Record<string, unknown>, {
            clock: {stop: vi.fn()},
            frameTimer: {reset: vi.fn()},
        });
        (physics as typeof physics & {pause: ReturnType<typeof vi.fn>}).pause = vi.fn();

        (runtime as unknown as {pausePlayer(): void}).pausePlayer();

        expect(reset).toHaveBeenCalledOnce();
        expect((physics as typeof physics & {pause: ReturnType<typeof vi.fn>}).pause).toHaveBeenCalledOnce();
        expect(runtime.isPaused).toBe(true);
        expect(runtime.isPlaying).toBe(false);
    });

    it("detaches the fixed-step owner and clears pending worker state on teardown", () => {
        const {runtime, physics} = createHarness();
        const pendingWorkerSimulationFrame = {remainingFixedSteps: 1};
        Object.assign(runtime as unknown as Record<string, unknown>, {
            fixedStepListenerPhysics: physics,
            pendingWorkerSimulationFrame,
            activeSimulationFrameContext: {fixedStepCount: 1},
            completedWorkerFixedStepsSinceTelemetry: 4,
            workerDroppedFixedSteps: 2,
            workerDroppedSimulationTime: 0.1,
        });

        (runtime as unknown as {clearPhysicsFixedStepListener(): void})
            .clearPhysicsFixedStepListener();

        expect(physics.setFixedStepCompletionListener).toHaveBeenCalledWith(null);
        expect((runtime as any).fixedStepListenerPhysics).toBeNull();
        expect((runtime as any).pendingWorkerSimulationFrame).toBeNull();
        expect((runtime as any).activeSimulationFrameContext).toBeNull();
        expect((runtime as any).completedWorkerFixedStepsSinceTelemetry).toBe(0);
        expect((runtime as any).workerDroppedFixedSteps).toBe(0);
        expect((runtime as any).workerDroppedSimulationTime).toBe(0);
    });
});

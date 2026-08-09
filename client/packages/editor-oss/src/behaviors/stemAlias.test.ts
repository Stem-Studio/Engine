import {afterEach, describe, expect, it, vi} from "vitest";

import {BehaviorBase} from "./Behavior";
import type {StemEngineInterface, StemRuntime, StemRuntimeProcessInBatchesOptions} from "./stem";
import {createEditorErthInterface, createStemEngineInterface} from "./stem/createStemEngineInterface";
import {GlobalStore} from "./stem/store/GlobalStore";

/**
 * The brand-neutral `StemEngineInterface` is exposed to behaviors as
 * `this.stemEngine`. The original `this.erth` name stays available as a
 * deprecation alias getter for backward compatibility with existing
 * user-authored behaviors.
 *
 * This test pins the runtime contract: `instance.erth === instance.stemEngine`.
 */
describe("BehaviorBase stemEngine/erth alias", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("exposes both `erth` and `stemEngine` pointing at the same object", () => {
        const fakeStemEngine = {
            ai: {},
            asset: {},
            camera: {},
            combat: {},
            team: {},
            pool: {},
            object: {},
            runtime: {},
            scene: {},
            store: {},
            lambdas: {},
            behaviors: {},
            tween: {},
            fsm: {},
            behaviorTree: {},
            spatial: {},
            events: {},
        } as never;

        const fakeTarget = {} as never;
        const fakeGameObject = {} as never;
        const instance = new BehaviorBase(fakeTarget, "test.behavior", {
            gameObject: fakeGameObject,
            erth: fakeStemEngine,
        });

        expect(instance.erth).toBe(fakeStemEngine);
        expect(instance.stemEngine).toBe(fakeStemEngine);
        expect(instance.stemEngine).toBe(instance.erth);
    });

    it("StemEngineInterface compile-time identity check", () => {
        const _check = (x: StemEngineInterface): StemEngineInterface => x;
        expect(typeof _check).toBe("function");
    });

    it("exports runtime API types from the stem barrel", () => {
        const _runtime = (runtime: StemRuntime, options: StemRuntimeProcessInBatchesOptions) => ({
            runtime,
            options,
        });
        expect(typeof _runtime).toBe("function");
    });

    it("forwards cooperative runtime frame yields through the stem API", async () => {
        const yieldRuntimeToFrame = vi.fn(async () => {});
        const stem = createStemEngineInterface({
            engine: {},
            getViewportSafeArea: vi.fn(),
            yieldRuntimeToFrame,
        } as never, new GlobalStore());

        await stem.runtime.yieldToFrame(true);

        expect(yieldRuntimeToFrame).toHaveBeenCalledWith(true);
    });

    it("processes runtime batches without materializing iterables and forces paint yields", async () => {
        const yieldRuntimeToFrame = vi.fn(async () => {});
        const stem = createStemEngineInterface({
            engine: {},
            getViewportSafeArea: vi.fn(),
            yieldRuntimeToFrame,
        } as never, new GlobalStore());

        function* values() {
            yield "a";
            yield "b";
            yield "c";
        }

        const seen: Array<string | number> = [];
        await stem.runtime.processInBatches(values(), (item, index) => {
            seen.push(item, index);
        }, {batchSize: 2, frameBudgetMs: 1_000_000});

        expect(seen).toEqual(["a", 0, "b", 1, "c", 2]);
        expect(yieldRuntimeToFrame).toHaveBeenCalledTimes(1);
        expect(yieldRuntimeToFrame).toHaveBeenCalledWith(true);
    });

    it("keeps synchronous runtime batch callbacks contiguous until a budget yield", async () => {
        const events: string[] = [];
        const yieldRuntimeToFrame = vi.fn(async () => {
            events.push("yield");
        });
        const stem = createStemEngineInterface({
            engine: {},
            getViewportSafeArea: vi.fn(),
            yieldRuntimeToFrame,
        } as never, new GlobalStore());

        await stem.runtime.processInBatches([1, 2, 3], (item) => {
            events.push(`item-${item}`);
            void Promise.resolve().then(() => {
                events.push(`microtask-${item}`);
            });
        }, {batchSize: 3, frameBudgetMs: 1_000_000});

        expect(events.slice(0, 4)).toEqual(["item-1", "item-2", "item-3", "yield"]);
        expect(events.slice(4)).toEqual(["microtask-1", "microtask-2", "microtask-3"]);
        expect(yieldRuntimeToFrame).toHaveBeenCalledOnce();
        expect(yieldRuntimeToFrame).toHaveBeenCalledWith(true);
    });

    it("awaits asynchronous runtime batch callbacks before processing the next item", async () => {
        const events: string[] = [];
        const stem = createStemEngineInterface({
            engine: {},
            getViewportSafeArea: vi.fn(),
            yieldRuntimeToFrame: vi.fn(async () => {}),
        } as never, new GlobalStore());

        await stem.runtime.processInBatches([1, 2], async (item) => {
            events.push(`start-${item}`);
            await Promise.resolve();
            events.push(`end-${item}`);
        }, {batchSize: 10, frameBudgetMs: 1_000_000});

        expect(events).toEqual(["start-1", "end-1", "start-2", "end-2"]);
    });

    it("preserves asynchronous runtime batch rejection semantics", async () => {
        const stem = createStemEngineInterface({
            engine: {},
            getViewportSafeArea: vi.fn(),
            yieldRuntimeToFrame: vi.fn(async () => {}),
        } as never, new GlobalStore());

        await expect(stem.runtime.processInBatches([1], async () => {
            throw new Error("batch failed");
        })).rejects.toThrow("batch failed");
    });

    it("throws a stable abort error from runtime batches when no abort reason is provided", async () => {
        const stem = createStemEngineInterface({
            engine: {},
            getViewportSafeArea: vi.fn(),
            yieldRuntimeToFrame: vi.fn(async () => {}),
        } as never, new GlobalStore());
        const signal = {aborted: true, reason: undefined} as AbortSignal;

        await expect(stem.runtime.processInBatches([1], () => {}, {
            signal,
        })).rejects.toThrow("Stem runtime batch processing was aborted");
    });

    it("editor-mode yieldToFrame cooperatively yields to the browser", async () => {
        const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
        const erth = createEditorErthInterface({
            getViewportSafeArea: vi.fn(),
        } as never);

        await erth.runtime.yieldToFrame();

        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it("editor-mode processInBatches yields between configured batches", async () => {
        const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
        const erth = createEditorErthInterface({
            getViewportSafeArea: vi.fn(),
        } as never);
        const seen: number[] = [];

        await erth.runtime.processInBatches([1, 2], (item) => {
            seen.push(item);
        }, {batchSize: 1, frameBudgetMs: 1_000_000});

        expect(seen).toEqual([1, 2]);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    });
});

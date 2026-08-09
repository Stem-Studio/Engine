import { createForeignBehaviorView, unwrapBehavior } from "../Behavior";
import { createAIInterface } from './ai/createAIInterface';
import { createAssetInterface } from './asset/createAssetInterface';
import { createBehaviorTreeInterface } from './behaviorTree/createBehaviorTreeInterface';
import { createCameraInterface } from './camera/createCameraInterface';
import { createCombatInterface } from './combat/createCombatInterface';
import {
    StemEngineInterface,
    StemLambdas,
    StemBehaviors,
    type StemRuntimeProcessInBatchesOptions,
} from "./StemEngineInterface";
import { createEventsInterface } from './events/createEventsInterface';
import { createFsmInterface } from './fsm/createFsmInterface';
import { createObjectInterface } from './object/createObjectInterface';
import { createPoolInterface } from './pool/createPoolInterface';
import { createSceneInterface } from './scene/createSceneInterface';
import { createSpatialInterface } from './spatial/createSpatialInterface';
import { createStoreInterface } from './store/createStoreInterface';
import { GlobalStore } from './store/GlobalStore';
import { createTeamInterface } from './team/createTeamInterface';
import { createTweenInterface } from './tween/createTweenInterface';
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import { createForeignLambdaView } from "../../lambdas/Lambda";
import GameManager from "../game/GameManager";
import {createProgressiveYieldController} from "../../utils/progressiveYield";

const DEFAULT_RUNTIME_BATCH_SIZE = 32;
const DEFAULT_RUNTIME_FRAME_BUDGET_MS = 4;

const nowForRuntimeBatch = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

const positiveInteger = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;

const nonNegativeNumber = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) && value! >= 0 ? value! : fallback;

const isPromiseLike = <T = unknown>(value: unknown): value is PromiseLike<T> =>
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as {then?: unknown}).then === "function";

const throwIfAborted = (signal: AbortSignal | undefined): void => {
    if (!signal?.aborted) return;
    if (signal.reason !== undefined) {
        throw signal.reason;
    }
    throw new Error("Stem runtime batch processing was aborted");
};

const yieldBrowserFrame = (): Promise<void> =>
    new Promise(resolve => {
        const finish = () => setTimeout(resolve, 0);
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => finish());
        } else {
            finish();
        }
    });

const createViewportInterface = (game: GameManager) => ({
    getSafeArea: () => game.getViewportSafeArea(),
});

const processRuntimeBatches = async <T>(
    items: Iterable<T>,
    process: (item: T, index: number) => void | Promise<void>,
    options: StemRuntimeProcessInBatchesOptions = {},
    yieldToFrame: () => Promise<void>,
): Promise<void> => {
    const batchSize = positiveInteger(options.batchSize, DEFAULT_RUNTIME_BATCH_SIZE);
    const frameBudgetMs = nonNegativeNumber(options.frameBudgetMs, DEFAULT_RUNTIME_FRAME_BUDGET_MS);
    const maybeYield = createProgressiveYieldController({
        batchSize: 1,
        frameBudgetMs: 0,
        yieldToFrame,
    }, {
        batchSize: 1,
        frameBudgetMs: 0,
    });
    let index = 0;
    let processedThisSlice = 0;
    let sliceStart = nowForRuntimeBatch();

    for (const item of items) {
        throwIfAborted(options.signal);
        const result = process(item, index);
        if (isPromiseLike(result)) {
            await result;
        }
        throwIfAborted(options.signal);
        index++;
        processedThisSlice++;

        if (
            processedThisSlice >= batchSize ||
            nowForRuntimeBatch() - sliceStart >= frameBudgetMs
        ) {
            await maybeYield(true);
            processedThisSlice = 0;
            sliceStart = nowForRuntimeBatch();
        }
    }
};

const createRuntimeInterface = (game: GameManager) => ({
    yieldToFrame: (force?: boolean) => game.yieldRuntimeToFrame(force),
    processInBatches: async <T>(
        items: Iterable<T>,
        process: (item: T, index: number) => void | Promise<void>,
        options: StemRuntimeProcessInBatchesOptions = {},
    ): Promise<void> => {
        await processRuntimeBatches(items, process, options, () => game.yieldRuntimeToFrame(true));
    },
});

const createLambdasInterface = (game: GameManager): StemLambdas => {
    return {
        getInstance: (instanceId: string) => {
            const lambda = game.lambdaManager?.getInstance(instanceId) ?? null;
            return lambda ? createForeignLambdaView(lambda) : null;
        },
        getInstancesByType: (lambdaId: string) =>
            (game.lambdaManager?.getInstancesByType(lambdaId) ?? []).map(lambda => createForeignLambdaView(lambda)),
        registerObject: (instanceId: string, target, componentData?) =>
            game.lambdaManager?.registerObject(instanceId, target, componentData) ?? false,
        deregisterObject: (instanceId: string, target) =>
            game.lambdaManager?.deregisterObject(instanceId, target),
        getObjectLambdas: (target) =>
            (game.lambdaManager?.getObjectLambdas(target) ?? []).map(lambda => createForeignLambdaView(lambda)),
    };
};

const createBehaviorsInterface = (game: GameManager): StemBehaviors => {
    return {
        find: (target, id) => {
            const results = game.behaviorManager?.getTargetBehaviorsById(target, id) ?? [];
            return results[0] ? createForeignBehaviorView(results[0]) : null;
        },
        findAll: (id) => (game.behaviorManager?.getBehaviorsById(id) ?? []).map(behavior => createForeignBehaviorView(behavior)),
        findOnObject: (target) =>
            (game.behaviorManager?.getTargetBehaviors(target) ?? []).map(behavior => createForeignBehaviorView(behavior)),
        getAttribute: (behavior, key) => behavior.getAttribute(key),
        requestChange: (behavior, key, value, options) =>
            game.behaviorManager!.requestAttributeChange(unwrapBehavior(behavior), key, value, null, options),
    };
};

export const createStemEngineInterface = (game: GameManager, globalStore: GlobalStore): StemEngineInterface => {
    const {erth: tween, groupRef: tweenGroupRef} = createTweenInterface();
    game.tweenGroupRef = tweenGroupRef;
    return {
        ai: createAIInterface(game),
        asset: createAssetInterface(game.engine, game),
        camera: createCameraInterface(game),
        combat: createCombatInterface(),
        team: createTeamInterface(),
        pool: createPoolInterface(),
        object: createObjectInterface(game),
        viewport: createViewportInterface(game),
        runtime: createRuntimeInterface(game),
        scene: createSceneInterface(game),
        store: createStoreInterface(globalStore),
        lambdas: createLambdasInterface(game),
        behaviors: createBehaviorsInterface(game),
        tween,
        fsm: createFsmInterface(),
        behaviorTree: createBehaviorTreeInterface(),
        spatial: createSpatialInterface(),
        events: createEventsInterface(),
    };
};

const notAvailable = (name: string) => {
    throw new Error(`erth.${name} is not available in edit mode`);
};

export const createEditorErthInterface = (engine: EngineRuntime): StemEngineInterface => {
    return {
        asset: createAssetInterface(engine),
        combat: createCombatInterface(),
        team: createTeamInterface(),
        pool: createPoolInterface(),
        store: createStoreInterface(new GlobalStore()),
        ai: { generate: () => notAvailable('ai') } as any,
        camera: { setTarget: () => notAvailable('camera'), getPosition: () => notAvailable('camera') } as any,
        object: { create: () => notAvailable('object'), destroy: () => notAvailable('object') } as any,
        viewport: { getSafeArea: () => engine.getViewportSafeArea() },
        runtime: {
            yieldToFrame: () => yieldBrowserFrame(),
            processInBatches: async <T>(
                items: Iterable<T>,
                process: (item: T, index: number) => void | Promise<void>,
                options: StemRuntimeProcessInBatchesOptions = {},
            ): Promise<void> => {
                await processRuntimeBatches(items, process, options, yieldBrowserFrame);
            },
        },
        scene: { getObjects: () => notAvailable('scene') } as any,
        lambdas: { getInstance: () => notAvailable('lambdas') } as any,
        behaviors: { find: () => notAvailable('behaviors') } as any,
        tween: {
            to: () => notAvailable('tween'),
            killAll: () => notAvailable('tween'),
        },
        fsm: { create: () => notAvailable('fsm') },
        behaviorTree: { create: () => notAvailable('behaviorTree') },
        spatial: { octree: () => notAvailable('spatial') },
        events: { on: () => notAvailable('events') },
    };
};

import {Object3D} from "three";

import type {Behavior} from "./Behavior";

const ERROR_LOG_INTERVAL_FRAMES = 120;
const ERROR_BACKOFF_BASE_FRAMES = 2;
const ERROR_BACKOFF_MAX_FRAMES = 60;
const FULLSCREEN_CAMERA_ERROR = "fullscreen can only be added to a camera";
const FULLSCREEN_REPAIR_RETRY_FRAMES = 30;
const FULLSCREEN_REPAIR_SCAN_DEPTH = 5;
const FULLSCREEN_UPDATE_PATCHED_SYMBOL = Symbol.for(
    "stem.editor-oss.behaviorManager.transientFullscreenUpdatePatched",
);
const FULLSCREEN_REPAIR_SKIP_KEYS = new Set([
    "target",
    "gameObject",
    "erth",
    "attributes",
    "options",
    "throttleConfig",
    "game",
    "_game",
    "scene",
    "renderer",
    "camera",
    "uiCamera",
    "behaviorManager",
    "lambdaManager",
    "physics",
    "engine",
]);

export interface BehaviorUpdateErrorLogState {
    signature: string;
    lastLoggedFrame: number;
    suppressedCount: number;
    consecutiveFailures: number;
    nextRetryFrame: number;
}

export interface TransientFullscreenRepairState {
    signature: string;
    lastRepairFrame: number;
}

interface BehaviorUpdateErrorPolicyOptions {
    getFrameCount(): number;
    getErrorStates(): WeakMap<Behavior, BehaviorUpdateErrorLogState>;
    getBackoffCount(): number;
    setBackoffCount(count: number): void;
    getFullscreenRepairStates(): WeakMap<Behavior, TransientFullscreenRepairState>;
    resolveFullscreenCamera(): Object3D | null;
    formatBehaviorId(id: string): string;
}

function isCameraLike(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const camera = value as {isPerspectiveCamera?: boolean; isOrthographicCamera?: boolean};
    return camera.isPerspectiveCamera === true || camera.isOrthographicCamera === true;
}

function isRuntimeFullscreenLike(value: unknown): value is Object3D & {update: (...args: any[]) => void} {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Object3D & Record<string, unknown> & {isObject3D?: boolean};
    const constructorName = typeof candidate.constructor?.name === "string"
        ? candidate.constructor.name.toLowerCase()
        : "";
    return (
        candidate.isObject3D === true &&
        typeof candidate.update === "function" &&
        (
            constructorName.includes("fullscreen") ||
            ("renderer" in candidate && "sizeX" in candidate && "sizeY" in candidate && "pixelSize" in candidate)
        )
    );
}

function normalizeFullscreenUpdateArgs(args: any[]): any[] {
    if (
        args.length >= 2 &&
        typeof args[0] === "number" &&
        typeof args[1] === "number" &&
        (args[0] > 1 || args[1] > 1)
    ) {
        return [1 / 60];
    }
    return args;
}

function errorMessage(error: unknown): string {
    return error && typeof error === "object" && "message" in error
        ? String((error as {message?: unknown}).message)
        : String(error ?? "");
}

export class BehaviorUpdateErrorPolicy {
    constructor(private readonly options: BehaviorUpdateErrorPolicyOptions) {}

    getSignature(error: unknown): string {
        if (error && typeof error === "object") {
            const typedError = error as {name?: unknown; message?: unknown};
            return `${String(typedError.name ?? "Error")}:${String(typedError.message ?? error)}`;
        }
        return String(error);
    }

    isSuppressedTransientError(signature: string, error?: unknown): boolean {
        return (
            signature.toLowerCase().includes(FULLSCREEN_CAMERA_ERROR) ||
            errorMessage(error).toLowerCase().includes(FULLSCREEN_CAMERA_ERROR)
        );
    }

    repairTransientFullscreenRoots(behavior: Behavior): boolean {
        const camera = this.options.resolveFullscreenCamera();
        if (!camera) return false;
        return this.repairFullscreenRootsFromValue(behavior, camera, new WeakSet<object>());
    }

    shouldSkip(behavior: Behavior, phase: string): boolean {
        if (this.options.getBackoffCount() <= 0) return false;
        const state = this.options.getErrorStates().get(behavior);
        return (
            !!state &&
            state.signature.startsWith(`${phase}:`) &&
            this.options.getFrameCount() < state.nextRetryFrame
        );
    }

    clear(behavior: Behavior, phase: string): void {
        if (this.options.getBackoffCount() <= 0) return;
        const stateMap = this.options.getErrorStates();
        const state = stateMap.get(behavior);
        if (!state?.signature.startsWith(`${phase}:`)) return;
        stateMap.delete(behavior);
        this.options.setBackoffCount(Math.max(0, this.options.getBackoffCount() - 1));
    }

    report(behavior: Behavior, error: unknown, phase = "update"): void {
        const errorSignature = this.getSignature(error);
        const signature = `${phase}:${errorSignature}`;
        const {state, isNewSignature} = this.recordFailure(behavior, signature);
        const frameCount = this.options.getFrameCount();

        if (this.isSuppressedTransientError(errorSignature, error)) {
            if (this.shouldRepairFullscreenError(behavior, signature)) {
                this.repairTransientFullscreenRoots(behavior);
                this.options.getFullscreenRepairStates().set(behavior, {
                    signature,
                    lastRepairFrame: frameCount,
                });
            }
            state.nextRetryFrame = Math.max(state.nextRetryFrame, frameCount + FULLSCREEN_REPAIR_RETRY_FRAMES);
            return;
        }

        const label = `[BehaviorManager] Error during behavior ${phase} for ${this.options.formatBehaviorId(behavior.id)}`;
        if (isNewSignature) {
            console.error(`${label}:`, error);
            return;
        }
        if (frameCount - state.lastLoggedFrame < ERROR_LOG_INTERVAL_FRAMES) return;

        const suppressedCount = state.suppressedCount;
        state.lastLoggedFrame = frameCount;
        state.suppressedCount = 0;
        console.error(`${label} (${suppressedCount} repeated error(s) suppressed):`, error);
    }

    private repairFullscreenRootsFromValue(
        value: unknown,
        camera: Object3D,
        seen: WeakSet<object>,
        depth = 0,
    ): boolean {
        if (!value || typeof value !== "object") return false;
        const object = value as object;
        if (seen.has(object)) return false;
        seen.add(object);

        if (isRuntimeFullscreenLike(value)) {
            this.patchFullscreenUpdate(value, camera);
            if (!isCameraLike(value.parent)) camera.add(value);
            return true;
        }
        if (depth >= FULLSCREEN_REPAIR_SCAN_DEPTH || (value as {isObject3D?: boolean}).isObject3D === true) {
            return false;
        }

        let repaired = false;
        try {
            for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
                if (FULLSCREEN_REPAIR_SKIP_KEYS.has(key)) continue;
                repaired = this.repairFullscreenRootsFromValue(nested, camera, seen, depth + 1) || repaired;
            }
        } catch {
            // Script state can include proxies and host objects that reject enumeration.
        }
        return repaired;
    }

    private patchFullscreenUpdate(
        fullscreen: Object3D & {update: (...args: any[]) => void},
        camera: Object3D,
    ): void {
        const record = fullscreen as Object3D & {update: (...args: any[]) => void} & Record<symbol, unknown>;
        if (record[FULLSCREEN_UPDATE_PATCHED_SYMBOL]) return;

        const originalUpdate = fullscreen.update;
        Object.defineProperty(record, FULLSCREEN_UPDATE_PATCHED_SYMBOL, {value: true, configurable: false});
        record.update = function repairedFullscreenUpdate(this: Object3D, ...args: any[]) {
            const updateArgs = normalizeFullscreenUpdateArgs(args);
            if (!isCameraLike(this.parent)) camera.add(this);
            if (!isCameraLike(this.parent)) return undefined;

            try {
                return originalUpdate.apply(this, updateArgs);
            } catch (error) {
                if (!errorMessage(error).toLowerCase().includes(FULLSCREEN_CAMERA_ERROR)) throw error;
                if (!isCameraLike(this.parent)) camera.add(this);
                if (!isCameraLike(this.parent)) return undefined;
                try {
                    return originalUpdate.apply(this, updateArgs);
                } catch (retryError) {
                    if (!errorMessage(retryError).toLowerCase().includes(FULLSCREEN_CAMERA_ERROR)) throw retryError;
                }
            }
            return undefined;
        };
    }

    private shouldRepairFullscreenError(behavior: Behavior, signature: string): boolean {
        const frameCount = this.options.getFrameCount();
        const state = this.options.getFullscreenRepairStates().get(behavior);
        return (
            !state ||
            state.signature !== signature ||
            frameCount - state.lastRepairFrame >= FULLSCREEN_REPAIR_RETRY_FRAMES
        );
    }

    private recordFailure(
        behavior: Behavior,
        signature: string,
    ): {state: BehaviorUpdateErrorLogState; isNewSignature: boolean} {
        const stateMap = this.options.getErrorStates();
        const state = stateMap.get(behavior);
        const frameCount = this.options.getFrameCount();
        if (!state || state.signature !== signature) {
            const nextState: BehaviorUpdateErrorLogState = {
                signature,
                lastLoggedFrame: frameCount,
                suppressedCount: 0,
                consecutiveFailures: 1,
                nextRetryFrame: frameCount,
            };
            stateMap.set(behavior, nextState);
            if (!state) this.options.setBackoffCount(this.options.getBackoffCount() + 1);
            return {state: nextState, isNewSignature: true};
        }

        state.consecutiveFailures += 1;
        state.suppressedCount += 1;
        state.nextRetryFrame = frameCount + this.getBackoffFrames(state.consecutiveFailures);
        return {state, isNewSignature: false};
    }

    private getBackoffFrames(consecutiveFailures: number): number {
        if (consecutiveFailures <= 1) return 0;
        const exponent = Math.min(consecutiveFailures - 2, 5);
        return Math.min(ERROR_BACKOFF_MAX_FRAMES, ERROR_BACKOFF_BASE_FRAMES * (2 ** exponent));
    }
}

const DEFAULT_SAMPLE_CAPACITY = 180;
const DEFAULT_PUBLISH_INTERVAL_MS = 250;
const FRAME_EMA_ALPHA = 0.1;

export type RuntimeFrameSkipReason =
    | "frame-cap"
    | "long-frame-recovery"
    | "script-import"
    | "renderer-unavailable";

export interface RuntimeFrameTelemetrySnapshot {
    readonly sampleCount: number;
    readonly renderedFrames: number;
    readonly skippedFrames: number;
    readonly fpsEma: number;
    readonly frameTimeEmaMs: number;
    readonly renderTimeEmaMs: number;
    readonly frameTimeP95Ms: number;
    readonly frameTimeP99Ms: number;
    readonly lastFrameTimeMs: number;
    readonly lastRenderTimeMs: number;
    readonly lastSimulationFixedSteps: number;
    readonly lastSimulationDroppedSteps: number;
    readonly lastSimulationDroppedTimeMs: number;
    readonly totalSimulationDroppedSteps: number;
    readonly totalSimulationDroppedTimeMs: number;
    readonly skippedByReason: Readonly<Record<RuntimeFrameSkipReason, number>>;
}

type SnapshotListener = (snapshot: RuntimeFrameTelemetrySnapshot) => void;
type PressureListener = (renderTimeEmaMs: number, frameTimeMs: number) => void;

/**
 * Allocation-light telemetry owned by the engine render loop.
 *
 * Frame samples are written into fixed-size typed-array rings. Percentiles and
 * public snapshot objects are produced only at the publication cadence, never
 * for every frame.
 */
export class RuntimeFrameTelemetry {
    private readonly frameTimes: Float32Array;
    private readonly percentileScratch: Float32Array;
    private readonly publishIntervalMs: number;
    private readonly snapshotListeners = new Set<SnapshotListener>();
    private readonly pressureListeners = new Set<PressureListener>();
    private readonly skippedByReason: Record<RuntimeFrameSkipReason, number> = {
        "frame-cap": 0,
        "long-frame-recovery": 0,
        "script-import": 0,
        "renderer-unavailable": 0,
    };

    private sampleCursor = 0;
    private sampleCount = 0;
    private renderedFrames = 0;
    private skippedFrames = 0;
    private lastRenderedAtMs = 0;
    private lastPublishedAtMs = Number.NEGATIVE_INFINITY;
    private fpsEma = 0;
    private frameTimeEmaMs = 0;
    private renderTimeEmaMs = 0;
    private lastFrameTimeMs = 0;
    private lastRenderTimeMs = 0;
    private lastSimulationFixedSteps = 0;
    private lastSimulationDroppedSteps = 0;
    private lastSimulationDroppedTimeMs = 0;
    private totalSimulationDroppedSteps = 0;
    private totalSimulationDroppedTimeMs = 0;
    private snapshot: RuntimeFrameTelemetrySnapshot;

    constructor(
        sampleCapacity = DEFAULT_SAMPLE_CAPACITY,
        publishIntervalMs = DEFAULT_PUBLISH_INTERVAL_MS,
    ) {
        const capacity = Math.max(8, Math.floor(sampleCapacity));
        this.frameTimes = new Float32Array(capacity);
        this.percentileScratch = new Float32Array(capacity);
        this.publishIntervalMs = Math.max(0, publishIntervalMs);
        this.snapshot = this.createSnapshot();
    }

    public recordRenderedFrame(nowMs: number, renderTimeMs: number, frameTimeMs?: number): void {
        const measuredFrameTimeMs = this.resolveFrameTime(nowMs, frameTimeMs);
        this.lastRenderedAtMs = nowMs;
        this.lastFrameTimeMs = measuredFrameTimeMs;
        this.lastRenderTimeMs = Math.max(0, renderTimeMs);
        this.renderedFrames++;

        this.frameTimes[this.sampleCursor] = measuredFrameTimeMs;
        this.sampleCursor = (this.sampleCursor + 1) % this.frameTimes.length;
        this.sampleCount = Math.min(this.sampleCount + 1, this.frameTimes.length);

        this.frameTimeEmaMs = this.updateEma(this.frameTimeEmaMs, measuredFrameTimeMs);
        this.renderTimeEmaMs = this.updateEma(this.renderTimeEmaMs, this.lastRenderTimeMs);
        const instantaneousFps = measuredFrameTimeMs > 0 ? 1000 / measuredFrameTimeMs : 0;
        this.fpsEma = this.updateEma(this.fpsEma, instantaneousFps);

        for (const listener of this.pressureListeners) {
            listener(this.renderTimeEmaMs, measuredFrameTimeMs);
        }
        this.publishIfDue(nowMs);
    }

    public recordSkippedFrame(reason: RuntimeFrameSkipReason, nowMs: number): void {
        this.skippedFrames++;
        this.skippedByReason[reason]++;
        this.publishIfDue(nowMs);
    }

    /**
     * Records the authoritative simulation-clock decision for this render
     * frame. Values are scalars copied into the next cadence snapshot.
     */
    public recordSimulationFrame(
        fixedSteps: number,
        droppedSteps: number,
        droppedTimeSeconds: number,
        totalDroppedSteps: number,
        totalDroppedTimeSeconds: number,
    ): void {
        this.lastSimulationFixedSteps = Math.max(0, Math.floor(fixedSteps));
        this.lastSimulationDroppedSteps = Math.max(0, Math.floor(droppedSteps));
        this.lastSimulationDroppedTimeMs = Math.max(0, droppedTimeSeconds * 1000);
        this.totalSimulationDroppedSteps = Math.max(0, Math.floor(totalDroppedSteps));
        this.totalSimulationDroppedTimeMs = Math.max(0, totalDroppedTimeSeconds * 1000);
    }

    public subscribe(listener: SnapshotListener, emitCurrent = true): () => void {
        this.snapshotListeners.add(listener);
        if (emitCurrent) {
            listener(this.getSnapshot());
        }
        return () => {
            this.snapshotListeners.delete(listener);
        };
    }

    public subscribeToPressure(listener: PressureListener): () => void {
        this.pressureListeners.add(listener);
        return () => {
            this.pressureListeners.delete(listener);
        };
    }

    public getSnapshot(): RuntimeFrameTelemetrySnapshot {
        return this.snapshot;
    }

    public reset(): void {
        this.frameTimes.fill(0);
        this.percentileScratch.fill(0);
        this.sampleCursor = 0;
        this.sampleCount = 0;
        this.renderedFrames = 0;
        this.skippedFrames = 0;
        this.lastRenderedAtMs = 0;
        this.lastPublishedAtMs = Number.NEGATIVE_INFINITY;
        this.fpsEma = 0;
        this.frameTimeEmaMs = 0;
        this.renderTimeEmaMs = 0;
        this.lastFrameTimeMs = 0;
        this.lastRenderTimeMs = 0;
        this.lastSimulationFixedSteps = 0;
        this.lastSimulationDroppedSteps = 0;
        this.lastSimulationDroppedTimeMs = 0;
        this.totalSimulationDroppedSteps = 0;
        this.totalSimulationDroppedTimeMs = 0;
        this.skippedByReason["frame-cap"] = 0;
        this.skippedByReason["long-frame-recovery"] = 0;
        this.skippedByReason["script-import"] = 0;
        this.skippedByReason["renderer-unavailable"] = 0;
        this.snapshot = this.createSnapshot();
    }

    private resolveFrameTime(nowMs: number, reportedFrameTimeMs?: number): number {
        if (Number.isFinite(reportedFrameTimeMs) && reportedFrameTimeMs! > 0) {
            return reportedFrameTimeMs!;
        }
        if (this.lastRenderedAtMs > 0 && nowMs > this.lastRenderedAtMs) {
            return nowMs - this.lastRenderedAtMs;
        }
        return 1000 / 60;
    }

    private updateEma(current: number, sample: number): number {
        return current === 0 ? sample : current + FRAME_EMA_ALPHA * (sample - current);
    }

    private publishIfDue(nowMs: number): void {
        if (nowMs - this.lastPublishedAtMs < this.publishIntervalMs) {
            return;
        }
        this.lastPublishedAtMs = nowMs;
        this.snapshot = this.createSnapshot();
        for (const listener of this.snapshotListeners) {
            listener(this.snapshot);
        }
    }

    private createSnapshot(): RuntimeFrameTelemetrySnapshot {
        const sortedSamples = this.percentileScratch.subarray(0, this.sampleCount);
        for (let i = 0; i < this.sampleCount; i++) {
            sortedSamples[i] = this.frameTimes[i]!;
        }
        sortedSamples.sort();

        return Object.freeze({
            sampleCount: this.sampleCount,
            renderedFrames: this.renderedFrames,
            skippedFrames: this.skippedFrames,
            fpsEma: this.fpsEma,
            frameTimeEmaMs: this.frameTimeEmaMs,
            renderTimeEmaMs: this.renderTimeEmaMs,
            frameTimeP95Ms: this.percentile(sortedSamples, 0.95),
            frameTimeP99Ms: this.percentile(sortedSamples, 0.99),
            lastFrameTimeMs: this.lastFrameTimeMs,
            lastRenderTimeMs: this.lastRenderTimeMs,
            lastSimulationFixedSteps: this.lastSimulationFixedSteps,
            lastSimulationDroppedSteps: this.lastSimulationDroppedSteps,
            lastSimulationDroppedTimeMs: this.lastSimulationDroppedTimeMs,
            totalSimulationDroppedSteps: this.totalSimulationDroppedSteps,
            totalSimulationDroppedTimeMs: this.totalSimulationDroppedTimeMs,
            skippedByReason: Object.freeze({...this.skippedByReason}),
        });
    }

    private percentile(sortedSamples: Float32Array, quantile: number): number {
        if (sortedSamples.length === 0) return 0;
        const index = Math.min(
            sortedSamples.length - 1,
            Math.max(0, Math.ceil(sortedSamples.length * quantile) - 1),
        );
        return sortedSamples[index]!;
    }
}

export const runtimeFrameTelemetry = new RuntimeFrameTelemetry();

declare global {
    var __STEM_RUNTIME_FRAME_TELEMETRY__: (() => RuntimeFrameTelemetrySnapshot) | undefined;
}

/**
 * Installs a read-only diagnostics getter in development builds. Production
 * code and tools consume the typed module API instead of a mutable global.
 */
export function installRuntimeFrameTelemetryDiagnostics(): void {
    if (!import.meta.env.DEV || globalThis.__STEM_RUNTIME_FRAME_TELEMETRY__) return;

    Object.defineProperty(globalThis, "__STEM_RUNTIME_FRAME_TELEMETRY__", {
        configurable: true,
        enumerable: false,
        value: () => runtimeFrameTelemetry.getSnapshot(),
        writable: false,
    });
}

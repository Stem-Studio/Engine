/**
 * Generic per-instance profiler for any system (behaviors, lambdas, etc.).
 * Disabled by default (zero overhead). Enable at runtime:
 *
 *   profiler.enable();
 *   // ... run frames ...
 *   const { totalTimeMs, topSystems } = profiler.getSummary();
 *
 * Replaces the previously duplicated LambdaProfiler and BehaviorProfiler.
 */

import { IdleWorkQueue } from "@stem/editor-oss/lambdas/IdleWorkQueue";

export interface SystemMetrics {
    systemId: string;
    instanceUuid: string;
    executionTimeMs: number;
    avgExecutionTimeMs: number;
    maxExecutionTimeMs: number;
    callCount: number;
    entityCount?: number;
}

export class SystemProfiler {
    private enabled: boolean = false;
    private metrics: Map<string, SystemMetrics> = new Map();
    private currentFrame: Map<string, number> = new Map();
    private idleQueue: IdleWorkQueue | null = null;
    private lastSummary: { totalTimeMs: number; topSystems: SystemMetrics[] } | null = null;

    enable(): void { this.enabled = true; }
    disable(): void { this.enabled = false; }
    isEnabled(): boolean { return this.enabled; }

    beginMeasure(instanceUuid: string): void {
        if (!this.enabled) return;
        this.currentFrame.set(instanceUuid, performance.now());
    }

    endMeasure(instanceUuid: string, systemId: string, entityCount?: number): void {
        if (!this.enabled) return;

        const start = this.currentFrame.get(instanceUuid);
        if (start === undefined) return;
        const elapsed = performance.now() - start;
        this.currentFrame.delete(instanceUuid);

        let m = this.metrics.get(instanceUuid);
        if (!m) {
            m = {
                systemId,
                instanceUuid,
                executionTimeMs: 0,
                avgExecutionTimeMs: 0,
                maxExecutionTimeMs: 0,
                callCount: 0,
            };
            this.metrics.set(instanceUuid, m);
        }

        m.executionTimeMs = elapsed;
        if (entityCount !== undefined) m.entityCount = entityCount;
        m.callCount++;
        m.maxExecutionTimeMs = Math.max(m.maxExecutionTimeMs, elapsed);
        // EMA with alpha 0.1 for smooth average
        m.avgExecutionTimeMs = 0.1 * elapsed + 0.9 * m.avgExecutionTimeMs;
    }

    getMetrics(): SystemMetrics[] {
        return Array.from(this.metrics.values());
    }

    getTopSystems(n: number = 5): SystemMetrics[] {
        const limit = this.normalizeTopLimit(n);
        if (limit <= 0) {
            return [];
        }
        return this.collectSummary(limit).topSystems;
    }

    getSummary(): { totalTimeMs: number; topSystems: SystemMetrics[] } {
        return this.collectSummary(5);
    }

    private collectSummary(limit: number): { totalTimeMs: number; topSystems: SystemMetrics[] } {
        let totalTimeMs = 0;
        const topSystems: SystemMetrics[] = [];

        for (const metric of this.metrics.values()) {
            totalTimeMs += metric.executionTimeMs;
            this.insertTopSystem(topSystems, metric, limit);
        }

        return {totalTimeMs, topSystems};
    }

    private insertTopSystem(topSystems: SystemMetrics[], metric: SystemMetrics, limit: number): void {
        if (limit <= 0) {
            return;
        }

        if (
            topSystems.length === limit &&
            metric.avgExecutionTimeMs <= topSystems[topSystems.length - 1]!.avgExecutionTimeMs
        ) {
            return;
        }

        let insertAt = topSystems.length;
        while (
            insertAt > 0 &&
            metric.avgExecutionTimeMs > topSystems[insertAt - 1]!.avgExecutionTimeMs
        ) {
            insertAt--;
        }

        if (insertAt >= limit) {
            return;
        }

        topSystems.splice(insertAt, 0, metric);
        if (topSystems.length > limit) {
            topSystems.pop();
        }
    }

    private normalizeTopLimit(n: number): number {
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }

    /** Schedule summary computation during idle time. Retrieve via getLastSummary(). */
    deferredSummary(): void {
        if (!this.enabled) return;
        this.getIdleQueue().schedule(() => {
            this.lastSummary = this.getSummary();
        });
    }

    private getIdleQueue(): IdleWorkQueue {
        if (!this.idleQueue) {
            this.idleQueue = new IdleWorkQueue();
        }
        return this.idleQueue;
    }

    /** Returns the most recently computed idle-deferred summary, or null if none yet. */
    getLastSummary(): { totalTimeMs: number; topSystems: SystemMetrics[] } | null {
        return this.lastSummary;
    }

    reset(): void {
        this.metrics.clear();
        this.currentFrame.clear();
        this.lastSummary = null;
    }

    dispose(): void {
        this.idleQueue?.dispose();
        this.idleQueue = null;
        this.reset();
        this.enabled = false;
    }
}

/** Singleton profiler for lambda instances. */
export const lambdaProfiler = new SystemProfiler();

/** Singleton profiler for behavior instances. */
export const behaviorProfiler = new SystemProfiler();

import { EventEmitter } from 'events';

import type { IPerformanceMetrics } from './interfaces/IQualityManager';

/**
 * Lightweight performance metrics collector.
 * No runtime RAF loop — metrics are pushed by external systems.
 */
export class PerformanceMonitor extends EventEmitter {
    private metrics: IPerformanceMetrics = {
        fps: 60,
        frameTime: 16.67,
        cpuTime: 0,
        gpuTime: 0,
        drawCalls: 0,
        triangles: 0,
        textureMemory: 0,
        geometryMemory: 0,
        totalMemory: 0,
    };

    // Scheduler metrics
    private budgetExhaustionCount = 0;
    private budgetCheckCount = 0;

    public dispose(): void {
        this.removeAllListeners();
    }

    public getMetrics(): IPerformanceMetrics {
        return { ...this.metrics };
    }

    public updateDrawCallsAndTriangles(drawCalls: number, triangles: number): void {
        this.metrics.drawCalls = drawCalls;
        this.metrics.triangles = triangles;
    }

    public updateMemoryUsage(textureMemory: number, geometryMemory: number): void {
        this.metrics.textureMemory = textureMemory;
        this.metrics.geometryMemory = geometryMemory;
        this.metrics.totalMemory = textureMemory + geometryMemory;
    }

    /**
     * Report whether the frame budget was exhausted this frame.
     * Called from LambdaManager or other budgeted runtime systems each tick.
     * @param exhausted whether budget was hit
     */
    public recordBudgetStatus(exhausted: boolean): void {
        this.budgetCheckCount++;
        if (exhausted) this.budgetExhaustionCount++;
        // Reset counters every ~5s (300 frames at 60fps) to keep the ratio current
        if (this.budgetCheckCount >= 300) {
            this.budgetExhaustionCount = Math.round(this.budgetExhaustionCount * 0.5);
            this.budgetCheckCount = Math.round(this.budgetCheckCount * 0.5);
        }
    }

    /** Fraction of recent frames where frame budget was exhausted (0–1). */
    public getBudgetExhaustionRate(): number {
        return this.budgetCheckCount > 0 ? this.budgetExhaustionCount / this.budgetCheckCount : 0;
    }
}

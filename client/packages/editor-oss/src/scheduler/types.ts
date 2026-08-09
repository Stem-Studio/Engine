import type { Object3D, Vector3 } from "three";

export interface FrameContext {
    deltaTime: number;
    fixedDeltaTime: number;
    frameCount: number;
    interpolationAlpha: number;
    fixedOverstep: number;
    frameStartTime: number;
    frameDeadline: number;
    underRenderPressure: boolean;
    renderAvgMs: number;
    spatialGrid: ISpatialGrid | null;
    /** True when authoritative fixed stages are active for this frame. */
    fixedUpdatesEnabled: boolean;
    /** Fixed steps executed for this rendered frame by the authoritative simulation clock. */
    fixedStepCount?: number;
    /** Whole simulation steps deliberately discarded by the bounded catch-up policy. */
    droppedFixedSteps?: number;
    /** Wall-clock seconds discarded by delta clamping and bounded catch-up. */
    droppedSimulationTime?: number;
    /** Lifetime discarded wall-clock seconds for the current play session. */
    totalDroppedSimulationTime?: number;
}

/**
 * Live budget check against the shared frame deadline.
 * @param ctx
 */
export function hasBudget(ctx: FrameContext): boolean {
    return performance.now() < ctx.frameDeadline;
}

export interface ISpatialGrid {
    beginFrame?(): void;
    endFrame?(): void;
    update(entityId: string, object: Object3D): void;
    getDistanceSq(entityId: string, point: Vector3): number | null;
    queryRadius(position: Vector3, radius: number, target?: string[]): string[];
    remove(entityId: string): void;
    dispose(): void;
}

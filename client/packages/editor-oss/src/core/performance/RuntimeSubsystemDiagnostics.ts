import type EngineRuntime from "../../EngineRuntime";
import global from "../../global";
import type {RuntimeLodDiagnostics} from "../lod/RuntimeLodController";
import {
    getGpuResourceOwnershipDiagnostics,
    type GpuResourceOwnershipDiagnostics,
} from "../resources/GpuResourceOwnership";
import {
    runtimeFrameTelemetry,
    type RuntimeFrameTelemetrySnapshot,
} from "./RuntimeFrameTelemetry";

export interface RuntimeSubsystemDiagnostics {
    frame: RuntimeFrameTelemetrySnapshot;
    gpuResources: GpuResourceOwnershipDiagnostics;
    lod: RuntimeLodDiagnostics | null;
}

declare global {
    var __STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__:
        | (() => RuntimeSubsystemDiagnostics)
        | undefined;
}

/**
 * Collects subsystem diagnostics only when explicitly requested. Installation
 * does not schedule work, poll the runtime, or walk the scene.
 */
export function getRuntimeSubsystemDiagnostics(
    app: EngineRuntime | null | undefined = global.app,
): RuntimeSubsystemDiagnostics {
    return {
        frame: runtimeFrameTelemetry.getSnapshot(),
        gpuResources: getGpuResourceOwnershipDiagnostics(),
        lod: app?.game?.plotBudgetManager?.getLodDiagnostics() ?? null,
    };
}

/**
 * Exposes diagnostics from the render lifecycle rather than a particular UI.
 * The callback resolves global.app on every read so it follows Edit/Play
 * runtime transitions without reinstalling or retaining a stale runtime.
 */
export function installRuntimeSubsystemDiagnostics(): void {
    if (globalThis.__STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__) return;

    Object.defineProperty(globalThis, "__STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__", {
        configurable: true,
        enumerable: false,
        value: () => getRuntimeSubsystemDiagnostics(),
        writable: false,
    });
}

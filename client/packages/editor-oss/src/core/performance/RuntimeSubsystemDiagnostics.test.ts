import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import global from "../../global";
import {getGpuResourceOwnershipDiagnostics} from "../resources/GpuResourceOwnership";
import {runtimeFrameTelemetry} from "./RuntimeFrameTelemetry";
import {
    getRuntimeSubsystemDiagnostics,
    installRuntimeSubsystemDiagnostics,
} from "./RuntimeSubsystemDiagnostics";

vi.mock("../resources/GpuResourceOwnership", () => ({
    getGpuResourceOwnershipDiagnostics: vi.fn(() => ({
        activeOwners: 0,
        activeResources: 0,
        retainedResourceLinks: 0,
        retainCalls: 0,
        releaseCalls: 0,
        disposedManagedResources: 0,
    })),
}));

const diagnosticsGlobal = globalThis as typeof globalThis & {
    __STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__?: () => unknown;
};

describe("RuntimeSubsystemDiagnostics", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        global.app = null;
        delete diagnosticsGlobal.__STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__;
        vi.restoreAllMocks();
    });

    it("performs no collection until the installed getter is invoked", () => {
        const getLodDiagnostics = vi.fn(() => ({registeredGroups: 1}));
        const getSnapshot = vi.spyOn(runtimeFrameTelemetry, "getSnapshot");
        global.app = {
            game: {
                plotBudgetManager: {getLodDiagnostics},
            },
        } as any;

        installRuntimeSubsystemDiagnostics();

        expect(getSnapshot).not.toHaveBeenCalled();
        expect(getGpuResourceOwnershipDiagnostics).not.toHaveBeenCalled();
        expect(getLodDiagnostics).not.toHaveBeenCalled();

        diagnosticsGlobal.__STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__?.();

        expect(getSnapshot).toHaveBeenCalledTimes(1);
        expect(getGpuResourceOwnershipDiagnostics).toHaveBeenCalledTimes(1);
        expect(getLodDiagnostics).toHaveBeenCalledTimes(1);
    });

    it("resolves the current runtime after a Play-to-Edit lifecycle transition", () => {
        const editLodDiagnostics = vi.fn(() => ({registeredGroups: 1}));
        const playLodDiagnostics = vi.fn(() => ({registeredGroups: 7}));
        global.app = {
            game: {
                plotBudgetManager: {getLodDiagnostics: playLodDiagnostics},
            },
        } as any;
        installRuntimeSubsystemDiagnostics();

        const playDiagnostics = diagnosticsGlobal.__STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__?.() as any;

        global.app = {
            game: {
                plotBudgetManager: {getLodDiagnostics: editLodDiagnostics},
            },
        } as any;
        const editDiagnostics = diagnosticsGlobal.__STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__?.() as any;

        expect(playDiagnostics.lod.registeredGroups).toBe(7);
        expect(editDiagnostics.lod.registeredGroups).toBe(1);
        expect(playLodDiagnostics).toHaveBeenCalledTimes(1);
        expect(editLodDiagnostics).toHaveBeenCalledTimes(1);
    });

    it("returns null LOD diagnostics when no runtime is active", () => {
        expect(getRuntimeSubsystemDiagnostics(null).lod).toBeNull();
    });
});

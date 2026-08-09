import React from "react";
import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import global from "@stem/editor-oss/global";
import {getGpuResourceOwnershipDiagnostics} from "@stem/editor-oss/core/resources/GpuResourceOwnership";
import {PerformanceOverlay} from "./PerformanceOverlay";

vi.mock("@stem/editor-oss/core/resources/GpuResourceOwnership", () => ({
    getGpuResourceOwnershipDiagnostics: vi.fn(() => ({
        activeOwners: 0,
        activeResources: 0,
        retainedResourceLinks: 0,
        retainCalls: 0,
        releaseCalls: 0,
        disposedManagedResources: 0,
    })),
}));

describe("PerformanceOverlay polling", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        localStorage.clear();
        delete globalThis.__STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__;
    });

    afterEach(() => {
        cleanup();
        global.app = null;
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("does not poll behavior metrics or traverse the scene while mounted hidden", () => {
        const getPerformanceMetrics = vi.fn(() => ({
            totalChecks: 0,
            culledCount: 0,
            throttledCount: 0,
            runTimeMs: 0,
            cullingEfficiency: 0,
            throttlingEfficiency: 0,
        }));
        const updateThrottlingConfig = vi.fn();
        const traverse = vi.fn();
        const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
        const requestAnimationFrameSpy = vi.spyOn(globalThis, "requestAnimationFrame");
        global.app = {
            game: {
                behaviorManager: {
                    getPerformanceMetrics,
                    updateThrottlingConfig,
                },
            },
            editor: {
                scene: {traverse},
            },
        } as any;

        render(<PerformanceOverlay />);
        act(() => {
            vi.advanceTimersByTime(5_000);
        });

        expect(getPerformanceMetrics).not.toHaveBeenCalled();
        expect(updateThrottlingConfig).not.toHaveBeenCalled();
        expect(getGpuResourceOwnershipDiagnostics).not.toHaveBeenCalled();
        expect(traverse).not.toHaveBeenCalled();
        expect(setIntervalSpy).not.toHaveBeenCalled();
        expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
    });

    it("polls behavior, LOD, and GPU diagnostics only while visible", () => {
        localStorage.setItem("performanceOverlayVisible", "true");
        const getPerformanceMetrics = vi.fn(() => ({
            totalChecks: 12,
            culledCount: 3,
            throttledCount: 4,
            runTimeMs: 0.5,
            cullingEfficiency: 25,
            throttlingEfficiency: 33,
        }));
        const updateThrottlingConfig = vi.fn();
        const getLodDiagnostics = vi.fn(() => ({
            registeredGroups: 7,
            enabledGroups: 6,
            currentTierCounts: [3, 2, 1],
            pendingTransitions: 2,
            appliedTransitions: 9,
            skippedTransitions: 0,
            residencyBlockedTransitions: 1,
            missingInputGroups: 0,
            disabledGroups: 1,
            lastUpdateCostMs: 0.25,
            lastUpdateSerial: 10,
        }));
        global.app = {
            game: {
                behaviorManager: {
                    getPerformanceMetrics,
                    updateThrottlingConfig,
                },
                plotBudgetManager: {getLodDiagnostics},
            },
        } as any;

        const view = render(<PerformanceOverlay />);

        expect(getPerformanceMetrics).toHaveBeenCalledTimes(1);
        expect(getLodDiagnostics).toHaveBeenCalledTimes(1);
        expect(getGpuResourceOwnershipDiagnostics).toHaveBeenCalledTimes(1);
        expect(view.getByTestId("simulation-diagnostics")).toBeTruthy();
        expect(view.getByTestId("lod-diagnostics").textContent).toContain("7");
        expect(view.getByTestId("gpu-resource-diagnostics")).toBeTruthy();

        act(() => {
            vi.advanceTimersByTime(2_000);
        });

        expect(getPerformanceMetrics).toHaveBeenCalledTimes(3);
        expect(getLodDiagnostics).toHaveBeenCalledTimes(3);
        expect(getGpuResourceOwnershipDiagnostics).toHaveBeenCalledTimes(3);

        act(() => {
            view.getByRole("button", {name: "×"}).click();
        });
        act(() => {
            vi.advanceTimersByTime(2_000);
        });

        expect(getPerformanceMetrics).toHaveBeenCalledTimes(3);
        expect(getLodDiagnostics).toHaveBeenCalledTimes(3);
        expect(getGpuResourceOwnershipDiagnostics).toHaveBeenCalledTimes(3);
    });

    it("exposes renderer counters and effective draw-buffer size in the visible overlay", () => {
        localStorage.setItem("performanceOverlayVisible", "true");
        global.app = {
            renderer: {
                info: {
                    autoReset: false,
                    render: {calls: 7, triangles: 12345},
                    memory: {geometries: 18, textures: 9},
                },
                getPixelRatio: () => 0.75,
                domElement: {width: 672, height: 293},
            },
            lastRendererFrameInfo: {calls: 3, triangles: 456},
            game: {
                behaviorManager: {
                    getPerformanceMetrics: () => ({
                        totalChecks: 1,
                        culledCount: 0,
                        throttledCount: 0,
                        runTimeMs: 0,
                        cullingEfficiency: 0,
                        throttlingEfficiency: 0,
                    }),
                    updateThrottlingConfig: vi.fn(),
                },
            },
        } as unknown as typeof global.app;

        const view = render(<PerformanceOverlay />);

        expect(view.getByTestId("renderer-diagnostics").textContent).toContain("12,345");
        expect(view.getByTestId("renderer-diagnostics").textContent).toContain("456");
        expect(view.getByTestId("renderer-diagnostics").textContent).toContain("672×293");
        expect(view.getByTestId("renderer-diagnostics").textContent).toContain("0.75");
    });

    it("does not install diagnostics as a UI module side effect", () => {
        render(<PerformanceOverlay />);

        expect(globalThis.__STEM_RUNTIME_SUBSYSTEM_DIAGNOSTICS__).toBeUndefined();
    });
});

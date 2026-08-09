import {describe, expect, it} from "vitest";

import {
    RuntimeBudgetCoordinator,
    type RuntimeBudgetSnapshot,
} from "./RuntimeBudgetCoordinator";
import type {IQualitySettings} from "../quality/interfaces/IQualityManager";

const MB = 1024 * 1024;

function textureManager(residentMb: number, totalMb = residentMb) {
    return {
        getStats: () => ({
            textureBytes: totalMb * MB,
            textureCount: 4,
            residentTextureBytes: residentMb * MB,
            residentTextureCount: 4,
            materialCount: 2,
            sharedMaterialCount: 0,
        }),
    };
}

describe("RuntimeBudgetCoordinator", () => {
    it("computes normal, warning, and critical pressure from resident texture bytes", () => {
        const coordinator = new RuntimeBudgetCoordinator({
            isMobile: true,
            managedTextureTargetBytes: 100 * MB,
            warningRatio: 0.8,
            criticalRatio: 1,
            recoveryRatio: 0.6,
        });

        expect(update(coordinator, 50).pressure).toBe("normal");
        expect(update(coordinator, 85).pressure).toBe("warning");
        expect(update(coordinator, 110).pressure).toBe("critical");

        // Critical pressure holds until below the warning threshold.
        expect(update(coordinator, 82).pressure).toBe("critical");
        expect(update(coordinator, 65).pressure).toBe("warning");
        expect(update(coordinator, 50).pressure).toBe("normal");
    });

    it("exposes pressure overrides for avatar, plot, and texture policies", () => {
        const coordinator = new RuntimeBudgetCoordinator({
            isMobile: true,
            managedTextureTargetBytes: 64 * MB,
            warningRatio: 0.8,
            criticalRatio: 1,
        });

        update(coordinator, 80);

        expect(coordinator.getAvatarBudgetOverrides()).toMatchObject({
            runtimePressure: "critical",
            runtimeDistanceScale: 0.65,
            runtimeUpdateRateScale: 0.65,
        });
        expect(coordinator.getPlotBudgetOverrides()).toMatchObject({
            runtimePressure: "critical",
            runtimeDistanceScale: 0.65,
            runtimeLodDistanceScale: 0.65,
        });
        expect(coordinator.getTextureResidencyOverrides()).toMatchObject({
            runtimePressure: "critical",
            maxResidentTextureBytes: 64 * MB,
            batchSize: 16,
            ownershipRefreshInterval: 4,
            evictGhostAvatarsUnderPressure: true,
            evictFarPlotsUnderPressure: true,
        });
    });

    it("derives managed texture targets from quality settings", () => {
        const coordinator = new RuntimeBudgetCoordinator();
        coordinator.configureFromQuality({
            runtimeBudget: {
                mobileManagedTextureTargetMB: 72,
                warningRatio: 0.7,
                criticalRatio: 0.9,
            },
        } as IQualitySettings, {isMobile: true});

        const snapshot = coordinator.update({textureResidencyManager: textureManager(68)});

        expect(snapshot.targetTextureBytes).toBe(72 * MB);
        expect(snapshot.pressure).toBe("critical");
        expect(snapshot.reason).toBe("managed-texture-critical");
    });

    it("keeps update defensively copied while frame updates reuse the stored snapshot", () => {
        const mutableStats = {
            textureBytes: 80 * MB,
            textureCount: 4,
            residentTextureBytes: 80 * MB,
            residentTextureCount: 4,
            materialCount: 2,
            sharedMaterialCount: 0,
        };
        const manager = {
            getStats: () => ({...mutableStats}),
            getStatsForFrame: () => mutableStats,
        };
        const coordinator = new RuntimeBudgetCoordinator({
            managedTextureTargetBytes: 100 * MB,
            warningRatio: 0.8,
        });

        const publicSnapshot = coordinator.update({textureResidencyManager: manager});
        publicSnapshot.textureStats!.textureBytes = 1;
        expect(coordinator.getSnapshot().textureStats!.textureBytes).toBe(80 * MB);

        const firstFrameSnapshot = coordinator.updateForFrame({textureResidencyManager: manager});
        mutableStats.residentTextureBytes = 90 * MB;
        const secondFrameSnapshot = coordinator.updateForFrame({textureResidencyManager: manager});

        expect(secondFrameSnapshot).toBe(firstFrameSnapshot);
        expect(secondFrameSnapshot.managedTextureBytes).toBe(90 * MB);
        expect(secondFrameSnapshot.textureStats).toBe(mutableStats);
    });
});

function update(coordinator: RuntimeBudgetCoordinator, residentMb: number): RuntimeBudgetSnapshot {
    return coordinator.update({textureResidencyManager: textureManager(residentMb)});
}

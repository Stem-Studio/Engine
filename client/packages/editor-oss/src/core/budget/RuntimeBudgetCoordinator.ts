import {DetectDevice} from "@stem/editor-oss/utils/DetectDevice";
import type {AvatarBudgetPolicyOptions} from "./AvatarBudgetPolicy";
import type {PlotBudgetPolicyOptions} from "./PlotBudgetPolicy";
import type {
    TextureResidencyOptions,
    TextureResidencyStats,
} from "./TextureResidencyPolicy";
import type {IQualitySettings} from "../quality/interfaces/IQualityManager";

export type RuntimeBudgetPressure = "normal" | "warning" | "critical";

export interface RuntimeBudgetOptions {
    enabled?: boolean;
    isMobile?: boolean;
    managedTextureTargetBytes?: number;
    warningRatio?: number;
    criticalRatio?: number;
    recoveryRatio?: number;
    warningDistanceScale?: number;
    criticalDistanceScale?: number;
    warningLodDistanceScale?: number;
    criticalLodDistanceScale?: number;
    warningUpdateRateScale?: number;
    criticalUpdateRateScale?: number;
}

export interface RuntimeBudgetUpdateOptions {
    underRenderPressure?: boolean;
    now?: number;
}

export interface RuntimeBudgetTextureStatsProvider {
    getStats(): TextureResidencyStats;
    getStatsForFrame?(): TextureResidencyStats;
}

export interface RuntimeBudgetManagers {
    textureResidencyManager?: RuntimeBudgetTextureStatsProvider;
}

export interface RuntimeBudgetSnapshot {
    enabled: boolean;
    pressure: RuntimeBudgetPressure;
    managedTextureBytes: number;
    totalManagedTextureBytes: number;
    targetTextureBytes: number;
    usageRatio: number;
    reason: string;
    updatedAt: number;
    framesInPressure: number;
    isMobile: boolean;
    textureStats?: TextureResidencyStats;
}

const MB = 1024 * 1024;

const DEFAULT_SNAPSHOT: RuntimeBudgetSnapshot = {
    enabled: true,
    pressure: "normal",
    managedTextureBytes: 0,
    totalManagedTextureBytes: 0,
    targetTextureBytes: 96 * MB,
    usageRatio: 0,
    reason: "not-updated",
    updatedAt: 0,
    framesInPressure: 0,
    isMobile: false,
};

/**
 * Coordinates runtime memory pressure without duplicating the budget policies.
 * Quality settings define the target; the active runtime loop updates this once per frame;
 * avatar/plot/texture policies consume the current pressure as overrides.
 */
export class RuntimeBudgetCoordinator {
    private options: Required<RuntimeBudgetOptions>;
    private configuredOverrides: RuntimeBudgetOptions;
    private snapshot: RuntimeBudgetSnapshot = {...DEFAULT_SNAPSHOT};

    constructor(options: RuntimeBudgetOptions = {}) {
        this.configuredOverrides = {...options};
        this.options = RuntimeBudgetCoordinator.resolveOptions(undefined, options);
        this.snapshot = {
            ...DEFAULT_SNAPSHOT,
            enabled: this.options.enabled,
            targetTextureBytes: this.options.managedTextureTargetBytes,
            isMobile: this.options.isMobile,
        };
    }

    configure(options: RuntimeBudgetOptions = {}): void {
        this.configuredOverrides = {...this.configuredOverrides, ...options};
        this.options = RuntimeBudgetCoordinator.resolveOptions(undefined, this.configuredOverrides);
    }

    configureFromQuality(settings: IQualitySettings | null | undefined, overrides: RuntimeBudgetOptions = {}): void {
        this.options = RuntimeBudgetCoordinator.resolveOptions(settings, {...this.configuredOverrides, ...overrides});
    }

    static resolveOptions(
        settings: IQualitySettings | null | undefined,
        overrides: RuntimeBudgetOptions = {},
    ): Required<RuntimeBudgetOptions> {
        const budgetSettings = settings?.runtimeBudget;
        const isMobile = overrides.isMobile ?? DetectDevice.isMobile();
        const configuredTargetMb =
            budgetSettings?.managedTextureTargetMB ??
            (isMobile ? budgetSettings?.mobileManagedTextureTargetMB : budgetSettings?.desktopManagedTextureTargetMB);
        const defaultTargetMb = isMobile ? 96 : 384;

        return {
            enabled: overrides.enabled ?? budgetSettings?.enabled ?? true,
            isMobile,
            managedTextureTargetBytes:
                overrides.managedTextureTargetBytes ??
                Math.max(1, configuredTargetMb ?? defaultTargetMb) * MB,
            warningRatio: overrides.warningRatio ?? budgetSettings?.warningRatio ?? 0.85,
            criticalRatio: overrides.criticalRatio ?? budgetSettings?.criticalRatio ?? 1,
            recoveryRatio: overrides.recoveryRatio ?? budgetSettings?.recoveryRatio ?? 0.72,
            warningDistanceScale: overrides.warningDistanceScale ?? 0.85,
            criticalDistanceScale: overrides.criticalDistanceScale ?? 0.65,
            warningLodDistanceScale: overrides.warningLodDistanceScale ?? 0.85,
            criticalLodDistanceScale: overrides.criticalLodDistanceScale ?? 0.65,
            warningUpdateRateScale: overrides.warningUpdateRateScale ?? 0.85,
            criticalUpdateRateScale: overrides.criticalUpdateRateScale ?? 0.65,
        };
    }

    update(
        managers: RuntimeBudgetManagers,
        updateOptions: RuntimeBudgetUpdateOptions = {},
    ): RuntimeBudgetSnapshot {
        this.updateSnapshot(managers, updateOptions);
        return this.getSnapshot();
    }

    updateForFrame(
        managers: RuntimeBudgetManagers,
        updateOptions: RuntimeBudgetUpdateOptions = {},
    ): Readonly<RuntimeBudgetSnapshot> {
        return this.updateSnapshot(managers, updateOptions);
    }

    private updateSnapshot(
        managers: RuntimeBudgetManagers,
        updateOptions: RuntimeBudgetUpdateOptions,
    ): RuntimeBudgetSnapshot {
        const textureStats = managers.textureResidencyManager?.getStatsForFrame?.() ??
            managers.textureResidencyManager?.getStats();
        const managedTextureBytes = textureStats?.residentTextureBytes ?? textureStats?.textureBytes ?? 0;
        const totalManagedTextureBytes = textureStats?.textureBytes ?? managedTextureBytes;
        const targetTextureBytes = this.options.managedTextureTargetBytes;
        const usageRatio = targetTextureBytes > 0 ? managedTextureBytes / targetTextureBytes : 0;
        const previousPressure = this.snapshot.pressure;
        const nextPressure = this.options.enabled
            ? this.computePressure(usageRatio, previousPressure, updateOptions.underRenderPressure === true)
            : "normal";
        const framesInPressure = nextPressure === previousPressure ? this.snapshot.framesInPressure + 1 : 0;

        const snapshot = this.snapshot;
        snapshot.enabled = this.options.enabled;
        snapshot.pressure = nextPressure;
        snapshot.managedTextureBytes = managedTextureBytes;
        snapshot.totalManagedTextureBytes = totalManagedTextureBytes;
        snapshot.targetTextureBytes = targetTextureBytes;
        snapshot.usageRatio = usageRatio;
        snapshot.reason = this.getReason(nextPressure, usageRatio, updateOptions.underRenderPressure === true);
        snapshot.updatedAt = updateOptions.now ?? Date.now();
        snapshot.framesInPressure = framesInPressure;
        snapshot.isMobile = this.options.isMobile;
        snapshot.textureStats = textureStats;
        return snapshot;
    }

    getSnapshot(): RuntimeBudgetSnapshot {
        return {
            ...this.snapshot,
            textureStats: this.snapshot.textureStats ? {...this.snapshot.textureStats} : undefined,
        };
    }

    getAvatarBudgetOverrides(): AvatarBudgetPolicyOptions {
        if (!this.options.enabled) return {};
        const pressure = this.snapshot.pressure;
        return {
            runtimePressure: pressure,
            runtimeDistanceScale: this.getDistanceScale(pressure),
            runtimeUpdateRateScale: this.getUpdateRateScale(pressure),
        };
    }

    getPlotBudgetOverrides(): PlotBudgetPolicyOptions {
        if (!this.options.enabled) return {};
        const pressure = this.snapshot.pressure;
        return {
            runtimePressure: pressure,
            runtimeDistanceScale: this.getDistanceScale(pressure),
            runtimeLodDistanceScale: this.getLodDistanceScale(pressure),
        };
    }

    getTextureResidencyOverrides(): TextureResidencyOptions {
        if (!this.options.enabled) return {};
        const pressure = this.snapshot.pressure;
        const underPressure = pressure !== "normal";

        return {
            maxResidentTextureBytes: this.options.managedTextureTargetBytes,
            runtimePressure: pressure,
            batchSize: pressure === "critical"
                ? (this.options.isMobile ? 16 : 48)
                : pressure === "warning"
                    ? (this.options.isMobile ? 10 : 30)
                    : undefined,
            ownershipRefreshInterval: pressure === "critical"
                ? 4
                : pressure === "warning"
                    ? 8
                    : undefined,
            disposeReducedTextures: underPressure || this.options.isMobile,
            evictGhostAvatarsUnderPressure: pressure === "critical",
            evictFarPlotsUnderPressure: pressure === "critical",
        };
    }

    private computePressure(
        usageRatio: number,
        previousPressure: RuntimeBudgetPressure,
        underRenderPressure: boolean,
    ): RuntimeBudgetPressure {
        const criticalRatio = this.options.criticalRatio;
        const warningRatio = this.options.warningRatio;
        const recoveryRatio = this.options.recoveryRatio;
        const renderPressureWarningRatio = warningRatio * 0.9;

        if (usageRatio >= criticalRatio) return "critical";
        if (previousPressure === "critical" && usageRatio >= warningRatio) return "critical";
        if (previousPressure === "critical" && usageRatio >= recoveryRatio) return "warning";
        if (usageRatio >= warningRatio) return "warning";
        if (underRenderPressure && usageRatio >= renderPressureWarningRatio) return "warning";
        if (previousPressure === "warning" && usageRatio >= recoveryRatio) return "warning";
        return "normal";
    }

    private getReason(
        pressure: RuntimeBudgetPressure,
        usageRatio: number,
        underRenderPressure: boolean,
    ): string {
        if (!this.options.enabled) return "disabled";
        if (pressure === "critical") return "managed-texture-critical";
        if (pressure === "warning" && underRenderPressure) return "managed-texture-render-pressure";
        if (pressure === "warning") return "managed-texture-warning";
        return usageRatio > 0 ? "within-managed-texture-target" : "no-managed-textures";
    }

    private getDistanceScale(pressure: RuntimeBudgetPressure): number {
        if (pressure === "critical") return this.options.criticalDistanceScale;
        if (pressure === "warning") return this.options.warningDistanceScale;
        return 1;
    }

    private getLodDistanceScale(pressure: RuntimeBudgetPressure): number {
        if (pressure === "critical") return this.options.criticalLodDistanceScale;
        if (pressure === "warning") return this.options.warningLodDistanceScale;
        return 1;
    }

    private getUpdateRateScale(pressure: RuntimeBudgetPressure): number {
        if (pressure === "critical") return this.options.criticalUpdateRateScale;
        if (pressure === "warning") return this.options.warningUpdateRateScale;
        return 1;
    }
}

export function configureRuntimeBudgetCoordinatorFromEngine(
    coordinator: RuntimeBudgetCoordinator,
    engine: unknown,
): void {
    const qualityManager = (engine as {qualityManager?: {getCurrentSettings?: () => IQualitySettings}} | null | undefined)
        ?.qualityManager;
    coordinator.configureFromQuality(qualityManager?.getCurrentSettings?.());
}

export function getRuntimeBudgetCoordinatorFromEngine(engine: unknown): RuntimeBudgetCoordinator | undefined {
    return (engine as {game?: {runtimeBudgetCoordinator?: RuntimeBudgetCoordinator}} | null | undefined)
        ?.game
        ?.runtimeBudgetCoordinator;
}

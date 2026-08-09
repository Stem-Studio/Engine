import type * as THREE from "three";

import {traverseObjectDepthFirst} from "../../utils/SceneTraverser";
import {
    getAvatarBudgetMetadata,
    type AvatarBudgetState,
    type AvatarBudgetStats,
} from "./AvatarBudgetPolicy";
import {
    getPlotBudgetMetadata,
    type PlotBudgetState,
    type PlotBudgetStats,
} from "./PlotBudgetPolicy";
import type {RuntimeBudgetSnapshot} from "./RuntimeBudgetCoordinator";
import {
    getTextureResidencyMetadata,
    type TextureResidencyState,
    type TextureResidencyStats,
} from "./TextureResidencyPolicy";

export interface BudgetInspectorManagerStats {
    plotRegisteredCount?: number;
    textureRegisteredCount?: number;
    textureManagerStats?: TextureResidencyStats;
}

export interface BudgetInspectorManagers {
    plotBudgetManager?: {getRegisteredCount(): number};
    textureResidencyManager?: {getRegisteredCount(): number; getStats(): TextureResidencyStats};
    runtimeBudgetCoordinator?: {getSnapshot(): RuntimeBudgetSnapshot};
}

export type BudgetAdvisorSeverity = "warning" | "critical";
export type BudgetAdvisorScope = "avatar" | "plot";
export type BudgetAdvisorMetric = "textureBytes" | "textureDimension" | "triangles" | "drawCalls" | "bones";

export interface BudgetAdvisorWarning {
    id: string;
    objectUuid: string;
    objectName: string;
    objectPath: string;
    scope: BudgetAdvisorScope;
    severity: BudgetAdvisorSeverity;
    metric: BudgetAdvisorMetric;
    message: string;
    value: number;
    limit: number;
    unit: "bytes" | "count" | "pixels";
}

export interface BudgetAdvisorSnapshot {
    enabled: true;
    allowed: boolean;
    blockedReason?: string;
    warningCount: number;
    criticalCount: number;
    warnings: BudgetAdvisorWarning[];
}

export interface BudgetInspectorCountSet<TState extends string> {
    total: number;
    states: Record<TState, number>;
    textureBytes: number;
    textureCount: number;
    residentTextureBytes?: number;
    residentTextureCount?: number;
    triangles: number;
    drawCalls: number;
}

export interface BudgetInspectorAvatarSummary extends BudgetInspectorCountSet<AvatarBudgetState> {
    local: number;
    remote: number;
}

export interface BudgetInspectorRow {
    uuid: string;
    name: string;
    path: string;
    object: THREE.Object3D;
    avatarState?: AvatarBudgetState;
    avatarRole?: string;
    avatarReason?: string;
    plotState?: PlotBudgetState;
    plotReason?: string;
    textureState?: TextureResidencyState;
    textureReason?: string;
    textureSource?: string;
    textureBytes: number;
    textureCount: number;
    triangles: number;
    drawCalls: number;
    maxTextureDimension?: number;
    maxTextureName?: string;
    advisorWarnings?: BudgetAdvisorWarning[];
    advisorSeverity?: BudgetAdvisorSeverity;
}

export interface BudgetInspectionSnapshot {
    generatedAt: number;
    managers: BudgetInspectorManagerStats;
    runtimeBudget?: RuntimeBudgetSnapshot;
    advisor?: BudgetAdvisorSnapshot;
    avatar: BudgetInspectorAvatarSummary;
    plot: BudgetInspectorCountSet<PlotBudgetState>;
    texture: BudgetInspectorCountSet<TextureResidencyState>;
    rows: BudgetInspectorRow[];
}

export interface BudgetInspectionOptions {
    maxRows?: number;
    maxAdvisorWarnings?: number;
    enableAdvisor?: boolean;
    allowAdvisor?: boolean;
    advisorBlockedReason?: string;
    now?: number;
}

export interface BudgetInspectionLogger {
    groupCollapsed?(message?: unknown, ...optionalParams: unknown[]): void;
    groupEnd?(): void;
    table?(tabularData?: unknown, properties?: string[]): void;
    info?(message?: unknown, ...optionalParams: unknown[]): void;
}

const EMPTY_AVATAR_STATES: Record<AvatarBudgetState, number> = {
    full: 0,
    ghost: 0,
    culled: 0,
};

const EMPTY_PLOT_STATES: Record<PlotBudgetState, number> = {
    near: 0,
    mid: 0,
    far: 0,
    culled: 0,
};

const EMPTY_TEXTURE_STATES: Record<TextureResidencyState, number> = {
    resident: 0,
    reduced: 0,
    evicted: 0,
};

type AdvisorTextureSlot =
    | "alphaMap"
    | "aoMap"
    | "bumpMap"
    | "clearcoatMap"
    | "clearcoatNormalMap"
    | "clearcoatRoughnessMap"
    | "displacementMap"
    | "emissiveMap"
    | "envMap"
    | "iridescenceMap"
    | "iridescenceThicknessMap"
    | "lightMap"
    | "map"
    | "metalnessMap"
    | "normalMap"
    | "roughnessMap"
    | "sheenColorMap"
    | "sheenRoughnessMap"
    | "specularColorMap"
    | "specularIntensityMap"
    | "specularMap"
    | "thicknessMap"
    | "transmissionMap";

type AdvisorTextureMaterial = THREE.Material & Partial<Record<AdvisorTextureSlot, THREE.Texture | null>>;

const ADVISOR_TEXTURE_SLOTS: AdvisorTextureSlot[] = [
    "alphaMap",
    "aoMap",
    "bumpMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "iridescenceMap",
    "iridescenceThicknessMap",
    "lightMap",
    "map",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
    "sheenColorMap",
    "sheenRoughnessMap",
    "specularColorMap",
    "specularIntensityMap",
    "specularMap",
    "thicknessMap",
    "transmissionMap",
];

const MB = 1024 * 1024;
const DEFAULT_ADVISOR_WARNING_LIMIT = 12;

const ADVISOR_LIMITS = {
    avatar: {
        textureBytes: {warning: 32 * MB, critical: 64 * MB},
        textureDimension: {warning: 1024, critical: 2048},
        triangles: {warning: 12000, critical: 30000},
        drawCalls: {warning: 4, critical: 12},
        bones: {warning: 100, critical: 140},
    },
    plot: {
        textureBytes: {warning: 48 * MB, critical: 96 * MB},
        textureDimension: {warning: 1024, critical: 2048},
        triangles: {warning: 30000, critical: 120000},
        drawCalls: {warning: 24, critical: 80},
    },
} satisfies Record<BudgetAdvisorScope, Record<string, {warning: number; critical: number}>>;

export function collectBudgetInspection(
    scene: THREE.Object3D | null | undefined,
    managers: BudgetInspectorManagers = {},
    options: BudgetInspectionOptions = {},
): BudgetInspectionSnapshot {
    const snapshot = createEmptySnapshot(managers, options.now ?? Date.now());
    const advisor = createAdvisorSnapshot(options);
    if (advisor) snapshot.advisor = advisor;
    const advisorActive = advisor?.allowed === true;
    if (!scene) {
        finalizeAdvisor(snapshot.advisor, options.maxAdvisorWarnings);
        return snapshot;
    }

    traverseObjectDepthFirst(scene, object => {
        const avatar = getAvatarBudgetMetadata(object);
        const plot = getPlotBudgetMetadata(object);
        const texture = getTextureResidencyMetadata(object);
        const hasAvatar = avatar?.enabled === true;
        const hasPlot = plot?.enabled === true;
        const hasTexture = texture?.enabled === true;
        if (!hasAvatar && !hasPlot && !hasTexture) return;

        let rowStats = emptyRowStats();
        const textureDimensions = advisorActive && (hasAvatar || hasPlot) ? collectMaxTextureDimension(object) : undefined;

        if (hasAvatar) {
            const state = getAvatarState(avatar.lastState ?? object.userData.avatarBudgetState);
            snapshot.avatar.total++;
            snapshot.avatar.states[state]++;
            if (avatar.isLocal) snapshot.avatar.local++;
            else snapshot.avatar.remote++;
            addAvatarStats(snapshot.avatar, avatar.stats);
            rowStats = maxRowStats(rowStats, statsToRowStats(avatar.stats));
        }

        if (hasPlot) {
            const state = getPlotState(plot.state ?? object.userData.plotBudgetState);
            snapshot.plot.total++;
            snapshot.plot.states[state]++;
            addPlotStats(snapshot.plot, plot.stats);
            rowStats = maxRowStats(rowStats, statsToRowStats(plot.stats));
        }

        if (hasTexture) {
            const state = getTextureState(texture.state ?? object.userData.textureResidencyState);
            snapshot.texture.total++;
            snapshot.texture.states[state]++;
            addTextureStats(snapshot.texture, texture.stats);
            rowStats = maxRowStats(rowStats, statsToRowStats(texture.stats));
        }

        const row: BudgetInspectorRow = {
            uuid: object.uuid,
            name: object.name || object.type || object.uuid.slice(0, 8),
            path: getObjectPath(object),
            object,
            avatarState: hasAvatar ? getAvatarState(avatar.lastState ?? object.userData.avatarBudgetState) : undefined,
            avatarRole: hasAvatar ? avatar.role ?? (avatar.isLocal ? "local" : "remote") : undefined,
            avatarReason: hasAvatar ? avatar.lastDecision?.reason : undefined,
            plotState: hasPlot ? getPlotState(plot.state ?? object.userData.plotBudgetState) : undefined,
            plotReason: hasPlot ? plot.lastDecision?.reason : undefined,
            textureState: hasTexture ? getTextureState(texture.state ?? object.userData.textureResidencyState) : undefined,
            textureReason: hasTexture ? texture.lastDecision?.reason : undefined,
            textureSource: hasTexture ? texture.lastDecision?.source : undefined,
            ...rowStats,
            maxTextureDimension: textureDimensions && textureDimensions.maxDimension > 0 ? textureDimensions.maxDimension : undefined,
            maxTextureName: textureDimensions?.textureName,
        };

        if (advisorActive && snapshot.advisor) {
            const warnings = collectAdvisorWarnings(row, {
                avatar: hasAvatar ? avatar : undefined,
                plot: hasPlot ? plot : undefined,
            });
            row.advisorWarnings = warnings.length > 0 ? warnings : undefined;
            row.advisorSeverity = getWorstAdvisorSeverity(warnings);
            snapshot.advisor.warnings.push(...warnings);
        }

        snapshot.rows.push(row);
    });

    snapshot.rows.sort((a, b) => {
        if (b.textureBytes !== a.textureBytes) return b.textureBytes - a.textureBytes;
        if (b.triangles !== a.triangles) return b.triangles - a.triangles;
        return a.name.localeCompare(b.name);
    });
    snapshot.rows = snapshot.rows.slice(0, Math.max(1, options.maxRows ?? 12));
    finalizeAdvisor(snapshot.advisor, options.maxAdvisorWarnings);
    return snapshot;
}

export function logBudgetInspection(
    snapshot: BudgetInspectionSnapshot,
    logger: BudgetInspectionLogger = console,
): void {
    const pressure = snapshot.runtimeBudget?.pressure;
    const advisorTitle = snapshot.advisor
        ? snapshot.advisor.allowed
            ? ` advisor=${snapshot.advisor.criticalCount}c/${snapshot.advisor.warningCount}w`
            : ` advisor=blocked:${snapshot.advisor.blockedReason ?? "not-allowed"}`
        : "";
    const title =
        `[BudgetInspector] avatars=${snapshot.avatar.total} plots=${snapshot.plot.total} textures=${snapshot.texture.total}` +
        (pressure ? ` pressure=${pressure}` : "") +
        advisorTitle;
    logger.groupCollapsed?.(title);
    logger.info?.("Summary", {
        generatedAt: new Date(snapshot.generatedAt).toISOString(),
        managers: snapshot.managers,
        avatar: {
            total: snapshot.avatar.total,
            states: snapshot.avatar.states,
            local: snapshot.avatar.local,
            remote: snapshot.avatar.remote,
            textureMB: bytesToMb(snapshot.avatar.textureBytes),
            triangles: snapshot.avatar.triangles,
            drawCalls: snapshot.avatar.drawCalls,
        },
        plot: {
            total: snapshot.plot.total,
            states: snapshot.plot.states,
            textureMB: bytesToMb(snapshot.plot.textureBytes),
            triangles: snapshot.plot.triangles,
            drawCalls: snapshot.plot.drawCalls,
        },
        texture: {
            total: snapshot.texture.total,
            states: snapshot.texture.states,
            textureMB: bytesToMb(snapshot.texture.textureBytes),
            residentTextureMB: bytesToMb(snapshot.texture.residentTextureBytes ?? snapshot.texture.textureBytes),
        },
        runtimeBudget: snapshot.runtimeBudget ? {
            pressure: snapshot.runtimeBudget.pressure,
            reason: snapshot.runtimeBudget.reason,
            residentTextureMB: bytesToMb(snapshot.runtimeBudget.managedTextureBytes),
            targetTextureMB: bytesToMb(snapshot.runtimeBudget.targetTextureBytes),
            usageRatio: Math.round(snapshot.runtimeBudget.usageRatio * 100) / 100,
        } : undefined,
        advisor: snapshot.advisor ? {
            allowed: snapshot.advisor.allowed,
            blockedReason: snapshot.advisor.blockedReason,
            warningCount: snapshot.advisor.warningCount,
            criticalCount: snapshot.advisor.criticalCount,
            warnings: snapshot.advisor.warnings,
        } : undefined,
    });
    logger.table?.(snapshot.rows.map(row => ({
        name: row.name,
        uuid: row.uuid,
        avatar: row.avatarState ?? "",
        role: row.avatarRole ?? "",
        plot: row.plotState ?? "",
        texture: row.textureState ?? "",
        reason: row.textureReason ?? row.plotReason ?? row.avatarReason ?? "",
        textureMB: bytesToMb(row.textureBytes),
        textures: row.textureCount,
        maxTexture: row.maxTextureDimension ?? "",
        triangles: row.triangles,
        drawCalls: row.drawCalls,
        advisor: row.advisorWarnings?.length ? `${row.advisorSeverity}:${row.advisorWarnings.length}` : "",
    })));
    logger.groupEnd?.();
}

function createAdvisorSnapshot(options: BudgetInspectionOptions): BudgetAdvisorSnapshot | undefined {
    if (options.enableAdvisor !== true) return undefined;

    const allowed = options.allowAdvisor === true;
    return {
        enabled: true,
        allowed,
        blockedReason: allowed ? undefined : options.advisorBlockedReason ?? "not-allowed",
        warningCount: 0,
        criticalCount: 0,
        warnings: [],
    };
}

function finalizeAdvisor(advisor: BudgetAdvisorSnapshot | undefined, maxWarnings = DEFAULT_ADVISOR_WARNING_LIMIT): void {
    if (!advisor || !advisor.allowed) return;

    advisor.criticalCount = advisor.warnings.filter(warning => warning.severity === "critical").length;
    advisor.warningCount = advisor.warnings.filter(warning => warning.severity === "warning").length;
    advisor.warnings = advisor.warnings
        .sort(compareAdvisorWarnings)
        .slice(0, Math.max(1, maxWarnings));
}

function collectAdvisorWarnings(
    row: BudgetInspectorRow,
    metadata: {
        avatar?: ReturnType<typeof getAvatarBudgetMetadata>;
        plot?: ReturnType<typeof getPlotBudgetMetadata>;
    },
): BudgetAdvisorWarning[] {
    const warnings: BudgetAdvisorWarning[] = [];

    if (metadata.avatar?.enabled === true) {
        addAvatarAdvisorWarnings(warnings, row, metadata.avatar.stats);
    }

    if (metadata.plot?.enabled === true) {
        addPlotAdvisorWarnings(warnings, row, metadata.plot.stats);
    }

    return warnings;
}

function addAvatarAdvisorWarnings(
    warnings: BudgetAdvisorWarning[],
    row: BudgetInspectorRow,
    stats: AvatarBudgetStats | undefined,
): void {
    const source = {
        textureBytes: row.textureBytes,
        textureDimension: row.maxTextureDimension ?? 0,
        triangles: stats?.triangles ?? row.triangles,
        drawCalls: stats?.drawCalls ?? row.drawCalls,
        bones: stats?.bones ?? 0,
    };

    addThresholdWarning(warnings, row, "avatar", "textureBytes", source.textureBytes, ADVISOR_LIMITS.avatar.textureBytes, "bytes");
    addThresholdWarning(
        warnings,
        row,
        "avatar",
        "textureDimension",
        source.textureDimension,
        ADVISOR_LIMITS.avatar.textureDimension,
        "pixels",
    );
    addThresholdWarning(warnings, row, "avatar", "triangles", source.triangles, ADVISOR_LIMITS.avatar.triangles, "count");
    addThresholdWarning(warnings, row, "avatar", "drawCalls", source.drawCalls, ADVISOR_LIMITS.avatar.drawCalls, "count");
    addThresholdWarning(warnings, row, "avatar", "bones", source.bones, ADVISOR_LIMITS.avatar.bones, "count");
}

function addPlotAdvisorWarnings(
    warnings: BudgetAdvisorWarning[],
    row: BudgetInspectorRow,
    stats: PlotBudgetStats | undefined,
): void {
    const source = {
        textureBytes: row.textureBytes,
        textureDimension: row.maxTextureDimension ?? 0,
        triangles: stats?.triangles ?? row.triangles,
        drawCalls: stats?.drawCalls ?? row.drawCalls,
    };

    addThresholdWarning(warnings, row, "plot", "textureBytes", source.textureBytes, ADVISOR_LIMITS.plot.textureBytes, "bytes");
    addThresholdWarning(
        warnings,
        row,
        "plot",
        "textureDimension",
        source.textureDimension,
        ADVISOR_LIMITS.plot.textureDimension,
        "pixels",
    );
    addThresholdWarning(warnings, row, "plot", "triangles", source.triangles, ADVISOR_LIMITS.plot.triangles, "count");
    addThresholdWarning(warnings, row, "plot", "drawCalls", source.drawCalls, ADVISOR_LIMITS.plot.drawCalls, "count");
}

function addThresholdWarning(
    warnings: BudgetAdvisorWarning[],
    row: BudgetInspectorRow,
    scope: BudgetAdvisorScope,
    metric: BudgetAdvisorMetric,
    value: number,
    limits: {warning: number; critical: number},
    unit: BudgetAdvisorWarning["unit"],
): void {
    if (!Number.isFinite(value) || value <= limits.warning) return;

    const severity: BudgetAdvisorSeverity = value > limits.critical ? "critical" : "warning";
    const limit = severity === "critical" ? limits.critical : limits.warning;
    warnings.push({
        id: `${row.uuid}:${scope}:${metric}`,
        objectUuid: row.uuid,
        objectName: row.name,
        objectPath: row.path,
        scope,
        severity,
        metric,
        message: getAdvisorMessage(scope, metric, severity),
        value,
        limit,
        unit,
    });
}

function getAdvisorMessage(
    scope: BudgetAdvisorScope,
    metric: BudgetAdvisorMetric,
    severity: BudgetAdvisorSeverity,
): string {
    const prefix = scope === "avatar" ? "Avatar" : "Plot";
    const level = severity === "critical" ? "critical" : "warning";

    switch (metric) {
        case "textureBytes":
            return `${prefix} texture memory exceeds mobile ${level} budget`;
        case "textureDimension":
            return `${prefix} texture dimensions exceed mobile ${level} budget`;
        case "triangles":
            return `${prefix} triangle count exceeds mobile ${level} budget`;
        case "drawCalls":
            return `${prefix} draw calls exceed mobile ${level} budget`;
        case "bones":
            return `${prefix} skeleton bones exceed mobile ${level} budget`;
    }
}

function getWorstAdvisorSeverity(warnings: BudgetAdvisorWarning[]): BudgetAdvisorSeverity | undefined {
    if (warnings.some(warning => warning.severity === "critical")) return "critical";
    if (warnings.some(warning => warning.severity === "warning")) return "warning";
    return undefined;
}

function compareAdvisorWarnings(a: BudgetAdvisorWarning, b: BudgetAdvisorWarning): number {
    const severityDiff = getAdvisorSeverityRank(b.severity) - getAdvisorSeverityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;

    const aRatio = a.limit > 0 ? a.value / a.limit : 0;
    const bRatio = b.limit > 0 ? b.value / b.limit : 0;
    if (bRatio !== aRatio) return bRatio - aRatio;
    return a.objectName.localeCompare(b.objectName);
}

function getAdvisorSeverityRank(severity: BudgetAdvisorSeverity): number {
    return severity === "critical" ? 2 : 1;
}

function collectMaxTextureDimension(root: THREE.Object3D): {maxDimension: number; textureName?: string} {
    const seen = new Set<string>();
    const result: {maxDimension: number; textureName?: string} = {maxDimension: 0};

    traverseObjectDepthFirst(root, child => {
        const mesh = child as THREE.Mesh;
        const material = mesh.material;
        if (!material) return;

        if (Array.isArray(material)) {
            for (const item of material) {
                collectMaterialTextureDimension(item, seen, result);
            }
        } else {
            collectMaterialTextureDimension(material, seen, result);
        }
    });

    return result;
}

function collectMaterialTextureDimension(
    material: THREE.Material,
    seen: Set<string>,
    result: {maxDimension: number; textureName?: string},
): void {
    for (const slot of ADVISOR_TEXTURE_SLOTS) {
        const texture = (material as AdvisorTextureMaterial)[slot];
        if (!isTextureLike(texture) || seen.has(texture.uuid)) continue;
        seen.add(texture.uuid);

        const dimension = getTextureMaxDimension(texture);
        if (dimension > result.maxDimension) {
            result.maxDimension = dimension;
            result.textureName = texture.name || slot;
        }
    }
}

function isTextureLike(value: unknown): value is THREE.Texture {
    return !!value && typeof value === "object" && (value as {isTexture?: boolean}).isTexture === true;
}

function getTextureMaxDimension(texture: THREE.Texture): number {
    const image = texture.image as
        | {width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number}
        | undefined;
    if (!image) return 0;

    return Math.max(
        image.videoWidth ?? 0,
        image.videoHeight ?? 0,
        image.naturalWidth ?? 0,
        image.naturalHeight ?? 0,
        image.width ?? 0,
        image.height ?? 0,
    );
}

function getAvatarState(value: unknown): AvatarBudgetState {
    return value === "ghost" || value === "culled" || value === "full" ? value : "full";
}

function getPlotState(value: unknown): PlotBudgetState {
    return value === "mid" || value === "far" || value === "culled" || value === "near" ? value : "near";
}

function getTextureState(value: unknown): TextureResidencyState {
    return value === "reduced" || value === "evicted" || value === "resident" ? value : "resident";
}

function createEmptySnapshot(managers: BudgetInspectorManagers, generatedAt: number): BudgetInspectionSnapshot {
    return {
        generatedAt,
        managers: {
            plotRegisteredCount: managers.plotBudgetManager?.getRegisteredCount?.(),
            textureRegisteredCount: managers.textureResidencyManager?.getRegisteredCount?.(),
            textureManagerStats: managers.textureResidencyManager?.getStats?.(),
        },
        runtimeBudget: managers.runtimeBudgetCoordinator?.getSnapshot?.(),
        avatar: {
            total: 0,
            states: {...EMPTY_AVATAR_STATES},
            local: 0,
            remote: 0,
            textureBytes: 0,
            textureCount: 0,
            triangles: 0,
            drawCalls: 0,
        },
        plot: {
            total: 0,
            states: {...EMPTY_PLOT_STATES},
            textureBytes: 0,
            textureCount: 0,
            triangles: 0,
            drawCalls: 0,
        },
        texture: {
            total: 0,
            states: {...EMPTY_TEXTURE_STATES},
            textureBytes: 0,
            textureCount: 0,
            residentTextureBytes: 0,
            residentTextureCount: 0,
            triangles: 0,
            drawCalls: 0,
        },
        rows: [],
    };
}

function bytesToMb(bytes: number): number {
    return Math.round(bytes / 1024 / 1024 * 10) / 10;
}

function addAvatarStats(summary: BudgetInspectorCountSet<AvatarBudgetState>, stats: AvatarBudgetStats | undefined): void {
    if (!stats) return;
    summary.textureBytes += stats.textureBytes;
    summary.textureCount += stats.textureCount;
    summary.triangles += stats.triangles;
    summary.drawCalls += stats.drawCalls;
}

function addPlotStats(summary: BudgetInspectorCountSet<PlotBudgetState>, stats: PlotBudgetStats | undefined): void {
    if (!stats) return;
    summary.textureBytes += stats.textureBytes;
    summary.textureCount += stats.textureCount;
    summary.triangles += stats.triangles;
    summary.drawCalls += stats.drawCalls;
}

function addTextureStats(
    summary: BudgetInspectorCountSet<TextureResidencyState>,
    stats: TextureResidencyStats | undefined,
): void {
    if (!stats) return;
    summary.textureBytes += stats.textureBytes;
    summary.textureCount += stats.textureCount;
    summary.residentTextureBytes = (summary.residentTextureBytes ?? 0) + (stats.residentTextureBytes ?? stats.textureBytes);
    summary.residentTextureCount = (summary.residentTextureCount ?? 0) + (stats.residentTextureCount ?? stats.textureCount);
}

function statsToRowStats(stats: AvatarBudgetStats | PlotBudgetStats | TextureResidencyStats | undefined) {
    if (!stats) return emptyRowStats();
    return {
        textureBytes: stats.textureBytes,
        textureCount: stats.textureCount,
        triangles: "triangles" in stats ? stats.triangles : 0,
        drawCalls: "drawCalls" in stats ? stats.drawCalls : 0,
    };
}

function emptyRowStats() {
    return {
        textureBytes: 0,
        textureCount: 0,
        triangles: 0,
        drawCalls: 0,
    };
}

function maxRowStats(a: ReturnType<typeof emptyRowStats>, b: ReturnType<typeof emptyRowStats>) {
    return {
        textureBytes: Math.max(a.textureBytes, b.textureBytes),
        textureCount: Math.max(a.textureCount, b.textureCount),
        triangles: Math.max(a.triangles, b.triangles),
        drawCalls: Math.max(a.drawCalls, b.drawCalls),
    };
}

function getObjectPath(object: THREE.Object3D): string {
    const names: string[] = [];
    let current: THREE.Object3D | null = object;
    while (current) {
        if (current.name) {
            names.push(current.name);
        }
        current = current.parent;
    }
    return names.reverse().join(" / ") || object.uuid;
}

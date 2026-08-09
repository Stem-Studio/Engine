import { useRef, useState } from "react";
import styled from "styled-components";

import BehaviorPerformanceSection from "./BehaviorPerformanceSection";
import { BudgetInspectorSection } from "./BudgetInspectorSection";
import { CascadedShadowMap } from "./CascadedShadowMap";
import LambdaExplorerSection from "./LambdaExplorerSection";
import PostProcessingSection from "./PostProcessingSection";
import { PresetDetailPanel } from "./PresetDetailPanel";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import { useBatchLodGenerationContext } from "@stem/editor-oss/context/BatchLodGenerationContext";
import { QualitySystemIntegration } from "../../../../../../core/quality";
import global from "@stem/editor-oss/global";
import { StyledButton } from "../../../common/StyledButton";
import { Tooltip } from "../../../common/Tooltip";
import { DEFAULT_UPLOAD_SETTINGS } from "../../../LeftPanel/MainTabs/AssetsTab/ModelUpload/constants";
import { LodTabContent } from "../../../LeftPanel/MainTabs/AssetsTab/ModelUpload/LodSection/LodTabContent";
import { LodTabs } from "../../../LeftPanel/MainTabs/AssetsTab/ModelUpload/LodSection/LodTabs";
import { OriginalTab } from "../../../LeftPanel/MainTabs/AssetsTab/ModelUpload/OriginalTab";
import { LodLevel, UploadSettings } from "../../../LeftPanel/MainTabs/AssetsTab/ModelUpload/types";
import { ContentItem } from "../../common/ContentItem";
import { NumericInputRow } from "../../common/NumericInputRow";
import { PanelCheckbox } from "../../common/PanelCheckbox";
import { Separator } from "../../common/Separator";
import { PanelSectionTitle } from "../../RightPanel.style";
import { TabContent, TooltipRowWrapper } from "../ProjectSettings/ProjectSettings.style";

const CompactWrapper = styled.div`
    width: 100%;
    & > div {
        padding: 8px 0;
        gap: 8px;
    }
`;

const DeviceTabs = styled.div`
    display: flex;
    gap: 4px;
    width: 100%;
`;

const DeviceTab = styled.button<{ $active: boolean }>`
    flex: 1;
    padding: 5px 0;
    border-radius: 4px;
    border: 1px solid ${({ $active }) => $active ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)"};
    background: ${({ $active }) => $active ? "rgba(255,255,255,0.1)" : "transparent"};
    color: rgba(255, 255, 255, ${({ $active }) => $active ? 0.9 : 0.5});
    font-size: 11px;
    font-weight: ${({ $active }) => $active ? 600 : 400};
    cursor: pointer;
    &:hover { background: rgba(255, 255, 255, 0.06); }
`;

const PresetList = styled.div`
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
`;

const PresetRow = styled.div<{ $active: boolean }>`
    display: flex;
    align-items: center;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    background: ${({ $active }) => $active ? "rgba(255,255,255,0.08)" : "transparent"};
    border: 1px solid ${({ $active }) => $active ? "rgba(255,255,255,0.15)" : "transparent"};
    &:hover { background: rgba(255, 255, 255, 0.05); }
`;

const QualityLabel = styled.span<{ $active: boolean }>`
    font-size: 12px;
    font-weight: ${({ $active }) => $active ? 600 : 400};
    color: rgba(255, 255, 255, ${({ $active }) => $active ? 0.9 : 0.65});
`;

const SelectRow = styled.div`
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
`;

const SelectLabel = styled.div`
    font-size: 12px;
    color: rgba(255, 255, 255, 0.8);
`;

const StyledSelect = styled.select`
    width: 100%;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.9);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    outline: none;
    &:focus {
        border-color: rgba(255, 255, 255, 0.32);
    }
`;

const FoldSectionWrapper = styled.div`
    width: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    margin-bottom: 14px;
`;

const FoldHeader = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 2px 0;
`;

const FoldExpandToggle = styled.span`
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    flex: 1 1 auto;
    min-width: 0;
    color: var(--theme-font-main-selected-color);
`;

const FoldContent = styled.div`
    width: 100%;
    padding: 8px 0 0;
`;

const InlineSectionTitle = styled.div`
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.6);
    margin-top: 4px;
`;

type RootTransformPolicy = "auto-reset" | "warn-only" | "ignore";

const ROOT_TRANSFORM_POLICY_OPTIONS: Array<{ value: RootTransformPolicy; label: string }> = [
    { value: "auto-reset", label: "Auto Reset (Legacy Safe)" },
    { value: "warn-only", label: "Warn Only" },
    { value: "ignore", label: "Ignore" },
];

const DEFAULT_SPLAT_SETTINGS = {
    maxStdDev: Math.sqrt(8),
    minPixelRadius: 2,
    maxPixelRadius: 512,
    sortRadial: true,
    minSortIntervalMs: 0,
    enableLod: true,
    pixelRatioFactor: 0.75,
};

const DEFAULT_VISIBLE_SPARK_OPTIONS = {
    minAlpha: 0,
    preBlurAmount: 0,
    blurAmount: 0.3,
    falloff: 1,
    clipXY: 1.4,
    focalAdjustment: 1,
};

const SPARK_COMPOSITE_NAME = "__SparkWebGpuRenderer";

type SplatRuntimeSettings = {
    maxStdDev: number;
    minPixelRadius: number;
    maxPixelRadius: number;
    sortRadial: boolean;
    minSortIntervalMs: number;
    enableLod: boolean;
    pixelRatioFactor: number;
};

type SparkCompositeRuntimeLike = {
    setPixelRatioFactor?: (factor: number) => void;
    pixelRatioFactor?: number;
    setSparkOptions?: (options: Record<string, unknown>) => void;
    spark?: {
        maxStdDev: number;
        minPixelRadius: number;
        maxPixelRadius: number;
        sortRadial: boolean;
        minSortIntervalMs: number;
        enableLod: boolean;
        enableDriveLod: boolean;
        dirty: boolean;
    };
};

const applySplatSettingsToActiveComposite = (
    scene: { getObjectByName?: (name: string) => unknown } | null | undefined,
    settings: SplatRuntimeSettings,
) => {
    const composite = scene?.getObjectByName?.(SPARK_COMPOSITE_NAME) as SparkCompositeRuntimeLike | undefined;
    if (!composite) {
        return;
    }

    if (typeof composite.setSparkOptions === "function") {
        composite.setSparkOptions({
            maxStdDev: settings.maxStdDev,
            minPixelRadius: settings.minPixelRadius,
            maxPixelRadius: settings.maxPixelRadius,
            sortRadial: settings.sortRadial,
            minSortIntervalMs: settings.minSortIntervalMs,
            enableLod: settings.enableLod,
            enableDriveLod: settings.enableLod,
        });
    } else if (composite.spark) {
        composite.spark.maxStdDev = settings.maxStdDev;
        composite.spark.minPixelRadius = settings.minPixelRadius;
        composite.spark.maxPixelRadius = settings.maxPixelRadius;
        composite.spark.sortRadial = settings.sortRadial;
        composite.spark.minSortIntervalMs = settings.minSortIntervalMs;
        composite.spark.enableLod = settings.enableLod;
        composite.spark.enableDriveLod = settings.enableLod;
        composite.spark.dirty = true;
    } else {
        return;
    }

    if (typeof composite.setPixelRatioFactor === "function") {
        composite.setPixelRatioFactor(settings.pixelRatioFactor);
    } else if (typeof composite.pixelRatioFactor === "number") {
        composite.pixelRatioFactor = settings.pixelRatioFactor;
    }
};

const deviceCategories = ["Desktop", "Apple Silicon", "Mobile", "iOS"] as const;

const presetEntries = [
    // Desktop — discrete GPU lane
    { key: "desktop_balanced", device: "Desktop", quality: "Balanced" },
    { key: "desktop_high", device: "Desktop", quality: "High" },
    { key: "desktop_ultra", device: "Desktop", quality: "Ultra" },
    // Desktop — Apple Silicon lane
    { key: "apple_silicon_balanced", device: "Apple Silicon", quality: "Balanced" },
    { key: "apple_silicon_high", device: "Apple Silicon", quality: "High" },
    { key: "apple_silicon_ultra", device: "Apple Silicon", quality: "Ultra" },
    // Mobile — Android lane
    { key: "android_balanced", device: "Mobile", quality: "Balanced" },
    { key: "android_high", device: "Mobile", quality: "High" },
    // iOS lane
    { key: "ios_balanced", device: "iOS", quality: "Balanced" },
    { key: "ios_high", device: "iOS", quality: "High" },
];

/**
 *
 * @param key
 */
function getDeviceForPreset(key: string): string {
    return presetEntries.find(e => e.key === key)?.device ?? "Desktop";
}

/**
 *
 */
function getCurrentPresetKey(): string {
    try {
        const qs = QualitySystemIntegration.getInstance();
        const presets = qs.getQualityManager().getPresets();
        const current = qs.getQualityManager().getCurrentSettings();
        for (const p of presets) {
            if (
                p.settings.rendering.pixelRatio === current.rendering.pixelRatio &&
                p.settings.physics.updateRate === current.physics.updateRate
            ) {
                return p.id;
            }
        }
    } catch { /* quality system not initialised yet */ }
    return "desktop_balanced";
}

export const RenderingAndPerformancePanel = () => {
    const app = global.app as EngineRuntime;
    const initialSplatSettings = app?.editor?.scene?.userData?.rendering?.splat ?? {};
    const qualityPreset = getCurrentPresetKey();
    const [activeDevice, setActiveDevice] = useState(() => getDeviceForPreset(qualityPreset));
    const [showDetail, setShowDetail] = useState(false);
    const [viewingPreset, setViewingPreset] = useState(qualityPreset);
    const detailAnchorRef = useRef<HTMLDivElement>(null);
    const [useInstancing, setUseInstancing] = useState(!!app?.editor?.useInstancing);
    const [physicsSleepingEnabled, setPhysicsSleepingEnabled] = useState(!!app?.editor?.scene.userData.physicsSleepingEnabled);
    const [showStats, setShowStats] = useState(!!app?.editor?.showStats);
    const [showMemoryStats, setShowMemoryStats] = useState(!!app?.editor?.showMemoryStats);
    const [usePhysicsWorker, setUsePhysicsWorker] = useState(!!app?.editor?.scene?.userData?.physicsUseWorker);
    const [debugMode, setDebugMode] = useState(!!app?.debug);
    const [enableDynamicBatching, setEnableDynamicBatching] = useState<boolean>(
        !(app?.editor?.scene?.userData?.rendering?.batching?.enableDynamic === false),
    );
    const [forceWebGL, setForceWebGL] = useState(!!app?.editor?.scene?.userData?.rendering?.forceWebGL);
    const [forceWebGLForVFX, setForceWebGLForVFX] = useState(app?.editor?.scene?.userData?.rendering?.forceWebGLForVFX ?? true);
    const [rootTransformPolicy, setRootTransformPolicy] = useState<RootTransformPolicy>(
        app?.editor?.scene?.userData?.rendering?.rootTransformPolicy ?? "auto-reset",
    );
    const [splatMaxStdDev, setSplatMaxStdDev] = useState<number>(
        initialSplatSettings.maxStdDev ?? DEFAULT_SPLAT_SETTINGS.maxStdDev,
    );
    const [splatMinPixelRadius, setSplatMinPixelRadius] = useState<number>(
        initialSplatSettings.minPixelRadius ?? DEFAULT_SPLAT_SETTINGS.minPixelRadius,
    );
    const [splatMaxPixelRadius, setSplatMaxPixelRadius] = useState<number>(
        initialSplatSettings.maxPixelRadius ?? DEFAULT_SPLAT_SETTINGS.maxPixelRadius,
    );
    const [splatSortRadial, setSplatSortRadial] = useState<boolean>(
        initialSplatSettings.sortRadial ?? DEFAULT_SPLAT_SETTINGS.sortRadial,
    );
    const [splatMinSortIntervalMs, setSplatMinSortIntervalMs] = useState<number>(
        initialSplatSettings.minSortIntervalMs ?? DEFAULT_SPLAT_SETTINGS.minSortIntervalMs,
    );
    const [, setSplatEnableLod] = useState<boolean>(
        initialSplatSettings.enableLod ?? DEFAULT_SPLAT_SETTINGS.enableLod,
    );
    const [splatPixelRatioFactor, setSplatPixelRatioFactor] = useState<number>(
        initialSplatSettings.pixelRatioFactor ?? DEFAULT_SPLAT_SETTINGS.pixelRatioFactor,
    );
    const [sparkOptionsInputs, setSparkOptionsInputs] = useState<Record<string, unknown>>(
        initialSplatSettings.sparkOptions && typeof initialSplatSettings.sparkOptions === "object"
            ? { ...initialSplatSettings.sparkOptions }
            : {},
    );
    const [isSplatSectionOpen, setIsSplatSectionOpen] = useState<boolean>(true);
    const { generateLodsForScene, cancelBatchLodGeneration, isProcessing, progress, total } = useBatchLodGenerationContext();

    const [activeLodLevel, setActiveLodLevel] = useState<LodLevel>(LodLevel.Lod1);
    const [uploadSettings, setUploadSettings] = useState<UploadSettings>(DEFAULT_UPLOAD_SETTINGS);

    const handleEditorChange = (key: string, value: boolean, setter: React.Dispatch<React.SetStateAction<any>>) => {
        if (!app?.editor) return;
        (app.editor as any)[key] = value;
        setter(value);
    };

    const handleUserDataChange = (key: string, value: boolean, setter: React.Dispatch<React.SetStateAction<any>>) => {
        if (!app?.editor?.scene?.userData) return;
        app.editor.scene.userData[key] = value;
        app.call?.("sceneGraphChanged", app.editor);
        setter(value);
    };

    const handleDebugModeChange = (_key: string, value: boolean, setter: React.Dispatch<React.SetStateAction<any>>) => {
        if (!app) return;
        app.storage.debug = value;
        app.debug = value;
        setter(value);
    };

    const handleForceWebGLChange = (_key: string, value: boolean, setter: React.Dispatch<React.SetStateAction<any>>) => {
        try {
            const ud = app.editor?.scene.userData || (app.editor!.scene.userData = {});
            const rendering = ud.rendering = ud.rendering || {};
            rendering.forceWebGL = value;
            setter(value);
            app.call?.("objectChanged", app.editor, app.editor?.scene);
        } catch (e) {
            console.warn("Failed to toggle forceWebGL:", e);
        }
    };

    const handleForceWebGLForVFXChange = (_key: string, value: boolean, setter: React.Dispatch<React.SetStateAction<any>>) => {
        try {
            const ud = app.editor?.scene.userData || (app.editor!.scene.userData = {});
            const rendering = ud.rendering = ud.rendering || {};
            rendering.forceWebGLForVFX = value;
            setter(value);
            app.call?.("objectChanged", app.editor, app.editor?.scene);
        } catch (e) {
            console.warn("Failed to toggle forceWebGLForVFX:", e);
        }
    };

    const handleEnableDynamicBatchingChange = (_key: string, value: boolean, setter: React.Dispatch<React.SetStateAction<any>>) => {
        try {
            const ud = app.editor?.scene.userData || (app.editor!.scene.userData = {});
            const rendering = ud.rendering = ud.rendering || {};
            const batching = rendering.batching = rendering.batching || {};
            batching.enableDynamic = value;
            setter(value);
            // Notify engine to re-evaluate rendering/batching.
            app.call?.("clear", app.editor, app.editor);
        } catch (e) {
            console.warn("Failed to toggle dynamic batching:", e);
        }
    };

    const handleRootTransformPolicyChange = (value: RootTransformPolicy) => {
        try {
            const ud = app.editor?.scene.userData || (app.editor!.scene.userData = {});
            const rendering = ud.rendering = ud.rendering || {};
            rendering.rootTransformPolicy = value;
            setRootTransformPolicy(value);
            app.call?.("objectChanged", app.editor, app.editor?.scene);
        } catch (e) {
            console.warn("Failed to update rootTransformPolicy:", e);
        }
    };

    const handleSplatSettingChange = (
        key: "maxStdDev" | "minPixelRadius" | "maxPixelRadius" | "minSortIntervalMs" | "sortRadial" | "enableLod" | "pixelRatioFactor",
        value: number | boolean,
        setter: React.Dispatch<React.SetStateAction<any>>,
    ) => {
        try {
            const ud = app.editor?.scene.userData || (app.editor!.scene.userData = {});
            const rendering = ud.rendering = ud.rendering || {};
            const splat = rendering.splat = rendering.splat || {};
            const nextValue =
                key === "pixelRatioFactor" && typeof value === "number"
                    ? Math.min(1, Math.max(0.5, value))
                    : value;

            splat[key] = nextValue;
            setter(nextValue);
            applySplatSettingsToActiveComposite(app.editor?.scene, {
                maxStdDev: splat.maxStdDev ?? DEFAULT_SPLAT_SETTINGS.maxStdDev,
                minPixelRadius: splat.minPixelRadius ?? DEFAULT_SPLAT_SETTINGS.minPixelRadius,
                maxPixelRadius: splat.maxPixelRadius ?? DEFAULT_SPLAT_SETTINGS.maxPixelRadius,
                sortRadial: splat.sortRadial ?? DEFAULT_SPLAT_SETTINGS.sortRadial,
                minSortIntervalMs: splat.minSortIntervalMs ?? DEFAULT_SPLAT_SETTINGS.minSortIntervalMs,
                enableLod: splat.enableLod ?? DEFAULT_SPLAT_SETTINGS.enableLod,
                pixelRatioFactor: splat.pixelRatioFactor ?? DEFAULT_SPLAT_SETTINGS.pixelRatioFactor,
            });
            app.call?.("objectChanged", app.editor, app.editor?.scene);
        } catch (e) {
            console.warn(`Failed to update splat setting "${key}":`, e);
        }
    };

    const applySparkOptionsToScene = (nextSparkOptions: Record<string, unknown>) => {
        const ud = app.editor?.scene.userData || (app.editor!.scene.userData = {});
        const rendering = ud.rendering = ud.rendering || {};
        const splat = rendering.splat = rendering.splat || {};
        splat.sparkOptions = nextSparkOptions;

        const composite = app.editor?.scene?.getObjectByName?.(SPARK_COMPOSITE_NAME) as SparkCompositeRuntimeLike | undefined;
        if (typeof composite?.setSparkOptions === "function") {
            composite.setSparkOptions(nextSparkOptions);
        }
        app.call?.("objectChanged", app.editor, app.editor?.scene);
    };

    const setSparkOptionInput = (key: string, value: unknown) => {
        const nextSparkOptions = {
            ...sparkOptionsInputs,
            [key]: value,
        };
        setSparkOptionsInputs(nextSparkOptions);
        applySparkOptionsToScene(nextSparkOptions);
    };

    const handleResetSplatDefaults = () => {
        try {
            const ud = app.editor?.scene.userData || (app.editor!.scene.userData = {});
            const rendering = ud.rendering = ud.rendering || {};
            const splat = rendering.splat = rendering.splat || {};

            splat.maxStdDev = DEFAULT_SPLAT_SETTINGS.maxStdDev;
            splat.minPixelRadius = DEFAULT_SPLAT_SETTINGS.minPixelRadius;
            splat.maxPixelRadius = DEFAULT_SPLAT_SETTINGS.maxPixelRadius;
            splat.sortRadial = DEFAULT_SPLAT_SETTINGS.sortRadial;
            splat.minSortIntervalMs = DEFAULT_SPLAT_SETTINGS.minSortIntervalMs;
            splat.enableLod = DEFAULT_SPLAT_SETTINGS.enableLod;
            splat.pixelRatioFactor = DEFAULT_SPLAT_SETTINGS.pixelRatioFactor;

            setSplatMaxStdDev(DEFAULT_SPLAT_SETTINGS.maxStdDev);
            setSplatMinPixelRadius(DEFAULT_SPLAT_SETTINGS.minPixelRadius);
            setSplatMaxPixelRadius(DEFAULT_SPLAT_SETTINGS.maxPixelRadius);
            setSplatSortRadial(DEFAULT_SPLAT_SETTINGS.sortRadial);
            setSplatMinSortIntervalMs(DEFAULT_SPLAT_SETTINGS.minSortIntervalMs);
            setSplatEnableLod(DEFAULT_SPLAT_SETTINGS.enableLod);
            setSplatPixelRatioFactor(DEFAULT_SPLAT_SETTINGS.pixelRatioFactor);

            const nextSparkOptions = {
                ...sparkOptionsInputs,
                ...DEFAULT_VISIBLE_SPARK_OPTIONS,
            };
            splat.sparkOptions = nextSparkOptions;
            setSparkOptionsInputs(nextSparkOptions);

            applySplatSettingsToActiveComposite(app.editor?.scene, DEFAULT_SPLAT_SETTINGS);

            const composite = app.editor?.scene?.getObjectByName?.(SPARK_COMPOSITE_NAME) as SparkCompositeRuntimeLike | undefined;
            if (typeof composite?.setSparkOptions === "function") {
                composite.setSparkOptions(nextSparkOptions);
            }

            app.call?.("objectChanged", app.editor, app.editor?.scene);
        } catch (e) {
            console.warn("Failed to reset splat defaults:", e);
        }
    };

    return (
        <TabContent>
            <ContentItem $rowGap="16px">
                {/* ── QUALITY PRESETS ── */}
                <TooltipRowWrapper>
                    <PanelSectionTitle>Rendering & Performance</PanelSectionTitle>
                    <Tooltip
                        text="Optimize visual quality and runtime stability across target device classes."
                        width="220px"
                    />
                </TooltipRowWrapper>
                <TooltipRowWrapper>
                    <PanelSectionTitle>Quality Presets</PanelSectionTitle>
                    <Tooltip
                        text="Preset bundles that change renderer, shadow, physics, and scene budget settings together. Start from the target device class, then inspect the preset details before overriding individual settings."
                        width="220px"
                    />
                </TooltipRowWrapper>
                <DeviceTabs>
                    {deviceCategories.map(d =>
                        <DeviceTab key={d}
                            $active={activeDevice === d}
                            onClick={() => setActiveDevice(d)}
                        >
                            {d}
                        </DeviceTab>,
                    )}
                </DeviceTabs>
                <PresetList ref={detailAnchorRef}>
                    {presetEntries
                        .filter(e => e.device === activeDevice)
                        .map(({ key, quality }) =>
                            <PresetRow
                                key={key}
                                $active={qualityPreset === key}
                                onClick={() => { setViewingPreset(key); setShowDetail(true); }}
                            >
                                <QualityLabel $active={qualityPreset === key}>{quality}</QualityLabel>
                            </PresetRow>,
                        )}
                </PresetList>
                {showDetail &&
                    <PresetDetailPanel
                        anchorRef={detailAnchorRef}
                        presetKey={viewingPreset}
                        onClose={() => setShowDetail(false)}
                    />
                }
                <Separator margin="4px 0" />

                {/* ── RENDERING ── */}
                <PanelSectionTitle>Rendering</PanelSectionTitle>
                <PanelCheckbox
                    v2
                    text="Enable Dynamic Batching"
                    checked={!!enableDynamicBatching}
                    isGray
                    regular
                    onChange={() => handleEnableDynamicBatchingChange("enableDynamicBatching", !enableDynamicBatching, setEnableDynamicBatching)}
                    tooltipText="Groups compatible dynamic meshes into larger render batches to reduce draw calls. Best for scenes with many similar moving objects. Usually leave this on unless you are debugging batching issues."
                />
                <PanelCheckbox
                    v2
                    text="Mesh Instancing Optimization"
                    checked={!!useInstancing}
                    isGray
                    regular
                    onChange={() => handleEditorChange("useInstancing", !useInstancing, setUseInstancing)}
                    tooltipText="Renders repeated meshes with shared draw calls to reduce CPU and GPU overhead. Most useful for repeated props, foliage, crowds, or modular kits."
                />
                <StyledButton
                    style={{ margin: "4px 0 0 0" }}
                    isGreySecondary
                    onClick={() => {
                        try {
                            const batching = app?.editor?.scene?.userData?.rendering?.batching;
                            if (batching && Array.isArray(batching.stats)) {
                                batching.stats = [];
                            }
                        } catch (e) {
                            console.warn("Failed to clear batching stats:", e);
                        }
                    }}
                >
                    Clear Batching Data
                </StyledButton>
                <Separator margin="4px 0" />

                {/* ── POST PROCESSING ── */}
                <PanelSectionTitle>Post Processing</PanelSectionTitle>
                <PostProcessingSection />
                <Separator margin="4px 0" />

                {/* ── SHADOWS ── */}
                <PanelSectionTitle>Shadows</PanelSectionTitle>
            </ContentItem>
            <CascadedShadowMap />
            <ContentItem $rowGap="16px">
                <Separator margin="4px 0" />

                {/* ── GRAPHICS API ── */}
                <PanelSectionTitle>Graphics API</PanelSectionTitle>
                <PanelCheckbox
                    v2
                    text="Force WebGL (disable WebGPU)"
                    checked={!!forceWebGL}
                    isGray
                    regular
                    onChange={() => handleForceWebGLChange("forceWebGL", !forceWebGL, setForceWebGL)}
                    tooltipText="Forces the project to run on WebGL instead of WebGPU. Use this as a compatibility fallback when WebGPU is unstable or unsupported. Leave it off when WebGPU is working correctly."
                />
                <PanelCheckbox
                    v2
                    text="Force WebGL for VFX"
                    checked={!!forceWebGLForVFX}
                    isGray
                    regular
                    onChange={() => handleForceWebGLForVFXChange("forceWebGLForVFX", !forceWebGLForVFX, setForceWebGLForVFX)}
                    tooltipText="Forces VFX rendering onto WebGL even if the main renderer can use WebGPU. Useful when effect authoring is stable in WebGL but a given browser has WebGPU-specific VFX issues."
                />
                <Separator margin="4px 0" />

                {/* ── PHYSICS ── */}
                <PanelSectionTitle>Physics</PanelSectionTitle>
                <PanelCheckbox
                    v2
                    text="Enable Physics Sleeping"
                    checked={!!physicsSleepingEnabled}
                    isGray
                    regular
                    onChange={() => handleUserDataChange("physicsSleepingEnabled", !physicsSleepingEnabled, setPhysicsSleepingEnabled)}
                    tooltipText="Lets inactive rigid bodies go to sleep until something wakes them. Usually keep this on for better performance. Turn it off only when sleeping causes gameplay issues for constantly monitored bodies."
                />
                <PanelCheckbox
                    v2
                    text="Multi-threaded Physics"
                    checked={!!usePhysicsWorker}
                    isGray
                    regular
                    onChange={() => handleUserDataChange("physicsUseWorker", !usePhysicsWorker, setUsePhysicsWorker)}
                    tooltipText="Runs physics work in a worker thread to reduce main-thread contention. Usually beneficial for heavier scenes, but test carefully if you rely on tight frame-to-frame synchronization."
                />
                <Separator margin="4px 0" />
            </ContentItem>

            {/* ── BUDGET INSPECTOR ── */}
            <BudgetInspectorSection />

            {/* ── BEHAVIOR PERFORMANCE ── */}
            <BehaviorPerformanceSection />

            {/* ── LOD GENERATION ── */}
            <ContentItem $rowGap="16px">
                <PanelSectionTitle>LOD Generation</PanelSectionTitle>
                <LodTabs
                    maxLodLevel={LodLevel.Lod3}
                    activeLodLevel={activeLodLevel}
                    setActiveLodLevel={setActiveLodLevel}
                    compact
                />
                <CompactWrapper>
                    {activeLodLevel === LodLevel.Original ?
                        <OriginalTab
                            settings={uploadSettings}
                            setSettings={setUploadSettings}
                            hideHumanoidOption
                        />
                     :
                        <LodTabContent
                            key={activeLodLevel}
                            lodSettings={uploadSettings.lodSettings[activeLodLevel - 1]!}
                            setLodSettings={(settings) => {
                                const newLodSettings = [...uploadSettings.lodSettings];
                                newLodSettings[activeLodLevel - 1] = settings;
                                setUploadSettings({ ...uploadSettings, lodSettings: newLodSettings });
                            }}
                        />
                    }
                    <StyledButton
                        style={{ margin: "0" }}
                        isGreySecondary
                        onClick={() => {
                            if (isProcessing) {
                                cancelBatchLodGeneration();
                                return;
                            }
                            if (app?.editor?.sceneID) {
                                void generateLodsForScene(app.editor.sceneID, uploadSettings.lodSettings, uploadSettings);
                            } else {
                                console.warn("No scene ID found");
                            }
                        }}
                    >
                        {isProcessing ? `Cancel Generation (${progress}/${total})` : "Generate Optimized Models"}
                    </StyledButton>
                </CompactWrapper>
                <Separator margin="4px 0" />

                {/* ── DEVELOPER TOOLS ── */}
                <PanelSectionTitle>Developer Tools</PanelSectionTitle>
                <SelectRow>
                    <TooltipRowWrapper>
                        <SelectLabel>Scene Root Transform Policy</SelectLabel>
                        <Tooltip
                            text="Controls how runtime handles non-identity transforms on scene roots. Keep Auto Reset for most scenes, use Warn Only while auditing content, and Ignore only when you intentionally manage root transforms yourself."
                            width="260px"
                        />
                    </TooltipRowWrapper>
                    <StyledSelect
                        value={rootTransformPolicy}
                        onChange={e => handleRootTransformPolicyChange(e.target.value as RootTransformPolicy)}
                    >
                        {ROOT_TRANSFORM_POLICY_OPTIONS.map(option =>
                            <option key={option.value}
                                value={option.value}
                            >
                                {option.label}
                            </option>,
                        )}
                    </StyledSelect>
                </SelectRow>
                <PanelCheckbox
                    v2
                    text="Performance Statistics Overlay"
                    checked={!!showStats}
                    isGray
                    regular
                    onChange={() => handleEditorChange("showStats", !showStats, setShowStats)}
                    tooltipText="Shows frame timing and runtime diagnostics in-game. Use this when tuning frame rate, hitching, or graphics cost on target hardware."
                />
                <PanelCheckbox
                    v2
                    text="Memory Statistics Overlay"
                    checked={!!showMemoryStats}
                    isGray
                    regular
                    onChange={() => handleEditorChange("showMemoryStats", !showMemoryStats, setShowMemoryStats)}
                    tooltipText="Shows memory usage to help spot leaks, oversized textures, or asset-heavy scenes. Most useful during profiling and should stay off during normal editing."
                />
                <PanelCheckbox
                    v2
                    text="Debug Mode"
                    checked={!!debugMode}
                    isGray
                    regular
                    onChange={() => handleDebugModeChange("debug", !debugMode, setDebugMode)}
                    tooltipText="Enables extra debug diagnostics and development-only behavior. Keep this off for normal content work and only enable it when investigating engine or gameplay issues."
                />
                <Separator margin="4px 0" />
                <LambdaExplorerSection />

                <Separator margin="4px 0" />
                <FoldSectionWrapper>
                    <FoldHeader>
                        <FoldExpandToggle onClick={() => setIsSplatSectionOpen(v => !v)}>
                            {isSplatSectionOpen ? "▼" : "▶"} Gaussian Splats
                        </FoldExpandToggle>
                        <StyledButton
                            isGreySecondary
                            style={{
                                width: "auto",
                                minWidth: "auto",
                                padding: "3px 8px",
                                margin: 0,
                                fontSize: "11px",
                                lineHeight: 1.1,
                            }}
                            onClick={handleResetSplatDefaults}
                        >
                            Reset
                        </StyledButton>
                    </FoldHeader>
                    {isSplatSectionOpen &&
                        <FoldContent>
                        <NumericInputRow
                            label="Max Std Dev"
                            value={splatMaxStdDev}
                            setValue={(value) => handleSplatSettingChange("maxStdDev", value, setSplatMaxStdDev)}
                            min={0.5}
                            max={8}
                            dragStep={0.1}
                            decimalPlaces={2}
                        />
                        <NumericInputRow
                            label="Min Pixel Radius"
                            value={splatMinPixelRadius}
                            setValue={(value) => handleSplatSettingChange("minPixelRadius", value, setSplatMinPixelRadius)}
                            min={0}
                            max={64}
                            dragStep={0.05}
                            decimalPlaces={2}
                        />
                        <NumericInputRow
                            label="Max Pixel Radius"
                            value={splatMaxPixelRadius}
                            setValue={(value) => handleSplatSettingChange("maxPixelRadius", value, setSplatMaxPixelRadius)}
                            min={1}
                            max={4096}
                            dragStep={1}
                            decimalPlaces={0}
                        />
                        <NumericInputRow
                            label="Min Sort Interval (ms)"
                            value={splatMinSortIntervalMs}
                            setValue={(value) => handleSplatSettingChange("minSortIntervalMs", value, setSplatMinSortIntervalMs)}
                            min={0}
                            max={1000}
                            dragStep={5}
                            decimalPlaces={0}
                        />
                        <NumericInputRow
                            label="Pixel Ratio Factor"
                            value={splatPixelRatioFactor}
                            setValue={(value) => handleSplatSettingChange("pixelRatioFactor", value, setSplatPixelRatioFactor)}
                            min={0.5}
                            max={1}
                            dragStep={0.05}
                            decimalPlaces={2}
                        />
                        <PanelCheckbox
                            v2
                            text="Radial Sort (vs Z-depth)"
                            checked={!!splatSortRadial}
                            isGray
                            regular
                            onChange={() => handleSplatSettingChange("sortRadial", !splatSortRadial, setSplatSortRadial)}
                            tooltipText="Use radial distance sorting for more stable rotation views. Turn off to use Z-depth sorting, which can better match some trained scenes."
                        />
                        <Separator margin="2px 0" />
                        <PanelSectionTitle>Spark Renderer Options</PanelSectionTitle>

                        <InlineSectionTitle>Core</InlineSectionTitle>
                        <NumericInputRow
                            label="Min Alpha"
                            value={Number(sparkOptionsInputs.minAlpha ?? 0)}
                            setValue={(value) => setSparkOptionInput("minAlpha", value)}
                            min={0}
                            max={1}
                            dragStep={0.01}
                            decimalPlaces={3}
                        />
                        <NumericInputRow
                            label="Pre Blur Amount"
                            value={Number(sparkOptionsInputs.preBlurAmount ?? 0)}
                            setValue={(value) => setSparkOptionInput("preBlurAmount", value)}
                            min={0}
                            max={10}
                            dragStep={0.05}
                            decimalPlaces={3}
                        />
                        <NumericInputRow
                            label="Blur Amount"
                            value={Number(sparkOptionsInputs.blurAmount ?? 0.3)}
                            setValue={(value) => setSparkOptionInput("blurAmount", value)}
                            min={0}
                            max={10}
                            dragStep={0.05}
                            decimalPlaces={3}
                        />
                        <NumericInputRow
                            label="Falloff"
                            value={Number(sparkOptionsInputs.falloff ?? 1)}
                            setValue={(value) => setSparkOptionInput("falloff", value)}
                            min={0}
                            max={4}
                            dragStep={0.05}
                            decimalPlaces={3}
                        />
                        <NumericInputRow
                            label="Clip XY"
                            value={Number(sparkOptionsInputs.clipXY ?? 1.4)}
                            setValue={(value) => setSparkOptionInput("clipXY", value)}
                            min={0}
                            max={8}
                            dragStep={0.05}
                            decimalPlaces={3}
                        />
                        <NumericInputRow
                            label="Focal Adjust"
                            value={Number(sparkOptionsInputs.focalAdjustment ?? 1)}
                            setValue={(value) => setSparkOptionInput("focalAdjustment", value)}
                            min={0}
                            max={8}
                            dragStep={0.05}
                            decimalPlaces={3}
                        />
                        </FoldContent>
                    }
                </FoldSectionWrapper>
            </ContentItem>
        </TabContent>
    );
};

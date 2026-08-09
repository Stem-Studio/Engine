import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import { POST_PROCESSING_DEFAULTS } from "../../../../../../render/postprocessing/defaults";
import { normalizePostProcessingConfig } from "../../../../../../render/postprocessing/normalizePostProcessingConfig";
import { showToast } from "@stem/editor-oss/showToast";
import { CollapsibleEditorSection } from "../../common/CollapsibleEditorSection/CollapsibleEditorSection";
import { NumericInputRow } from "../../common/NumericInputRow";
import { Separator } from "../../common/Separator";
import { TextInputRow } from "../../common/TextInputRow";
import { StyledSwitch } from "../../../common/StyledSwitch";
import { Tooltip } from "../../../common/Tooltip";
import { useLUTUploader } from "../../../LeftPanel/MainTabs/AssetsTab/SubTabs/hooks/useLUTUploader";
import { useRemoveEditorDependencies } from "../../../../../asset-management/hooks/assets";

/**
 * Flat post-processing section — no card wrapper. Just a header row
 * (expand arrow + title + toggle switch) above optional child content.
 *
 * Intentionally lightweight vs. `CollapsibleEditorSection`: the card
 * styling on that component (gray background, border, padding) visually
 * breaks the flat Project Settings panel when it's used for every
 * effect. This local wrapper keeps the sections in line with the
 * surrounding controls.
 */
const PostFxSectionWrapper = styled.div`
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 14px;
`;

const PostFxSectionHeader = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 2px 0;
    font-size: 13px;
    font-weight: var(--theme-font-medium-plus);
    color: var(--theme-font-main-selected-color);
`;

const PostFxExpandToggle = styled.span`
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    flex: 1 1 auto;
    min-width: 0;
`;

const PostFxSectionBody = styled.div`
    padding: 8px 0 0;
`;

const PostFxHeaderRight = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
`;

interface PostFxSectionProps {
    title: string;
    enabled: boolean;
    onEnabledChange: (next: boolean) => void;
    defaultExpanded?: boolean;
    ariaLabel?: string;
    /**
     * Short description of what this effect does. Rendered as a hoverable
     * `?` icon between the title and the enable switch, matching the
     * `Enable Dynamic Batching` row pattern elsewhere in this panel.
     */
    tooltip?: string;
    children?: React.ReactNode;
}

const PostFxSection: React.FC<PostFxSectionProps> = ({
    title,
    enabled,
    onEnabledChange,
    defaultExpanded = false,
    ariaLabel,
    tooltip,
    children,
}) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    return (
        <PostFxSectionWrapper>
            <PostFxSectionHeader>
                <PostFxExpandToggle onClick={() => setIsExpanded(!isExpanded)}>
                    {isExpanded ? "▼" : "▶"} {title}
                </PostFxExpandToggle>
                <PostFxHeaderRight
                    onClick={(e) => e.stopPropagation()}
                    aria-label={ariaLabel ?? `Toggle ${title}`}
                >
                    {tooltip && <Tooltip text={tooltip}
                        width="320px"
                                />}
                    <StyledSwitch
                        checked={enabled}
                        onChange={(e) => onEnabledChange(!!e?.target?.checked)}
                    />
                </PostFxHeaderRight>
            </PostFxSectionHeader>
            {isExpanded && <PostFxSectionBody>{children}</PostFxSectionBody>}
        </PostFxSectionWrapper>
    );
};

const ResetAdvancedButton = styled.button`
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    color: #d8d8d8;
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.2;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;

    &:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.2);
        color: #fff;
    }

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
`;

const UploadButton = styled.button`
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    color: #d8d8d8;
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.2;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
    margin: 0 0 8px;

    &:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.2);
        color: #fff;
    }

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
`;

const AssetInfo = styled.div`
    font-size: 11px;
    color: #aaa;
    padding: 4px 0 8px;
    word-break: break-all;
`;

const AO_ADVANCED_DEFAULTS = {
    resolutionScale: POST_PROCESSING_DEFAULTS.ao.resolutionScale,
    thickness: POST_PROCESSING_DEFAULTS.ao.thickness,
};

/**
 * Post-processing settings panel.
 *
 * Each effect (AO, Bloom, DoF, LUT, Film, Chromatic Aberration, SSR)
 * lives in its own CollapsibleEditorSection with a header-embedded
 * enable/disable switch. Collapsing is independent of enablement — users
 * can enable an effect without expanding its controls (common when just
 * toggling from outside the panel) and vice versa.
 *
 * State path: writes flow to `scene.userData.postProcessing.{feature}`
 * and fire `postProcessingChanged`. The EffectRenderer's
 * `updatePostProcessingFromScene` picks up the change and either updates
 * live uniforms or rebuilds the pipeline (for enable toggles + SSR MRT
 * changes).
 */
export default function PostProcessingSection() {
    const app = global.app as EngineRuntime;

    const [postProcessing, setPostProcessing] = useState<any>(() => {
        return app?.editor?.scene?.userData?.postProcessing || {};
    });

    useEffect(() => {
        setPostProcessing(app?.editor?.scene?.userData?.postProcessing || {});
    }, [app?.editor?.scene?.userData?.postProcessing]);

    const mergedPP = useMemo(() => {
        return normalizePostProcessingConfig(postProcessing);
    }, [postProcessing]);

    const handlePostProcessingChange = (key: string, value: any) => {
        const updated = {
            ...postProcessing,
            [key]: {
                ...postProcessing[key],
                ...value,
            },
        };
        setPostProcessing(updated);
        if (app?.editor?.scene) {
            app.editor.scene.userData.postProcessing = updated;
            app.call("postProcessingChanged", app.editor, app.editor?.scene);
        }
    };

    const handleAOResolutionScaleChange = (value: number) => {
        const previousValue = mergedPP.ao.resolutionScale;

        handlePostProcessingChange("ao", { resolutionScale: value });

        if (previousValue <= 1 && value > 1) {
            showToast({
                type: "warning",
                title: "AO resolution scale above 1",
                body: "Using AO resolution scale above 1 can significantly increase GPU cost.",
            });
        }
    };

    const handleResetAOAdvancedSettings = () => {
        handlePostProcessingChange("ao", AO_ADVANCED_DEFAULTS);
    };

    // --- LUT asset upload --------------------------------------------------
    const lutFileInputRef = useRef<HTMLInputElement | null>(null);
    const {uploadLUT, isUploading: isLUTUploading} = useLUTUploader();
    const removeEditorDependencies = useRemoveEditorDependencies();
    const [lutFileName, setLutFileName] = useState<string>(postProcessing?.lut?.fileName ?? "");
    const [isRemovingLut, setIsRemovingLut] = useState(false);

    useEffect(() => {
        setLutFileName(postProcessing?.lut?.fileName ?? "");
    }, [postProcessing?.lut?.fileName]);

    const handleLutFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        event.target.value = ""; // allow re-upload of the same file

        // If a previous LUT asset exists, detach its dependency before
        // uploading the new one — keeps the scene's asset list clean.
        const previousAssetId = postProcessing?.lut?.assetId;

        const result = await uploadLUT(file);
        if (!result) return;

        // Clear legacy `source` URL when switching to an asset-system LUT.
        // Store the human-readable file name in userData so the UI can show
        // it without having to round-trip to the asset service.
        handlePostProcessingChange("lut", {
            assetId: result.assetId,
            source: "",
            fileName: result.fileName,
        });
        setLutFileName(result.fileName);

        // Best-effort detach of the previous asset from the scene. Don't
        // block the upload flow on this; if it fails the user can manually
        // clean up later.
        if (previousAssetId && previousAssetId !== result.assetId) {
            removeEditorDependencies.mutate([previousAssetId], {
                onError: (err) => console.warn("Failed to detach previous LUT asset", err),
            });
        }
    };

    /**
     * Removes the LUT from the scene. Clears the scene userData reference
     * AND detaches the asset from the scene's asset list via
     * removeEditorDependencies. The asset data itself may still live in
     * the user's asset library if it was attached to other scenes; this
     * only touches the current scene.
     *
     * Safe on failure: if removeEditorDependencies errors (network,
     * permissions), we still clear the userData reference so the LUT
     * pass stops being applied. The engine handles a dangling assetId
     * gracefully — EffectRenderer._resolveLutUrl returns null on missing
     * asset and the LUT pass no-ops.
     */
    const handleRemoveLutAsset = async () => {
        const assetId = postProcessing?.lut?.assetId;

        // Always clear the reference first — guarantees the LUT stops
        // rendering even if the asset detach API call fails.
        handlePostProcessingChange("lut", {
            assetId: "",
            source: "",
            fileName: "",
        });
        setLutFileName("");

        if (!assetId) return;

        setIsRemovingLut(true);
        try {
            await removeEditorDependencies.mutateAsync([assetId]);
            showToast({type: "success", title: "LUT removed from scene"});
        } catch (err) {
            console.error("Failed to detach LUT asset from scene:", err);
            showToast({
                type: "warning",
                title: "LUT reference cleared, but asset cleanup failed",
                body: "The LUT is no longer applied. You can retry from the Assets panel.",
            });
        } finally {
            setIsRemovingLut(false);
        }
    };

    return (
        <>
            {/* Ambient Occlusion */}
            <PostFxSection
                title="Ambient Occlusion"
                enabled={mergedPP.ao.enabled}
                onEnabledChange={(checked) => handlePostProcessingChange("ao", { enabled: checked })}
                ariaLabel="Toggle Ambient Occlusion"
                tooltip="Darkens creases, corners, and contact points where ambient light is occluded. Adds perceived depth and realism to interior geometry without requiring extra lights."
            >
                <NumericInputRow
                    label="Scale"
                    value={mergedPP.ao.scale}
                    setValue={value => handlePostProcessingChange("ao", { scale: value })}
                    min={0.1}
                    max={10}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Overall AO strength. Typical values are 0.5-1.5. Lower values keep the effect subtle, while higher values make creases and contacts much darker."
                />
                <NumericInputRow
                    label="Samples"
                    value={mergedPP.ao.samples}
                    setValue={value => handlePostProcessingChange("ao", { samples: Math.max(1, Math.round(value)) })}
                    min={1}
                    max={64}
                    dragStep={1}
                    decimalPlaces={0}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Number of AO samples per pixel. Typical values are 8-16 for real-time use, 16-32 for higher-end targets, and higher only when you can afford the GPU cost."
                />
                <NumericInputRow
                    label="Kernel Radius"
                    value={mergedPP.ao.kernelRadius}
                    setValue={value => handlePostProcessingChange("ao", { kernelRadius: value })}
                    min={0}
                    max={10}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="How far AO looks for nearby occluders. Typical values are 0.2-2 depending on scene scale. Smaller radii emphasize fine detail, larger radii create broader darkening."
                />
                <CollapsibleEditorSection title="AO Advanced"
                    defaultExpanded={false}
                >
                    <NumericInputRow
                        label="Resolution Scale"
                        value={mergedPP.ao.resolutionScale}
                        setValue={handleAOResolutionScaleChange}
                        min={0.1}
                        max={2}
                        dragStep={0.01}
                        decimalPlaces={2}
                        width="90px"
                        $margin="0 0 8px"
                        labelTooltip="Internal resolution multiplier for the AO pass. 1 is the normal default. Typical values are 0.5-1 for performance-focused scenes. Values above 1 can get expensive quickly."
                    />
                    <NumericInputRow
                        label="Thickness"
                        value={mergedPP.ao.thickness}
                        setValue={value => handlePostProcessingChange("ao", { thickness: value })}
                        min={0}
                        max={10}
                        dragStep={0.01}
                        decimalPlaces={2}
                        width="90px"
                        $margin="0 0 8px"
                        labelTooltip="Thickness assumption used to reduce haloing and edge leaks. Typical values are small and scene-dependent. Increase cautiously if thin geometry produces unstable AO."
                    />
                    <ResetAdvancedButton onClick={handleResetAOAdvancedSettings}>
                        Reset Advanced to Default
                    </ResetAdvancedButton>
                </CollapsibleEditorSection>
            </PostFxSection>

            {/* Bloom */}
            <PostFxSection
                title="Bloom"
                enabled={mergedPP.bloom.enabled}
                onEnabledChange={(checked) => handlePostProcessingChange("bloom", { enabled: checked })}
                ariaLabel="Toggle Bloom"
                tooltip="Adds a soft glow around bright highlights and emissive materials. Good for sun flares, neon signs, magic VFX, and sci-fi UI. Use sparingly to avoid washed-out scenes."
            >
                <NumericInputRow
                    label="Strength"
                    value={mergedPP.bloom.strength}
                    setValue={value => handlePostProcessingChange("bloom", { strength: value })}
                    min={0}
                    max={2}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Overall bloom brightness. Typical values are 0.1-0.8 for subtle polish and 0.8-1.5 for stylized glow-heavy scenes."
                />
                <NumericInputRow
                    label="Radius"
                    value={mergedPP.bloom.radius}
                    setValue={value => handlePostProcessingChange("bloom", { radius: value })}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Spread and softness of the bloom blur. Lower values keep highlights tighter, while higher values create a larger glow halo."
                />
                <NumericInputRow
                    label="Threshold"
                    value={mergedPP.bloom.threshold}
                    setValue={value => handlePostProcessingChange("bloom", { threshold: value })}
                    min={0}
                    max={5}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Brightness threshold before bloom appears. Typical values are around 0.7-1.5. Lower thresholds make more of the image glow, higher thresholds restrict bloom to only the brightest areas."
                />
            </PostFxSection>

            {/* Depth of Field */}
            <PostFxSection
                title="Depth of Field"
                enabled={mergedPP.dof.enabled}
                onEnabledChange={(checked) => handlePostProcessingChange("dof", { enabled: checked })}
                ariaLabel="Toggle Depth of Field"
                tooltip="Blurs objects outside a focus distance to mimic a real camera lens. Good for cinematic cutscenes, photo mode, and focus-pull emphasis. Cheap to enable but can feel heavy-handed in gameplay cameras."
            >
                <NumericInputRow
                    label="Focus Dist"
                    value={mergedPP.dof.focusDistance}
                    setValue={value => handlePostProcessingChange("dof", { focusDistance: value })}
                    min={0.1}
                    max={200}
                    dragStep={0.1}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="World-space distance from camera kept most in focus."
                />
                <NumericInputRow
                    label="Focal Len"
                    value={mergedPP.dof.focalLength}
                    setValue={value => handlePostProcessingChange("dof", { focalLength: value })}
                    min={0.01}
                    max={50}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Depth tolerance around focus plane before strong blur starts."
                />
                <NumericInputRow
                    label="Bokeh"
                    value={mergedPP.dof.bokehScale}
                    setValue={value => handlePostProcessingChange("dof", { bokehScale: value })}
                    min={0}
                    max={10}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Artistic blur size multiplier for out-of-focus areas."
                />
            </PostFxSection>

            {/* Color Grading (LUT) */}
            <PostFxSection
                title="Color Grading (LUT)"
                enabled={mergedPP.lut.enabled}
                onEnabledChange={(checked) => handlePostProcessingChange("lut", { enabled: checked })}
                ariaLabel="Toggle Color Grading"
                tooltip="Applies a color lookup table (.cube / .3dl) to remap the final image's color palette. Use for per-project color grading, day/night moods, or stylized looks without editing every material."
            >
                <input
                    ref={lutFileInputRef}
                    type="file"
                    accept=".cube,.3dl"
                    style={{display: "none"}}
                    onChange={handleLutFileSelect}
                />
                <UploadButton
                    disabled={isLUTUploading}
                    onClick={() => lutFileInputRef.current?.click()}
                >
                    {isLUTUploading ? "Uploading…" : "Upload LUT (.cube / .3dl)"}
                </UploadButton>
                {mergedPP.lut.assetId && (
                    <>
                        <AssetInfo>
                            Asset: {lutFileName || mergedPP.lut.assetId}
                        </AssetInfo>
                        <ResetAdvancedButton
                            onClick={() => { void handleRemoveLutAsset(); }}
                            disabled={isRemovingLut}
                        >
                            {isRemovingLut ? "Removing…" : "Remove LUT from Scene"}
                        </ResetAdvancedButton>
                        <Separator invisible margin="0 0 8px" />
                    </>
                )}
                <TextInputRow
                    label="Source URL"
                    value={mergedPP.lut.source}
                    setValue={value => handlePostProcessingChange("lut", { source: value, assetId: "" })}
                    placeholder="https://.../look.cube"
                    width="90px"
                    margin="0 0 8px"
                    labelTooltip="Alternate source: paste a URL to a hosted .cube/.3dl file. Ignored when an uploaded asset is set above."
                />
                <NumericInputRow
                    label="Intensity"
                    value={mergedPP.lut.intensity}
                    setValue={value => handlePostProcessingChange("lut", { intensity: value })}
                    min={0}
                    max={1}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Blend between original (0) and fully-graded (1) output."
                />
            </PostFxSection>

            {/* Film Grain */}
            <PostFxSection
                title="Film Grain"
                enabled={mergedPP.film.enabled}
                onEnabledChange={(checked) => handlePostProcessingChange("film", { enabled: checked })}
                ariaLabel="Toggle Film Grain"
                tooltip="Overlays an animated grain pattern for a filmic, cinematic, or retro look. Pairs well with horror, noir, and cutscene cameras; keep intensity low for subtle polish."
            >
                <NumericInputRow
                    label="Intensity"
                    value={mergedPP.film.intensity}
                    setValue={value => handlePostProcessingChange("film", { intensity: value })}
                    min={0}
                    max={1}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Grain strength. Typical values: 0.1-0.3 subtle, 0.3-0.5 pronounced."
                />
            </PostFxSection>

            {/* Chromatic Aberration */}
            <PostFxSection
                title="Chromatic Aberration"
                enabled={mergedPP.chromaticAberration.enabled}
                onEnabledChange={(checked) => handlePostProcessingChange("chromaticAberration", { enabled: checked })}
                ariaLabel="Toggle Chromatic Aberration"
                tooltip="Shifts red, green, and blue channels outward to mimic lens color fringing. Good for damage feedback, teleports, warp flashes, and disoriented or drunk states. Subtle at low strength; intense quickly past ~0.02."
            >
                <NumericInputRow
                    label="Strength"
                    value={mergedPP.chromaticAberration.strength}
                    setValue={value => handlePostProcessingChange("chromaticAberration", { strength: value })}
                    min={0}
                    max={1}
                    dragStep={0.001}
                    decimalPlaces={3}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Per-channel offset. 0 = identity, ~0.005 subtle polish, ~0.02 heavy damage feedback, ~0.1 very strong, values above that are highly stylized."
                />
            </PostFxSection>

            {/* Screen-Space Reflections */}
            <PostFxSection
                title="Screen-Space Reflections"
                enabled={mergedPP.ssr.enabled}
                onEnabledChange={(checked) => handlePostProcessingChange("ssr", { enabled: checked })}
                ariaLabel="Toggle Screen-Space Reflections"
                tooltip="Reflects the rendered scene onto metallic and low-roughness surfaces (wet floors, polished counters, glass). Only reflects what's on-screen — use a mirror primitive for off-screen geometry. Auto-disables on lower quality tiers to save bandwidth."
            >
                <NumericInputRow
                    label="Max Distance"
                    value={mergedPP.ssr.maxDistance}
                    setValue={value => handlePostProcessingChange("ssr", { maxDistance: value })}
                    min={1}
                    max={200}
                    dragStep={0.5}
                    decimalPlaces={1}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Maximum ray-march distance in world units. Larger = reflections reach further but cost more per pixel. Typical: 10-30."
                />
                <NumericInputRow
                    label="Thickness"
                    value={mergedPP.ssr.thickness}
                    setValue={value => handlePostProcessingChange("ssr", { thickness: value })}
                    min={0.01}
                    max={2}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Ray-step thickness in world units. Larger values are faster but produce coarser reflections. Typical: 0.05-0.2."
                />
                <NumericInputRow
                    label="Opacity"
                    value={mergedPP.ssr.opacity}
                    setValue={value => handlePostProcessingChange("ssr", { opacity: value })}
                    min={0}
                    max={1}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Reflection blend intensity. 1 = full reflection strength; lower values make reflections more subtle."
                />
                <NumericInputRow
                    label="Quality"
                    value={mergedPP.ssr.quality}
                    setValue={value => handlePostProcessingChange("ssr", { quality: value })}
                    min={0.05}
                    max={1}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Raymarch sample density. Higher values improve detail but increase GPU cost. Quality tiers may clamp this below your requested value on weaker devices."
                />
                <NumericInputRow
                    label="Resolution"
                    value={mergedPP.ssr.resolutionScale}
                    setValue={value => handlePostProcessingChange("ssr", { resolutionScale: value })}
                    min={0.1}
                    max={1}
                    dragStep={0.01}
                    decimalPlaces={2}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Internal SSR render resolution relative to the viewport. Lower values save bandwidth; quality tiers may cap this automatically."
                />
                <PostFxHeaderRight style={{justifyContent: "space-between", width: "100%", marginBottom: 8}}>
                    <span style={{fontSize: 12, color: "#d8d8d8"}}>Blur By Roughness</span>
                    <StyledSwitch
                        checked={!!mergedPP.ssr.blur}
                        onChange={(e) => handlePostProcessingChange("ssr", { blur: !!e?.target?.checked })}
                    />
                </PostFxHeaderRight>
                <NumericInputRow
                    label="Blur Quality"
                    value={mergedPP.ssr.blurQuality}
                    setValue={value => handlePostProcessingChange("ssr", { blurQuality: value })}
                    min={1}
                    max={3}
                    dragStep={1}
                    decimalPlaces={0}
                    width="90px"
                    $margin="0 0 8px"
                    labelTooltip="Higher blur quality produces smoother glossy reflections at extra cost. Ignored when roughness blur is disabled."
                />
            </PostFxSection>
        </>
    );
}

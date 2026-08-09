import {useRef} from "react";
import * as THREE from "three";

import "../css/Section.css";
import {useLightingContext} from "@stem/editor-oss/context";
import global from "@stem/editor-oss/global";
import {ILightState} from "@stem/editor-oss/types/editor";
import ShadowUtils from "@stem/editor-oss/utils/ShadowUtils";
import {Tooltip} from "../../common";
import {InputSymbol} from "../../common/InputSymbol";
import {NumericInput} from "../../common/NumericInput";
import {StyledButton} from "../../common/StyledButton";
import StyledColorPicker from "../../common/StyledColorPicker/StyledColorPicker";
import {PanelCheckbox} from "../common/PanelCheckbox";
import {SelectRow} from "../common/SelectRow";
import {FlexCenterWrapper} from "../common/StyledRowWrapper";
import {PanelSectionTitle, PanelSectionTitleSecondary} from "../RightPanel.style";

const shadowTooltipContent =
    "Use these only when shadows show acne, peter-panning, or shimmer. Bias changes are usually tiny, often around -0.0005 to 0.0005. Normal bias is commonly around 0.01-0.2. Start with very small adjustments.";

type AxisType = "x" | "y" | "z";
type ShadowCastingLight = THREE.Light & {shadow?: THREE.LightShadow | null; castShadow: boolean};

const SHADOW_MAP_REBUILD_DELAY_MS = 100;

const AxisArray: AxisType[] = ["x", "y", "z"];

const disposeShadowMap = (shadow: THREE.LightShadow) => {
    if (shadow.map) {
        shadow.map.dispose();
        shadow.map = null;
    }
};

const updateShadowCameraProjection = (camera: THREE.Camera) => {
    (camera as THREE.Camera & {updateProjectionMatrix?: () => void}).updateProjectionMatrix?.();
};

const rebuildShadowMapAfterRendererCleanup = (
    light: ShadowCastingLight,
    applyShadowChanges: (shadow: THREE.LightShadow) => void,
    notifyChanged: () => void,
) => {
    light.castShadow = false;
    notifyChanged();

    // Three r184 can keep a stale shadow render target when map size changes.
    // Let the renderer observe castShadow=false for a task, then rebuild.
    setTimeout(() => {
        const shadow = light.shadow;
        if (!shadow) return;

        applyShadowChanges(shadow);
        disposeShadowMap(shadow);
        updateShadowCameraProjection(shadow.camera);
        shadow.needsUpdate = true;
        light.castShadow = true;
        notifyChanged();
    }, SHADOW_MAP_REBUILD_DELAY_MS);
};

interface Props {
    lightState: ILightState;
    isLocked?: boolean;
    selectedObj: any;
}

export const LightingSection = ({lightState, isLocked, selectedObj}: Props) => {
    const {
        showColor,
        color,
        showSkyColor,
        skyColor,
        showGroundColor,
        groundColor,
        showIntensity,
        intensity,
        showDecay,
        decay,
        showDistance,
        distance,
        showAngle,
        angle,
        showPenumbra,
        penumbra,
        showWidth,
        width,
        showHeight,
        height,
        showCastShadow,
        castShadow,
        showTarget,
        target,
        showShadowParams,
        shadowMapSize,
        shadowCameraWidth,
        shadowRadius,
        shadowBlurSamples,
        shadowBias,
        shadowNormalBias,
        shadowFocus,
        isUnityStyle,
        showUnityStyle,
    } = lightState;

    const {
        setColorChangeActivated,
        colorChangeActivated,
        setSkyColorChangeActivated,
        skyColorChangeActivated,
        setGroundColorChangeActivated,
        groundColorChangeActivated,
    } = useLightingContext();

    const app = (global as any).app;
    const anchorRef = useRef<HTMLDivElement>(null);

    let shadowCastersCount = 0;
    if (app?.editor?.scene) {
        app.editor.scene.traverse((object: THREE.Object3D) => {
            if (object instanceof THREE.Light && object.castShadow) {
                shadowCastersCount++;
            }
        });
    }

    const disableCastShadow = !castShadow && shadowCastersCount >= 4;

    const handleValueChange = (value: any, key: string) => {
        const selected = app.editor.objectByUuid(selectedObj.uuid);
        if (selected) {
            if (selected.type === "PointLight") {
                if (key === "distance" && value <= 0) {
                    value = 0.1;
                }
            }

            selected[key] = value;

            app.call(`objectChanged`, selected, selected);

            if (key === "castShadow") {
                ShadowUtils.checkShadowCastingLights(app.editor.scene as THREE.Scene);
            }
        }
    };

    const handleColorChange = (value: string) => {
        const selected = app.editor.objectByUuid(selectedObj.uuid);
        if (selected && showColor && value !== undefined) {
            selected.color = new THREE.Color(value);

            let helper = selected.children.filter((n: any) => n.userData.type === "helper")[0];

            if (helper) {
                helper.material.color = selected.color;
            }
            app.call(`objectChanged`, selected, selected);
        }
    };

    const handleSkyColorChange = (value: string) => {
        const selected = app.editor.objectByUuid(selectedObj.uuid);
        if (selected && showSkyColor && value !== undefined) {
            selected.color = new THREE.Color(value);

            let sky = selected.children.filter((n: any) => n.userData.type === "sky")[0];

            if (sky) {
                sky.material.uniforms.topColor.value = selected.color;
            }
            app.call(`objectChanged`, selected, selected);
        }
    };

    const handleGroundColorChange = (value: string) => {
        const selected = app.editor.objectByUuid(selectedObj.uuid);
        if (selected && showGroundColor && value !== undefined) {
            selected.groundColor = new THREE.Color(value);

            let ground = selected.children.filter((n: any) => n.userData.type === "sky")[0];

            if (ground) {
                ground.material.uniforms.bottomColor.value = selected.groundColor;
            }

            app.call(`objectChanged`, selected, selected);
        }
    };

    const handleTargetChange = (value: number, toUpdate: AxisType) => {
        const selected = app.editor.objectByUuid(selectedObj.uuid);
        if (selected && showTarget && value !== undefined) {
            const targetObject = new THREE.Object3D();
            const target = selected.target as THREE.Object3D;

            switch (toUpdate) {
                case "x":
                    targetObject.position.set(value, target.position.y, target.position.z);
                    break;
                case "y":
                    targetObject.position.set(target.position.x, value, target.position.z);
                    break;
                case "z":
                    targetObject.position.set(target.position.x, target.position.y, value);
                    break;
            }

            selected.target = targetObject;
            selected.target.updateMatrixWorld(true);

            app.call(`objectChanged`, selected, selected);
        }
    };

    return (
        <div
            className="Section"
            ref={anchorRef}
        >
            {showUnityStyle && (
                <div className="box">
                    <PanelCheckbox
                        text="Unity-style"
                        checked={!!isUnityStyle}
                        onChange={e => {
                            const selected = app.editor.objectByUuid(selectedObj.uuid);
                            if (selected && typeof selected.isUnityStyle === "boolean") {
                                selected.isUnityStyle = e.target.checked;
                            }
                            app.call(`objectChanged`, selected, selected);
                        }}
                        v2
                        isGray
                        regular
                        tooltipText="Makes the directional light behave more like a Unity-style sun light workflow. Leave this off unless your scene or imported content expects that behavior."
                    />
                </div>
            )}
            {showCastShadow && (
                <div className="box">
                    <Tooltip
                        text={
                            disableCastShadow
                                ? "Maximum performance and stability limit of 4 shadow casting lights reached."
                                : undefined
                        }
                        triggerFullWidth
                    >
                        <PanelCheckbox
                            text="Cast Shadow"
                            checked={!!castShadow}
                            onChange={e => handleValueChange(e.target.checked, "castShadow")}
                            v2
                            isGray
                            regular
                            disabled={disableCastShadow}
                            tooltipText="Lets this light create real-time shadows. Use it on only the most important lights. Typical scenes keep shadow casting to one main sun or a very small number of hero lights."
                        />
                    </Tooltip>
                </div>
            )}
            {showColor && (
                <div className="box">
                    <InlineTooltipLabel
                        label="Color"
                        tooltip="Light tint. Neutral white is the default. Warm tones suggest sunlight or interior lamps, while cooler tones suggest moonlight, overcast skies, or sci-fi lighting."
                    />
                    <div
                        className="color-box"
                        style={
                            !isLocked
                                ? {backgroundColor: color}
                                : {
                                      backgroundColor: color,
                                      pointerEvents: "none",
                                  }
                        }
                        onClick={() => setColorChangeActivated(true)}
                    />
                    {colorChangeActivated && (
                        <StyledColorPicker
                            color={color || "#ffffff"}
                            setColor={value => handleColorChange(value)}
                            hide={() => setColorChangeActivated(false)}
                        />
                    )}
                </div>
            )}
            {showSkyColor && (
                <div className="box">
                    <InlineTooltipLabel
                        label="Sky Color"
                        tooltip="Upper hemisphere tint for hemisphere lights. Usually brighter and cooler than ground color."
                    />
                    <div
                        className="color-box"
                        style={
                            !isLocked
                                ? {backgroundColor: skyColor}
                                : {
                                      backgroundColor: skyColor,
                                      pointerEvents: "none",
                                  }
                        }
                        onClick={() => setSkyColorChangeActivated(true)}
                    />
                    {skyColorChangeActivated && (
                        <StyledColorPicker
                            color={skyColor || "#ffffff"}
                            setColor={(value: string) => handleSkyColorChange(value)}
                            hide={() => setSkyColorChangeActivated(false)}
                        />
                    )}
                </div>
            )}
            {showGroundColor && (
                <div className="box">
                    <InlineTooltipLabel
                        label="Ground Color"
                        tooltip="Lower hemisphere tint for hemisphere lights. Usually darker and warmer than sky color to mimic bounce from terrain or floors."
                    />
                    <div
                        className="color-box"
                        style={
                            !isLocked
                                ? {backgroundColor: groundColor}
                                : {
                                      backgroundColor: groundColor,
                                      pointerEvents: "none",
                                  }
                        }
                        onClick={() => setGroundColorChangeActivated(true)}
                    />
                    {groundColorChangeActivated && (
                        <StyledColorPicker
                            color={groundColor || "#ffffff"}
                            setColor={(value: string) => handleGroundColorChange(value)}
                            hide={() => setGroundColorChangeActivated(false)}
                        />
                    )}
                </div>
            )}
            {showIntensity && (
                <div className="box">
                    <InlineTooltipLabel
                        label="Intensity"
                        tooltip="Brightness of the selected light. Typical values vary by light type, but small fill lights often sit around 0.1-1, while strong suns or hero lights can be higher depending on your tone mapping."
                    />
                    <NumericInput
                        className={"numeric-input"}
                        value={intensity ?? 10}
                        setValue={value => handleValueChange(value, "intensity")}
                        disabled={isLocked}
                    />
                </div>
            )}
            {showDistance && (
                <div className="box">
                    <InlineTooltipLabel
                        label="Distance"
                        tooltip="Range of point or spot lights. A value of 0 usually means no range cutoff. Keep this as tight as possible for better performance and more believable falloff."
                    />
                    <NumericInput
                        className={"numeric-input"}
                        value={distance || 5}
                        setValue={value => handleValueChange(value, "distance")}
                        disabled={isLocked}
                    />
                </div>
            )}
            {showDecay && (
                <div className="box">
                    <InlineTooltipLabel
                        label="Decay"
                        tooltip="How quickly the light fades with distance. A value near 2 is physically plausible. Lower values keep light reaching farther and can feel more game-like or stylized."
                    />
                    <NumericInput
                        className={"numeric-input"}
                        value={decay || 0}
                        setValue={value => handleValueChange(value, "decay")}
                        disabled={isLocked}
                    />
                </div>
            )}
            {showAngle && (
                <div className="box">
                    <InlineTooltipLabel
                        label="Angle"
                        tooltip="Cone width of a spot light, in radians. Smaller values make a tighter beam, larger values create a wider wash. Typical spotlights stay well below 1.2 radians."
                    />
                    <NumericInput
                        className={"numeric-input"}
                        value={angle || 0}
                        setValue={value => handleValueChange(value, "angle")}
                        disabled={isLocked}
                    />
                </div>
            )}
            {showPenumbra && (
                <div className="box">
                    <InlineTooltipLabel
                        label="Penumbra"
                        tooltip="Softness at the edge of a spot light cone. 0 gives a hard edge, 1 gives the softest falloff. Typical values are 0.1-0.5."
                    />
                    <NumericInput
                        className={"numeric-input"}
                        value={penumbra || 0}
                        setValue={value => handleValueChange(value, "penumbra")}
                        disabled={isLocked}
                    />
                </div>
            )}
            {showWidth && (
                <div className="box">
                    <InlineTooltipLabel
                        label="Width"
                        tooltip="Width of a rect area light in world units. Larger values make the light source broader and the specular reflections feel larger and softer."
                    />
                    <NumericInput
                        className={"numeric-input"}
                        value={width || 0}
                        setValue={value => handleValueChange(value, "width")}
                        disabled={isLocked}
                    />
                </div>
            )}
            {showHeight && (
                <div className="box">
                    <InlineTooltipLabel
                        label="Height"
                        tooltip="Height of a rect area light in world units. Adjust width and height together to match the size of the practical light source you are simulating."
                    />
                    <NumericInput
                        className={"numeric-input"}
                        value={height || 0}
                        setValue={value => handleValueChange(value, "height")}
                        disabled={isLocked}
                    />
                </div>
            )}

            {showTarget && (
                <div
                    className="box column"
                    style={{gap: 8}}
                >
                    <InlineTooltipLabel
                        label="Target Position"
                        tooltip="Where the directional or spot light points. Move this instead of rotating the light manually when you want predictable aiming."
                    />
                    <div
                        className="box"
                        style={{gap: 8}}
                    >
                        {AxisArray.map((axis: AxisType) => {
                            return (
                                <div
                                    className="inputWrapper"
                                    key={axis}
                                >
                                    <InputSymbol
                                        symbol={axis.toUpperCase()}
                                        value={+(target?.position[axis as keyof THREE.Vector3] || 0)}
                                        setValue={value => handleTargetChange(value, axis)}
                                        isLocked={false}
                                    />
                                    <NumericInput
                                        id={"light target" + axis}
                                        value={+(target?.position[axis as keyof THREE.Vector3] || 0)}
                                        setValue={() => {}}
                                        className="dark-input"
                                        onBlur={value => handleTargetChange(value, axis)}
                                        onDragValueChange={value => handleTargetChange(value, axis)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            {showShadowParams && (
                <>
                    <div
                        className="box"
                        style={{display: "flex", alignItems: "center", gap: 4}}
                    >
                        <PanelSectionTitle>Shadow Parameters</PanelSectionTitle>
                        <Tooltip text="Fine-tune shadow quality. Adjust resolution, bias, and radius to reduce artifacts like shadow acne or peter-panning." />
                    </div>
                    <div className="box">
                        <InlineTooltipLabel
                            label="Shadow Map Resolution"
                            tooltip="Size of the shadow texture. Typical values are 1024 or 2048. Use 4096 only for large hero shadows, since higher resolutions increase GPU memory and render cost."
                        />
                        <SelectRow
                            label=""
                            data={[
                                {key: "256", value: "256"},
                                {key: "512", value: "512"},
                                {key: "1024", value: "1024"},
                                {key: "2048", value: "2048"},
                                {key: "4096", value: "4096"},
                            ]}
                            value={{
                                key: String(shadowMapSize || 512),
                                value: String(shadowMapSize || 512),
                            }}
                            onChange={item => {
                                const value = Number(item.value);
                                const selected = app.editor.objectByUuid(selectedObj.uuid);
                                if (selected && selected.shadow) {
                                    rebuildShadowMapAfterRendererCleanup(
                                        selected,
                                        shadow => {
                                            shadow.mapSize.set(value, value);
                                        },
                                        () => app.call(`objectChanged`, selected, selected),
                                    );
                                }
                            }}
                            disableTyping
                        />
                    </div>

                    {/* Shadow Camera Distance for DirectionalLight */}
                    {typeof shadowCameraWidth === "number" && (
                        <div className="box">
                            <InlineTooltipLabel
                                label="Shadow Camera Distance"
                                tooltip="Size of the directional light shadow coverage area. Smaller values make shadows sharper because the same map covers less space. Keep it only as large as the playable area that needs shadows."
                            />
                            <NumericInput
                                className={"numeric-input"}
                                value={shadowCameraWidth}
                                setValue={value => {
                                    const selected = app.editor.objectByUuid(selectedObj.uuid);
                                    if (selected && selected.shadow && selected.shadow.camera) {
                                        const half = value / 2;
                                        selected.shadow.camera.left = -half;
                                        selected.shadow.camera.right = half;
                                        selected.shadow.camera.top = half;
                                        selected.shadow.camera.bottom = -half;
                                        selected.shadow.camera.updateProjectionMatrix?.();
                                        app.call(`objectChanged`, selected, selected);
                                    }
                                }}
                                disabled={isLocked || !castShadow}
                                min={0.01}
                            />
                        </div>
                    )}
                    <div className="box">
                        <TooltipLabel
                            anchorRef={anchorRef}
                            label="Shadow Bias"
                        />
                        <NumericInput
                            className={"numeric-input"}
                            value={shadowBias ?? 0}
                            setValue={value => {
                                const selected = app.editor.objectByUuid(selectedObj.uuid);
                                if (selected && selected.shadow) {
                                    selected.shadow.bias = value;
                                    app.call(`objectChanged`, selected, selected);
                                }
                            }}
                            disabled={isLocked || !castShadow}
                            min={-1}
                            max={1}
                            dragStep={0.00001}
                            decimalPlaces={6}
                        />
                    </div>
                    <div className="box">
                        <TooltipLabel
                            anchorRef={anchorRef}
                            label="Normal Bias"
                        />
                        <NumericInput
                            className={"numeric-input"}
                            value={shadowNormalBias ?? 0}
                            setValue={value => {
                                const selected = app.editor.objectByUuid(selectedObj.uuid);
                                if (selected && selected.shadow) {
                                    selected.shadow.normalBias = value;
                                    app.call(`objectChanged`, selected, selected);
                                }
                            }}
                            disabled={isLocked || !castShadow}
                            min={-1}
                            max={1}
                            decimalPlaces={6}
                        />
                    </div>

                    {(() => {
                        const shadowMapType = app.editor?.rendering.shadowMapType;
                        if (shadowMapType === THREE.PCFShadowMap || shadowMapType === THREE.VSMShadowMap) {
                            return (
                                <div className="box">
                                    <InlineTooltipLabel
                                        label="Shadow Radius"
                                        tooltip="Softness filter for supported shadow map types. Typical values are 1-4. Increase it for softer shadows, but very high values can look mushy or cause artifacts."
                                    />
                                    <NumericInput
                                        className={"numeric-input"}
                                        value={shadowRadius ?? 3}
                                        setValue={value => {
                                            const selected = app.editor.objectByUuid(selectedObj.uuid);
                                            if (selected && selected.shadow) {
                                                selected.shadow.radius = value;
                                                app.call(`objectChanged`, selected, selected);
                                            }
                                        }}
                                        disabled={isLocked || !castShadow}
                                        min={0}
                                        max={20}
                                        decimalPlaces={2}
                                    />
                                </div>
                            );
                        }
                        return null;
                    })()}
                    {(() => {
                        const shadowMapType = app.editor?.rendering.shadowMapType;
                        if (shadowMapType === THREE.VSMShadowMap) {
                            return (
                                <div className="box">
                                    <InlineTooltipLabel
                                        label="Shadow Blur Samples"
                                        tooltip="Number of blur samples used by VSM shadows. Typical values are 4-8. Higher values can smooth noise but cost more performance."
                                    />
                                    <NumericInput
                                        className={"numeric-input"}
                                        value={shadowBlurSamples ?? 8}
                                        setValue={value => {
                                            const selected = app.editor.objectByUuid(selectedObj.uuid);
                                            if (selected && selected.shadow) {
                                                selected.shadow.blurSamples = value;
                                                app.call(`objectChanged`, selected, selected);
                                            }
                                        }}
                                        disabled={isLocked || !castShadow}
                                        min={1}
                                        max={32}
                                        dragStep={1}
                                        decimalPlaces={0}
                                    />
                                </div>
                            );
                        }
                        return null;
                    })()}
                    <StyledButton
                        isBlue
                        onClick={() => {
                            const selected = app.editor.objectByUuid(selectedObj.uuid);
                            if (selected && selected.shadow) {
                                rebuildShadowMapAfterRendererCleanup(
                                    selected,
                                    shadow => {
                                        shadow.radius = 3;
                                        shadow.bias = 0;
                                        shadow.normalBias = 0.1;
                                        shadow.mapSize.set(2048, 2048);

                                        if (shadow.camera instanceof THREE.OrthographicCamera) {
                                            const value = 200;
                                            const half = value / 2;
                                            shadow.camera.left = -half;
                                            shadow.camera.right = half;
                                            shadow.camera.top = half;
                                            shadow.camera.bottom = -half;
                                        }
                                    },
                                    () => app.call(`objectChanged`, selected, selected),
                                );
                            }
                        }}
                        disabled={isLocked || !castShadow}
                    >
                        Reset Shadow to Default
                    </StyledButton>
                    {typeof shadowFocus === "number" && (
                        <div className="box">
                            <InlineTooltipLabel
                                label="Shadow Focus"
                                tooltip="Focus factor for supported spot light shadows. Lower values spread detail more evenly, while higher values concentrate more detail near the center."
                            />
                            <NumericInput
                                className={"numeric-input"}
                                value={shadowFocus}
                                setValue={value => {
                                    const selected = app.editor.objectByUuid(selectedObj.uuid);
                                    if (selected && selected.shadow) {
                                        selected.shadow.focus = value;
                                        app.call(`objectChanged`, selected, selected);
                                    }
                                }}
                                disabled={isLocked || !castShadow}
                                min={0}
                                max={1}
                                decimalPlaces={3}
                            />
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export const TooltipLabel = ({
    anchorRef,
    label,
}: {
    anchorRef: React.RefObject<HTMLElement | null> | undefined;
    label: string;
}) => {
    return (
        <FlexCenterWrapper>
            <PanelSectionTitleSecondary style={{marginBottom: 0}}>{label}</PanelSectionTitleSecondary>
            <Tooltip
                content={shadowTooltipContent}
                stayOpenOnHover
                maxWidth="360px"
                placement="left-of-anchor"
                anchorRef={anchorRef}
                triggerFullWidth={false}
                offsetX={-10}
            />
        </FlexCenterWrapper>
    );
};

const InlineTooltipLabel = ({label, tooltip}: {label: string; tooltip: string}) => (
    <FlexCenterWrapper>
        <PanelSectionTitleSecondary style={{marginBottom: 0}}>{label}</PanelSectionTitleSecondary>
        <Tooltip
            content={tooltip}
            stayOpenOnHover
            maxWidth="360px"
            triggerFullWidth={false}
        />
    </FlexCenterWrapper>
);

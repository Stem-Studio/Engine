import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import * as THREE from "three";

import {DIRECTIONAL_LIGHT_ROWS, ROWS} from "./helpers";
import {MaterialRow} from "./ModelEditorButtons/ModelEditorButtons";
import {CameraPanel} from "./panels/CameraPanel/CameraPanel";
import {CurveEditorPanel} from "./panels/CurveEditorPanel";
import {MaterialEditorPanel} from "./panels/MaterialEditorPanel/MaterialEditorPanel";
import {Panel} from "./panels/Panels/Panels";
import {BasicParticleEmitterPanel} from "./panels/ParticleEmitterPanel/BasicParticleEmitterPanel";
import {DefaultLightsAndFogPanel} from "./panels/ProjectSettings/DefaultLightsAndFogPanel/DefaultLightsAndFogPanel";
import {GameSettings} from "./panels/ProjectSettings/GameSettings";
import {RenderingAndPerformancePanel} from "./panels/RenderingAndPerformance";
import {SVGPathPanel} from "./panels/SVGPathPanel";
import {TextPanel} from "./panels/TextPanel";
import {ToolsBehaviorPanel} from "./panels/ToolsBehaviorPanel";
import {BorderedWrapper, Container, PanelContentWrapper} from "./RightPanel.style";
import {BasicPropertiesSection} from "./sections/BasicPropertiesSection";
import {StartOnTriggerLight} from "./StartOnTriggerLight";
import {LambdaComponentsTab} from "./tabs/LambdaComponents/LambdaComponentsTab";
import {ObjectBehaviorsTab} from "./tabs/ObjectBehaviors";
import {
    BILLBOARD_BEHAVIOR_ID,
    GENERIC_SOUND_BEHAVIOR_ID,
    IMAGE_BILLBOARD_BEHAVIOR_ID,
    SPAWN_POINT_BEHAVIOR_ID,
    TERRAIN_BEHAVIOR_ID,
    VIDEO_BILLBOARD_BEHAVIOR_ID,
    VOLUME_BEHAVIOR_ID,
} from "@stem/editor-oss/EngineRuntime";
import BehaviorData from "../../../../behaviors/BehaviorData";
import {useAppGlobalContext} from "@stem/editor-oss/context";
import {RIGHT_PANEL_VERSIONS} from "@stem/editor-oss/context/appStateTypes";
import LightingContextProvider from "@stem/editor-oss/context/LightingContext";
import {useEditorSelection} from "@stem/editor-oss/hooks/useEditorSelection";
import {isModelAssetInstance} from "@stem/editor-oss/model/util";
import CustomShape from "../../../../object/geometry/CustomShape";
import CustomTube from "../../../../object/geometry/CustomTube";
import Text3D from "../../../../object/geometry/Text3D";
import {findTopVFXParent, isVFXParent} from "@stem/editor-oss/services";
import {EDITOR_TOP_NAV_HALF_HEIGHT, PANEL_FULL_HEIGHT} from "@stem/editor-oss/types/editor";
import {isDirectionalLight} from "@stem/editor-oss/utils/LightUtils";
import {
    containsPlanCadSelectionMetadata,
    hasPlanCadSelectionMetadata,
} from "@stem/editor-oss/utils/PlanCadSelectionMetadata";
import {isChildOfScene} from "@stem/editor-oss/utils/SceneUtil";
import {ResizableWrapper} from "../common/ResizableWrapper/ResizableWrapper";
import {StyledButton} from "../common/StyledButton";
import {NEW_MISC_NAME} from "../LeftPanel/MainTabs/AssetsTab/SubTabs/MiscTab";
import {PlanCadPropertiesSection} from "../PlanMode/PlanCadPropertiesSection";

export enum TABS {
    OBJECT_3D = "Properties",
    BEHAVIORS = "Behaviors",
    LAMBDAS = "Lambdas",
    SCENE_SETTINGS = "Settings",
}

type Props = {
    showModelAnimationCombiner: () => void;
    openUIPanel: () => void;
    onResize?: (width: number) => void;
    onVisibilityChange?: (visible: boolean) => void;
    /** Width percentage of the pinned code editor (0 when not pinned). Shifts the panel left. */
    pinnedCodeEditorWidth?: number;
    /**
     * Width (in pixels) the AI copilot is currently occupying on the right
     * edge. When > 0, the RightPanel tucks in to the left of the copilot
     * so the two don't overlap. 0 means the copilot is closed or absent.
     */
    aiCopilotOffsetRight?: number;
    drawerMode?: boolean;
    onRequestClose?: () => void;
};

type TextureJSON = ReturnType<THREE.Texture["toJSON"]>;

export type TextureType = THREE.Texture | TextureJSON | null;

export interface IBehaviorUISettings {
    behaviorID: string;
    showTransformationSection?: boolean;
    justPosition?: boolean;
}

const RightPanel = ({showModelAnimationCombiner, openUIPanel, onResize, onVisibilityChange, pinnedCodeEditorWidth = 0, aiCopilotOffsetRight = 0, drawerMode = false, onRequestClose}: Props) => {
    const {activeRightPanel, setActiveRightPanel} = useAppGlobalContext();
    const isGameSettingsPanelOpen = activeRightPanel === RIGHT_PANEL_VERSIONS.GameSettings;
    const isCameraSettingsPanelOpen = activeRightPanel === RIGHT_PANEL_VERSIONS.CameraSettings;
    const isRenderingPerformancePanelOpen = activeRightPanel === RIGHT_PANEL_VERSIONS.RenderingAndPerformance;
    const isDefaultLightsAndFogPanelOpen = activeRightPanel === RIGHT_PANEL_VERSIONS.DEFAULT_LIGHTS_FOG;
    const isMaterialEditorPanelOpen = activeRightPanel === RIGHT_PANEL_VERSIONS.MaterialEditor;
    const noBehaviorsPanel = activeRightPanel !== RIGHT_PANEL_VERSIONS.None;
    const [behaviorUISettings, setBehaviorUISettings] = useState<IBehaviorUISettings | null>(null);
    const [activeTab, setActiveTab] = useState(TABS.OBJECT_3D);
    const [isScene, setIsScene] = useState(false);
    const [isPrimitive, setIsPrimitive] = useState(false);
    const [isStem, setIsStem] = useState(false);
    const [isParticleEmitter, setIsParticleEmitter] = useState(false);
    // state for rows
    const [showPhysics, setShowPhysics] = useState(false);
    const [showRigidBody, setShowRigidBody] = useState(false);
    const [showModelLighting, setShowModelLighting] = useState(false);
    const [showModelEditorSection, setShowModelEditorSection] = useState(true);
    const [showCollision, setShowCollision] = useState(false);
    const [hideAll, setHideAll] = useState(false);
    const [showTexture, setShowTexture] = useState(false);
    const [isPhoneSheet, setIsPhoneSheet] = useState(() =>
        typeof window !== "undefined" && window.matchMedia("(max-width: 600px)").matches,
    );
    const [texture, setTexture] = useState<TextureType>(null);
    const [color, setColor] = useState<string | null>(null);
    const {selected, selectionVersion, app} = useEditorSelection("RightPanel");
    const selectedObj = useMemo(() => app?.editor?.getSelectedObject(), [selectionVersion]);
    const shouldRenderPlanCadProperties =
        hasPlanCadSelectionMetadata(selectedObj) ||
        containsPlanCadSelectionMetadata(selectedObj);
    const activeRightPanelRef = useRef(activeRightPanel);
    const keepMaterialPanelOpenRef = useRef(false);

    useEffect(() => {
        const query = window.matchMedia("(max-width: 600px)");
        const update = (event: MediaQueryListEvent | MediaQueryList) => setIsPhoneSheet(event.matches);
        query.addEventListener("change", update);
        update(query);
        return () => query.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        activeRightPanelRef.current = activeRightPanel;
        updateBehaviorSettings();
    }, [activeRightPanel]);

    useEffect(() => {
        if (
            !selected &&
            activeRightPanel !== RIGHT_PANEL_VERSIONS.DEFAULT_LIGHTS_FOG &&
            activeRightPanel !== RIGHT_PANEL_VERSIONS.RenderingAndPerformance &&
            activeRightPanel !== RIGHT_PANEL_VERSIONS.GameSettings
        ) {
            setActiveRightPanel(RIGHT_PANEL_VERSIONS.None);
        }
    }, [selectionVersion, setActiveRightPanel]);

    const behaviorUISettingsRef = useRef<IBehaviorUISettings | null>(null);

    const updateBehaviorSettings = () => {
        let next: IBehaviorUISettings | null = null;

        if (activeRightPanelRef.current === RIGHT_PANEL_VERSIONS.SpawnPoint) {
            next = {
                behaviorID: SPAWN_POINT_BEHAVIOR_ID,
                showTransformationSection: true,
                justPosition: true,
            };
        } else if (activeRightPanelRef.current === RIGHT_PANEL_VERSIONS.Terrain) {
            next = {behaviorID: TERRAIN_BEHAVIOR_ID};
        } else if (activeRightPanelRef.current === RIGHT_PANEL_VERSIONS.Volume) {
            next = {
                behaviorID: VOLUME_BEHAVIOR_ID,
                showTransformationSection: true,
                justPosition: false,
            };
        } else if (activeRightPanelRef.current === RIGHT_PANEL_VERSIONS.GenericSound) {
            next = {
                behaviorID: GENERIC_SOUND_BEHAVIOR_ID,
                showTransformationSection: true,
                justPosition: false,
            };
        } else if (activeRightPanelRef.current === RIGHT_PANEL_VERSIONS.Billboard) {
            next = {
                behaviorID: BILLBOARD_BEHAVIOR_ID,
                showTransformationSection: true,
                justPosition: false,
            };
        } else if (activeRightPanelRef.current === RIGHT_PANEL_VERSIONS.ImageBillboard) {
            next = {
                behaviorID: IMAGE_BILLBOARD_BEHAVIOR_ID,
                showTransformationSection: true,
                justPosition: false,
            };
        } else if (activeRightPanelRef.current === RIGHT_PANEL_VERSIONS.VideoBillboard) {
            next = {
                behaviorID: VIDEO_BILLBOARD_BEHAVIOR_ID,
                showTransformationSection: true,
                justPosition: false,
            };
        }

        const prev = behaviorUISettingsRef.current;
        if (
            prev?.behaviorID === next?.behaviorID &&
            prev?.showTransformationSection === next?.showTransformationSection &&
            prev?.justPosition === next?.justPosition
        ) {
            return;
        }
        behaviorUISettingsRef.current = next;
        setBehaviorUISettings(next);
    };

    const checkBehaviors = (behaviors: BehaviorData[], currentSelected: THREE.Object3D | null): boolean => {
        let panelSet = false;

        // Process behaviors in priority order to avoid conflicts
        // Priority: Terrain > SpawnPoint > Volume > GenericSound
        const behaviorIds = behaviors?.map(b => b.id) || [];

        let targetPanel: RIGHT_PANEL_VERSIONS | null = null;

        if (behaviorIds.includes(TERRAIN_BEHAVIOR_ID)) {
            targetPanel = RIGHT_PANEL_VERSIONS.Terrain;
        } else if (behaviorIds.includes(SPAWN_POINT_BEHAVIOR_ID)) {
            targetPanel = RIGHT_PANEL_VERSIONS.SpawnPoint;
        } else if (behaviorIds.includes(VOLUME_BEHAVIOR_ID)) {
            // Check if this is a proper scene volume
            const isSceneVolume =
                currentSelected &&
                (currentSelected.userData.isSceneVolume || currentSelected.name.includes(NEW_MISC_NAME.VOLUMES));

            targetPanel = isSceneVolume ? RIGHT_PANEL_VERSIONS.Volume : RIGHT_PANEL_VERSIONS.None;
        } else if (behaviorIds.includes(GENERIC_SOUND_BEHAVIOR_ID)) {
            targetPanel = RIGHT_PANEL_VERSIONS.GenericSound;
        } else if (behaviorIds.includes(BILLBOARD_BEHAVIOR_ID)) {
            targetPanel = RIGHT_PANEL_VERSIONS.Billboard;
        } else if (behaviorIds.includes(IMAGE_BILLBOARD_BEHAVIOR_ID)) {
            targetPanel = RIGHT_PANEL_VERSIONS.ImageBillboard;
        } else if (behaviorIds.includes(VIDEO_BILLBOARD_BEHAVIOR_ID)) {
            targetPanel = RIGHT_PANEL_VERSIONS.VideoBillboard;
        }

        if (targetPanel !== null) {
            if (activeRightPanelRef.current !== targetPanel) {
                setActiveRightPanel(targetPanel);
            }
            panelSet = true;
        }

        return panelSet;
    };

    const hideRows = () => {
        setShowPhysics(false);
        setShowRigidBody(false);
        setShowModelLighting(false);
        setShowTexture(false);
        setShowCollision(false);
    };

    useEffect(() => {
        keepMaterialPanelOpenRef.current = !!showModelEditorSection && !!isMaterialEditorPanelOpen;
    }, [showModelEditorSection, isMaterialEditorPanelOpen]);

    const handleUpdate = useCallback(() => {
        updateBehaviorSettings();
        const currentSelectedObj = app.editor?.getSelectedObject();

        // Handle cases where no object is selected
        if (!currentSelectedObj) {
            // If there is a selection in editor but getSelectedObject() returned null,
            // this might be a timing issue - don't change the panel
            if (app.editor?.selected) {
                console.log(
                    "[RightPanel] Editor has selection but getSelectedObject returned null - potential timing issue",
                );
                // Early return to avoid clearing the panel
                return;
            }
            // No selection - don't automatically show any panel
            return;
        }

        // When an object is selected, ensure we have an appropriate panel
        if (currentSelectedObj) {
            let shouldSetDefaultPanel = true;
            // Check for specific behavior panels, but skip for groups with
            // multiple behaviors so the full behavior list stays accessible.
            const behaviors = currentSelectedObj?.userData.behaviors;
            const isGroupWithMultipleBehaviors =
                currentSelectedObj instanceof THREE.Group && Array.isArray(behaviors) && behaviors.length > 1;
            const behaviorPanelSet = !isGroupWithMultipleBehaviors && checkBehaviors(behaviors, currentSelectedObj);
            if (behaviorPanelSet) {
                shouldSetDefaultPanel = false;
            }

            if (
                (currentSelectedObj as {cls?: string}).cls === "Camera" ||
                (currentSelectedObj as {isCamera?: boolean}).isCamera ||
                currentSelectedObj.type === "Scene"
            ) {
                shouldSetDefaultPanel = false;
            }

            if (keepMaterialPanelOpenRef.current) {
                shouldSetDefaultPanel = false;
            }

            // If no specific panel was set, default to None to show object properties
            if (shouldSetDefaultPanel && activeRightPanelRef.current !== RIGHT_PANEL_VERSIONS.None) {
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.None);
            }
        }

        const isSelectedScene =
            currentSelectedObj instanceof THREE.Object3D &&
            currentSelectedObj.type === "Scene" &&
            currentSelectedObj instanceof THREE.Scene;
        const is3dObject =
            currentSelectedObj &&
            currentSelectedObj instanceof THREE.Object3D &&
            (currentSelectedObj.type === "Object3D" || currentSelectedObj.isObject3D);
        const isGroup =
            currentSelectedObj &&
            currentSelectedObj instanceof THREE.Group &&
            (currentSelectedObj.type === "Group" || currentSelectedObj.isGroup);
        const isLight = currentSelectedObj instanceof THREE.Light;
        const isModel = isModelAssetInstance(currentSelectedObj);

        // Legacy plane primitives are actually a Group or Object3D with a Mesh
        // child object. These legacy planes are identified by userData.isPlane.
        const isPrimitiveSelected =
            (currentSelectedObj instanceof THREE.Mesh && !!currentSelectedObj.geometry?.type) ||
            (currentSelectedObj instanceof THREE.Object3D && currentSelectedObj?.userData?.isPlane);
        const childOfScene = currentSelectedObj instanceof THREE.Object3D && isChildOfScene(currentSelectedObj);
        const vfxSelectionTarget =
            currentSelectedObj && currentSelectedObj instanceof THREE.Object3D
                ? findTopVFXParent(currentSelectedObj, app.editor?.scene)
                : null;
        const isParticleEmitterSelected =
            !!currentSelectedObj &&
            (currentSelectedObj?.userData.isVFX ||
                isVFXParent(currentSelectedObj) ||
                currentSelectedObj.type === "ParticleEmitter" ||
                !!vfxSelectionTarget);
        const isStemSelected = !!currentSelectedObj.userData.prefabId;

        setIsPrimitive(isPrimitiveSelected);
        setIsStem(isStemSelected);

        setIsParticleEmitter(isParticleEmitterSelected);
        setIsScene(!!isSelectedScene);
        setHideAll(!!isSelectedScene);

        if (isSelectedScene) {
            hideRows();
            setTexture(null);
            setColor(null);
            setShowModelEditorSection(false);
            if (activeRightPanelRef.current !== RIGHT_PANEL_VERSIONS.None) {
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.DEFAULT_LIGHTS_FOG);
            }
            return;
        }

        if (
            isLight ||
            !currentSelectedObj ||
            !(
                currentSelectedObj instanceof THREE.Mesh ||
                currentSelectedObj instanceof THREE.SkinnedMesh ||
                isGroup ||
                is3dObject
            )
        ) {
            hideRows();
            setTexture(null);
            setColor(null);
            setShowModelEditorSection(false);
            return;
        }
        if (isGroup || is3dObject) {
            setShowPhysics(childOfScene);
            setShowRigidBody(currentSelectedObj?.userData?.physics?.enabled);
            setShowModelLighting(true);
            setShowCollision(true);
            setShowTexture(false);
            setTexture(null);
            setColor(null);
            setShowModelEditorSection(true);
        }

        if (currentSelectedObj instanceof THREE.Mesh || currentSelectedObj instanceof THREE.SkinnedMesh) {
            const material = currentSelectedObj.material;
            setShowPhysics(childOfScene);
            setShowRigidBody(currentSelectedObj?.userData?.physics?.enabled);
            setShowModelLighting(true);
            setShowCollision(true);
            if (currentSelectedObj.material instanceof Array) {
                setShowTexture(false);
            } else if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhongMaterial) {
                setShowTexture(true);
                setTexture(material?.map || null);
                const colorHex = `#${material?.color?.getHexString()}`;
                setColor(currentSelectedObj.material ? colorHex : null);
            }

            setShowModelEditorSection(true);
        }

        if (isModel) {
            setShowModelEditorSection(true);
            setShowPhysics(true);
        }

        if (isPrimitiveSelected) {
            setShowModelEditorSection(true);
            setShowPhysics(true);
        }

        if (isParticleEmitterSelected) {
            setShowModelEditorSection(false);
            setShowPhysics(false);
        }
    }, [selectionVersion]);

    useEffect(() => {
        if (selected) {
            handleUpdate();
        } else {
            setIsScene(false);
        }
    }, [selectionVersion]);

    useEffect(() => {
        if (noBehaviorsPanel) {
            setActiveTab(TABS.OBJECT_3D);
        }
    }, [noBehaviorsPanel]);

    useEffect(() => {
        if (
            isScene &&
            activeTab !== TABS.SCENE_SETTINGS &&
            activeTab !== TABS.BEHAVIORS &&
            activeTab !== TABS.LAMBDAS
        ) {
            setActiveTab(TABS.SCENE_SETTINGS);
        }
    }, [isScene]);

    useEffect(() => {
        // Keep the active tab across object selection changes, except Scene Settings
        // which only applies to scene selection.
        if (!isScene && activeTab === TABS.SCENE_SETTINGS) {
            setActiveTab(TABS.OBJECT_3D);
        }
    }, [isScene, activeTab]);

    const shouldRenderBasicTabs = () => {
        return activeRightPanel === RIGHT_PANEL_VERSIONS.None;
    };

    const shouldRenderTabs = () => {
        // When a scene is selected we still want SCENE_SETTINGS / BEHAVIORS /
        // LAMBDAS tabs visible even though DOT-6862 now auto-opens the
        // DEFAULT_LIGHTS_FOG panel — otherwise scene-level behaviors and
        // lambdas become unreachable.
        return (
            !isGameSettingsPanelOpen &&
            !isRenderingPerformancePanelOpen &&
            (!isDefaultLightsAndFogPanelOpen || isScene)
        );
    };

    // Memoized tab click handlers to prevent re-renders
    const handleObjectTabClick = useCallback(() => {
        setActiveTab(TABS.OBJECT_3D);
    }, []);

    const handleBehaviorsTabClick = useCallback(() => {
        setActiveTab(TABS.BEHAVIORS);
    }, []);

    // Memoized style for ResizableWrapper — shifts left when the pinned code
    // editor or the AI copilot is visible on the right edge.
    const wrapperStyle = useMemo(() => {
        if (drawerMode) {
            return {
                position: "fixed" as const,
                zIndex: 100,
                right: 0,
                top: "calc(48px + env(safe-area-inset-top, 0px))",
                bottom: 0,
                transform: "none",
                width: isPhoneSheet ? "100vw" : "min(380px, 90vw)",
                height: "auto",
                maxHeight: "none",
            };
        }
        let right: string;
        if (pinnedCodeEditorWidth) {
            right = `calc(${pinnedCodeEditorWidth}% + 12px)`;
        } else if (aiCopilotOffsetRight > 0) {
            // +12px gutter from the viewport edge, +8px gap between copilot and panel.
            right = `${aiCopilotOffsetRight + 12 + 8}px`;
        } else {
            right = "12px";
        }
        return {
            position: "fixed" as const,
            zIndex: 100,
            right,
            top: "50%",
            transform: `translateY(calc(-50% + ${EDITOR_TOP_NAV_HALF_HEIGHT}))`,
            height: PANEL_FULL_HEIGHT,
            maxHeight: PANEL_FULL_HEIGHT,
        };
    }, [pinnedCodeEditorWidth, aiCopilotOffsetRight, drawerMode, isPhoneSheet]);

    const basicTabs = useMemo(() => {
        const isTextEditorPanelOpen = selectedObj instanceof Text3D;
        if (!selected || Array.isArray(selected)) return;
        const selectedVFXTarget = findTopVFXParent(selected, app.editor?.scene);
        if (
            selected.userData.isVFX ||
            isVFXParent(selected) ||
            selected.type === "ParticleEmitter" ||
            selectedVFXTarget
        ) {
            return <BasicParticleEmitterPanel />;
        } else if (isDirectionalLight(selected)) {
            return DIRECTIONAL_LIGHT_ROWS.map(({name, type}, index) => (
                <Panel
                    key={type + index}
                    panelType={type}
                    label={name}
                    texture={texture}
                    color={color}
                    setColor={setColor}
                    showCollision={showCollision}
                    showModelLighting={showModelLighting}
                    showPhysics={showPhysics}
                    showRigidBody={showRigidBody}
                    showTexture={showTexture}
                    hideAll={hideAll}
                    simpleMovementSection
                    isStem={isStem}
                />
            ));
        } else {
            return (
                <>
                    <StartOnTriggerLight />
                    {ROWS.map(({name, type}, index) => (
                        <Panel
                            key={type + index}
                            panelType={type}
                            label={name}
                            texture={texture}
                            color={color}
                            setColor={setColor}
                            showCollision={showCollision}
                            showModelLighting={showModelLighting}
                            showPhysics={showPhysics}
                            showRigidBody={showRigidBody}
                            showTexture={showTexture}
                            hideAll={hideAll}
                            simpleMovementSection
                            hideTextProperties={isTextEditorPanelOpen}
                            isStem={isStem}
                        />
                    ))}
                </>
            );
        }
    }, [
        isPrimitive,
        isParticleEmitter,
        isScene,
        isCameraSettingsPanelOpen,
        isDefaultLightsAndFogPanelOpen,
        color,
        texture,
        showCollision,
        showModelLighting,
        showPhysics,
        showRigidBody,
        hideAll,
        selectedObj,
    ]);

    const isVisible = !(activeRightPanel === RIGHT_PANEL_VERSIONS.None && !selected);

    useEffect(() => {
        onVisibilityChange?.(isVisible);
    }, [isVisible]);

    if (!isVisible) {
        return null;
    }

    return (
        <ResizableWrapper
            initialWidth={258}
            minWidth={258}
            maxWidth={() => window.innerWidth * (pinnedCodeEditorWidth ? (1 - pinnedCodeEditorWidth / 100) * 0.4 : 0.3)}
            storageKey="right_panel_width"
            style={wrapperStyle}
            className={drawerMode ? "right-panel-drawer" : undefined}
            onResize={onResize}
        >
            <Container as="aside"
                aria-label="Inspector"
            >
                {drawerMode && (
                    <button className="panel-close"
                        type="button"
                        aria-label="Close inspector"
                        onClick={onRequestClose}
                    >
                        ×
                    </button>
                )}
                {shouldRenderTabs() && (
                    <BorderedWrapper height="48px">
                        {isScene && (
                            <StyledButton
                                isActive={activeTab === TABS.SCENE_SETTINGS}
                                onClick={() => setActiveTab(TABS.SCENE_SETTINGS)}
                            >
                                {TABS.SCENE_SETTINGS}
                            </StyledButton>
                        )}
                        {!isScene && (
                            <>
                                {isMaterialEditorPanelOpen ? (
                                    <StyledButton isActive>Materials</StyledButton>
                                ) : (
                                    <StyledButton
                                        isActive={activeTab === TABS.OBJECT_3D}
                                        onClick={handleObjectTabClick}
                                    >
                                        {TABS.OBJECT_3D}
                                    </StyledButton>
                                )}
                            </>
                        )}
                        {(!noBehaviorsPanel || isScene) && (
                            <StyledButton
                                isActive={activeTab === TABS.BEHAVIORS}
                                onClick={handleBehaviorsTabClick}
                            >
                                {TABS.BEHAVIORS}
                            </StyledButton>
                        )}
                        {(!noBehaviorsPanel || isScene) && (
                            <StyledButton
                                isActive={activeTab === TABS.LAMBDAS}
                                onClick={() => setActiveTab(TABS.LAMBDAS)}
                            >
                                {TABS.LAMBDAS}
                            </StyledButton>
                        )}
                    </BorderedWrapper>
                )}
                <PanelContentWrapper
                    className="hidden-scroll"
                    $isBehaviorOpen={activeTab === TABS.BEHAVIORS || activeTab === TABS.LAMBDAS}
                >
                    <GameSettings openUIPanel={openUIPanel} />
                    {!!behaviorUISettings && activeTab !== TABS.BEHAVIORS && (
                        <ToolsBehaviorPanel behaviorUISettings={behaviorUISettings} />
                    )}
                    {isMaterialEditorPanelOpen && (
                        <MaterialEditorPanel
                            showModelAnimationCombiner={showModelAnimationCombiner}
                            isPrimitiveSelected={isPrimitive}
                            isStemSelected={isStem}
                        />
                    )}
                    <CameraPanel />
                    {isRenderingPerformancePanelOpen && <RenderingAndPerformancePanel />}
                    {isDefaultLightsAndFogPanelOpen && (!isScene || activeTab === TABS.SCENE_SETTINGS) && <DefaultLightsAndFogPanel />}

                    {activeTab === TABS.OBJECT_3D && (
                        <LightingContextProvider>
                            {shouldRenderBasicTabs() && (
                                <>
                                    <BasicPropertiesSection
                                        description={
                                            selectedObj && isDirectionalLight(selectedObj)
                                                ? "Tip: Use the Behaviors tab to make this light follow a target or simulate a day-night cycle."
                                                : undefined
                                        }
                                    />

                                    {selectedObj && shouldRenderPlanCadProperties && (
                                        <PlanCadPropertiesSection selectedObject={selectedObj} />
                                    )}

                                    {/* Special editor panels - render before other sections to keep them visible */}
                                    {selectedObj instanceof CustomTube && <CurveEditorPanel />}
                                    {selectedObj instanceof Text3D && <TextPanel />}
                                    {selectedObj instanceof CustomShape && <SVGPathPanel />}

                                    {basicTabs}

                                    {showModelEditorSection && (
                                        <MaterialRow
                                            showModelAnimationCombiner={showModelAnimationCombiner}
                                            isPrimitiveSelected={isPrimitive}
                                            isStemSelected={isStem}
                                        />
                                    )}
                                </>
                            )}
                        </LightingContextProvider>
                    )}
                    {activeTab === TABS.SCENE_SETTINGS && isScene && !isDefaultLightsAndFogPanelOpen && <DefaultLightsAndFogPanel />}
                    {activeTab === TABS.BEHAVIORS &&
                        !isGameSettingsPanelOpen &&
                        !isCameraSettingsPanelOpen &&
                        (!isDefaultLightsAndFogPanelOpen || isScene) && <ObjectBehaviorsTab />}
                    {activeTab === TABS.LAMBDAS &&
                        !isGameSettingsPanelOpen &&
                        !isCameraSettingsPanelOpen &&
                        (!isDefaultLightsAndFogPanelOpen || isScene) && <LambdaComponentsTab />}
                </PanelContentWrapper>
            </Container>
        </ResizableWrapper>
    );
};

export default React.memo(RightPanel);

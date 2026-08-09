import i18n from "i18next";
import { debounce } from "lodash";
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { AngleUnitsSection, AngleUnitsSettings } from "./AngleUnitsSection";
import { BoundingBoxSection } from "./BoundingBoxSection";
import { CADToolsSection } from "./CADToolsSection";
import {
  ColorPaletteSection,
  DEFAULT_COLOR_PALETTE,
} from "./ColorPaletteSection";
import {
  DEFAULT_ANGLE_UNITS_SETTINGS,
  DEFAULT_BOUNDING_BOX_SETTINGS,
  DEFAULT_UNITS_SETTINGS,
  mergeSnappingSettings,
  type BoundingBoxSettings,
} from "./constants";
import { useIntegrationSettings } from "./hooks";
import { PhysicsSection, PhysicsSettings } from "./PhysicsSection";
import {
  TabContent,
  TooltipRowWrapper,
  Wrapper,
} from "./ProjectSettings.style";
import {
  GameDetailsSection,
  PlayerProfileSection,
} from "./sections";
import { SnappingSection, SnappingSettings } from "./SnappingSection";
import { UnitsSection, UnitsSettings } from "./UnitsSection";
import { saveScene } from "@stem/network/api/scene";
import { updateSceneThumbnail } from "@stem/network/api/scene/thumbnail";
import {
  useAppGlobalContext,
  useHomepageContext,
} from "@stem/editor-oss/context";
import { RIGHT_PANEL_VERSIONS } from "@stem/editor-oss/context/appStateTypes";
import Editor from "../../../../../../editor/Editor";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import { isPhysicsEngineType, PhysicsEngineType } from "../../../../../../physics/common/types";
import { showToast } from "@stem/editor-oss/showToast";
import { HUDRendererMode } from "@stem/editor-oss/types/GameSettingsTypes";
import Ajax from "@stem/editor-oss/utils/Ajax";
import {
  DEFAULT_ORIENTATION_POLICY,
  normalizeOrientationPolicy,
} from "@stem/editor-oss/utils/orientationPolicy";
import { backendUrlFromPath } from "@stem/editor-oss/utils/UrlUtils";
import { isPlaygroundMode } from "@web-shared/playgroundMode";
import {
  DEFAULT_CAD_TOOLS_SETTINGS,
  setCADToolsSettings,
} from "../../../../../cad/settings";
import { Tooltip } from "../../../common";
import { Item } from "../../../common/BasicCombobox/BasicCombobox";
import { NumericInput } from "../../../common/NumericInput";
import { StyledButton } from "../../../common/StyledButton";
import { getRandomPlaceholderIdentifier } from "../../../CreateDashboard/GameOverview/placeholderThumbnails";
import { ContentItem } from "../../common/ContentItem";
import { NumericInputRow } from "../../common/NumericInputRow";
import { PanelCheckbox } from "../../common/PanelCheckbox";
import { SelectRow } from "../../common/SelectRow";
import { Separator } from "../../common/Separator";
import {
  PanelSectionTitle,
  PanelSectionTitleSecondary,
} from "../../RightPanel.style";

export interface IMapping {
  backend: string;
  backend_port: number;
  created_at: string;
  game_id: string;
  host: string;
  id: string;
  path: string;
  type: string;
  updated_at: string;
}

const normalizeProjectGameSettings = (
  gameSettings: Record<string, any> = {},
  fallbackIsGame = true,
) => {
  const { enabled: _legacyEnabled, ...current } = gameSettings;
  return {
    ...current,
    uuid: current.uuid || THREE.MathUtils.generateUUID(),
    isGame: current.isGame ?? _legacyEnabled ?? fallbackIsGame,
    lives: current.lives ?? 3,
    maxScore: current.maxScore ?? 500,
    timer: current.timer ?? 200,
    orientationPolicy: normalizeOrientationPolicy(
      current.orientationPolicy || DEFAULT_ORIENTATION_POLICY,
    ),
  };
};

const SERIALIZED_GAME_BOOLEAN_SETTINGS = new Set([
  "showHUD",
  "useAvatar",
  "isMultiplayer",
  "multiplayerAutoJoin",
  "voiceChatEnabled",
]);

const loadGameMappingApi = () => import("@stem/network/api/gameMapping");

const GameSettingsComponent = ({
  openUIPanel,
}: {
  openUIPanel: () => void;
}) => {
  const app = (global as any).app as EngineRuntime;
  const editor = app.editor as Editor;
  const {
    setActiveRightPanel,
    activeRightPanel,
    slug,
    setSlug,
    gameMapping,
    setGameMapping,
  } = useAppGlobalContext();
  const { setShouldRefreshDashboard } = useHomepageContext();

  // Use the integration settings hook
  const {
    discordIntegration,
    playerSupport,
    allowAnonymousFirebase,
    setPlayerSupport,
    setAllowAnonymousFirebase,
    disableAllIntegrations,
    loadIntegrationSettings,
  } = useIntegrationSettings();

  const [useAvatar, setUseAvatar] = useState(!!app.editor?.useAvatar);
  const [isMultiplayer, setIsMultiplayer] = useState(
    !!app.editor?.isMultiplayer,
  );
  const [isVFXOnMobile, setIsVFXOnMobile] = useState(!!editor?.VFXOnMobile);
  const [showHUD, setShowHUD] = useState(!!app.editor?.showHUD);
  const [hudRenderer, setHudRenderer] = useState<HUDRendererMode>(
    editor?.hudRenderer === "uikit" ? "uikit" : "html",
  );
  const [productionMode, setProductionMode] = useState(
    app.editor?.scene?.userData?.productionMode ?? true,
  );
  const [playmodeInspectorEnabled, setPlaymodeInspectorEnabled] = useState(
    !!app.editor?.scene?.userData?.playmodeInspectorEnabled,
  );
  const [compartmentsEnabled, setCompartmentsEnabled] = useState(
    app.editor?.scene?.userData?.compartmentsEnabled ?? false,
  );
  const [maxMultiplayerClientsPerRoom, setMaxMultiplayerClientsPerRoom] =
    useState(editor?.maxMultiplayerClientsPerRoom || 4);
  const [multiplayerAutoJoin, setMultiplayerAutoJoin] = useState(
    !!editor?.multiplayerAutoJoin,
  );
  const [enableOrbitControls, setEnableOrbitControls] = useState(
    typeof editor?.scene?.userData?.enableOrbitControls === "boolean"
      ? editor.scene.userData.enableOrbitControls
      : true,
  );
  const [game, setGame] = useState(() => {
    const gameSettings = editor?.scene?.userData?.game || {};
    return normalizeProjectGameSettings(gameSettings);
  });
  const [thumbnail, setThumbnail] = useState(editor?.sceneThumbnail || "");
  const [name, setName] = useState(editor?.sceneName || "");
  const [description, setDescription] = useState(editor?.description || "");
  const [tags, setTags] = useState<string[]>(editor?.tags || []);
  const [contentRating, setContentRating] = useState(
    editor?.contentRating || "Unrated",
  );

  const [suggestedSlug, setSuggestedSlug] = useState("");
  const [isSlugError, setIsSlugError] = useState(false);
  const [slugErrorStatus, setSlugErrorStatus] = useState("");
  const [slugLocked, setSlugLocked] = useState(!!slug || false);

  // Physics settings
  const [physicsSettings, setPhysicsSettings] = useState(() => {
    const savedPhysicsSettings = app?.editor?.scene?.userData?.physics;
    return {
      engine: isPhysicsEngineType(savedPhysicsSettings?.engine)
        ? savedPhysicsSettings.engine
        : PhysicsEngineType.Ammo,
      gravity: savedPhysicsSettings?.gravity || -9.81,
    };
  });

  // Snapping settings
  const [snappingSettings, setSnappingSettings] = useState<SnappingSettings>(
    () => {
      const saved = app?.editor?.scene?.userData?.snapping;
      return mergeSnappingSettings(saved);
    },
  );

  const [cadToolsEnabled, setCadToolsEnabled] = useState<boolean>(() => {
    const saved = app?.editor?.scene?.userData?.cadTools?.enabled;
    return typeof saved === "boolean"
      ? saved
      : DEFAULT_CAD_TOOLS_SETTINGS.enabled;
  });

  // Units settings
  const [unitsSettings, setUnitsSettings] = useState<UnitsSettings>(() => {
    const saved = app?.editor?.scene?.userData?.units;
    return saved || DEFAULT_UNITS_SETTINGS;
  });

  // Angle units settings
  const [angleUnitsSettings, setAngleUnitsSettings] =
    useState<AngleUnitsSettings>(() => {
      const saved = app?.editor?.scene?.userData?.angleUnits;
      return saved || DEFAULT_ANGLE_UNITS_SETTINGS;
    });

  // Bounding box mode
  const [boundingBoxSettings, setBoundingBoxSettings] =
    useState<BoundingBoxSettings>(() => {
      const saved = app?.editor?.scene?.userData?.boundingBox;
      return saved || DEFAULT_BOUNDING_BOX_SETTINGS;
    });
  const snappingSectionRef = useRef<HTMLDivElement>(null);
  const [pendingProjectSettingsSection, setPendingProjectSettingsSection] =
    useState<string | null>(null);

  // Color palette
  const [colorPalette, setColorPalette] = useState(
    () => app?.editor?.scene?.userData?.colorPalette || DEFAULT_COLOR_PALETTE,
  );

  const orientationPolicyOptions: Item[] = [
    { key: "requireLandscape", value: i18n.t("Require landscape") },
  ];

  const debouncedSceneChange = useCallback(
    debounce((data) => {
      void Ajax.post({
        url: backendUrlFromPath(`/api/Scene/Edit`),
        data: {
          Name: data.name,
          ID: editor?.sceneID,
          Description: data.description,
          Tags: JSON.stringify(data.tags),
          ContentRating: data.contentRating,
        },
        msgBodyType: "multipart",
      }).then((response) => {
        if (response?.data.Code === 200 && editor) {
          editor.sceneName = data.name;
          editor.description = data.description;
          editor.tags = data.tags;
          editor.contentRating = data.contentRating;
          setShouldRefreshDashboard(true);
          app.call(`clear`, editor, editor);
        }
      });
    }, 500),
    [app, setShouldRefreshDashboard],
  );

  const loadGameMapping = async () => {
    if (!editor?.sceneID) return;
    const { getGameMapping } = await loadGameMappingApi();
    const mapping = await getGameMapping(editor.sceneID);
    setGameMapping(mapping);
    if (mapping) {
      setSlug(mapping.Slug);
      setSuggestedSlug(mapping.Slug);
      setSlugLocked(true);
    } else {
      setSlug("");
      setSuggestedSlug("");
      setSlugLocked(false);
    }
  };

  const handleNameChange = () => {
    editor.sceneName = name;
    app.call("sceneNameUpdated");
    debouncedSceneChange({ name, description, tags, contentRating });
  };

  const handleDescriptionChange = () => {
    editor.description = description;
    debouncedSceneChange({ name, description, tags, contentRating });
  };

  const handleNameInputChange = (value: string) => {
    setName(value);
    editor.sceneName = value;
    app.call("sceneNameUpdated");
  };

  const handleDescriptionInputChange = (value: string) => {
    setDescription(value);
    editor.description = value;
  };

  const handleContentRatingChange = (rating: string) => {
    setContentRating(rating);
    editor.contentRating = rating;
    debouncedSceneChange({ name, description, tags, contentRating: rating });
  };

  const removeSelected = () => {
    if (
      editor.selected &&
      !Array.isArray(editor.selected) &&
      editor.selected.type !== "Scene" &&
      !(editor.selected as THREE.PerspectiveCamera).isPerspectiveCamera
    ) {
      setActiveRightPanel(RIGHT_PANEL_VERSIONS.None);
    }
  };

  const handleInputChange = (value: any, inputName: string) => {
    setGame((prevState) => {
      const newState = { ...prevState, [inputName]: value };
      editor.scene.userData.game = newState;
      app.call("objectChanged", app.editor, app.editor?.scene);
      return newState;
    });
  };

  const handleThumbnailChange = (url: string) => {
    const nextThumbnail = url || getRandomPlaceholderIdentifier();
    setThumbnail(nextThumbnail);
    editor.sceneThumbnail = nextThumbnail;
    const sceneId = editor.sceneID;
    const sceneName = editor.sceneName;
    if (sceneId && sceneName) {
      void updateSceneThumbnail(sceneId, sceneName, nextThumbnail);
      setShouldRefreshDashboard(true);
    }
  };

  const setLocalGameState = () => {
    const gameData = editor?.scene?.userData?.game;
    if (gameData) {
      setGame(normalizeProjectGameSettings(gameData));
    }
  };

  const handleBooleanChange = (
    key: string,
    setter: (value: boolean) => void,
  ) => {
    const current = (editor as any)[key] as boolean;
    const newValue = !current;
    (editor as any)[key] = newValue;

    if (SERIALIZED_GAME_BOOLEAN_SETTINGS.has(key)) {
      if (!editor.scene.userData) editor.scene.userData = {};
      const gameSettings = {
        ...normalizeProjectGameSettings(editor.scene.userData.game),
        [key]: newValue,
      };
      editor.scene.userData.game = gameSettings;
      setGame(gameSettings);
      app.call("objectChanged", app.editor, app.editor?.scene);
    }

    setter(newValue);
  };

  const handleProductionModeCheckboxChange = (checked: boolean) => {
    if (!editor.scene.userData) editor.scene.userData = {};
    editor.scene.userData.productionMode = checked;
    setProductionMode(checked);
  };

  const ensureSceneGameSettings = () => {
    const current = editor.scene.userData.game || {};
    const gameSettings = normalizeProjectGameSettings(current);
    editor.scene.userData.game = gameSettings;
    return gameSettings;
  };

  const handleProjectTypeChange = (checked: boolean) => {
    if (!editor.scene.userData) editor.scene.userData = {};
    const gameSettings = {
      ...ensureSceneGameSettings(),
      isGame: checked,
    };
    editor.scene.userData.game = gameSettings;
    app.call("objectChanged", app.editor, app.editor?.scene);
    setGame(gameSettings);
  };

  const handlePlaymodeInspectorCheckboxChange = (checked: boolean) => {
    if (!editor.scene.userData) editor.scene.userData = {};
    editor.scene.userData.playmodeInspectorEnabled = checked;
    setPlaymodeInspectorEnabled(checked);
  };

  const handleCompartmentsCheckboxChange = async (checked: boolean) => {
    if (!editor.scene.userData) editor.scene.userData = {};
    editor.scene.userData.compartmentsEnabled = checked;
    setCompartmentsEnabled(checked);
    app.call("objectChanged", editor, editor.scene);

    const confirmed = window.confirm(
      "Compartments setting changed. Save and reload scene to apply?",
    );
    if (confirmed) {
      try {
        await saveScene(false, false);
        window.location.reload();
      } catch (error) {
        console.error("Failed to save and reload scene:", error);
      }
    }
  };

  const handleEnableOrbitControlsChange = (checked: boolean) => {
    if (!editor.scene.userData) editor.scene.userData = {};
    editor.scene.userData.enableOrbitControls = checked;
    app.call("objectChanged", app.editor, app.editor?.scene);
    setEnableOrbitControls(checked);
  };

  const handlePhysicsSettingsChange = (settings: PhysicsSettings) => {
    editor.scene.userData.physics = { ...settings };
    app.call("objectChanged", app.editor, app.editor?.scene);
    setPhysicsSettings(settings);
  };

  const handleSnappingSettingsChange = (settings: SnappingSettings) => {
    if (!settings) return;
    const normalizedSettings = mergeSnappingSettings(settings);
    editor.scene.userData.snapping = { ...normalizedSettings };
    app.call("objectChanged", app.editor, app.editor?.scene);
    setSnappingSettings(normalizedSettings);
    app.call("snappingSettingsChanged", app.editor, normalizedSettings);
  };

  const handleUnitsSettingsChange = (settings: UnitsSettings) => {
    if (!settings) return;
    editor.scene.userData.units = { ...settings };
    app.call("objectChanged", app.editor, app.editor?.scene);
    setUnitsSettings(settings);
    app.call("unitsSettingsChanged", app.editor, settings);
  };

  const handleAngleUnitsSettingsChange = (settings: AngleUnitsSettings) => {
    if (!settings) return;
    editor.scene.userData.angleUnits = { ...settings };
    app.call("objectChanged", app.editor, app.editor?.scene);
    setAngleUnitsSettings(settings);
    app.call("angleUnitsSettingsChanged", app.editor, settings);
  };

  const handleBoundingBoxSettingsChange = (settings: BoundingBoxSettings) => {
    if (!settings) return;
    editor.scene.userData.boundingBox = { ...settings };
    setBoundingBoxSettings(settings);
    app.call("boundingBoxModeChanged", app.editor, settings);
    app.call("objectChanged", app.editor, app.editor?.scene);
  };

  const handleCADToolsSettingsChange = (enabled: boolean) => {
    setCADToolsSettings(editor.scene, { enabled });
    app.call("objectChanged", app.editor, app.editor?.scene);
    setCadToolsEnabled(enabled);
    app.call("cadToolsSettingsChanged", app.editor, { enabled });
    if (!enabled) {
      editor.exitCADMode();
    }
  };

  const handleColorPaletteChange = (palette: string) => {
    editor.scene.userData.colorPalette = palette;
    app.call("objectChanged", app.editor, app.editor?.scene);
    setColorPalette(palette);
  };

  const handleMaxMultiplayerClientsPerRoomChange = (value: number) => {
    editor.maxMultiplayerClientsPerRoom = value;
    setMaxMultiplayerClientsPerRoom(value);
  };

  const handleHudRendererChange = (value: HUDRendererMode) => {
    editor.hudRenderer = value;
    setHudRenderer(value);
  };

  const handlePlayerSupportChange = (enabled: boolean) => {
    const newPlayerSupport = { enabled };
    editor.scene.userData.playerSupport = newPlayerSupport;
    setPlayerSupport(newPlayerSupport);
    if (!enabled) {
      disableAllIntegrations();
    }
  };

  const isValidSubdomain = (input: string) => {
    const regex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
    return regex.test(input);
  };

  const handleDeleteSlug = async () => {
    try {
      const { deleteGameMapping } = await loadGameMappingApi();
      await deleteGameMapping(editor.sceneID || "");
      setGameMapping(null);
      setSlug("");
      setSlugLocked(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSlugError(false);
      setSlugErrorStatus("");
    }
  };

  const handleSaveSlug = async () => {
    if (!editor.sceneID || !suggestedSlug) return;
    if (suggestedSlug === gameMapping?.Slug) return;

    if (!isValidSubdomain(suggestedSlug)) {
      return showToast({
        type: "error",
        title: "No special characters allowed.",
      });
    }

    try {
      const { checkSlugExists, createGameMapping, updateGameMapping } =
        await loadGameMappingApi();
      const slugCheck = await checkSlugExists(suggestedSlug);
      if (!slugCheck) {
        setIsSlugError(true);
        setSlugErrorStatus("Error connecting with the server!");
        return;
      }

      if (!slugCheck.valid) {
        setIsSlugError(true);
        return;
      }

      if (slugCheck.exists && !gameMapping) {
        showToast({ type: "error", title: "Slug is already taken" });
        setSlugErrorStatus("Slug is already taken!");
        setIsSlugError(true);
        return;
      }

      let discordClientId = undefined;
      if (discordIntegration.enabled && editor.sceneID) {
        try {
          discordClientId = await app.authManager.discordGetClientID(
            editor.sceneID,
          );
        } catch (error) {
          console.error("Error getting Discord client ID:", error);
          showToast({
            type: "error",
            title: "Failed to get Discord app ID",
            body: "Please ensure Discord keys are properly configured.",
          });
          return;
        }
      }

      const result = gameMapping
        ? await updateGameMapping(
            editor.sceneID,
            suggestedSlug,
            discordClientId,
          )
        : await createGameMapping(
            editor.sceneID,
            suggestedSlug,
            discordClientId,
          );

      if (result) {
        setGameMapping(result.mapping ?? null);
        setSlug(suggestedSlug);
        setSlugLocked(true);
        setIsSlugError(false);
        setSlugErrorStatus("");
      } else {
        setIsSlugError(true);
        setSlugErrorStatus("Could not set the slug for the game!");
      }
    } catch (err) {
      console.error(err);
      setIsSlugError(true);
    }
  };

  const loadGameSettingsFromMetadata = useCallback(() => {
    if (!editor) return;

    editor.scene.userData.game = normalizeProjectGameSettings(
      editor.scene.userData.game,
    );
    setGame(editor.scene.userData.game);
    setUseAvatar(!!editor?.useAvatar);
    setIsMultiplayer(!!editor?.isMultiplayer);
    setIsVFXOnMobile(!!editor?.VFXOnMobile);
    setName(editor.sceneName || "");
    setDescription(editor.description || "");
    setShowHUD(!!app.editor?.showHUD);
    setHudRenderer(editor?.hudRenderer === "uikit" ? "uikit" : "html");
    setMaxMultiplayerClientsPerRoom(
      app.editor?.maxMultiplayerClientsPerRoom || 4,
    );
    setMultiplayerAutoJoin(!!app.editor?.multiplayerAutoJoin);
    setProductionMode(app.editor?.scene?.userData?.productionMode ?? true);
    setPlaymodeInspectorEnabled(
      !!app.editor?.scene?.userData?.playmodeInspectorEnabled,
    );
    setCompartmentsEnabled(
      app.editor?.scene?.userData?.compartmentsEnabled ?? false,
    );
    setEnableOrbitControls(
      typeof editor?.scene?.userData?.enableOrbitControls === "boolean"
        ? editor.scene.userData.enableOrbitControls
        : true,
    );
    setTags(editor.tags || []);
    setContentRating(editor.contentRating || "Unrated");
    setThumbnail(editor.sceneThumbnail || "");

    // Load physics settings
    const physicsData = editor?.scene?.userData?.physics;
    if (physicsData) {
      setPhysicsSettings({
        engine: physicsData.engine,
        gravity: physicsData.gravity,
      });
    }

    // Load snapping settings
    const snappingData = mergeSnappingSettings(
      editor?.scene?.userData?.snapping,
    );
    setSnappingSettings(snappingData);
    if (snappingData)
      app.call("snappingSettingsChanged", app.editor, snappingData);

    const cadToolsData =
      editor?.scene?.userData?.cadTools || DEFAULT_CAD_TOOLS_SETTINGS;
    setCadToolsEnabled(!!cadToolsData.enabled);
    app.call("cadToolsSettingsChanged", app.editor, {
      enabled: !!cadToolsData.enabled,
    });

    // Load units settings
    const unitsData = editor?.scene?.userData?.units || DEFAULT_UNITS_SETTINGS;
    setUnitsSettings(unitsData);
    if (unitsData) app.call("unitsSettingsChanged", app.editor, unitsData);

    // Load angle units settings
    const angleUnitsData =
      editor?.scene?.userData?.angleUnits || DEFAULT_ANGLE_UNITS_SETTINGS;
    setAngleUnitsSettings(angleUnitsData);
    if (angleUnitsData)
      app.call("angleUnitsSettingsChanged", app.editor, angleUnitsData);

    // Load bounding box settings
    const boundingBoxData =
      editor?.scene?.userData?.boundingBox || DEFAULT_BOUNDING_BOX_SETTINGS;
    setBoundingBoxSettings(boundingBoxData);
    app.call("boundingBoxModeChanged", app.editor, boundingBoxData);

    // Load color palette
    setColorPalette(
      editor?.scene?.userData?.colorPalette || DEFAULT_COLOR_PALETTE,
    );

    // Load integration settings
    loadIntegrationSettings();
  }, [editor, app, loadIntegrationSettings]);

  useEffect(() => {
    if (gameMapping) {
      setSlug(gameMapping.Slug);
      setSuggestedSlug(gameMapping.Slug ?? "");
    } else {
      setSuggestedSlug(slug ?? "");
    }
  }, [gameMapping]);

  useEffect(() => {
    const updateSceneName = () => setName(editor.sceneName || "");
    app.on(`sceneNameUpdated.GameSettings`, updateSceneName);
    app.on(`objectSelected.GameSettings`, removeSelected);
    app.on("sceneSaved.GameSettings", () => {
      setLocalGameState();
      loadGameSettingsFromMetadata();
    });
    app.on("sceneLoaded.GameSettings", () => {
      setLocalGameState();
      loadGameSettingsFromMetadata();
      void loadGameMapping();
    });
    app.on("clear.GameSettings", loadGameSettingsFromMetadata);

    // Sync snapping settings when changed externally (e.g. ActionBar snap preset)
    app.on(
      "snappingSettingsChanged.GameSettings",
      (settings: SnappingSettings) => {
        setSnappingSettings(mergeSnappingSettings(settings));
      },
    );
    app.on("focusProjectSettingsSection.GameSettings", (section: string) => {
      setPendingProjectSettingsSection(section);
    });

    return () => {
      app.on(`objectSelected.GameSettings`, null);
      app.on("sceneSaved.GameSettings", null);
      app.on("sceneLoaded.GameSettings", null);
      app.on("clear.GameSettings", null);
      app.on(`sceneNameUpdated.GameSettings`, null);
      app.on("snappingSettingsChanged.GameSettings", null);
      app.on("focusProjectSettingsSection.GameSettings", null);
    };
  }, [editor, loadGameSettingsFromMetadata]);

  useEffect(() => {
    if (activeRightPanel === RIGHT_PANEL_VERSIONS.GameSettings) {
      setLocalGameState();
      loadGameSettingsFromMetadata();
      void loadGameMapping();
    }
  }, [activeRightPanel, loadGameSettingsFromMetadata]);

  useEffect(() => {
    if (
      activeRightPanel !== RIGHT_PANEL_VERSIONS.GameSettings ||
      (pendingProjectSettingsSection !== "snapping" &&
        pendingProjectSettingsSection !== "cadTools")
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      snappingSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      setPendingProjectSettingsSection(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeRightPanel, pendingProjectSettingsSection]);

  if (activeRightPanel !== RIGHT_PANEL_VERSIONS.GameSettings) return null;

  return (
    <TabContent>
      {/* ── 1. Project Identity ── */}
      <GameDetailsSection
        name={name}
        setName={handleNameInputChange}
        description={description}
        setDescription={handleDescriptionInputChange}
        tags={tags}
        setTags={setTags}
        game={game}
        thumbnail={thumbnail}
        onThumbnailChange={handleThumbnailChange}
        suggestedSlug={suggestedSlug}
        setSuggestedSlug={setSuggestedSlug}
        isSlugError={isSlugError}
        slugErrorStatus={slugErrorStatus}
        slugLocked={slugLocked}
        onNameChange={handleNameChange}
        onDescriptionChange={handleDescriptionChange}
        onSaveSlug={handleSaveSlug}
        onDeleteSlug={handleDeleteSlug}
        onInputChange={handleInputChange}
        contentRating={contentRating}
        onContentRatingChange={handleContentRatingChange}
        debouncedSceneChange={debouncedSceneChange}
      />

      {/* ── 2. Editor Preferences ── */}
      <Separator margin="-4px 0 12px" />
      <ContentItem
        ref={snappingSectionRef}
        $rowGap="12px"
        style={{ scrollMarginTop: "12px" }}
      >
        <TooltipRowWrapper>
          <PanelSectionTitle>Snapping</PanelSectionTitle>
          <Tooltip
            text="Controls precision placement behavior for move, rotate, and scale operations."
            width="220px"
          />
        </TooltipRowWrapper>
        <SnappingSection
          settings={snappingSettings}
          onChange={handleSnappingSettingsChange}
          angleUnit={angleUnitsSettings.currentUnit}
        />
        <CADToolsSection
          enabled={cadToolsEnabled}
          onChange={handleCADToolsSettingsChange}
        />
      </ContentItem>

      <Separator margin="-4px 0 12px" />
      <ContentItem $rowGap="12px">
        <TooltipRowWrapper>
          <PanelSectionTitle>Units</PanelSectionTitle>
          <Tooltip
            text="Sets preferred measurement display units in editor controls."
            width="220px"
          />
        </TooltipRowWrapper>
        <UnitsSection
          settings={unitsSettings}
          onChange={handleUnitsSettingsChange}
        />
        <BoundingBoxSection
          settings={boundingBoxSettings}
          onChange={handleBoundingBoxSettingsChange}
        />
      </ContentItem>

      <Separator margin="-4px 0 12px" />
      <ContentItem $rowGap="12px">
        <TooltipRowWrapper>
          <PanelSectionTitle>Angle Units</PanelSectionTitle>
          <Tooltip
            text="Sets preferred angle display units for editor rotation controls and gizmo overlays."
            width="220px"
          />
        </TooltipRowWrapper>
        <AngleUnitsSection
          settings={angleUnitsSettings}
          onChange={handleAngleUnitsSettingsChange}
        />
      </ContentItem>

      <Separator margin="-4px 0 12px" />
      <ContentItem $rowGap="12px">
        <TooltipRowWrapper>
          <PanelSectionTitle>Color Palette</PanelSectionTitle>
          <Tooltip
            text="Choose a named color palette whose swatches appear in every color picker."
            width="220px"
          />
        </TooltipRowWrapper>
        <ColorPaletteSection
          palette={colorPalette}
          onChange={handleColorPaletteChange}
        />
      </ContentItem>

      {/* ── 3. Physics ── */}
      <Separator margin="-4px 0 12px" />
      <ContentItem $rowGap="12px">
        <TooltipRowWrapper>
          <PanelSectionTitle>Physics</PanelSectionTitle>
          <Tooltip
            text="Sets global simulation defaults for gravity and physics backend."
            width="220px"
          />
        </TooltipRowWrapper>
        <PhysicsSection
          settings={physicsSettings}
          onChange={handlePhysicsSettingsChange}
        />
      </ContentItem>

      {/* ── 4. Game Rules ── */}
      <Separator margin="-4px 0 12px" />
      <ContentItem $rowGap="12px">
        <TooltipRowWrapper>
          <PanelSectionTitle>Level Rules</PanelSectionTitle>
          <Tooltip
            text="Defines score, life, and timer goals for your core gameplay loop. Use these when the project behaves like a level-based game with clear failure or completion conditions."
            width="220px"
          />
        </TooltipRowWrapper>
        <NumericInputRow
          label="Max Score"
          value={game.maxScore}
          setValue={(value) => handleInputChange(value, "maxScore")}
          rightAlign
          $margin="0"
          labelTooltip="Target score threshold for completing the level. Use 0 or a low value when score is not a win condition. Typical arcade-style targets are small and readable, while progression-heavy games may use much larger totals."
        />
        <NumericInputRow
          label="Player Lives"
          value={game.lives}
          setValue={(value) => handleInputChange(value, "lives")}
          rightAlign
          $margin="0"
          labelTooltip="How many failed attempts the player gets before game over. Common values are 1 for punishing runs, 3 for classic arcade structure, and 5 or more for forgiving casual experiences."
        />
        <TooltipRowWrapper>
          <PanelSectionTitleSecondary>Time Limit</PanelSectionTitleSecondary>
          <Wrapper>
            <Tooltip
              text="Maximum time allowed for the level in seconds. Set to 0 for no time limit. Short sessions often use 30-180 seconds, while exploration scenes usually leave this at 0."
              width="120px"
            />
            <NumericInput
              padding="6px 16px 6px 14px"
              value={game.timer}
              setValue={(value) => handleInputChange(value, "timer")}
              unit={"s"}
              rightAlign
            />
          </Wrapper>
        </TooltipRowWrapper>
      </ContentItem>

      <Separator margin="-4px 0 12px" />
      <ContentItem $rowGap="12px">
        <TooltipRowWrapper>
          <PanelSectionTitle $margin="0 0 0px">HUD & Display</PanelSectionTitle>
          <Tooltip
            text="Controls default player-facing interface and display behavior for the runtime experience."
            width="220px"
          />
        </TooltipRowWrapper>
        <PanelCheckbox
          v2
          text="Use Standard HUD Panels"
          checked={!!showHUD}
          isGray
          regular
          onChange={() => handleBooleanChange("showHUD", setShowHUD)}
          tooltipText="Shows the built-in HUD and menu panels. Leave this on unless the experience uses a fully custom interface or intentionally hides default gameplay chrome."
        />
        <SelectRow
          label="Renderer"
          data={[
            { key: "html", value: "HTML" },
            { key: "uikit", value: "UIKit" },
          ]}
          value={{
            key: hudRenderer,
            value: hudRenderer === "uikit" ? "UIKit" : "HTML",
          }}
          onChange={(item) =>
            handleHudRendererChange(item.key as HUDRendererMode)
          }
          disableTyping
          width="120px"
        />
        <StyledButton
          style={{ fontWeight: "400" }}
          isGreySecondary
          onClick={openUIPanel}
          disabled={!game.isGame}
        >
          Customize
        </StyledButton>
        <SelectRow
          label={i18n.t("Orientation")}
          data={orientationPolicyOptions}
          value={
            orientationPolicyOptions.find(
              (option) =>
                option.key ===
                (game.orientationPolicy || DEFAULT_ORIENTATION_POLICY),
            ) || orientationPolicyOptions[0]
          }
          onChange={(selected) =>
            handleInputChange(selected.key, "orientationPolicy")
          }
          disableTyping
          noPortal
          labelTooltip={i18n.t(
            "Stem Studio mobile support is landscape-only. Portrait and any-orientation scene values are migrated to the required landscape policy.",
          )}
        />
        <TooltipRowWrapper style={{ height: "16px" }}>
          <PanelSectionTitleSecondary>
            Enable Orbit Controls
          </PanelSectionTitleSecondary>
          <Wrapper>
            <Tooltip
              text="Allows the player to orbit the camera when no player character is active. Useful for model viewers, architectural walkthroughs, or sandbox scenes."
              width="130px"
            />
            <PanelCheckbox
              v2
              text=""
              checked={!!enableOrbitControls}
              isGray
              regular
              onChange={() =>
                handleEnableOrbitControlsChange(!enableOrbitControls)
              }
            />
          </Wrapper>
        </TooltipRowWrapper>
        <PanelCheckbox
          v2
          text="VFX on mobile"
          checked={!!isVFXOnMobile}
          isGray
          regular
          onChange={() => handleBooleanChange("VFXOnMobile", setIsVFXOnMobile)}
          tooltipText="Allows particle systems and heavier visual effects on mobile devices. Keep this off for broad mobile compatibility, and enable it only when the project is tested on target phones."
        />
      </ContentItem>

      {/* ── 5. Player & Multiplayer ── */}
      {/* Mirror PlayerProfileSection's own visibility logic so the
                preceding separator doesn't strand a phantom section when
                every child checkbox is hidden in playground mode. */}
      {!isPlaygroundMode() && (
        <>
          <Separator margin="-4px 0 12px" />
          <PlayerProfileSection
            playerSupport={playerSupport}
            allowAnonymousFirebase={allowAnonymousFirebase}
            useAvatar={useAvatar}
            isMultiplayer={isMultiplayer}
            multiplayerAutoJoin={multiplayerAutoJoin}
            maxMultiplayerClientsPerRoom={maxMultiplayerClientsPerRoom}
            onPlayerSupportChange={handlePlayerSupportChange}
            onBooleanChange={handleBooleanChange}
            onMaxClientsChange={handleMaxMultiplayerClientsPerRoomChange}
            setAllowAnonymousFirebase={setAllowAnonymousFirebase}
            setUseAvatar={setUseAvatar}
            setIsMultiplayer={setIsMultiplayer}
            setMultiplayerAutoJoin={setMultiplayerAutoJoin}
          />
        </>
      )}

      {/* ── 8. Developer Tools ── */}
      <Separator margin="-4px 0 12px" />
      <ContentItem $rowGap="12px">
        <PanelSectionTitle $margin="0 0 0px">Developer Tools</PanelSectionTitle>
        <TooltipRowWrapper style={{ height: "16px" }}>
          <PanelSectionTitleSecondary>
            Production Mode
          </PanelSectionTitleSecondary>
          <Wrapper>
            <Tooltip text="Remove debugger statements" width="120px" />
            <PanelCheckbox
              v2
              text=""
              checked={!!productionMode}
              isGray
              regular
              onChange={() =>
                handleProductionModeCheckboxChange(!productionMode)
              }
            />
          </Wrapper>
        </TooltipRowWrapper>
        <TooltipRowWrapper style={{ height: "16px" }}>
          <PanelSectionTitleSecondary>Game Project</PanelSectionTitleSecondary>
          <Wrapper>
            <Tooltip
              text="Marks this project as a game. Turn it off for a 3D experience; Play still starts the runtime and uses orbit controls when no player exists."
              width="220px"
            />
            <PanelCheckbox
              v2
              text=""
              checked={!!game.isGame}
              isGray
              regular
              onChange={() => handleProjectTypeChange(!game.isGame)}
            />
          </Wrapper>
        </TooltipRowWrapper>
        <TooltipRowWrapper style={{ height: "16px" }}>
          <PanelSectionTitleSecondary>
            Enable Play-mode Inspector
          </PanelSectionTitleSecondary>
          <Wrapper>
            <Tooltip
              text="Show a hierarchy + properties panel during Play. Edits revert when Play stops."
              width="220px"
            />
            <PanelCheckbox
              v2
              text=""
              checked={!!playmodeInspectorEnabled}
              isGray
              regular
              onChange={() =>
                handlePlaymodeInspectorCheckboxChange(!playmodeInspectorEnabled)
              }
            />
          </Wrapper>
        </TooltipRowWrapper>
        <TooltipRowWrapper style={{ height: "16px" }}>
          <PanelSectionTitleSecondary>Compartments</PanelSectionTitleSecondary>
          <Wrapper>
            <Tooltip
              text="SES sandbox for scripts (reload required)"
              width="180px"
            />
            <PanelCheckbox
              v2
              text=""
              checked={!!compartmentsEnabled}
              isGray
              regular
              onChange={() =>
                handleCompartmentsCheckboxChange(!compartmentsEnabled)
              }
            />
          </Wrapper>
        </TooltipRowWrapper>
        <StyledButton
          style={{ fontWeight: "400", marginTop: "8px" }}
          isGreySecondary
          onClick={() => app.editor?.component?.showFTUEModal()}
        >
          Show First Time Experience
        </StyledButton>
        <StyledButton
          style={{ fontWeight: "400", marginTop: "8px" }}
          isGreySecondary
          onClick={() => {
            localStorage.removeItem("erth-ftue-seen");
            showToast({
              type: "info",
              title: "Experience Reset",
              body: "Reload the page to see the Getting Started guide.",
            });
          }}
        >
          Reset First Time User Experience
        </StyledButton>
      </ContentItem>
    </TabContent>
  );
};

export const GameSettings = React.memo(GameSettingsComponent);

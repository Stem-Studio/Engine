/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/**
 * Module: Editor.ts
 * Purpose: Contains logic for editor.
 */

import "./css/Editor.css";
import I18n from "i18next";
import * as THREE from "three";
import {Mesh, Object3D, OrthographicCamera, PerspectiveCamera, Scene} from "three";
import {TransformControls} from "three/examples/jsm/controls/TransformControls.js";
import {CSS3DRenderer} from "three/examples/jsm/renderers/CSS3DRenderer.js";
import {WebGPURenderer} from "three/webgpu";
import {ParticleEmitter, ParticleSystem, QuarksLoader, QuarksUtil, type VFXBatchSettings} from "three.quarks";

import {AssetType, getSceneAssets} from "@stem/network/api/asset";
import {
    getBehaviorsList,
    getBehaviorsFromAssets,
    getBehaviorsListForScene,
    legacyAddBehaviorToScene,
} from "@stem/network/api/behavior";
import {getLambdaRevisionData} from "@stem/network/api/lambda";
import {saveScene} from "@stem/network/api/scene";
import {getScriptRevisionData} from "@stem/network/api/script";
import {emptyAssetResolutionContext, getAssetResolutionContext, resolveAssetRevisionId} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {remapBehaviorAttributeUuids} from "@stem/editor-oss/asset-management/dependencies";
import EngineRuntime, {
    ApplicationMode,
    CASCADED_SHADOWS_MAP_BEHAVIOR_ID,
    GLOBAL_BEHAVIOR_HOST,
    MOBILE_TOUCH_CONTROLS_BEHAVIOR_ID,
} from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import {isGaussianSplatObject} from "@stem/editor-oss/model/gaussianSplats";
import {isModelAssetInstance} from "@stem/editor-oss/model/util";
import {getPrefabId, isPrefab} from "@stem/editor-oss/prefab/util";
import {createFreshParticleConfig, isVFXAutoStartEnabled, isVFXParent} from "@stem/editor-oss/services";
import {showToast} from "@stem/editor-oss/showToast";
import {SceneAssetSource, type AssetSource} from "./asset-management/AssetSource";
import {seedScriptDependencyEntry} from "../script-runtime/scriptDependencyCache";
import {
    buildNameAwareScriptImportContext,
    getScriptImportDependencyMap,
    loadScriptImportRevisionMap,
    type ScriptImportRevisionMap,
} from "../script-runtime/scriptImports";
import {isScriptsEnabled} from "@stem/editor-oss/utils/featureFlags";
import {DEFAULT_SNAPPING_SETTINGS} from "./assets/v2/RightPanel/panels/ProjectSettings/constants";
import {getPhysics} from "./assets/v2/utils/getPhysics";
import BehaviorAttributeConverter from "./behaviors/BehaviorAttributeConverter";
import {BehaviorConfig, BehaviorEditorOptions} from "./behaviors/BehaviorConfig";
import BehaviorDataManager from "./behaviors/BehaviorDataManager";
import BehaviorObjectSettingsApplier from "./behaviors/BehaviorObjectSettingsApplier";
import BehaviorPluginManager from "./behaviors/BehaviorPluginManager";
import BehaviorScriptRegistry from "./behaviors/BehaviorScriptRegistry";
import {SceneConfig} from "@stem/editor-oss/scene/SceneConfig";
import LegacyScriptConverter from "../serialization/LegacyScriptConverter";
import {CAMERA_EFFECTS, CAMERA_OBJECT_INTERACTION, CAMERA_TYPES_NEW} from "@stem/editor-oss/types/editor";
import {DetectDevice} from "@stem/editor-oss/utils/DetectDevice";
import MeshUtils from "@stem/editor-oss/utils/MeshUtils";
import {cloneObject, processChildData} from "@stem/editor-oss/utils/ObjectUtils";
import ShadowUtils from "@stem/editor-oss/utils/ShadowUtils";
import {checkAndNotifyLargeTextures, logLargeTexturesReport} from "@stem/editor-oss/utils/TextureCheckerUtils";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {isDefaultSceneObject} from "@stem/editor-oss/agent/script-tool/defaultSceneObjects";
import ChildrenAttributeConverter from "./behaviors/converters/ChildrenAttributeConverter";
import EnumAttributeConverter from "./behaviors/converters/EnumConverter";
import ModelLoader from "../assets/js/loaders/ModelLoader";
import BehaviorData, {BEHAVIOR_DATA_SCHEMA_VERSION} from "../behaviors/BehaviorData";
import {CreateBehaviorOptions} from "../behaviors/BehaviorManager";
import BehaviorScriptInjector from "../behaviors/BehaviorScriptInjector";
import BehaviorTypeRegistry from "../behaviors/BehaviorTypeRegistry";
import {createGameObject} from "../behaviors/stem/core/createGameObject";
import {isInputActive} from "./assets/v2/utils/isInputActive";
import BehaviorAttributeType from "./behaviors/BehaviorAttributeType";
import BehaviorConfigRegistry from "./behaviors/BehaviorConfigRegistry";
import {BehaviorContextProvider} from "./behaviors/BehaviorContextProvider";
import {StemEngineInterface} from "../behaviors/stem/StemEngineInterface";
import {
    AddObjectCommand,
    AttachBehaviorCommand,
    DetachBehaviorCommand,
    GroupObjectsCommand,
    RemoveObjectCommand,
} from "@stem/editor-oss/command/Commands";
import History from "@stem/editor-oss/command/History";
import {RIGHT_PANEL_VERSIONS} from "@stem/editor-oss/context/appStateTypes";
import ControlsManager from "../controls/ControlsManager";
import type {RuntimeContext} from "../core/RuntimeContext";
import i18n from "@stem/editor-oss/i18n/config";
import {LambdaFileLoader} from "../lambdas";
import {PhysicsUtil} from "../physics/PhysicsUtil";
import {queryClient} from "@web-shared/queryClient";
import {editorHasUnsavedChanges} from "@stem/editor-oss/utils/editorUnsavedChanges";
import {UPLOAD_FILE_TYPE} from "./assets/v2/AssetsLibrary/UploadView/UploadView";
import BehaviorUIManager from "./behaviors/BehaviorUIManager";
import LambdaConfigRegistry from "../lambdas/LambdaConfigRegistry";
import {ElementsUtils} from "@stem/editor-oss/utils/ElementsUtils";
import BooleanAttributeConverter from "./behaviors/converters/BooleanAttributeConverter";
import ButtonAttributeConverter from "./behaviors/converters/ButtonAttributeConverter";
import ColorAttributeConverter from "./behaviors/converters/ColorAttributeConverter";
import GroupAttributeConverter from "./behaviors/converters/GroupAttributeConverter";
import ImageAttributeConverter from "./behaviors/converters/ImageAttributeConverter";
import LabelAttributeConverter from "./behaviors/converters/LabelAttributeConverter";
import ModelPreviewAttributeConverter from "./behaviors/converters/ModelPreviewAttributeConverter";
import NumberAttributeConverter from "./behaviors/converters/NumberAttributeConverter";
import ObjectAttributeConverter from "./behaviors/converters/ObjectAttributeConverter";
import ObjectBehaviorsAttributeConverter from "./behaviors/converters/ObjectBehaviorsAttributeConverter";
import PrefabAttributeConverter from "./behaviors/converters/PrefabAttributeConverter";
import SeparatorAttributeConverter from "./behaviors/converters/SeparatorAttributeConverter";
import SliderAttributeConverter from "./behaviors/converters/SliderAttributeConverter";
import StringAttributeConverter from "./behaviors/converters/StringAttributeConverter";
import Vector2AttributeConverter from "./behaviors/converters/Vector2AttributeConverter";
import Vector3AttributeConverter from "./behaviors/converters/Vector3AttributeConverter";
import VideoAttributeConverter from "./behaviors/converters/VideoAttributeConverter";
import {isSceneBehaviorsMigrated, migrateLegacyBehaviors} from "./behaviors/LegacyBehaviorMigration";
import {isLegacyBehaviorId} from "../behaviors/util";
import {IS_OSS} from "../mode/buildMode";
import AssetAttributeConverter from "./behaviors/converters/AssetAttributeConverter";
import BooleanWidget from "./behaviors/widgets/BooleanWidget";
import ButtonWidget from "./behaviors/widgets/ButtonWidget";
import DefaultBehaviorWidget from "./behaviors/widgets/DefaultBehaviorWidget";
import EnumWidget from "./behaviors/widgets/EnumWidget";
import ImageWidget from "./behaviors/widgets/ImageWidget";
import LabelWidget from "./behaviors/widgets/LabelWidget";
import ModelPreviewWidget from "./behaviors/widgets/ModelPreviewWidget";
import NumberWidget from "./behaviors/widgets/NumberWidget";
import ObjectBehaviorsWidget from "./behaviors/widgets/ObjectBehaviorsWidget";
import ObjectWidget from "./behaviors/widgets/ObjectWidget";
import PrefabWidget from "./behaviors/widgets/PrefabWidget";
import SeparatorWidget from "./behaviors/widgets/SeparatorWidget";
import SliderWidget from "./behaviors/widgets/SliderWidget";
import StringWidget from "./behaviors/widgets/StringWidget";
import Vector2Widget from "./behaviors/widgets/Vector2Widget";
import Vector3Widget from "./behaviors/widgets/Vector3Widget";
import VideoWidget from "./behaviors/widgets/VideoWidget";
import {CADController} from "./cad/CADController";
import {ensureObjectMeshData} from "./cad/meshDataUtils";
import {removedObjectContainsCADEditedObject, resetCADModeState, restoreCADTransformControls} from "./cad/removeGuards";
import {isCADToolsEnabled} from "./cad/settings";
import {CADAxisConstraint, CADSelectionMode, CADSelectionShape, CADTool} from "./cad/types";
import {CurveEditorControls} from "./controls/CurveEditorControls";
import LambdaTypeRegistry from "../lambdas/LambdaTypeRegistry";
import AssetWidget, {
    AudioUploadButton,
    FileUploadButton,
    ImageUploadButton,
    VideoUploadButton,
} from "./behaviors/widgets/AssetWidget";
import {defaultRendering} from "./defaultRendering";
import EditorComponent from "./EditorComponent";
import {createEditorErthInterface} from "../behaviors/stem/createStemEngineInterface";
import {generateUniqueNameWithCounter} from "../v2/pages/services";
import EmptySceneTemplate from "./menu/scene/EmptySceneTemplate";
import {isStemEditor} from "./stem-editor/isStemEditor";
import type {StemEditorMetadata} from "./stem-editor/saveStemEditor";
import {ParticleSystemPreviewObject} from "../object/particle/ParticleSystemPreviewObject";
import {DYNAMIC_ROOT_NAME} from "@stem/editor-oss/scene/dynamicRoots";

export {defaultRendering};

export const DEFAULT_VFX_NAME = "New VFX Effect";

const {t} = i18n;

class Editor {
    // TODO: move this to a config/theme file
    private isStarted: boolean = false;
    static DEFAULT_BACKGROUND_COLOR: number = 0x27272a;
    type: string = "scene";
    view: string = "perspective";
    history: History;
    selected: Object3D | Object3D[] | null = null;
    selectionHelpers: Object3D[] = [];
    sceneConfig: SceneConfig = new SceneConfig();
    orthCamera: OrthographicCamera = new OrthographicCamera();

    // --- RuntimeContext delegation: reads through ctx to avoid stale refs ---
    private ctx: RuntimeContext;
    get scene(): Scene {
        return this.ctx.scene;
    }
    set scene(v: Scene) {
        this.engine!.scene = v;
    }
    get sceneHelpers(): THREE.Group {
        return this.ctx.sceneHelpers;
    }
    get camera(): PerspectiveCamera {
        return this.ctx.camera;
    }
    get renderer(): WebGPURenderer {
        return this.ctx.renderer;
    }
    set renderer(v: WebGPURenderer) {
        this.engine!.renderer = v;
    }

    rendererCSS!: CSS3DRenderer;
    objects: Object3D[] = [];
    scripts: any = [];
    animations: any = [];
    transformControls: TransformControls | null = null;
    curveEditorControls: CurveEditorControls | null = null;
    controls: ControlsManager | null = null;
    showViewHelper: boolean = true;
    gpuPickNum: number = 0;
    audioListener: THREE.AudioListener = new THREE.AudioListener();

    // UI camera for UIKit rendering inside the editor viewport. Lazily created
    // by `ensureUICamera()` on first use (mirrors `GameManager.uiCamera` which
    // is play-mode only). Behaviors that build a `UIKit.Fullscreen` in
    // `onEditorAdded` await `editor.ensureUICamera()` and parent the root to it,
    // so the editor preview shares one rendering path with play mode instead of
    // doubling up with a `THREE.CanvasTexture` snapshot.
    uiCamera: PerspectiveCamera | null = null;
    private _uiCameraInitPromise: Promise<PerspectiveCamera> | null = null;

    mousePosition: {x: number; y: number} = {x: 0, y: 0};
    mouseAuxPosition: {x: number; y: number} = {x: 0, y: 0};
    mouseClickPosition: {x: number; y: number} = {x: 0, y: 0};
    objectsNames: Set<string> = new Set<string>();

    previousSceneID?: string | null = null;
    isPasting = false;
    isApplyingSceneSnapshot = false;

    // Read-only inspection mode — DOT-7545 Gap #3. Session-only flag (not
    // persisted). Set when a non-owner, non-collaborator, non-admin opens a
    // public scene for inspection. Gates save paths, Ctrl+S, multiplayer
    // room join, and asset-edit affordances. Anonymous users are redirected
    // to Play before they can reach the editor, so this flag is only ever
    // true for authenticated read-only viewers.
    isReadOnly: boolean = false;

    // --- Deprecation getters/setters: delegate to sceneConfig ---
    get sceneID() {
        return this.sceneConfig.sceneID;
    }
    set sceneID(v) {
        this.sceneConfig.sceneID = v;
        // Invariant: once a sceneID is known, downstream systems (behavior
        // imports, lambda loading) expect a matching assetSource. Reload
        // paths (setUpScene, setUpLocalScene) set it explicitly; save-then-
        // play-without-reload and early stemscript-import paths would
        // otherwise race with it. If a more specialized source (e.g.
        // StemAssetSource) was already installed, leave it alone.
        if (v && !this.assetSource) {
            this.assetSource = new SceneAssetSource(v);
        }
    }
    get sceneName() {
        return this.sceneConfig.sceneName;
    }
    set sceneName(v) {
        this.sceneConfig.sceneName = v;
    }
    get sceneAlias() {
        return this.sceneConfig.sceneAlias;
    }
    set sceneAlias(v) {
        this.sceneConfig.sceneAlias = v;
    }
    get sceneLockedItems() {
        return this.sceneConfig.sceneLockedItems;
    }
    set sceneLockedItems(v) {
        this.sceneConfig.sceneLockedItems = v;
    }
    get sceneThumbnail() {
        return this.sceneConfig.sceneThumbnail;
    }
    set sceneThumbnail(v) {
        this.sceneConfig.sceneThumbnail = v;
    }
    get isPublic() {
        return this.sceneConfig.isPublic;
    }
    set isPublic(v) {
        this.sceneConfig.isPublic = v;
    }
    get isAssetPack() {
        return this.sceneConfig.isAssetPack;
    }
    set isAssetPack(v) {
        this.sceneConfig.isAssetPack = v;
    }
    get isTopPick() {
        return this.sceneConfig.isTopPick;
    }
    set isTopPick(v) {
        this.sceneConfig.isTopPick = v;
    }
    get VFXOnMobile() {
        return this.sceneConfig.VFXOnMobile;
    }
    set VFXOnMobile(v) {
        this.sceneConfig.VFXOnMobile = v;
    }
    get isCloneable() {
        return this.sceneConfig.isCloneable;
    }
    set isCloneable(v) {
        this.sceneConfig.isCloneable = v;
    }
    get isPublished() {
        return this.sceneConfig.isPublished;
    }
    set isPublished(v) {
        this.sceneConfig.isPublished = v;
    }
    get projectUserId() {
        return this.sceneConfig.projectUserId;
    }
    set projectUserId(v) {
        this.sceneConfig.projectUserId = v;
    }
    get useAvatar() {
        return this.sceneConfig.useAvatar;
    }
    set useAvatar(v) {
        this.sceneConfig.useAvatar = v;
    }
    get majorVersion() {
        return this.sceneConfig.majorVersion;
    }
    set majorVersion(v) {
        this.sceneConfig.majorVersion = v;
    }
    get minorVersion() {
        return this.sceneConfig.minorVersion;
    }
    set minorVersion(v) {
        this.sceneConfig.minorVersion = v;
    }
    get assetsCount() {
        return this.sceneConfig.assetsCount;
    }
    set assetsCount(v) {
        this.sceneConfig.assetsCount = v;
    }
    get isMultiplayer() {
        return this.sceneConfig.isMultiplayer;
    }
    set isMultiplayer(v) {
        this.sceneConfig.isMultiplayer = v;
    }
    get multiplayerAutoJoin() {
        return this.sceneConfig.multiplayerAutoJoin;
    }
    set multiplayerAutoJoin(v) {
        this.sceneConfig.multiplayerAutoJoin = v;
    }
    get maxMultiplayerClientsPerRoom() {
        return this.sceneConfig.maxMultiplayerClientsPerRoom;
    }
    set maxMultiplayerClientsPerRoom(v) {
        this.sceneConfig.maxMultiplayerClientsPerRoom = v;
    }
    get showStats() {
        return this.sceneConfig.showStats;
    }
    set showStats(v) {
        this.sceneConfig.showStats = v;
    }
    get showMemoryStats() {
        return this.sceneConfig.showMemoryStats;
    }
    set showMemoryStats(v) {
        this.sceneConfig.showMemoryStats = v;
    }
    get useInstancing() {
        return this.sceneConfig.useInstancing;
    }
    set useInstancing(v) {
        this.sceneConfig.useInstancing = v;
    }
    get useShadows() {
        // Authoritative source is the scene's serialized game settings — that's
        // what `render settings useShadows=…` writes (SettingsHandlers) and what
        // persists across save/reload. `sceneConfig.useShadows` is only an
        // in-memory mirror that defaults to true and was never synced from the
        // scene, so reading it directly made the renderer ignore a scene that
        // explicitly disabled shadows (forcing shadow-variant shader compiles +
        // a shadow pass over the whole scene). Prefer the scene value; fall back
        // to the mirror/default when a scene never set it.
        const game = this.scene?.userData?.game;
        if (game && typeof game.useShadows === "boolean") return game.useShadows;
        return this.sceneConfig.useShadows;
    }
    set useShadows(v) {
        this.sceneConfig.useShadows = v;
        if (this.scene) {
            if (!this.scene.userData.game) this.scene.userData.game = {};
            this.scene.userData.game.useShadows = v;
        }
    }
    get rendering() {
        return this.sceneConfig.rendering;
    }
    set rendering(v) {
        this.sceneConfig.rendering = v;
    }
    get voiceChatEnabled() {
        return this.sceneConfig.voiceChatEnabled;
    }
    set voiceChatEnabled(v) {
        this.sceneConfig.voiceChatEnabled = v;
    }
    get isSandbox() {
        return this.sceneConfig.isSandbox;
    }
    set isSandbox(v) {
        this.sceneConfig.isSandbox = v;
    }
    get aiPromptMode() {
        return this.sceneConfig.aiPromptMode;
    }
    set aiPromptMode(v) {
        this.sceneConfig.aiPromptMode = v;
    }
    get isCollaborative() {
        return this.sceneConfig.isCollaborative;
    }
    set isCollaborative(v) {
        this.sceneConfig.isCollaborative = v;
    }
    get maxCollaboratorsInRoom() {
        return this.sceneConfig.maxCollaboratorsInRoom;
    }
    set maxCollaboratorsInRoom(v) {
        this.sceneConfig.maxCollaboratorsInRoom = v;
    }
    get showHUD() {
        return this.sceneConfig.showHUD;
    }
    set showHUD(v) {
        this.sceneConfig.showHUD = v;
    }
    get hudRenderer() {
        return this.sceneConfig.hudRenderer;
    }
    set hudRenderer(v) {
        this.sceneConfig.hudRenderer = v;
    }
    get allowAnonymousFirebase() {
        return this.sceneConfig.allowAnonymousFirebase;
    }
    set allowAnonymousFirebase(v) {
        this.sceneConfig.allowAnonymousFirebase = v;
    }
    get description() {
        return this.sceneConfig.description;
    }
    set description(v) {
        this.sceneConfig.description = v;
    }
    get tags() {
        return this.sceneConfig.tags;
    }
    set tags(v) {
        this.sceneConfig.tags = v;
    }
    get contentRating() {
        return this.sceneConfig.contentRating;
    }
    set contentRating(v) {
        this.sceneConfig.contentRating = v;
    }
    get sceneAssetId() {
        return this.sceneConfig.sceneAssetId;
    }
    set sceneAssetId(v) {
        this.sceneConfig.sceneAssetId = v;
    }
    get sceneRevisionId() {
        return this.sceneConfig.sceneRevisionId;
    }
    set sceneRevisionId(v) {
        this.sceneConfig.sceneRevisionId = v;
    }
    get publishRevisionId() {
        return this.sceneConfig.publishRevisionId;
    }
    set publishRevisionId(v) {
        this.sceneConfig.publishRevisionId = v;
    }

    behaviorConfigRegistry: BehaviorConfigRegistry;
    behaviorDataManager: BehaviorDataManager;
    behaviorUIManager: BehaviorUIManager;
    behaviorContextProvider: BehaviorContextProvider;
    behaviorAttributeConverter: BehaviorAttributeConverter;
    behaviorScriptRegistry: BehaviorScriptRegistry;
    behaviorPluginManager: BehaviorPluginManager;
    // this should be never reset, because if default behavior configs are loaded once, they are always available
    // when app stop is called we can clear only script behaviors from behaviorRegistry
    behaviorConfigsLoaded: boolean = false;
    behaviorConfigsLoading: boolean = false;
    behaviorTypeRegistry: BehaviorTypeRegistry;
    behaviorScriptInjector: BehaviorScriptInjector;
    usedBehaviorIds: Map<string, number> = new Map(); // used to track behavior IDs with reference counts
    // Lambda system (editor-side, available without play mode)
    lambdaConfigRegistry: LambdaConfigRegistry;
    lambdaTypeRegistry: LambdaTypeRegistry;
    lambdaFileLoader: LambdaFileLoader;
    lambdaConfigsLoaded: boolean = false;
    lambdaConfigsLoading: boolean = false;
    scriptIdCounter: number = 0; // temporary for converting scripts to behaviors to name them
    component: EditorComponent | null = null;
    engine: EngineRuntime | null = null;
    private editorErth: StemEngineInterface | null = null;
    /**
     * Counter so callers can nest `runInScriptImportContext` (for example a
     * future composite import that calls into another). Greater than zero
     * means `addObject` should mark new objects with `userData.isImported`.
     */
    private _scriptImportDepth: number = 0;
    pendingBehaviorsToAdd: Map<string, string[]> = new Map(); // used to queue behaviors to add to game when in sandbox mode
    cadMode = false;
    cadTool: CADTool = "select";
    cadSelectionMode: CADSelectionMode = "object";
    cadSelectionShape: CADSelectionShape = "box";
    cadAxisConstraint: CADAxisConstraint[] = ["x", "y", "z"];
    cadEditedObjectUuid: string | null = null;
    cadController: CADController;

    /** Source for asset discovery. Set during scene/stem setup. */
    assetSource: AssetSource | undefined = undefined;

    private inactivityTimeout: any = null;

    private boundFirstInteractionHandler: () => void = this.onFirstInteraction.bind(this);

    constructor(engine: EngineRuntime) {
        this.engine = engine;
        this.ctx = engine;
        this.history = new History(this);
        this.transformControls = engine.transformControls;

        // Note: curveEditorControls will be initialized lazily in enterCurveEditMode
        // because app.viewport may not be available yet during construction
        this.curveEditorControls = null;

        this.scripts = engine.scripts;

        // setup behavior system
        this.behaviorConfigRegistry = new BehaviorConfigRegistry();
        this.behaviorScriptRegistry = new BehaviorScriptRegistry();

        this.behaviorAttributeConverter = new BehaviorAttributeConverter();
        this.behaviorDataManager = new BehaviorDataManager(
            this.behaviorConfigRegistry,
            this.behaviorAttributeConverter,
        );
        this.behaviorTypeRegistry = new BehaviorTypeRegistry();
        this.behaviorScriptInjector = new BehaviorScriptInjector();
        this.behaviorPluginManager = new BehaviorPluginManager(this);
        this.behaviorContextProvider = new BehaviorContextProvider();
        // Note: BehaviorContextProvider now uses async API queries, no init() needed
        this.behaviorUIManager = new BehaviorUIManager(this.behaviorAttributeConverter, this.behaviorPluginManager);
        this.behaviorUIManager.init();
        this.registerBehaviorWidgets();
        this.registerAttributeConverters();

        // Setup lambda system (editor-side) — configs loaded eagerly so they're available immediately
        this.lambdaConfigRegistry = new LambdaConfigRegistry();
        this.lambdaTypeRegistry = new LambdaTypeRegistry();
        this.lambdaFileLoader = new LambdaFileLoader();
        this.loadEagerLambdaConfigs();
        this.cadController = new CADController(this);

        engine.on(`animate.editor`, this.update.bind(this));
        engine.on(`objectChanged.editor`, this.onObjectChanged.bind(this));
    }

    // this will overwrite existing default behavior configs
    async loadDefaultBehaviorConfigsAndTypes() {
        if (this.behaviorConfigsLoading || this.behaviorConfigsLoaded) {
            return;
        }
        this.behaviorConfigsLoading = true;

        const service = this.engine?.behaviorLoadingService;
        if (!service) {
            console.error("[Editor] BehaviorLoadingService not available");
            this.behaviorConfigsLoading = false;
            return;
        }

        const defaultConfigs = await service.loadDefaultConfigs();

        console.log(`[Editor] Loading ${defaultConfigs.length} default behavior configs and types...`);

        // Register configs and collect those that need class loading
        const configsToLoad: Array<{id: string; main: string; isScript: boolean}> = [];

        for (const config of defaultConfigs) {
            if (this.behaviorConfigRegistry.getConfig(config.id)) {
                this.behaviorConfigRegistry.unregisterConfig(config.id, true);
            }
            this.behaviorConfigRegistry.registerConfig(config.id, config);

            if (!this.behaviorTypeRegistry.getType(config.id)) {
                configsToLoad.push({id: config.id, main: config.main, isScript: false});
            }
        }

        // Batch load behavior classes via shared service
        const loaded = await service.loadClasses(configsToLoad as any, {});

        let successCount = 0;
        for (const [id, behaviorType] of loaded) {
            this.behaviorTypeRegistry.registerType(id, behaviorType);
            successCount++;
        }

        this.behaviorConfigsLoaded = true;
        this.behaviorConfigsLoading = false;
        console.info(
            `[Editor] Loaded ${successCount} behavior types (${configsToLoad.length - successCount} failures)`,
        );
    }

    /** Synchronously registers all built-in lambda configs (eagerly loaded JSON) */
    private loadEagerLambdaConfigs(): void {
        const eagerConfigs = this.lambdaFileLoader.getEagerConfigs();
        for (const {config} of eagerConfigs) {
            if (!this.lambdaConfigRegistry.getConfig(config.id)) {
                this.lambdaConfigRegistry.registerConfig(config.id, config, true);
            }
        }
        this.lambdaConfigsLoaded = true;
        console.info(`[Editor] Eagerly loaded ${eagerConfigs.length} built-in lambda configs`);
    }

    /** Async: loads lambda class constructors (lazy-loaded TS modules) */
    async loadDefaultLambdaConfigsAndTypes() {
        if (this.lambdaConfigsLoading) return;
        this.lambdaConfigsLoading = true;

        try {
            const packs = await this.lambdaFileLoader.loadAllBuiltInPacks();
            let successCount = 0;

            for (const {config, cls} of packs) {
                if (!this.lambdaConfigRegistry.getConfig(config.id)) {
                    this.lambdaConfigRegistry.registerConfig(config.id, config, true);
                }
                if (!this.lambdaTypeRegistry.getType(config.id)) {
                    this.lambdaTypeRegistry.registerType(config.id, cls);
                }
                successCount++;
            }

            console.info(`[Editor] Loaded ${successCount} built-in lambda types`);
        } catch (error) {
            console.error("[Editor] Failed to load lambda types:", error);
        } finally {
            this.lambdaConfigsLoading = false;
        }
    }

    private registerBehaviorWidgets(): void {
        this.behaviorUIManager.setBehaviorWidget(new DefaultBehaviorWidget(this.behaviorDataManager));
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Boolean, new BooleanWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Number, new NumberWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.String, new StringWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Vector3, new Vector3Widget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Vector2, new Vector2Widget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Enum, new EnumWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Object, new ObjectWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Children, new ObjectWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Prefab, new PrefabWidget());
        this.behaviorUIManager.registerAttributeWidget(
            BehaviorAttributeType.ModelAsset,
            new AssetWidget("widget-model-asset"),
        );
        this.behaviorUIManager.registerAttributeWidget(
            BehaviorAttributeType.ImageAsset,
            new AssetWidget("widget-image-asset", ImageUploadButton),
        );
        this.behaviorUIManager.registerAttributeWidget(
            BehaviorAttributeType.AudioAsset,
            new AssetWidget("widget-audio-asset", AudioUploadButton),
        );
        this.behaviorUIManager.registerAttributeWidget(
            BehaviorAttributeType.VideoAsset,
            new AssetWidget("widget-video-asset", VideoUploadButton),
        );
        this.behaviorUIManager.registerAttributeWidget(
            BehaviorAttributeType.FileAsset,
            new AssetWidget("widget-file-asset", FileUploadButton),
        );
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Slider, new SliderWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Separator, new SeparatorWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Label, new LabelWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Image, new ImageWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Button, new ButtonWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.ModelPreview, new ModelPreviewWidget());
        this.behaviorUIManager.registerAttributeWidget(
            BehaviorAttributeType.ObjectBehaviors,
            new ObjectBehaviorsWidget(),
        );
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Video, new VideoWidget());
        this.behaviorUIManager.registerAttributeWidget(BehaviorAttributeType.Color, new StringWidget());
    }

    private registerAttributeConverters(): void {
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Boolean,
            new BooleanAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Number,
            new NumberAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Float,
            new NumberAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.String,
            new StringAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Vector3,
            new Vector3AttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Vector2,
            new Vector2AttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Enum,
            new EnumAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Object,
            new ObjectAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Children,
            new ChildrenAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Prefab,
            new PrefabAttributeConverter(queryClient),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.ModelAsset,
            new AssetAttributeConverter(queryClient, AssetType.Model, BehaviorAttributeType.ModelAsset),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.ImageAsset,
            new AssetAttributeConverter(queryClient, AssetType.Image, BehaviorAttributeType.ImageAsset),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.AudioAsset,
            new AssetAttributeConverter(queryClient, AssetType.Audio, BehaviorAttributeType.AudioAsset),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.VideoAsset,
            new AssetAttributeConverter(queryClient, AssetType.Video, BehaviorAttributeType.VideoAsset),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.FileAsset,
            new AssetAttributeConverter(queryClient, AssetType.File, BehaviorAttributeType.FileAsset),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Slider,
            new SliderAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Label,
            new LabelAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Separator,
            new SeparatorAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Image,
            new ImageAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Group,
            new GroupAttributeConverter(this.behaviorAttributeConverter),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.ObjectBehaviors,
            new ObjectBehaviorsAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Video,
            new VideoAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Button,
            new ButtonAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.ModelPreview,
            new ModelPreviewAttributeConverter(),
        );
        this.behaviorAttributeConverter.registerAttributeConverter(
            BehaviorAttributeType.Color,
            new ColorAttributeConverter(),
        );
    }

    isGame = () => {
        const gameSettings = this.scene?.userData?.game;
        return !!(gameSettings?.isGame ?? gameSettings?.enabled);
    };

    start() {
        if (this.isStarted) {
            console.warn("[Editor] Editor is already started.");
            return;
        }
        if (!this.engine) {
            console.error("[Editor] EngineRuntime is not initialized. Cannot start editor.");
            return;
        }

        // Set isStarted immediately to prevent concurrent initialization
        this.isStarted = true;

        void this.loadDefaultBehaviorConfigsAndTypes();
        void this.loadDefaultLambdaConfigsAndTypes();

        this.scene.name = "Default Scene";
        this.scene.background = new THREE.Color(Editor.DEFAULT_BACKGROUND_COLOR);

        this.engine.on("sceneSaveStart.Editor", () => {
            this.removePreviewBoxes();
        });

        this.engine.on("objectRemoved.Editor", (object: any) => {
            this.removeOjbectPreviewBox(object);
        });

        this.engine.on("sceneClosed.Editor", () => {
            this.onSceneClosed();
        });

        this.engine.on("updateSelection.Editor", () => {
            const selected = this.selected;
            if (selected) {
                this.deselect();
                this.select(selected);
            }
        });

        //TODO: MISHA - review the auto-save policy
        this.engine.storage.autoSave = false;
        this.engine.call("storageChanged", this, "autoSave", true);
        this.engine.call("editorStarted", this);

        this.select(null);
        this.addEventsListeners();
        this.startInactivityWatcher();
        this.clearAndAddObjectsBehaviorPlugins();
    }

    stop() {
        if (!this.isStarted) {
            console.warn("[Editor] Editor is not started or already stopped.");
            return;
        }

        if (!this.engine) {
            console.error("[Editor] EngineRuntime is not initialized. Cannot stop editor.");
            return;
        }

        this.isStarted = false;
        this.syncSceneBehaviorConfigs();
        this.behaviorPluginManager.clear();

        this.engine.call("editorStopped", this);
        this.engine.on("sceneSaveStart.Editor", null);
        this.engine.on("sceneClosed.Editor", null);
        this.engine.on("updateSelection.Editor", null);
        this.engine.on("objectChanged.editor", null);

        if (this.transformControls) {
            let controlHelper = this.transformControls.getHelper();

            this.sceneHelpers.remove(controlHelper);
        }

        this.objectsNames.clear();
        this.disposeUICamera();
        this.removeEventsListeners();
        this.stopInactivityWatcher();
    }

    /**
     * Clean up behavior plugins for an object and all its children
     * This method follows SRP by keeping editor-specific plugin management in the Editor
     * @param object
     */
    cleanupBehaviorPluginsForObjectAndChildren(object: THREE.Object3D): void {
        // Clean up behavior plugins for this object
        const behaviors = object.userData?.behaviors;
        if (behaviors && Array.isArray(behaviors)) {
            behaviors.forEach(behaviorData => {
                try {
                    const behaviorPlugin = this.behaviorPluginManager.getPlugin(behaviorData.uuid);
                    if (behaviorPlugin) {
                        this.behaviorPluginManager.removePlugin(behaviorPlugin);
                        console.log(
                            `[Editor] Cleaned up behavior plugin "${behaviorData.id}" (${behaviorData.uuid}) from deleted object "${object.name}"`,
                        );
                    }
                } catch (error) {
                    console.error(
                        `[Editor] Error cleaning up behavior plugin "${behaviorData.id}" (${behaviorData.uuid}):`,
                        error,
                    );
                }
            });
        }

        // Recursively clean up behavior plugins for all children
        object.children.forEach(child => {
            this.cleanupBehaviorPluginsForObjectAndChildren(child);
        });
    }

    async setScene(scene: THREE.Scene, skipOtherActions = false, isNewScene = false): Promise<void> {
        if (this.engine) {
            this.isApplyingSceneSnapshot = true;
            try {
                // Clean up old particle systems from batchedRenderer before replacing scene
                if (this.engine.batchedRenderer && this.scene) {
                    QuarksUtil.runOnAllParticleEmitters(this.scene, (emitter: ParticleEmitter) => {
                        this.engine!.batchedRenderer.deleteSystem(emitter.system);
                    });
                }

                // TODO: refactor
                this.engine.scene = scene;
                this.objectsNames = new Set<string>();

                let globalHost = scene.getObjectByName(GLOBAL_BEHAVIOR_HOST);
                if (!globalHost) {
                    globalHost = new THREE.Object3D();
                    globalHost.name = GLOBAL_BEHAVIOR_HOST;
                    scene.add(globalHost);
                }

                let firstDirLight: THREE.Object3D | null = null;

                this.scene.traverse((child: any) => {
                    if (child.isDirectionalLight && !firstDirLight) {
                        firstDirLight = child;
                    }
                    if (child.isHemisphereLight && isNewScene) {
                        (child as Object3D).position.set(1e9, 1e9, 1e9);
                    }
                });

                this.scene.traverse((child: any) => {
                    this.objectsNames.add(child.name);
                    if (child === globalHost) return;

                    const isDirLight = child.isDirectionalLight;
                    if (isDirLight && child.userData.physics) {
                        delete child.userData.physics;
                    }

                    if (!this.VFXOnMobile && DetectDevice.isMobile() && child instanceof ParticleEmitter) {
                        child.visible = false;
                        child.system?.stop?.();
                    }
                    const behaviors: any[] = child.userData?.behaviors || [];
                    behaviors.forEach(b => {
                        const hostBehaviors: any[] = globalHost.userData.behaviors || [];

                        if (b.id === MOBILE_TOUCH_CONTROLS_BEHAVIOR_ID || b.id === CASCADED_SHADOWS_MAP_BEHAVIOR_ID) {
                            if (!hostBehaviors.some(hb => hb.id === b.id)) {
                                const attrs = {...b.attributesData};

                                this.execute(new DetachBehaviorCommand(child, "", b.id));

                                new AttachBehaviorCommand(globalHost, b.id, {
                                    attributesData: attrs,
                                    uuid: b.uuid,
                                    enabled: b.enabled,
                                }).execute();

                                console.log(`Moved behavior '${b.id}' from ${child.name} to ${GLOBAL_BEHAVIOR_HOST}`);
                            }
                        }
                    });
                });

                this.scene.add(this.engine.batchedRenderer);
                this.processParticleSystems(this.scene);
                if (skipOtherActions) {
                    return;
                }

                if (this.engine.environmentManager) {
                    await this.engine.environmentManager.applyEnvironmentSettings();
                }

                if (!this.behaviorConfigsLoaded && !this.engine.options.isPlayModeOnly) {
                    console.info("[Editor] Waiting for behavior configs to load before processing scene...");

                    await new Promise<void>(resolve => {
                        const configCheckInterval = setInterval(() => {
                            if (this.behaviorConfigsLoaded) {
                                clearInterval(configCheckInterval);
                                console.info("[Editor] Behavior configs loaded, proceeding with scene setup");
                                resolve();
                            }
                        }, 100); // Check every 100ms
                    });
                }

                this.scene.traverse(child => {
                    if (child === globalHost) return;

                    const behaviors: any[] = child.userData?.behaviors || [];
                    behaviors.forEach(b => {
                        const hostBehaviors: any[] = globalHost.userData.behaviors || [];

                        if (b.id === MOBILE_TOUCH_CONTROLS_BEHAVIOR_ID) {
                            if (!hostBehaviors.some(hb => hb.id === b.id)) {
                                const attrs = {...b.attributesData};

                                this.execute(new DetachBehaviorCommand(child, "", b.id));

                                new AttachBehaviorCommand(globalHost, b.id, {
                                    attributesData: attrs,
                                    uuid: b.uuid,
                                    enabled: b.enabled,
                                }).execute();

                                console.log(`Moved behavior '${b.id}' from ${child.name} to ${GLOBAL_BEHAVIOR_HOST}`);
                            }
                        } else if (b.id === CASCADED_SHADOWS_MAP_BEHAVIOR_ID) {
                            const target = firstDirLight || globalHost;
                            const targetBehaviors: any[] = target.userData.behaviors || [];

                            if (!targetBehaviors.some(hb => hb.id === b.id) && child !== target) {
                                const attrs = {...b.attributesData};

                                this.execute(new DetachBehaviorCommand(child, "", b.id));

                                new AttachBehaviorCommand(target, b.id, {
                                    attributesData: attrs,
                                    uuid: b.uuid,
                                    enabled: b.enabled,
                                }).execute();

                                console.log(`Moved behavior '${b.id}' from ${child.name} to ${target.name}`);
                            }
                        }
                    });
                });

                const csmDefaultTarget = firstDirLight as THREE.Object3D | null;
                if (csmDefaultTarget) {
                    const targetBehaviors: any[] = csmDefaultTarget.userData.behaviors || [];
                    const hasCSM = targetBehaviors.some((b: any) => b.id === CASCADED_SHADOWS_MAP_BEHAVIOR_ID);

                    // Also check global host just in case it ended up there
                    const globalHostBehaviors: any[] = globalHost.userData.behaviors || [];
                    const hasCSMGlobal = globalHostBehaviors.some((b: any) => b.id === CASCADED_SHADOWS_MAP_BEHAVIOR_ID);

                    if (!hasCSM && !hasCSMGlobal) {
                        console.log(
                            `Adding missing '${CASCADED_SHADOWS_MAP_BEHAVIOR_ID}' behavior to ${csmDefaultTarget.name}`,
                        );
                        new AttachBehaviorCommand(csmDefaultTarget, CASCADED_SHADOWS_MAP_BEHAVIOR_ID, {
                            attributesData: {},
                            enabled: true,
                        }).execute();
                    }
                }

                await this.onSceneLoaded();
            } finally {
                setTimeout(() => {
                    this.isApplyingSceneSnapshot = false;
                }, 2000)

            }
        }

        this.scene.traverse(object => {
            object.updateMatrixWorld();
            (object as any).target?.updateMatrixWorld();
        });
    }

    private async onSceneLoaded() {
        // await this.cleanupSceneUserData(); // temporary fix for old script behaviors

        this.loadSceneBehaviors();

        // In play-mode-only (publish links), skip editor-specific behavior processing.
        // GameManager will handle all behavior loading via the behavior bundle.
        if (this.engine?.options.isPlayModeOnly) {
            return;
        }

        // Migrate legacy behaviors to Assets API.
        // OSS has no legacy cloud/Mongo behavior backend — and OSS asset IDs
        // ("oss-asset-<ts>-<rand>") are not 24-char Mongo ObjectIDs, so
        // `isLegacyBehaviorId` would wrongly flag every OSS behavior as legacy
        // and mint a fresh duplicate asset on every load. Skip migration in OSS.
        if (!IS_OSS && this.engine?.mode === ApplicationMode.EDIT && this.sceneID) {
            await migrateLegacyBehaviors({
                scene: this.scene,
                sceneId: this.sceneID,
            });
        }

        this.cleanupScriptsAndConfigs(); // temporary fix for lost scripts

        this.convertToNewBehaviors();
        this.convertCameraToNewFormat(this.camera);
        await this.addBackendBehaviorsToScene();
        await this.loadBackendLambdaConfigs();
        await this.loadBackendImportSources();
        this.notifyObjectsAddedToScene();
        this.clearAndAddObjectsBehaviorPlugins();
        this.syncSceneBehaviorConfigs();
    }

    private notifyObjectsAddedToScene() {
        this.traverseSceneObjects(object => {
            this.engine?.call("objectAdded", this, object);
        });
    }

    private clearAndAddObjectsBehaviorPlugins() {
        this.behaviorPluginManager.clear();
        this.usedBehaviorIds.clear();
        if (this.isSandbox) {
            // In sandbox mode, we don't add behavior plugins
            return;
        }
        const processObject = (object: THREE.Object3D) => {
            const objectBehaviorsData = object.userData.behaviors as BehaviorData[] | undefined;
            if (!objectBehaviorsData || objectBehaviorsData.length === 0) {
                return;
            }
            objectBehaviorsData.forEach(behaviorData => {
                this.addBehaviorPlugin(object, behaviorData);
                this.addBehaviorIdReference(behaviorData.id);
            });
        };

        // Process the scene root itself (scene-level behaviors)
        processObject(this.scene);

        // Process all child objects
        this.traverseSceneObjects(processObject);
    }

    // optimized(not) recursive function to traverse the scene
    traverseSceneObjects(callback: (object: THREE.Object3D) => void) {
        const isStemObject = (/*object: THREE.Object3D*/) => {
            // return object.userData && object.userData.isStemObject;
            return true; // For now, we consider all objects as stem objects because not all objects have isStemObject flag for now
        };

        const traverse = (object: THREE.Object3D) => {
            if (!(isStemObject(/*object*/))) {
                return;
            }
            callback(object);
            object.children.forEach(child => {
                traverse(child);
            });
        };

        this.scene.children.forEach(child => {
            traverse(child);
        });
    }

    reverseTraverseSceneObjects(callback: (object: THREE.Object3D) => void) {
        const objectsArr: THREE.Object3D[] = [];
        this.traverseSceneObjects(object => {
            objectsArr.push(object);
        });

        objectsArr.reverse().forEach(callback);
    }

    handleEditorVisibilityChange(uuid: string, visible: boolean) {
        const object = this.objectByUuid(uuid);
        if (object) {
            object.userData.editorVisibility = visible;
            object.visible = visible;
            this.engine?.call("objectChanged", object, object);
        }
    }

    async parseAndRegisterScriptBehavior(
        id: string,
        code: string,
        context = getAssetResolutionContext(this.scene) || undefined,
        importRevisionMap?: ScriptImportRevisionMap,
    ): Promise<void> {
        try {
            const importContext = await buildNameAwareScriptImportContext(this.sceneID, context);
            const resolvedImportRevisionMap = importRevisionMap || await loadScriptImportRevisionMap(code, importContext);
            const behaviorClass = this.behaviorScriptInjector.parse(id, code, undefined, {
                context: importContext,
                importRevisionMap: resolvedImportRevisionMap,
            });
            if (this.behaviorTypeRegistry.getType(id)) {
                this.behaviorTypeRegistry.unregisterType(id);
            }
            this.behaviorTypeRegistry.registerType(id, behaviorClass);
        } catch (error) {
            console.error(`[Editor] Failed to parse script behavior "${id}":`, error);
        }
    }

    async addBackendBehaviorsToScene() {
        if (!this.scene || !this.assetSource) {
            return;
        }
        const behaviorsInScene =
            this.assetSource.kind === "scene"
                ? await getBehaviorsListForScene(this.sceneID!, this.scene)
                : await this.assetSource
                      .getAssets({types: [AssetType.Behavior]})
                      .then(({assets}) => getBehaviorsFromAssets(assets, this.scene));
        const sceneContext = getAssetResolutionContext(this.scene) || undefined;
        const importContext = await buildNameAwareScriptImportContext(this.sceneID, sceneContext);

        for (const behaviorConfigData of behaviorsInScene) {
            const config = {
                ...behaviorConfigData.Config,
                id: behaviorConfigData.ID, // Use the backend ID as the config ID
            } as BehaviorConfig;

            let behaviorConfig = this.behaviorConfigRegistry.getConfig(behaviorConfigData.ID);

            // If there is already a behavior config with the same ID and this
            // is not a legacy behavior, remove the old one first. That is, new
            // behaviors saved using the Asset API take precedence over
            // behaviors stored in the scene.
            if (behaviorConfig && !isLegacyBehaviorId(behaviorConfigData.ID)) {
                this.behaviorConfigRegistry.unregisterConfig(behaviorConfigData.ID);
                this.behaviorScriptRegistry.unregisterScript(behaviorConfigData.ID);
                behaviorConfig = null; // Mark the config as deleted
            }

            // If there is no behavior config with the same ID, register the new
            // one.
            if (!behaviorConfig) {
                this.behaviorConfigRegistry.registerConfig(behaviorConfigData.ID, config);
                this.behaviorScriptRegistry.registerScript(behaviorConfigData.ID, behaviorConfigData.Code);
                console.info(`[Editor] Registering behavior config "${config.id}" from backend`);
            }

            if (behaviorConfigData.RevisionID) {
                seedScriptDependencyEntry({
                    assetId: behaviorConfigData.ID,
                    revisionId: behaviorConfigData.RevisionID,
                    ownerType: "behavior",
                    dependencies: getScriptImportDependencyMap(behaviorConfigData.Code, importContext),
                });
            }

            if (behaviorConfigData.Code) {
                await this.parseAndRegisterScriptBehavior(behaviorConfigData.ID, behaviorConfigData.Code);
            }
        }
    }

    async loadBackendLambdaConfigs(): Promise<void> {
        if (!this.scene) return;

        try {
            let lambdaAssets: {id: string; headRevisionId: string}[];
            if (this.assetSource) {
                const response = await this.assetSource.getAssets({types: [AssetType.Lambda]});
                lambdaAssets = response.assets;
            } else if (this.sceneID) {
                const response = await getSceneAssets(this.sceneID, {
                    types: [AssetType.Lambda],
                });
                lambdaAssets = response.assets;
            } else {
                return;
            }
            const sceneContext = getAssetResolutionContext(this.scene) || undefined;
            const importContext = await buildNameAwareScriptImportContext(this.sceneID, sceneContext);

            let count = 0;
            await Promise.all(
                lambdaAssets.map(async asset => {
                    const headRevisionId = asset.headRevisionId;
                    if (!headRevisionId) {
                        console.warn(`[Editor] No head revision for lambda asset ${asset.id}`);
                        return;
                    }
                    try {
                        const sceneRevisionId = resolveAssetRevisionId(asset.id, sceneContext ?? emptyAssetResolutionContext) || headRevisionId;
                        const [{config}, sceneRevision] = await Promise.all([
                            getLambdaRevisionData(asset.id, headRevisionId),
                            getLambdaRevisionData(asset.id, sceneRevisionId),
                        ]);

                        // Always update with latest head config so descriptions stay current
                        if (this.lambdaConfigRegistry.getConfig(config.id)) {
                            this.lambdaConfigRegistry.updateConfig(config.id, config, true);
                        } else {
                            this.lambdaConfigRegistry.registerConfig(config.id, config, true);
                        }
                        this.lambdaConfigRegistry.setAssetMeta(config.id, {
                            assetId: asset.id,
                            revisionId: sceneRevisionId,
                        });
                        seedScriptDependencyEntry({
                            assetId: asset.id,
                            revisionId: sceneRevisionId,
                            ownerType: "lambda",
                            dependencies: getScriptImportDependencyMap(sceneRevision.code, importContext),
                        });
                        count++;
                    } catch (err) {
                        console.warn(`[Editor] Failed to load lambda config for asset ${asset.id}:`, err);
                    }
                }),
            );

            if (count > 0) {
                console.info(`[Editor] Loaded ${count} backend lambda configs`);
            }
        } catch (error) {
            console.error("[Editor] Failed to load backend lambda configs:", error);
        }
    }

    async loadBackendImportSources(): Promise<void> {
        if (!this.sceneID || !this.scene) return;
        if (!isScriptsEnabled()) return;

        try {
            const {assets: importAssets} = await getSceneAssets(this.sceneID, {
                types: [AssetType.Script],
            });
            const sceneContext = getAssetResolutionContext(this.scene) || undefined;
            const importContext = await buildNameAwareScriptImportContext(this.sceneID, sceneContext);

            let count = 0;
            await Promise.all(
                importAssets.map(async asset => {
                    const revisionId = resolveAssetRevisionId(asset.id, sceneContext ?? emptyAssetResolutionContext) || asset.headRevisionId;
                    if (!revisionId) {
                        console.warn(`[Editor] No current revision for import asset ${asset.id}`);
                        return;
                    }

                    try {
                        const {code} = await getScriptRevisionData(asset.id, revisionId);
                        seedScriptDependencyEntry({
                            assetId: asset.id,
                            revisionId,
                            ownerType: "import",
                            dependencies: getScriptImportDependencyMap(code, importContext),
                        });
                        count++;
                    } catch (err) {
                        console.warn(`[Editor] Failed to load import source for asset ${asset.id}:`, err);
                    }
                }),
            );

            if (count > 0) {
                console.info(`[Editor] Loaded ${count} backend import sources`);
            }
        } catch (error) {
            console.error("[Editor] Failed to load backend import sources:", error);
        }
    }

    private clearSceneBehaviorRegistry() {
        const behaviorConfigs = this.behaviorConfigRegistry.getAllConfigs();
        for (const config of behaviorConfigs) {
            if (config.isScript) {
                this.behaviorConfigRegistry.unregisterConfig(config.id);
            }
        }
        this.behaviorScriptRegistry.clear();
    }

    onSaveScene() {
        this.syncSceneBehaviorConfigs();

        const textureCheckResult = checkAndNotifyLargeTextures(this.scene);
        logLargeTexturesReport(textureCheckResult);

        const shadowLights = ShadowUtils.checkShadowCastingLights(this.scene);
        ShadowUtils.logShadowCastersReport(shadowLights);
    }

    private onSceneClosed() {
        this.clearSceneBehaviorRegistry();
        this.clearPendingBehaviors();
    }

    syncSceneBehaviorConfigs() {
        this.saveLegacySceneBehaviorConfigs();
        this.saveLegacySceneBehaviorScripts();
    }

    createEmptyScene() {
        const template = new EmptySceneTemplate();
        template.create();
        console.info("[Editor] Empty scene created");
        this.controls?.loadCamera();
    }

    clear() {
        if (!this.engine) {
            console.error("[Editor] EngineRuntime is not initialized. Cannot clear editor.");
            return;
        }

        this.engine.call("clearTools", this);

        this.history.clear();

        this.removePreviewBoxes();
        this.removeAudioListener();
        this.clearPendingBehaviors();
        this.clearScriptsAndConfigs();
        this.clearSelectionHelpers();
        // Intentionally do NOT call `disposeUICamera()` here. The
        // `scene.children` walk below removes the uiCamera as a side effect,
        // but `ensureUICamera()` is self-healing — it re-adds the cached
        // camera if its parent was cleared. Disposing the cache outright
        // would orphan any UIKit roots that behaviors had already attached
        // to the cached camera object (since their `_uiAttached=true` keeps
        // the helper's `attach()` from re-parenting onto a fresh camera).

        if (this.scene.background instanceof THREE.Texture) {
            this.scene.background = new THREE.Color(Editor.DEFAULT_BACKGROUND_COLOR);
        } else if (this.scene.background instanceof THREE.Color) {
            this.scene.background.setHex(Editor.DEFAULT_BACKGROUND_COLOR);
        }

        this.scene.fog = null;

        this.deselect();

        // Drop the stem-editor flag before the loop so the removeObject
        // guard against deleting the stem instance does not block teardown.
        delete this.scene.userData.stemEditor;

        const objects = this.scene.children;

        while (objects.length > 0) {
            this.removeObject(objects[0]!);
            //this object is added back if removed
            if (objects.length == 1 && objects[0]?.name === DYNAMIC_ROOT_NAME) {
                break;
            }
        }

        this.scripts.length = 0;
        const userName = this.engine?.authManager.getUserName();
        this.sceneID = null;
        this.sceneName = this.isSandbox ? `${userName ? userName + "'s" : "Your"} Sandbox` : "Game Title";
        this.sceneAlias = userName;
        this.engine.options.sceneType = "Empty";
        this.isSandbox = false;
        this.isCollaborative = false;

        const game = {
            uuid: THREE.MathUtils.generateUUID(),
            enabled: true,
            lives: 3,
            maxScore: 500,
        };

        this.scene.userData = {
            game,
            scheduler: {
                enabled: false,
            },
            snapping: {...DEFAULT_SNAPPING_SETTINGS},
            compartmentsEnabled: true,
        };
        this.scene.uuid = THREE.MathUtils.generateUUID();
        this.isMultiplayer = false;
        this.showHUD = false;
        this.voiceChatEnabled = false;
        this.useAvatar = false;

        this.engine.call("editorCleared", this);
        this.engine.call("scriptChanged", this);
        this.engine.call("animationChanged", this);
    }

    reset() {
        this.stop();
        this.start();
    }

    // probably its for avoiding browser to block audio playback until user interacts with the page
    onFirstInteraction() {
        document.removeEventListener("click", this.boundFirstInteractionHandler);
        this.addAudioListener();
    }

    private addAudioListener() {
        if (!this.camera.children.find(o => o instanceof THREE.AudioListener)) {
            this.camera.add(this.audioListener);
        }
    }

    private removeAudioListener() {
        const index = this.camera.children.findIndex(o => o instanceof THREE.AudioListener);
        if (index !== -1) {
            this.camera.remove(this.camera.children[index]!);
        }
    }

    getObjectMaterial(object: THREE.Object3D | THREE.Mesh, slot: number) {
        // Ensure object is a Mesh before accessing material
        if ((object as THREE.Mesh).material !== undefined) {
            let material = (object as THREE.Mesh).material;

            if (Array.isArray(material) && slot !== undefined) {
                material = material[slot]!;
            }

            return material;
        }
        return undefined;
    }

    setObjectMaterial(object: THREE.Object3D, slot: number, newMaterial: THREE.Material) {
        if (Array.isArray((object as any).material) && slot !== undefined) {
            (object as any).material[slot] = newMaterial;
        } else {
            (object as any).material = newMaterial;
        }
    }

    objectByUuid(uuid: string): THREE.Object3D | null {
        return this.scene.getObjectByProperty("uuid", uuid) || null;
    }

    get cadEditedObject(): THREE.Mesh | null {
        if (!this.cadEditedObjectUuid) {
            return null;
        }

        const object = this.objectByUuid(this.cadEditedObjectUuid);
        return object instanceof THREE.Mesh ? object : null;
    }

    getCADSupport(object: THREE.Object3D | THREE.Object3D[] | null = this.selected) {
        if (!isCADToolsEnabled(this.scene)) {
            return {
                supported: false,
                reason: "CAD Tools (beta) is disabled in Project Settings.",
            };
        }

        if (Array.isArray(object) || !(object instanceof THREE.Mesh)) {
            return {
                supported: false,
                reason: "Mesh edit mode requires a single mesh selection.",
            };
        }

        if (!(object.geometry instanceof THREE.BufferGeometry)) {
            return {
                supported: false,
                reason: "Mesh edit mode requires BufferGeometry.",
            };
        }

        if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
            return {
                supported: false,
                reason: "Mesh edit mode is not available for skinned meshes.",
            };
        }

        const position = object.geometry.getAttribute("position");
        if (!position || position.count < 3) {
            return {
                supported: false,
                reason: "Mesh edit mode requires a valid mesh surface.",
            };
        }

        return {
            supported: true,
            reason: null,
        };
    }

    canEnterCADMode(object: THREE.Object3D | THREE.Object3D[] | null = this.selected): boolean {
        return this.getCADSupport(object).supported;
    }

    ensureMeshDataForObject(object: THREE.Object3D | null = this.selected as THREE.Object3D | null) {
        if (!this.canEnterCADMode(object)) {
            return null;
        }

        const serializedMeshData = ensureObjectMeshData(object);
        if (serializedMeshData) {
            if (this.cadEditedObjectUuid === object?.uuid) {
                this.cadController.refresh();
            }
            this.engine?.call("objectChanged", this, object);
        }

        return serializedMeshData;
    }

    enterCADMode(target?: THREE.Object3D | null) {
        const object = target ?? (Array.isArray(this.selected) ? null : this.selected);

        // Block CAD mode if object is locked by another user
        const selectedBy = object?.userData?.selectedBy;
        if (selectedBy && selectedBy !== this.engine?.userId) {
            showToast({
                type: "warning",
                title: "This object is being edited by another user.",
            });
            return false;
        }

        const cadSupport = this.getCADSupport(object || null);
        if (!cadSupport.supported) {
            showToast({
                type: "warning",
                title: cadSupport.reason || "Mesh edit mode is not available for this object.",
            });
            return false;
        }

        const mesh = object as THREE.Mesh;
        this.ensureMeshDataForObject(mesh);
        this.cadController.activate(mesh);
        this.engine?.transformControls?.detach();
        if (this.engine?.transformControls) {
            (this.engine.transformControls as unknown as {visible?: boolean}).visible = false;
        }

        this.cadMode = true;
        this.cadEditedObjectUuid = mesh.uuid;
        if (this.cadSelectionMode === "object") {
            this.cadSelectionMode = "vertex";
        }
        if (this.cadTool === "select") {
            this.cadTool = "move";
        }

        window.addEventListener("keydown", this.handleCADKeyboardEvent);

        this.engine?.call("cadModeChanged", this, {
            enabled: this.cadMode,
            object: mesh,
        });
        this.engine?.call("cadSelectionModeChanged", this, this.cadSelectionMode);
        this.engine?.call("cadSelectionShapeChanged", this, this.cadSelectionShape);
        this.engine?.call("cadAxisConstraintChanged", this, this.cadAxisConstraint);
        this.engine?.call("cadToolChanged", this, this.cadTool);

        return true;
    }

    exitCADMode(options: {notifySelection?: boolean} = {}) {
        if (!this.cadMode && !this.cadEditedObjectUuid) {
            return;
        }

        resetCADModeState(this);
        this.cadController.deactivate();
        restoreCADTransformControls(this.engine);
        // Leaving CAD mode cancels any in-progress annotation pick session
        // so the tool's event listeners don't outlive the mode.
        this._annotationTool?.cancel();
        window.removeEventListener("keydown", this.handleCADKeyboardEvent);

        this.engine?.call("cadModeChanged", this, {
            enabled: false,
            object: null,
        });
        this.engine?.call("cadSelectionModeChanged", this, this.cadSelectionMode);
        this.engine?.call("cadSelectionShapeChanged", this, this.cadSelectionShape);
        this.engine?.call("cadAxisConstraintChanged", this, this.cadAxisConstraint);
        this.engine?.call("cadToolChanged", this, this.cadTool);

        if (options.notifySelection !== false && this.selected && !Array.isArray(this.selected)) {
            this.engine?.call("objectSelected", this, this.selected);
        }
    }

    toggleCADMode(target?: THREE.Object3D | null) {
        if (this.cadMode) {
            this.exitCADMode();
            return false;
        }

        return this.enterCADMode(target);
    }

    isCADToolCompatibleWithSelectionMode(tool: CADTool, mode: CADSelectionMode) {
        if (tool === "extrude" || tool === "inset" || tool === "bevel") {
            return mode === "face";
        }

        return mode === "vertex" || mode === "edge" || mode === "face";
    }

    setCADSelectionMode(mode: CADSelectionMode) {
        if (mode === "object") {
            this.exitCADMode();
            return;
        }

        if (!this.cadMode && !this.enterCADMode()) {
            return;
        }

        this.cadSelectionMode = mode;
        this.cadController.setSelectionMode(mode);
        this.engine?.call("cadSelectionModeChanged", this, this.cadSelectionMode);

        if (!this.isCADToolCompatibleWithSelectionMode(this.cadTool, mode)) {
            this.cadTool = "move";
            this.cadController.setTool(this.cadTool);
            this.engine?.call("cadToolChanged", this, this.cadTool);
        }
    }

    setCADSelectionShape(shape: CADSelectionShape) {
        this.cadSelectionShape = shape;
        this.engine?.call("cadSelectionShapeChanged", this, this.cadSelectionShape);
    }

    setCADAxisConstraint(constraint: CADAxisConstraint[]) {
        this.cadAxisConstraint = constraint.length > 0 ? [...constraint] : ["x", "y", "z"];
        this.cadController.updateTransformControls();
        this.engine?.call("cadAxisConstraintChanged", this, this.cadAxisConstraint);
    }

    setCADTool(tool: CADTool) {
        if (!this.cadMode && ["move", "rotate", "scale", "extrude", "inset", "bevel"].includes(tool)) {
            if (!this.enterCADMode()) {
                return;
            }
        }

        if (["extrude", "inset", "bevel"].includes(tool) && this.cadSelectionMode !== "face") {
            this.cadSelectionMode = "face";
            this.cadController.setSelectionMode(this.cadSelectionMode);
            this.engine?.call("cadSelectionModeChanged", this, this.cadSelectionMode);
        }

        this.cadTool = tool;
        this.cadController.setTool(tool);
        this.engine?.call("cadToolChanged", this, this.cadTool);
    }

    applyCADExtrude(distance: number) {
        if (this.cadController.extrudeSelection(distance)) {
            this.cadTool = "move";
            this.cadController.setTool(this.cadTool);
            this.engine?.call("cadToolChanged", this, this.cadTool);
            return true;
        }

        return false;
    }

    applyCADInset(amount: number) {
        if (this.cadController.insetSelection(amount)) {
            this.cadTool = "select";
            this.cadController.setTool(this.cadTool);
            this.engine?.call("cadToolChanged", this, this.cadTool);
            return true;
        }

        return false;
    }

    applyCADBevel(width: number) {
        if (this.cadController.bevelSelection(width, Math.max(width * 0.35, 0.01))) {
            this.cadTool = "move";
            this.cadController.setTool(this.cadTool);
            this.engine?.call("cadToolChanged", this, this.cadTool);
            return true;
        }

        return false;
    }

    applyCADEdgeLength(length: number) {
        return this.cadController.setSelectedEdgeLength(length);
    }

    applyCADEdgeBevel(width: number, steps = 1, profile: "flat" | "round" = "flat") {
        if (this.cadController.bevelSelection(width, Math.max(width * 0.35, 0.01), steps, profile)) {
            this.cadTool = "move";
            this.cadController.setTool(this.cadTool);
            this.engine?.call("cadToolChanged", this, this.cadTool);
            return true;
        }

        return false;
    }

    applyCADDelete() {
        return this.cadController.deleteSelection();
    }

    applyCADDissolve() {
        return this.cadController.dissolveSelection();
    }

    applyCADMerge() {
        return this.cadController.mergeSelection();
    }

    applyCADSelectLinked() {
        return this.cadController.selectLinked();
    }

    applyCADSelectLoop() {
        return this.cadController.selectLoop();
    }

    applyCADSelectRing() {
        return this.cadController.selectRing();
    }

    applyCADLoopCut() {
        return this.cadController.loopCutSelection();
    }

    applyCADBridge() {
        return this.cadController.bridgeSelection();
    }

    applyCADFill() {
        return this.cadController.fillSelection();
    }

    applyCADKnife() {
        return this.cadController.knifeSelection();
    }

    applyCADInvertNormals() {
        return this.cadController.invertNormals();
    }

    applyCADSubdivide(cuts: number) {
        return this.cadController.subdivideSelection(cuts);
    }

    applyCADExtrudeEdge(amount: number) {
        return this.cadController.extrudeEdgeSelection(amount);
    }

    applyCADMergeCoplanar() {
        return this.cadController.mergeCoplanarFaces();
    }

    applyCADOffsetTop(amount: number) {
        return this.cadController.offsetTop(amount);
    }

    applyCADEdgeToEdgeCut() {
        return this.cadController.edgeToEdgeCut();
    }

    applyCADArcEdge(offset: number, segments: number) {
        return this.cadController.arcEdge(offset, segments);
    }

    applyCADMirror(axis: "x" | "y" | "z") {
        return this.cadController.mirrorMesh(axis);
    }

    applyCADArrayLinear(count: number, offset: THREE.Vector3) {
        return this.cadController.arrayMeshLinear(count, offset);
    }

    applyCADArrayRadial(count: number, axis: "x" | "y" | "z", totalAngleRad = Math.PI * 2) {
        return this.cadController.arrayMeshRadial(count, axis, totalAngleRad);
    }

    /**
     * Annotation authoring. CAD-mode-only: startAnnotating refuses to begin
     * a session if cadMode is false. Creation flows through AddAnnotationCommand
     * so undo/redo + collaboration sync work via the standard scene-serializer
     * path.
     */
    private _annotationTool: import("./cad/annotationTool").AnnotationTool | null = null;

    private async getAnnotationTool() {
        if (!this._annotationTool) {
            const {AnnotationTool} = await import("./cad/annotationTool");
            this._annotationTool = new AnnotationTool(this);
        }
        return this._annotationTool;
    }

    async startAnnotating(type: import("../object/annotation").AnnotationType, options: {text?: string} = {}): Promise<boolean> {
        if (!this.cadMode) {
            console.warn("[Editor] startAnnotating ignored: annotations are CAD-mode only");
            return false;
        }
        const tool = await this.getAnnotationTool();
        return tool.start(type, options);
    }

    cancelAnnotating(): void {
        this._annotationTool?.cancel();
    }

    isAnnotating(): boolean {
        return !!this._annotationTool?.isActive();
    }

    /**
     * Scatter `count` instances of `source` across the surface of `target`,
     * producing a single InstancedMesh that lands in the scene via the
     * standard Command pipeline (undoable + collab-synced through the
     * scene serializer).
     *
     * CAD-mode-gated like other authoring tools added in this wave.
     * @param source
     * @param target
     * @param options
     */
    async applyCADSurfaceScatter(
        source: THREE.Mesh,
        target: THREE.Mesh,
        options: import("@stem/editor-oss/utils/SurfaceScatter").ScatterOptions,
    ) {
        if (!this.cadMode) {
            console.warn("[Editor] applyCADSurfaceScatter ignored: scatter is CAD-mode only");
            return null;
        }
        const {ScatterCommand} = await import("@stem/editor-oss/command/Commands");
        const command = new ScatterCommand(source, target, options);
        const result = await this.execute(command);
        return result;
    }

    /**
     * Directly create + add a distance annotation between two world-space
     * points. Used by programmatic callers and tests. CAD-mode-only to
     * match the modal tool's gating rule.
     * @param p1
     * @param p2
     */
    async createDistanceAnnotation(p1: THREE.Vector3, p2: THREE.Vector3) {
        if (!this.cadMode) {
            console.warn("[Editor] createDistanceAnnotation ignored: annotations are CAD-mode only");
            return null;
        }
        const {DistanceAnnotation} = await import("../object/annotation/DistanceAnnotation");
        const {AddAnnotationCommand} = await import("@stem/editor-oss/command/Commands");
        const annotation = new DistanceAnnotation(p1, p2);
        const command = new AddAnnotationCommand(annotation);
        await this.execute(command);
        return annotation;
    }

    applyCADInflateDeflate(factor: number) {
        return this.cadController.inflateDeflate(factor);
    }

    applyCADMergeEdges() {
        return this.cadController.mergeEdges();
    }

    applyCADFillFromVertices() {
        return this.cadController.fillFromVertices();
    }

    private handleCADKeyboardEvent = (event: KeyboardEvent) => {
        if (!this.cadMode) {
            return;
        }

        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
            return;
        }

        const key = event.key.toUpperCase();

        if (key === "N" && this.cadSelectionMode === "face") {
            event.preventDefault();
            this.applyCADInvertNormals();
        } else if (key === "D" && this.cadSelectionMode === "face") {
            event.preventDefault();
            this.applyCADSubdivide(2);
        } else if (key === "O") {
            event.preventDefault();
            this.applyCADOffsetTop(0.25);
        } else if (key === "M") {
            if (this.cadSelectionMode === "face") {
                event.preventDefault();
                this.applyCADMergeCoplanar();
            } else if (this.cadSelectionMode === "vertex") {
                event.preventDefault();
                this.applyCADMerge();
            }
        } else if (key === "K" && this.cadSelectionMode === "edge") {
            event.preventDefault();
            this.applyCADEdgeToEdgeCut();
        } else if (key === "A" && this.cadSelectionMode === "edge") {
            event.preventDefault();
            this.applyCADArcEdge(0.2, 8);
        }
    };

    private syncCADStateWithSelection() {
        if (!this.cadMode) {
            return;
        }

        const editedObject = this.cadEditedObject;
        if (!editedObject) {
            this.exitCADMode();
            return;
        }

        if (Array.isArray(this.selected) || !this.selected || this.selected.uuid !== editedObject.uuid) {
            this.selected = editedObject;
        }
    }

    modelByID(id: string): Object3D | null {
        this.scene.traverse(object => {
            if (object.userData && object.userData.ID === id) {
                return object;
            }
        });

        return null;
    }

    addSelectionHelper(object: THREE.Object3D) {
        this.selectionHelpers.push(object);
        this.sceneHelpers.add(object);
    }

    removeSelectionHelper(object: THREE.Object3D) {
        const index = this.selectionHelpers.indexOf(object);
        if (index !== -1) {
            this.selectionHelpers.splice(index, 1);
        }
        this.sceneHelpers.remove(object);
    }

    clearSelectionHelpers() {
        this.selectionHelpers.forEach(helper => {
            this.sceneHelpers.remove(helper);
        });
        this.selectionHelpers.length = 0;
    }

    getExistingNames = (): Set<string> => {
        return new Set(this.scene.children.map(obj => obj.name));
    };
    /**
     * Run `fn` with the editor flagged as "inside a script import." Every
     * `addObject` call made during `fn` (directly, or via commands the script
     * dispatches) tags its object with `userData.isImported = true`. Pairs
     * with `clearImportedContent()` to make `exec` idempotent against repeat
     * runs.
     *
     * Re-entrant: the depth counter handles the case where a future composite
     * import dispatches another scripted import inside its own callback.
     */
    async runInScriptImportContext<T>(fn: () => Promise<T>): Promise<T> {
        // Suspend the editor render loop for the duration of a bulk script
        // import. Otherwise the loop re-renders the whole scene after every
        // command; as a heavy game adds hundreds of meshes + unique TSL
        // materials, each interleaved frame gets slower (and TSL reshades
        // churn), degrading the import to ~O(n^2) — a multi-minute hang that
        // can OOM the renderer. The loop keeps ticking but `animate()`
        // early-returns while paused, so per-command cost stays flat. We
        // resume (one render of the final scene) on the outermost exit.
        // Uses the existing `pauseRender`/`resumeRender` events (RenderEvent).
        const outermost = this._scriptImportDepth === 0;
        this._scriptImportDepth += 1;
        if (outermost) {
            try {
                global.app?.call("pauseRender");
            } catch {
                /* render pause is best-effort */
            }
        }
        try {
            return await fn();
        } finally {
            this._scriptImportDepth -= 1;
            if (this._scriptImportDepth === 0) {
                try {
                    global.app?.call("resumeRender");
                } catch {
                    /* render resume is best-effort */
                }
            }
        }
    }

    // TODO: wwe need to prevent adding objects directly to the scene without this method
    // to be sure that all objects have default user data, this will also help us optimize traversing objects in the scene
    async addObject(object: THREE.Object3D, parent?: THREE.Object3D, customName?: string) {
        object.name = customName || generateUniqueNameWithCounter(object.name, this.scene, this.getExistingNames());
        this.objectsNames.add(object.name);

        this.processParticleSystems(object);
        this.setObjectDefaultUserData(object);
        this.setObjectDefaultShadowSettings(object);

        if (this._scriptImportDepth > 0 && object.userData.isImported !== true) {
            object.userData.isImported = true;
        }

        if (!parent) {
            parent = this.scene;

            // In stem editor mode, default to the stem instance so new
            // objects become part of the stem payload instead of siblings
            // at scene root (where they would be invisible in the tree and
            // dropped on save).
            if (isStemEditor(this.scene)) {
                const stemMeta = this.scene.userData.stemEditor as StemEditorMetadata | undefined;
                const stemInstance = stemMeta
                    ? this.scene.children.find(child => getPrefabId(child) === stemMeta.assetId)
                    : undefined;
                if (stemInstance) {
                    parent = stemInstance;
                }
            }
        }

        this.objectsNames.add(object.name);

        try {
            if (parent.uuid === object.uuid) {
                this.scene.add(object);
            } else {
                parent.add(object);
            }
        } catch (e) {
            console.error(e);
        }

        // FIXME: object must be configured with physics before calling this method
        if (!object.userData.physics) {
            const isLight = object instanceof THREE.Light;
            // Skip physics auto-enable for empty Groups — they have no geometry
            // so bounding box is infinite. Children get physics when added later.
            const isEmptyGroup = object.type === "Group" && object.children.length === 0;
            if (!isLight && !isEmptyGroup) {
                object.userData.physics = getPhysics(null, object);
                object.userData.physics.enabled = true;
            }
        }

        object.updateMatrixWorld();
        if (PhysicsUtil.isPhysicsEnabled(object)) {
            PhysicsUtil.updateShapeOffsetAndScale(object);
        }

        await this.engine?.game?.initializeObject(object);

        this.engine?.call("objectAdded", this, object);
        this.engine?.call("sceneGraphChanged", this);

        if (this.scene) {
            ShadowUtils.checkShadowCastingLights(this.scene);
        }
    }

    removeObject(object: THREE.Object3D) {
        if (object.parent === null) {
            return;
        }

        // The stem instance must remain a direct child of the scene so
        // saveStemEditor can locate it. clear() drops the stemEditor flag
        // before its teardown loop so this guard does not block it.
        if (isStemEditor(this.scene)) {
            const stemMeta = this.scene.userData.stemEditor as StemEditorMetadata | undefined;
            const stemInstance = stemMeta
                ? this.scene.children.find(child => getPrefabId(child) === stemMeta.assetId)
                : undefined;
            if (stemInstance && object === stemInstance) {
                showToast({type: "info", title: "The stem cannot be deleted"});
                return;
            }
        }

        const removedCadEditedObject = removedObjectContainsCADEditedObject(object, this.cadEditedObjectUuid);
        if (removedCadEditedObject) {
            this.exitCADMode({notifySelection: false});
        }
        const selectedObject = this.selected instanceof THREE.Object3D ? this.selected : null;
        const removedSelectedObject =
            !!selectedObject &&
            (object === selectedObject ||
                Boolean(object.getObjectByProperty("uuid", selectedObject.uuid)));

        // Clean up behavior plugins first (Editor responsibility)
        this.cleanupBehaviorPluginsForObjectAndChildren(object);

        if (this.engine?.batchedRenderer) {
            QuarksUtil.runOnAllParticleEmitters(object, (emitter: ParticleEmitter) => {
                this.engine!.batchedRenderer.deleteSystem(emitter.system);
            });
        }

        object.parent.remove(object);
        if (removedSelectedObject) {
            this.deselect();
        }

        this.engine?.game?.disposeObject(object);

        // FIXME: Disposing geometries and materials can lead to issues if those resources are shared
        // and we try to use them again later. We need a more robust resource management system.
        // object.traverse(child => {
        //     MeshUtils.dispose(child);
        // });

        this.engine?.call("objectRemoved", this, object);
        this.engine?.call("sceneGraphChanged", this);
    }

    /**
     * Wipe everything previously brought in by `exec` so a re-run starts from
     * the same base state as the very first run:
     *
     * - Every object whose `userData.isImported === true` is removed (deepest
     *   first so we never dereference a stale parent handle).
     * - Every behavior and lambda attached to the four default scene objects
     *   is detached. The runtime *registry* of behavior scripts/configs and
     *   lambda configs is untouched — revision history depends on those.
     *
     * User-authored objects (anything without the marker) and their
     * attachments are preserved.
     */
    clearImportedContent() {
        const depth = (obj: THREE.Object3D): number => {
            let d = 0;
            for (let p = obj.parent; p; p = p.parent) d++;
            return d;
        };

        const importedObjects: THREE.Object3D[] = [];
        this.scene.traverse(obj => {
            if (obj === this.scene) return;
            if (obj.userData?.isImported === true) {
                importedObjects.push(obj);
            }
        });

        // Deepest first: removing a parent first would orphan our handle to
        // the child and the second removeObject call would see `parent === null`.
        importedObjects.sort((a, b) => depth(b) - depth(a));

        for (const obj of importedObjects) {
            // A descendant may already have been pulled out of the tree when
            // its (also-imported) parent was removed. removeObject() already
            // guards on `parent === null`, so this is safe but we skip the
            // wasted work.
            if (!obj.parent) continue;
            this.removeObject(obj);
        }

        // Detach behaviors + lambdas from the four default objects. Snapshot
        // the arrays before iterating because both detach paths mutate them.
        for (const child of this.scene.children) {
            if (!isDefaultSceneObject(child)) continue;

            const behaviors = (child.userData?.behaviors as BehaviorData[] | undefined) ?? [];
            for (const behavior of [...behaviors]) {
                this.removeBehaviorFromObject(child, behavior.uuid);
            }

            const lambdaManager = this.engine?.game?.lambdaManager;
            if (lambdaManager) {
                lambdaManager.deregisterObjectFromAll(child);
            }
            if (Array.isArray(child.userData?.lambdaComponents)) {
                child.userData.lambdaComponents = [];
            }
        }

        this.engine?.call("sceneGraphChanged", this);
    }

    pauseObject(object: THREE.Object3D) {
        this.engine?.game?.pauseObject(object);
    }

    resumeObject(object: THREE.Object3D) {
        this.engine?.game?.resumeObject(object);
    }

    handleCreateParticleFromScratch = (
        objectToAddTo?: THREE.Object3D,
        callback?: (particleSystem: ParticleSystem) => void,
        userData?: any,
    ) => {
        const particleSystem = new ParticleSystem(createFreshParticleConfig());
        const emitter = particleSystem.emitter;
        emitter.name = "Emitter";

        // parent object wrapper
        const particleParent = new THREE.Group();
        particleParent.name = DEFAULT_VFX_NAME;
        particleParent.userData.isTemplateVariant = true;
        particleParent.add(emitter);

        if (userData) {
            particleParent.userData = structuredClone(userData);
        } else {
            this.setObjectDefaultUserData?.(particleParent);
        }

        particleParent.userData.physics = getPhysics(particleParent.userData.physics || null, particleParent);
        particleParent.userData.physics.enabled = false;

        if (objectToAddTo) {
            objectToAddTo.add(particleParent);
        } else {
            this.addObject(particleParent);
            this.select(particleParent);
        }

        if (!emitter.userData.physics) {
            emitter.userData.physics = getPhysics(null, emitter);
            emitter.userData.physics.enabled = false;
        }

        if (this.engine?.batchedRenderer) {
            QuarksUtil.addToBatchRenderer(emitter, this.engine.batchedRenderer);
            if (isVFXAutoStartEnabled(particleParent)) {
                QuarksUtil.restart(emitter);
            } else {
                QuarksUtil.stop(emitter);
            }
        }

        callback?.(particleSystem);
    };

    processParticleSystems = (object3d: Object3D) => {
        object3d.traverse(obj => {
            if (obj instanceof ParticleEmitter || obj.getObjectByProperty("type", "ParticleEmitter")) {
                this.setObjectDefaultUserData(obj);
            }
            if (obj instanceof ParticleEmitter) {
                if (!obj.userData.physics) {
                    obj.userData.physics = getPhysics(null, obj);
                    obj.userData.physics.enabled = false;
                }
                const particleSystem = obj.system;
                if (this.engine?.batchedRenderer) {
                    QuarksUtil.addToBatchRenderer(obj, this.engine.batchedRenderer);
                    const autoStart = isVFXAutoStartEnabled(obj);
                    if (autoStart) {
                        QuarksUtil.restart(obj);
                    } else {
                        QuarksUtil.stop(obj);
                    }
                }
                const mesh = new ParticleSystemPreviewObject(particleSystem as ParticleSystem);

                object3d.castShadow = false;
                object3d.receiveShadow = false;
                object3d.userData.shadow = {
                    castShadow: false,
                    receiveShadow: false,
                };
                obj.add(mesh);
            }
        });
    };

    moveObjectToPoint(object: THREE.Object3D, point: THREE.Vector3Like) {
        if (object) {
            const originalMatrixAutoUpdate = object.matrixAutoUpdate;
            object.updateMatrixWorld(true);

            const boundingBox = new THREE.Box3().setFromObject(object);
            const objBottom = boundingBox.min.y;

            if (!isFinite(objBottom)) {
                console.warn("Object has no geometry to compute bounding box. Placing at point.y");
                object.position.set(point.x, point.y, point.z);
            } else {
                const deltaY = point.y - objBottom;
                object.position.set(point.x, object.position.y + deltaY, point.z);
            }

            object.matrixAutoUpdate = originalMatrixAutoUpdate;
            object.updateMatrixWorld();
            this.engine?.call("objectChanged", this, object);
        }
    }

    getSelectedObject() {
        try {
            const selectedObj = this.selected instanceof THREE.Object3D ? this.selected : null;

            // Legacy plane primitives are actually a Group or Object3D with a Mesh
            // child object. These legacy planes are identified by userData.isPlane.
            // In these cases, get the Mesh child object.
            const plane = selectedObj?.userData?.isPlane
                ? (selectedObj.children.find(obj => obj instanceof THREE.Mesh) as THREE.Mesh)
                : undefined;
            const selectedObject = plane || selectedObj;

            // Validate the selected object
            if (selectedObject && !selectedObject.uuid) {
                console.warn("[Editor] getSelectedObject: Selected object missing uuid, returning null");
                return null;
            }

            return selectedObject;
        } catch (error) {
            console.error("[Editor] getSelectedObject error:", error);
            return null;
        }
    }

    addPendingBehavior(target: Object3D, behaviorData: BehaviorData) {
        const targetUUID = target.uuid;
        const behaviorUUID = behaviorData.uuid;
        console.info(`[Editor] Adding pending behavior ${behaviorUUID} to target ${targetUUID}`);
        let behaviorUUIDs = this.pendingBehaviorsToAdd.get(targetUUID);
        if (!behaviorUUIDs) {
            behaviorUUIDs = [];
            this.pendingBehaviorsToAdd.set(targetUUID, behaviorUUIDs);
        }
        if (!behaviorUUIDs.includes(behaviorUUID)) {
            behaviorUUIDs.push(behaviorUUID);
        }
    }

    removePendingBehavior(target: Object3D, behaviorData: BehaviorData) {
        const targetUUID = target.uuid;
        const behaviorUUID = behaviorData.uuid;
        console.info(`[Editor] Removing pending behavior ${behaviorUUID} from target ${targetUUID}`);
        const behaviorUUIDs = this.pendingBehaviorsToAdd.get(targetUUID);
        if (!behaviorUUIDs) {
            return;
        }

        const index = behaviorUUIDs.indexOf(behaviorUUID);
        if (index !== -1) {
            behaviorUUIDs.splice(index, 1);
        }

        if (behaviorUUIDs.length === 0) {
            this.pendingBehaviorsToAdd.delete(targetUUID);
        }
    }

    addAllPendingBehaviors(): void {
        if (!this.isSandbox) {
            return;
        }

        this.pendingBehaviorsToAdd.forEach((behaviorUUIDs, targetUUID) => {
            const targetObject = this.objectByUuid(targetUUID);
            if (!targetObject) {
                console.warn(`[Editor] Target object with UUID ${targetUUID} not found for pending behaviors`);
                return;
            }
            const behaviors = targetObject.userData?.behaviors as BehaviorData[] | undefined;
            if (!behaviors) {
                console.warn(`[Editor] No behaviors found on target object with UUID ${targetUUID}`);
                return;
            }

            behaviorUUIDs.forEach(behaviorUUID => {
                const behaviorData = behaviors.find((b: BehaviorData) => b.uuid === behaviorUUID);
                if (behaviorData) {
                    const behaviorOptions: CreateBehaviorOptions = {
                        uuid: behaviorData.uuid,
                        attributes: behaviorData.attributesData,
                    };
                    this.engine?.game?.addBehaviorToObject(targetObject, behaviorData.id, behaviorOptions);
                    console.info(
                        `[Editor] Added pending behavior "${behaviorData.id}" (${behaviorData.uuid}) to object "${targetObject.name}"`,
                    );
                } else {
                    console.warn(
                        `[Editor] Behavior with UUID ${behaviorUUID} not found on target object with UUID ${targetUUID}`,
                    );
                }
            });
        });
        this.pendingBehaviorsToAdd.clear();
    }

    clearPendingBehaviors(): void {
        this.pendingBehaviorsToAdd.clear();
    }

    async addBehaviorToObject(
        object: THREE.Object3D | null,
        behaviorId: string,
        options?: BehaviorEditorOptions,
    ): Promise<BehaviorData | null> {
        if (!object) {
            console.error("[Editor] Cannot add behavior to null object");
            return null;
        }

        if (!this.behaviorConfigsLoaded) {
            await new Promise<void>(resolve => {
                const configCheckInterval = setInterval(() => {
                    if (this.behaviorConfigsLoaded) {
                        clearInterval(configCheckInterval);
                        resolve();
                    }
                }, 100);
            });
        }

        const customUUID = options?.uuid;
        const customAttributesData = options?.attributesData;
        const throttleConfig = options?.throttleConfig;
        const index = options?.index ?? -1;
        const enabled = options?.enabled ?? true;
        const priority = options?.priority;

        if (!this.behaviorDataManager.canAddBehaviorsToObject(object)) {
            console.error(`[Editor] Cannot add behavior to object ${object.uuid}- not allowed`);
            return null;
        }

        const behaviorContext = await this.behaviorContextProvider.getBehaviorContext(
            object,
            this.scene,
            this.sceneID,
            this.assetSource ?? null,
        );
        const behaviorData = this.behaviorDataManager.createBehaviorData(behaviorId, behaviorContext, customUUID);
        if (!behaviorData) {
            console.error(`[Editor] Failed to create behavior data using "${behaviorId}" name`);
            return null;
        }
        behaviorData.enabled = enabled;

        // Only override priority if explicitly provided
        if (priority !== undefined) {
            behaviorData.priority = priority;
        }

        // Apply throttleConfig if provided
        if (throttleConfig) {
            behaviorData.throttleConfig = throttleConfig;
        }

        const config = this.behaviorConfigRegistry.getConfig(behaviorId);
        if (config) {
            const objectSettings = config.objectSettings;
            if (objectSettings) {
                BehaviorObjectSettingsApplier.applyObjectSettings(object, objectSettings);
            }
        } else {
            console.error(`[Editor] No behavior config found for type: ${behaviorId}`);
            return null;
        }

        let shouldSkip = false;
        if (config.isSingleton) {
            // check if there is already a behavior of this type in the scene
            this.scene.traverse((child: THREE.Object3D) => {
                const behaviors: BehaviorData[] = child.userData.behaviors;
                if (!behaviors) {
                    return;
                }

                for (const behavior of behaviors) {
                    if (behavior.id === behaviorId) {
                        console.warn(`[Editor] Behavior "${behaviorId}" is already added to the scene, skipping...`);
                        shouldSkip = true;
                        return;
                    }
                }
            });
        }

        if (shouldSkip) {
            showToast({
                type: "warning",
                body: `Cannot add multiple instances of behavior "${behaviorId}"`,
            });
            return null;
        }

        if (customAttributesData) {
            const configAttributes = config.attributes;
            for (const [key, value] of Object.entries(customAttributesData)) {
                if (configAttributes[key]) {
                    behaviorData.attributesData![key] = value;
                } else {
                    console.warn(
                        `[Editor] Missing attribute "${key}" in behavior "${behaviorId}", skipping custom attribute`,
                    );
                }
            }
        }

        if (!this.behaviorDataManager.addBehaviorDataToObject(object, behaviorData, index)) {
            console.error(`[Editor] Failed to add behavior data using "${index}" name`);
            return null;
        }

        // Handle exclusive boolean attributes - disable them in other behaviors if needed
        this.behaviorDataManager.handleExclusiveAttributesOnAdd(object, behaviorData, this.scene);

        // In sandbox mode, we don't add behavior plugins
        if (!this.isSandbox && enabled) {
            this.addBehaviorPlugin(object, behaviorData);
        }

        this.addBehaviorIdReference(behaviorData.id);

        if (object === this.selected) {
            this.engine?.call(`objectChanged`, this, object);
        }

        return behaviorData;
    }

    addBehaviorPlugin(object: THREE.Object3D, behaviorData: BehaviorData): void {
        if (!behaviorData.enabled) {
            return;
        }

        if (!this.engine) {
            console.error(`[Editor] Cannot add behavior plugin ${behaviorData.id} - app is null`);
            return;
        }

        let behaviorType = this.behaviorTypeRegistry.getType(behaviorData.id);

        // Fallback: if type not in registry, try parsing the script on-the-fly
        if (!behaviorType) {
            const script = this.behaviorScriptRegistry.getScript(behaviorData.id);

            if (script) {
                if (script.includes("@import")) {
                    void this.parseAndRegisterScriptBehavior(behaviorData.id, script);
                } else {
                    try {
                        const parsed = this.behaviorScriptInjector.parse(behaviorData.id, script);
                        if (this.behaviorTypeRegistry.getType(behaviorData.id)) {
                            this.behaviorTypeRegistry.unregisterType(behaviorData.id);
                        }
                        this.behaviorTypeRegistry.registerType(behaviorData.id, parsed);
                    } catch (error) {
                        console.error(`[Editor] Failed to parse script behavior "${behaviorData.id}":`, error);
                    }
                }
                behaviorType = this.behaviorTypeRegistry.getType(behaviorData.id);
            }

            if (!behaviorType) {
                return;
            }
        }

        if (!this.editorErth) {
            this.editorErth = createEditorErthInterface(this.engine);
        }

        const game = this.engine?.game || undefined;

        // Create behavior options - gameObject is optional for editor-only behaviors
        // Provide editor erth when no game is running so asset methods work in edit mode
        const behaviorOptions = {
            gameObject: createGameObject(object, game),
            erth: this.editorErth,
            uuid: behaviorData.uuid,
            attributes: behaviorData.attributesData,
        };

        const behaviorPlugin = new behaviorType(object, behaviorData.id, behaviorOptions);

        // Check if this is an editor plugin before requiring game
        const isEditorPlugin = this.behaviorPluginManager.isPlugin(behaviorPlugin);

        // Editor plugins can work without game, runtime-only behaviors need game
        if (!isEditorPlugin && !game) {
            return;
        }

        if (behaviorPlugin && isEditorPlugin) {
            this.behaviorPluginManager.addPlugin(object, behaviorPlugin);
        }
    }

    removeAllBehaviorsFromObjectByType(object: THREE.Object3D, behaviorTypeName: string) {
        if (!object) {
            console.error("[Editor] Cannot remove behavior from null object");
            return false;
        }

        const behaviors = object.userData.behaviors;
        if (!behaviors) {
            return false;
        }

        const behaviorsUUIDsToRemove = [];
        for (const behavior of behaviors) {
            if (behavior.id === behaviorTypeName) {
                behaviorsUUIDsToRemove.push(behavior.uuid);
            }
        }

        behaviorsUUIDsToRemove.forEach(behaviorUUID => {
            this.removeBehaviorFromObject(object, behaviorUUID);
        });

        if (object === this.selected) {
            this.engine?.call(`objectChanged`, this, object);
        }

        return;
    }

    removeBehaviorFromObject(object: THREE.Object3D, uuid: string) {
        const behaviorData = this.behaviorDataManager.getBehaviorDataByUUID(object, uuid);
        if (!behaviorData) {
            console.error(`[Editor] No behavior found with uuid: ${uuid}`);
            return;
        }

        if (!this.behaviorDataManager.removeBehaviorDataFromObjectByUUID(object, uuid)) {
            console.error(`[Editor] Failed to remove behavior with uuid: ${uuid}`);
            return;
        }

        this.removeBehaviorPlugin(uuid);

        this.removeBehaviorIdReference(behaviorData.id);

        if (object === this.selected) {
            this.engine?.call(`objectChanged`, this, object);
        }

        return behaviorData;
    }

    private addBehaviorIdReference(behaviorId: string) {
        let existingCount = this.usedBehaviorIds.get(behaviorId) || 0;
        this.usedBehaviorIds.set(behaviorId, existingCount + 1);
    }

    private removeBehaviorIdReference(behaviorId: string) {
        const existingCount = this.usedBehaviorIds.get(behaviorId);
        if (existingCount && existingCount > 1) {
            this.usedBehaviorIds.set(behaviorId, existingCount - 1);
        } else {
            this.usedBehaviorIds.delete(behaviorId);
        }
    }

    removeBehaviorPlugin(uuid: string) {
        const behaviorPlugin = this.behaviorPluginManager.getPlugin(uuid);
        if (behaviorPlugin) {
            this.behaviorPluginManager.removePlugin(behaviorPlugin);
        }
    }

    resumeObjectBehaviors(object: THREE.Object3D | THREE.Object3D[] | string | null) {
        if (typeof object === "string") {
            object = this.objectByUuid(object);
        }

        if (!object) {
            return;
        }

        if (Array.isArray(object)) {
            object.forEach(obj => {
                this.engine?.game?.behaviorManager?.resumeObjectBehaviors(obj);
            });
        } else {
            this.engine?.game?.behaviorManager?.resumeObjectBehaviors(object);
        }
    }

    pauseObjectBehaviors(object: THREE.Object3D | THREE.Object3D[] | null) {
        if (!object) {
            return;
        }

        if (Array.isArray(object)) {
            object.forEach(obj => {
                this.engine?.game?.behaviorManager?.pauseObjectBehaviors(obj);
            });
        } else {
            this.engine?.game?.behaviorManager?.pauseObjectBehaviors(object);
        }
    }

    retargetObjectBehaviors(objectUUID: string, newTarget: THREE.Object3D) {
        this.engine?.game?.behaviorManager?.retargetObjectBehaviors(objectUUID, newTarget);
    }

    moveObjectToCameraClosestPoint(object: THREE.Object3D) {
        let point: THREE.Vector3 | null = null;
        if (this.engine?.isPlaying) {
            point = this.getCameraLookAtPoint();
        } else {
            const intersect = this.getObjectInsertPoint();
            if (intersect) {
                point = intersect.point;
            } else {
                point = this.getCameraLookAtPoint();
            }
        }

        if (point) {
            const boundingBox = new THREE.Box3().setFromObject(object);
            const objBottom = boundingBox.min.y;
            //boundingBox may return Infinity for objects like Light
            const deltaY = boundingBox.min.y !== Infinity ? point.y - objBottom : 0;
            object.position.set(point.x, object.position.y + deltaY, point.z);
        }
        this.engine?.call("objectChanged", this, object);
    }

    // TODO: make someting like behavior manager but for editor to organize it better
    getBehaviorsInSceneById(id: string): BehaviorData[] | null {
        if (!this.scene) {
            return null;
        }

        const behaviors: BehaviorData[] = [];
        this.scene.traverse(object => {
            const objectBehaviors = object.userData.behaviors;
            if (!objectBehaviors) {
                return;
            }
            for (const behavior of objectBehaviors) {
                if (behavior.id === id) {
                    behaviors.push(behavior);
                }
            }
        });

        return behaviors;
    }

    getObjectInsertPoint() {
        this.camera.updateMatrixWorld();

        const origin = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
        const direction = new THREE.Vector3().copy(this.camera.getWorldDirection(new THREE.Vector3()));

        const planeNormal = new THREE.Vector3(0, 1, 0);
        const planePoint = new THREE.Vector3(0, 0, 0);

        const planeD = -planeNormal.dot(planePoint);
        const denominator = planeNormal.dot(direction);

        if (Math.abs(denominator) > 1e-6) {
            const t = -(planeNormal.dot(origin) + planeD) / denominator;

            if (t >= 0) {
                const intersectionPoint = origin.clone().add(direction.clone().multiplyScalar(t));
                return {
                    point: intersectionPoint,
                    distance: origin.distanceTo(intersectionPoint),
                };
            }
        }

        return null;
    }

    getCameraLookAtPoint = (maxDistance?: number, isGroundPoint?: boolean) => {
        const raycaster = new THREE.Raycaster();
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);

        const player = this.engine?.game?.player;

        raycaster.set(this.camera.position, direction);

        let playerChildren: THREE.Object3D[] = [];
        this.engine?.game?.player?.traverse((child: THREE.Object3D) => {
            playerChildren.push(child);
        });

        let objectsToCheck: THREE.Object3D[] = [];
        this.scene.traverse((child: THREE.Object3D) => {
            if (
                !playerChildren.includes(child) &&
                child !== player &&
                child !== this.scene &&
                child.type !== "LineSegments"
            ) {
                objectsToCheck.push(child);
            }
        });

        const refObject = player || this.camera;
        let point: THREE.Vector3 | null = null;

        const intersections = raycaster.intersectObjects(objectsToCheck, true);

        if (intersections.length > 0) {
            if (maxDistance && refObject?.position.distanceTo(intersections[0]!.point) > maxDistance) {
                point = refObject.position.clone().add(direction.multiplyScalar(maxDistance));
            } else {
                point = intersections[0]!.point;
                isGroundPoint = false; // If we hit an object, we don't want to force ground point
            }
        } else {
            point = refObject.position.clone().add(direction.multiplyScalar(maxDistance || 10));
        }

        if (isGroundPoint) {
            const boundingBox = new THREE.Box3().setFromObject(refObject);
            const objBottom = boundingBox.min.y;
            point.setY(objBottom);
        }

        // If no collision, return a far point in the direction the camera is looking
        return point;
    };

    computeIntersectPoint = (position: {x: number; y: number}, sceneHelpers?: THREE.Object3D): THREE.Vector3 => {
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const rect = this.engine!.viewport!.getBoundingClientRect();

        mouse.x = ((position.x - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((position.y - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, this.camera);
        const intersectPoint = new THREE.Vector3();

        const sceneObjects: THREE.Object3D[] = [];
        this.scene.children.forEach(child => {
            if (child !== sceneHelpers && !child.userData?.isRuntimeOnly) {
                sceneObjects.push(child);
            }
        });

        const intersections = raycaster.intersectObjects(sceneObjects, true);

        const placeObjectInDirection = () => {
            const direction = new THREE.Vector3();
            raycaster.ray.direction.normalize();
            direction.copy(raycaster.ray.direction).multiplyScalar(10);
            intersectPoint.copy(raycaster.ray.origin).add(direction);
        };

        if (intersections.length > 0) {
            const intersection = intersections[0];
            intersectPoint.copy(intersection!.point);
        } else if (!this.engine?.isPlaying) {
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const point = raycaster.ray.intersectPlane(groundPlane, intersectPoint);

            if (!point) {
                placeObjectInDirection();
            }
        } else {
            placeObjectInDirection();
        }

        return intersectPoint;
    };

    // TODO: rename
    private convertToNewBehaviors() {
        this.scriptIdCounter = 0;
        // convert old behavior format to new format
        this.scene.traverse(object => {
            this.convertObjectBehaviorToNewFormat(object);
        });
        // remove old scripts
        this.scripts = [];
    }

    // move old camera behavior data from behaviors, this is temporary until we will move to new format
    private convertCameraToNewFormat(camera: THREE.Camera) {
        if (camera.userData.cameraData) {
            return;
        }

        camera.userData.cameraData = this.getDefaultCameraData();

        const cameraData = camera.userData.cameraData;

        let oldCameraBehavior = null;
        const behaviors = camera.userData.behaviors;

        if (behaviors) {
            for (let i = 0; i < behaviors.length; i++) {
                if (behaviors[i].type === "Camera") {
                    oldCameraBehavior = behaviors[i];
                    behaviors.splice(i, 1);
                    break;
                }
            }
        }

        if (oldCameraBehavior) {
            Object.entries(oldCameraBehavior).forEach(([key, value]) => {
                // if this key exists in new cameraData, set it
                if (key in cameraData) {
                    cameraData[key] = value;
                    console.log(
                        `[Editor] Camera behavior field "${key}" with value "${String(value)}" converted to new format`,
                    );
                }
            });
        }

        // usually this field is used for camera type
        if (camera.userData.control) {
            cameraData.cameraType = camera.userData.control;
            delete camera.userData.control;
        }

        // cameraData.cameraType = camera.userData.control || oldCameraBehavior.cameraType || cameraData.cameraType;

        console.log("[Editor] Camera behavior converted to new format", camera.userData);
    }

    getDefaultCameraData() {
        return {
            type: "Camera",
            cameraType: CAMERA_TYPES_NEW.THIRD_PERSON,
            objectInteraction: CAMERA_OBJECT_INTERACTION.ZOOM,
            playerCollisionBox: 2,
            cameraHeadHeight: 2,
            cameraEffect: CAMERA_EFFECTS.NONE,
            cameraDefaultDistance: 3.5,
            cameraMinDistance: 0.5,
            cameraMaxDistance: 8,
            cameraFOV: 60,
            cameraNear: 1,
            cameraFar: 100000,
            cameraAngle: 0,
            cameraAxis: 0,
            usePointerLock: false,
            orbitOptions: {
                enableDamping: true,
                dampingFactor: 0.08,
                panSpeed: 1.6,
            },
        };
    }

    private convertObjectBehaviorToNewFormat(object: THREE.Object3D) {
        const behaviors = object.userData.behaviors;
        if (behaviors) {
            for (let i = 0; i < behaviors.length; i++) {
                const newBehavior = this.convertToNewBehaviorFormat(behaviors[i]);
                if (newBehavior) {
                    behaviors[i] = newBehavior;
                }
            }
        }
    }

    // TODO: move to utils
    private convertToNewBehaviorFormat(behavior: any): BehaviorData | null {
        if (behavior.name) {
            console.log(`[Editor] Converting behavior v2 "${behavior.name}" to new format, `);
            return {
                schemaVersion: BEHAVIOR_DATA_SCHEMA_VERSION,
                id: behavior.name,
                uuid: behavior.id,
                enabled: behavior.enabled,
                attributesData: behavior.attributesData,
                target: behavior.target || null,
                priority: behavior.priority || 1,
            };
        }

        if (!behavior.type) {
            // already in new format
            return behavior;
        }

        if (behavior.type === "Script") {
            const behaviorName = "script" + this.scriptIdCounter;
            this.scriptIdCounter++;

            console.info(`[Editor] Converting script behavior "${behavior?.name}" to behavior "${behaviorName}"`);

            const behaviorConfig: BehaviorConfig = {
                name: behaviorName,
                id: behaviorName,
                attributes: {},
                version: "",
                author: "",
                isScript: true,
                main: "",
            };
            this.behaviorConfigRegistry.registerConfig(behaviorName, behaviorConfig);

            const newScript = LegacyScriptConverter.convert(behavior.source);
            this.behaviorScriptRegistry.registerScript(behaviorName, newScript);
            delete behavior.source;
            delete behavior.name;
            behavior.type = behaviorName;
        }

        const id = behavior.type.toLowerCase().trim();

        const newBehavior = {
            schemaVersion: BEHAVIOR_DATA_SCHEMA_VERSION,
            id: id,
            uuid: behavior.uuid,
            enabled: behavior.enabled,
            attributesData: {} as Record<string, any>,
            target: behavior.target || null,
            priority: behavior.priority || 1,
        };

        const config = this.behaviorConfigRegistry.getConfig(id);
        if (!config) {
            console.error(`[Editor] No behavior config found for old behavior format: "${id}"`);

            // put all attributes in attributesData except id, name, enabled, type
            for (const [key, value] of Object.entries(behavior)) {
                if (["id", "name", "enabled", "type"].includes(key)) {
                    continue;
                }
                newBehavior.attributesData[key] = value;
            }

            return newBehavior;
        }

        console.info(`[Editor] Behavior "${behavior.type}" has old format, converting to new format`);

        /**
         *
         * @param config
         * @param oldBeh
         */
        function convertAttributes(config: BehaviorConfig, oldBeh: any): Record<string, BehaviorData> {
            const attributes = config.attributes;
            const newAttributes: Record<string, BehaviorData> = {};

            Object.entries(attributes).forEach(([fieldName]) => {
                if (oldBeh[fieldName] === undefined) {
                    console.warn(`[Editor] Missing attribute "${fieldName}" in behavior "${config.id}", skipping`);
                    return;
                }
                console.info(`[Editor] Converting attribute "${fieldName}" in behavior "${config.id}"`);
                newAttributes[fieldName] = oldBeh[fieldName];
            });

            return newAttributes;
        }

        if (id === "character") {
            // behavior = behavior.characterOptions; // hack for character behavior
            behavior = {...behavior.characterOptions};
        }

        newBehavior.attributesData = convertAttributes(config, behavior);

        return newBehavior;
    }

    convertConfigToNewFormat(behaviorConfig: any): BehaviorConfig {
        if (!behaviorConfig.displayName) {
            return behaviorConfig;
        }

        const id = behaviorConfig.name;
        const name = behaviorConfig.displayName;

        delete behaviorConfig.displayName;

        behaviorConfig.name = name;
        behaviorConfig.id = id;

        console.info(`[Editor] Converting behavior config "${id}" to new format`);

        return behaviorConfig;
    }

    private loadSceneBehaviors() {
        let configs: BehaviorConfig[] = (this.scene.userData.behaviorConfigs || []).map((config: any) =>
            this.convertConfigToNewFormat(config),
        );
        const scripts: Record<string, string> = this.scene.userData.scripts || {};

        // Skip loading script-based behaviors if scene has been migrated. But
        // continue to load file-based configs.
        const isMigrated = isSceneBehaviorsMigrated(this.scene);
        if (isMigrated) {
            console.debug("[Editor] Skipping legacy behaviors - scene is migrated");
            configs = configs.filter(config => !config.isScript);
        }

        for (const config of configs) {
            if (!this.behaviorConfigRegistry.getConfig(config.id)) {
                this.behaviorConfigRegistry.registerConfig(config.id, config);
                console.info(`[Editor] Registering behavior config "${config.id}" from scene userData`);
            }
        }

        for (const [id, script] of Object.entries(scripts)) {
            if (this.behaviorConfigRegistry.getConfig(id)) {
                this.behaviorScriptRegistry.registerScript(id, script);
                console.info(`[Editor] Registering behavior script "${id}" from scene userData`);

                const scriptConfig = this.behaviorConfigRegistry.getConfig(id);
                if (scriptConfig?.isScript) {
                    void this.parseAndRegisterScriptBehavior(id, script);
                }
            }
        }
    }

    private clearScriptsAndConfigs() {
        this.behaviorConfigRegistry.clearScripts();
        this.behaviorScriptRegistry.clear();
        console.info("[Editor] Cleared behavior configs and scripts");
    }

    // TODO: this is not used for now, until we have versioning for behavior configs
    // private async cleanupSceneUserData() {
    //     const sceneScripts: Record<string, string> = this.scene.userData.scripts || {};
    //     const sceneConfigs: Record<string, any> = this.scene.userData.behaviorConfigs || {};
    //     const promises: Promise<void>[] = [];

    //     Object.entries(sceneScripts).forEach(([key, value]) => {
    //         const config = sceneConfigs.find((c: any) => c.id === key);
    //         if (config) {
    //             promises.push(this.saveBehavior(JSON.stringify(config), value));
    //         }
    //     });

    //     if (promises.length > 0) {
    //         try {
    //             await Promise.all(promises);
    //             console.log("[Editor] Scene user data cleaned up successfully");
    //             delete this.scene.userData.scripts;
    //             await this.app?.saveScene();
    //         } catch (error) {
    //             console.error("[Editor] Error cleaning up scene user data:", error);
    //         }
    //     }
    // }

    private saveLegacySceneBehaviorConfigs() {
        const allConfigs = this.behaviorConfigRegistry.getAllConfigs();

        // Don't store new behaviors saved with the Asset API in the scene.
        const legacyConfigs = allConfigs.filter(config => isLegacyBehaviorId(config.id));

        // Built-in pack behaviors ship with the editor and their static
        // metadata (description, attributes schema, throttleConfig, …) is
        // loaded from `packs/**/behavior.json` at startup. Saving the full
        // config into every scene bloats files by tens of KB and forces a
        // re-export every time a built-in's metadata changes. Write only
        // the `{id}` reference for built-ins; load resolves the full config
        // against the registry. User-authored script behaviors aren't in
        // the built-in set, so they keep their full config in the scene.
        const builtInIds = this.engine?.behaviorLoadingService?.getBuiltInIds() ?? new Set<string>();
        const compact = (config: BehaviorConfig): BehaviorConfig | {id: string} =>
            builtInIds.has(config.id) ? {id: config.id} : config;

        // A behavior can be registered under more than one registry key — its
        // asset id AND an import alias (the YAML config.id) — so getAllConfigs()
        // returns the SAME behavior more than once, every copy carrying the same
        // config.id. Worse, a behavior edit re-registers only the asset-id key
        // (and moves it to the end of the registry Map), leaving the alias-keyed
        // copy stale with the OLD code/config. Writing both a fresh and a stale
        // copy into the scene is what made the FIRST behavior edit revert on
        // reload: the stale duplicate could be hydrated last and win. De-duplicate
        // by config.id, keeping the LAST (newest) entry — re-registration moves
        // the freshly-saved config to the end, so last-wins selects new content.
        const dedupeById = (configs: BehaviorConfig[]): BehaviorConfig[] => {
            const byId = new Map<string, BehaviorConfig>();
            for (const config of configs) byId.set(config.id, config);
            return Array.from(byId.values());
        };

        if (this.isSandbox) {
            this.scene.userData.behaviorConfigs = dedupeById(legacyConfigs).map(compact);
            return;
        }

        this.scene.userData.behaviorConfigs = dedupeById(
            legacyConfigs.filter(config => this.usedBehaviorIds.has(config.id) || config.isScript),
        ).map(compact);

        const configNames = this.scene.userData.behaviorConfigs.map((config: any) => config.id || config.name);
        console.debug("[Editor] Saved scene behavior configs", configNames);
    }

    private saveLegacySceneBehaviorScripts() {
        // We are saving all user scripts in scene userData because some of them
        // could be created in runtime. However, don't save new behaviors saved
        // with the Asset API in the scene.
        const allScripts = this.behaviorScriptRegistry.getScripts();
        const legacyScripts: Record<string, string> = {};
        for (const [id, code] of Object.entries(allScripts)) {
            if (isLegacyBehaviorId(id)) {
                legacyScripts[id] = code;
            }
        }
        this.scene.userData.scripts = legacyScripts;
    }

    private setObjectDefaultUserData(object: THREE.Object3D) {
        // Initialize visibility properties with proper defaults
        object.userData.gameVisibility = object.userData.gameVisibility ?? true;
        object.userData.editorVisibility = object.userData.editorVisibility ?? object.userData.gameVisibility;
        object.userData.isStemObject = true;
        object.userData.isSelectable = this.isSandbox;
        object.userData.visibleByAI = true;
    }

    private cleanupScriptsAndConfigs() {
        const scripts = this.behaviorScriptRegistry.getScripts();
        const configs = this.behaviorConfigRegistry.getAllConfigs();

        Object.keys(scripts).forEach(scriptName => {
            if (!configs.some(config => config.id === scriptName)) {
                this.behaviorScriptRegistry.unregisterScript(scriptName);
                console.warn(`[Editor] Unregistering behavior script "${scriptName}" without corresponding config`);
            }
        });

        configs.forEach(config => {
            if (!config.isScript) {
                return;
            }
            if (!scripts[config.id]) {
                this.behaviorConfigRegistry.unregisterConfig(config.id);
                console.warn(`[Editor] Unregistering behavior config "${config.id}" without corresponding script`);
            }
        });
    }

    private setObjectDefaultShadowSettings(object: THREE.Object3D) {
        if ((object as THREE.Mesh).geometry) return; // skip primitives
        if (!object.userData.shadow) {
            if (object instanceof THREE.Light) {
                object.userData.shadow = {
                    castShadow: false,
                    receiveShadow: false,
                };
            } else {
                object.userData.shadow = {
                    castShadow: true,
                    receiveShadow: true,
                };
            }
        }
        ShadowUtils.applyCastShadow(object, object.userData.shadow.castShadow, false);
        ShadowUtils.applyReceiveShadow(object, object.userData.shadow.receiveShadow, false);
    }

    handleUploadView = (
        state: boolean,
        forScene: boolean,
        fileType?: UPLOAD_FILE_TYPE,
        onUploadComplete?: (assets: {assetId: string}[]) => void,
    ) => {
        if (state) {
            this.component?.openUploadView({
                uploadForScene: forScene,
                fileType: fileType || UPLOAD_FILE_TYPE.MODEL,
                onUploadComplete,
            });
        } else {
            this.component?.closeUploadView();
        }
    };

    isStemLocked(obj: THREE.Object3D) {
        return obj.userData?.prefabId && !obj.userData.prefabEditRevisionId;
    }

    select(object: THREE.Object3D | THREE.Object3D[] | null, noFocus?: boolean) {
        const cadEditedObject = this.cadEditedObject;
        if (this.cadMode && cadEditedObject) {
            if (!object) {
                return;
            }

            const requestedObjects = Array.isArray(object) ? object : [object];
            const targetsEditedObject = requestedObjects.some(candidate => {
                if (!candidate) {
                    return false;
                }
                return this.getSelectionBoundaryObject(candidate)?.uuid === cadEditedObject.uuid;
            });

            if (!targetsEditedObject) {
                return;
            }

            object = cadEditedObject;
        }

        if (!object) {
            this.clearSelection();
            return;
        }

        const isCollaborativeEditing = this.isCollaborative || (this.isSandbox && this.isMultiplayer);

        if (Array.isArray(object)) {
            const filtered = Array.from(
                new Set(
                    object
                        .filter((obj): obj is THREE.Object3D => obj !== null)
                        .map(obj => this.getSelectionBoundaryObject(obj)),
                ),
            );

            if (filtered.some(obj => obj?.userData?.selectedBy && obj?.userData?.selectedBy !== this.engine?.userId)) {
                return;
            }

            this.component?.setState({showRightPanel: false});

            this.selected = filtered;

            global.app?.call("objectArraySelected", this, this.selected);

            if (isCollaborativeEditing) {
                this.selected.forEach(obj => {
                    obj.userData.selectedBy = this.engine?.userId;
                });
            }

            return;
        }

        const clickedObject = this.getSelectionBoundaryObject(object);

        if (clickedObject?.userData?.selectedBy && clickedObject.userData.selectedBy !== this.engine?.userId) {
            return;
        }

        // Root of clicked object
        const clickedRoot = this.getRootObject(clickedObject);

        let target: THREE.Object3D;

        if (
            !this.selected ||
            Array.isArray(this.selected) ||
            this.selected.type === "Scene" ||
            (this.selected as any).isCamera
        ) {
            // Nothing selected, pick root
            target = clickedRoot;
        } else {
            const currentRoot = this.getRootObject(this.selected);

            if (currentRoot !== clickedRoot) {
                // Different root clicked, reset selection to new root
                target = clickedRoot;
            } else {
                // Same root clicked, drill down toward clicked target
                target = this.drillDownSelection(this.selected, clickedObject);
            }
        }

        this.selected = target;

        if (isCollaborativeEditing && !Array.isArray(this.selected)) {
            this.selected.userData.selectedBy = this.engine?.userId;
        }

        this.component?.setState({showRightPanel: true});
        this.engine?.call("objectSelected", this, this.selected, noFocus);

        this.syncCADStateWithSelection();
    }

    // ---------------------- SELECT HELPERS ----------------------

    getSelectionBoundaryObject(obj: THREE.Object3D): THREE.Object3D {
        const billboardRoot = this.getBillboardSelectionRoot(obj);
        if (billboardRoot) {
            return billboardRoot;
        }

        const skinnedMeshRoot = this.getSkinnedMeshSelectionRoot(obj);
        return skinnedMeshRoot || obj;
    }

    getBillboardSelectionRoot(obj: THREE.Object3D): THREE.Object3D | null {
        let current: THREE.Object3D | null = obj;

        while (current) {
            if (current.userData?.isBillboard) {
                return current;
            }
            current = current.parent;
        }

        return null;
    }

    getSkinnedMeshSelectionRoot(obj: THREE.Object3D): THREE.Object3D | null {
        const skinnedMesh = (obj as THREE.SkinnedMesh).isSkinnedMesh ? obj as THREE.SkinnedMesh : null;
        const skeletonRoot = skinnedMesh?.skeleton?.bones[0];

        if (!skinnedMesh || !skeletonRoot) {
            return null;
        }

        const skeletonAncestors = new Set<THREE.Object3D>();
        let current: THREE.Object3D | null = skeletonRoot;

        while (current) {
            skeletonAncestors.add(current);
            current = current.parent;
        }

        current = skinnedMesh.parent;
        while (current && current.type !== "Scene") {
            if (skeletonAncestors.has(current)) {
                return current;
            }
            current = current.parent;
        }

        return skinnedMesh.parent && skinnedMesh.parent.type !== "Scene"
            ? skinnedMesh.parent
            : null;
    }

    // Clear selection helper
    clearSelection() {
        if (Array.isArray(this.selected)) {
            this.selected.forEach(obj => delete obj?.userData?.selectedBy);
        } else if (this.selected) {
            delete this.selected.userData?.selectedBy;
        }
        this.selected = null;
        this.component?.setState({showRightPanel: true});
        this.engine?.call("objectSelected", this, null);
    }

    // Traverse to root (just below scene)
    getRootObject(obj: THREE.Object3D): THREE.Object3D {
        let current = obj;
        while (current.parent && current.parent.type !== "Scene") {
            current = current.parent;
        }
        return current;
    }

    isSceneHierarchyNode(obj: THREE.Object3D): boolean {
        if (obj.type === "Scene" || (obj as any).isCamera) {
            return true;
        }

        if (obj.name === "[Dynamic]" || obj.userData?.isRuntimeOnly) {
            return false;
        }

        return Boolean(obj.userData?.isStemObject) || isPrefab(obj);
    }

    getPreferredDrillDownChild(currentSelection: THREE.Object3D): THREE.Object3D {
        const nextChild = currentSelection.children.find(child => this.isSceneHierarchyNode(child));
        return nextChild || currentSelection;
    }

    getPreferredDrillDownPathTarget(path: THREE.Object3D[], currentSelection: THREE.Object3D): THREE.Object3D {
        const nextNode = path.slice(1).find(node => this.isSceneHierarchyNode(node));
        return nextNode || currentSelection;
    }

    isInsidePrefab(prefab: THREE.Object3D, target: THREE.Object3D): boolean {
        let current: THREE.Object3D | null = target;

        while (current) {
            if (current === prefab) return true;
            current = current.parent;
        }

        return false;
    }

    // Drill-down toward clicked object
    drillDownSelection(currentSelection: THREE.Object3D, clickedTarget: THREE.Object3D): THREE.Object3D {
        if (
            Boolean(currentSelection.userData?.prefabId) &&
            !currentSelection.userData.prefabEditRevisionId &&
            this.isInsidePrefab(currentSelection, clickedTarget)
        ) {
            return currentSelection;
        }

        if (currentSelection.userData?.isBillboard) {
            return currentSelection;
        }

        const clickedBoundary = this.getSelectionBoundaryObject(clickedTarget);
        if (clickedBoundary !== clickedTarget) {
            return clickedBoundary;
        }

        // If current selection is the clicked target itself, pick its first child (deeper drill)
        if (currentSelection === clickedTarget && currentSelection.children.length > 0) {
            return this.getPreferredDrillDownChild(currentSelection);
        }

        // Otherwise, find path from current selection to clicked target
        const path = this.getPathToTarget(currentSelection, clickedTarget);
        if (path.length > 1) {
            return this.getPreferredDrillDownPathTarget(path, currentSelection);
        }

        // Fallback
        return clickedTarget;
    }

    // Return array of objects from root to target
    getPathToTarget(root: THREE.Object3D, target: THREE.Object3D): THREE.Object3D[] {
        const path: THREE.Object3D[] = [];
        let found = false;

        /**
         *
         * @param node
         */
        function traverse(node: THREE.Object3D) {
            if (found) return;
            path.push(node);
            if (node === target) {
                found = true;
                return;
            }
            for (const child of node.children) {
                traverse(child);
                if (found) return;
            }
            if (!found) path.pop();
        }

        traverse(root);
        return path;
    }

    // Helper to get next child in hierarchy for drill-down
    getNextChildInHierarchy(currentSelection: THREE.Object3D, clickedTarget: THREE.Object3D): THREE.Object3D {
        // If current selection has children, pick the child that was clicked or the first child
        if (currentSelection.children.length === 0) return currentSelection;

        // Try to find the child that matches clickedTarget or pick the first
        const nextChild = currentSelection.children.find(c => c === clickedTarget) || currentSelection.children[0];
        return nextChild!;
    }

    selectById(id: number) {
        if (id === this.camera.id) {
            this.select(this.camera);
            return;
        }

        this.select(this.scene.getObjectById(id) || null);
    }

    selectByUuid(uuid: string | string[]) {
        if (typeof uuid === "string") {
            if (uuid === this.camera.uuid) {
                this.select(this.camera);
                return;
            }
            const child = this.scene.getObjectByProperty("uuid", uuid);
            if (child) {
                this.select(child);
            }
        } else {
            const selectedObjects: THREE.Object3D[] = [];

            uuid.forEach(id => {
                if (id === this.camera.uuid) {
                    selectedObjects.push(this.camera);
                    return;
                }

                this.scene.traverse(child => {
                    if (child.uuid === id) {
                        selectedObjects.push(child);
                    }
                });
            });

            if (selectedObjects.length > 0) {
                this.select(selectedObjects);
            } else {
                console.log("[Editor] No objects found for the given UUIDs");
            }
        }
    }

    deselect() {
        this.select(null);
    }

    playVFX(object?: typeof this.selected) {
        if (!object) {
            object = this.scene;
        }
        object = Array.isArray(object) ? object : [object];

        object.forEach(obj => {
            if (obj instanceof THREE.Object3D) {
                QuarksUtil.runOnAllParticleEmitters(obj, (emitter: ParticleEmitter) => {
                    QuarksUtil.restart(emitter);
                });
            }
        });
    }

    stopVFX(object?: typeof this.selected) {
        if (!object) {
            object = this.scene;
        }
        object = Array.isArray(object) ? object : [object];

        object.forEach(obj => {
            if (obj instanceof THREE.Object3D) {
                QuarksUtil.runOnAllParticleEmitters(obj, (emitter: ParticleEmitter) => {
                    QuarksUtil.stop(emitter);
                });
            }
        });
    }

    focus(object: THREE.Object3D) {
        this.engine?.call("objectFocused", this, object);
    }

    focusById(id: number) {
        let obj = this.scene.getObjectById(id);
        if (obj) {
            this.focus(obj);
        }
    }

    focusByUUID(uuid: string) {
        if (uuid === this.camera.uuid) {
            this.focus(this.camera);
            return;
        }

        this.scene.traverse(child => {
            if (child.uuid === uuid) {
                this.focus(child);
            }
        });
    }

    async execute(cmd: any, optionalName: string = "") {
        return await this.history.execute(cmd, optionalName);
    }

    undo() {
        this.history.undo();
        this.engine?.call(`undo`, this, this);
    }

    redo() {
        this.history.redo();
        this.engine?.call(`redo`, this, this);
    }

    deepClone = async (obj: any, uuidMap?: Map<string, string>, omitCharacter?: boolean) => {
        const clone = obj.clone(false);
        clone.uuid = THREE.MathUtils.generateUUID();
        uuidMap?.set(obj.uuid, clone.uuid);

        clone.castShadow = !!obj?.castShadow;

        if (clone.geometry) {
            clone.geometry = clone.geometry.clone();
            clone.geometry.uuid = THREE.MathUtils.generateUUID();
        }

        if (clone.material) {
            if (Array.isArray(clone.material)) {
                clone.material = clone.material.map((material: any) => {
                    const newMaterial = material.clone();
                    newMaterial.uuid = THREE.MathUtils.generateUUID();
                    return newMaterial;
                });
            } else {
                clone.material = clone.material.clone();
                clone.material.uuid = THREE.MathUtils.generateUUID();
            }
        }

        for (const child of obj.children) {
            const childClone = await this.createObjectClone(child, uuidMap, omitCharacter);
            clone.add(childClone);
        }

        if (obj.userData._children) {
            obj.userData._children = []; // reset _children to avoid duplications
            MeshUtils.traverseUUID(obj.children, obj.userData._children);
        }

        if (clone.userData.behaviors && Array.isArray(clone.userData.behaviors)) {
            clone.userData.behaviors = clone.userData.behaviors.map((behavior: BehaviorData) =>
                this.behaviorDataManager.cloneBehaviorData(behavior),
            );
        }

        if (omitCharacter) {
            await this.execute(new DetachBehaviorCommand(clone, "", "character"));
        }

        return clone;
    };

    createObjectClone = async (
        object: THREE.Object3D,
        uuidMap?: Map<string, string>,
        omitCharacter?: boolean,
        omitPosition?: boolean,
    ) => {
        if (isModelAssetInstance(object) && isGaussianSplatObject(object)) {
            const serializedObject = this.serializeObject(object)[0];

            if (serializedObject) {
                const clonedFromSerialized = await this.deserializeObject(serializedObject);

                if (clonedFromSerialized) {
                    const remappedUuids = uuidMap || new Map<string, string>();
                    const previousUuid = clonedFromSerialized.uuid;
                    clonedFromSerialized.uuid = THREE.MathUtils.generateUUID();
                    remappedUuids.set(previousUuid, clonedFromSerialized.uuid);

                    if (clonedFromSerialized.userData.behaviors && Array.isArray(clonedFromSerialized.userData.behaviors)) {
                        clonedFromSerialized.userData.behaviors = clonedFromSerialized.userData.behaviors.map(
                            (behavior: BehaviorData) => this.behaviorDataManager.cloneBehaviorData(behavior),
                        );
                    }

                    remapBehaviorAttributeUuids(clonedFromSerialized, remappedUuids);
                    processChildData(clonedFromSerialized);

                    if (clonedFromSerialized.userData._children) {
                        clonedFromSerialized.userData._children = [];
                        MeshUtils.traverseUUID(clonedFromSerialized.children, clonedFromSerialized.userData._children);
                    }

                    if (omitCharacter) {
                        const detachPromises: Promise<unknown>[] = [];
                        clonedFromSerialized.traverse(child => {
                            detachPromises.push(this.execute(new DetachBehaviorCommand(child, "", "character")));
                        });

                        await Promise.all(detachPromises);
                    }

                    if (omitPosition) {
                        clonedFromSerialized.position.set(0, 0, 0);
                    }

                    return clonedFromSerialized;
                }
            }
        }

        const cloned = cloneObject(object, {uuidMap, cloneMaterials: true, cloneGeometry: true});

        // TODO: Is this needed / used anymore?
        if (cloned.userData._children) {
            cloned.userData._children = []; // reset _children to avoid duplications
            MeshUtils.traverseUUID(cloned.children, cloned.userData._children);
        }

        if (omitCharacter) {
            const detachPromises: Promise<unknown>[] = [];
            cloned.traverse(child => {
                detachPromises.push(this.execute(new DetachBehaviorCommand(child, "", "character")));
            });

            await Promise.all(detachPromises);
        }

        if (omitPosition) {
            cloned.position.set(0, 0, 0);
        }

        return cloned;
    };

    cloneParticleSystem(ps: ParticleSystem): ParticleSystem {
        const newPS = ps.clone();

        if (ps.material) {
            const newMaterial = ps.material.clone();
            newMaterial.transparent = ps.material.transparent;
            newMaterial.side = ps.material.side;
            newMaterial.opacity = ps.material.opacity;
            newMaterial.needsUpdate = true;

            const psMatWithMap = ps.material as THREE.MeshBasicMaterial;
            if (psMatWithMap.map) {
                const oldMap = psMatWithMap.map;
                (newMaterial as THREE.MeshBasicMaterial).map = oldMap.clone ? oldMap.clone() : oldMap;
                (newMaterial as THREE.MeshBasicMaterial).map!.needsUpdate = true;
            }

            newPS.material = newMaterial;
        }

        newPS.rendererSettings = structuredClone
            ? structuredClone(ps.rendererSettings)
            : JSON.parse(JSON.stringify(ps.rendererSettings));

        newPS.rendererSettings.material = newPS.material;

        (newPS.rendererSettings as VFXBatchSettings & {_instanceId?: number})._instanceId = Math.random();

        newPS.particleNum = 0;
        newPS.particles = [];

        newPS.restart?.();

        return newPS;
    }

    cloneObjectByUuid = async (
        id: string,
        object?: THREE.Object3D,
        point?: THREE.Vector3Like,
        callback?: (obj: THREE.Object3D) => void,
        noSelect?: boolean,
    ) => {
        object = this.objectByUuid(id) || object || undefined;
        if (!object) return;
        const isOriginalObjVFX = object.userData.isVFX || isVFXParent(object);
        const isNewVfx = object.userData.isTemplateVariant;
        if (isOriginalObjVFX && isNewVfx) {
            return this.handleCreateParticleFromScratch(undefined, undefined, object.userData);
        }
        const objectParent = object.parent;
        const clone = await this.createObjectClone(object, undefined, true);

        const isVFX = clone.userData.isVFX || isVFXParent(clone);

        if (isVFX) {
            clone.userData.isTemplateVariant = true;
        }

        if (point) this.moveObjectToPoint(clone, point);

        // ADD TO SCENE FIRST
        this.execute(new AddObjectCommand(clone, objectParent, undefined, noSelect));

        this.engine?.call("objectCloned");

        // VFX INIT AFTER SCENE ATTACH
        if (isVFX) {
            requestAnimationFrame(() => {
                clone.traverse((child: any) => {
                    let ps: ParticleSystem | undefined;

                    if (child.particleSystem) ps = child.particleSystem;
                    else if (child.type === "ParticleEmitter") ps = child.system;

                    if (!ps) return;

                    const newPS = this.cloneParticleSystem(ps);

                    // bind system AFTER scene attach
                    if (child instanceof ParticleEmitter) {
                        child.system = newPS;
                    } else if (child.particleSystem) {
                        child.particleSystem = newPS;
                        child.userData.system = newPS;
                    }

                    const emitter = child;
                    QuarksUtil.addToBatchRenderer(emitter, this.engine!.batchedRenderer);
                    if (isVFXAutoStartEnabled(emitter)) {
                        QuarksUtil.restart(emitter);
                    } else {
                        QuarksUtil.stop(emitter);
                    }
                });

                // FORCE FIRST FRAME UPDATE
                this.engine?.batchedRenderer?.update?.(0);
            });
        }

        if (object.userData.behaviors) {
            clone.userData.behaviors = [];
            for (const behavior of object.userData.behaviors) {
                await this.addBehaviorToObject(clone, behavior.id, {
                    attributesData: behavior.attributesData,
                    enabled: behavior.enabled,
                    throttleConfig: behavior.throttleConfig,
                    index: -1,
                });
            }
        }

        if (callback) callback(clone);
        return clone;
    };

    loadModelByUrl = async (objectUserData: {
        ID: string;
        Name: string;
        Url: string;
        Type: string;
    }): Promise<THREE.Object3D | null> => {
        try {
            let loader = new (ModelLoader as any)();
            const url = backendUrlFromPath(objectUserData.Url);
            const obj = await loader.load(url, objectUserData, {
                camera: this.camera,
                renderer: this.renderer,
                audioListener: this.audioListener,
            });
            return obj;
        } catch (e) {
            console.error(`[Editor] Error loading model from URL: ${objectUserData.Url}`, e);
            showToast({type: "error", title: t("Could not load model")});
            return null;
        }
    };

    loadQuarksFromJsonUrl = async (url: string): Promise<Object3D | null> => {
        try {
            const loader = new QuarksLoader();
            const obj = await new Promise(resolve => {
                loader.load(
                    url,
                    (obj: any) => {
                        resolve(obj);
                    },
                    undefined,
                    (error: any) => {
                        console.error(`[Editor] Error loading particle system from URL: ${url}`, error);
                        resolve(null);
                    },
                );
            });

            if (!obj) {
                console.error(`[Editor] Failed to load particle system from URL: ${url}`);
                return null;
            }

            return (obj as Object3D).clone();
        } catch (e) {
            console.error(`[Editor] Error loading particle system from URL: ${url}`, e);
            return null;
        }
    };

    moveElementToIndex(element: THREE.Object3D, index: number) {
        const currentIndex = this.scene.children.findIndex(child => child.uuid === element.uuid);

        if (currentIndex > -1) {
            this.scene.children.splice(currentIndex, 1);
        }
        this.scene.children.splice(index, 0, element);
    }

    groupElements(elements: THREE.Object3D[] | THREE.Object3D) {
        if (elements instanceof Array && elements.length > 1) {
            if (elements.some(object => object === this.scene || object === this.camera)) {
                showToast({type: "info", title: "Default scene and camera cannot be grouped"});
                return;
            }

            // The stem instance must remain a direct child of the scene so
            // saveStemEditor can locate it. Refuse to group any selection
            // that includes it.
            if (isStemEditor(this.scene)) {
                const stemMeta = this.scene.userData.stemEditor as StemEditorMetadata | undefined;
                const stemInstance = stemMeta
                    ? this.scene.children.find(child => getPrefabId(child) === stemMeta.assetId)
                    : undefined;
                if (stemInstance && elements.some(object => object === stemInstance)) {
                    showToast({type: "info", title: "The stem cannot be grouped"});
                    return;
                }
            }

            const group = new THREE.Group();
            group.name = generateUniqueNameWithCounter("Group", this.scene, this.getExistingNames());
            this.objectsNames.add(group.name);

            this.setObjectDefaultUserData(group);
            this.setObjectDefaultShadowSettings(group);

            group.userData.physics = {
                ...getPhysics(group.userData.physics || null),
                enabled: false, // disable physics for group
            };
            const index = this.scene.children.findIndex(child => child.uuid === elements[0]!.uuid);

            // select a parent: if all elements have the same parent - select it, otherwise - scene root
            const firstParent = elements[0]!.parent;
            const allSameParent = elements.every(obj => obj.parent === firstParent);
            const parent = allSameParent && firstParent ? firstParent : this.scene;

            // calculate the center of the group
            const bounds = new THREE.Box3();
            elements.forEach(object => {
                bounds.expandByPoint(object.getWorldPosition(new THREE.Vector3()));
            });
            const center = new THREE.Vector3();
            bounds.getCenter(center);
            parent.worldToLocal(center);
            group.position.copy(center);

            this.execute(
                new GroupObjectsCommand(group, parent, elements, parent === this.scene ? index : -1),
                "Group Objects",
            );
        }
    }

    ungroupElements(group: THREE.Object3D) {
        if (!group) return;

        const parent = group.parent;
        if (!parent) return;

        const children = [...group.children];
        if (children.length === 0) return;

        // The stem instance must remain a direct child of the scene so
        // saveStemEditor can locate it. Refuse to ungroup it.
        if (isStemEditor(this.scene)) {
            const stemMeta = this.scene.userData.stemEditor as StemEditorMetadata | undefined;
            const stemInstance = stemMeta
                ? this.scene.children.find(child => getPrefabId(child) === stemMeta.assetId)
                : undefined;
            if (stemInstance && group === stemInstance) {
                showToast({type: "info", title: "The stem cannot be ungrouped"});
                return;
            }
        }

        // 1. Reparent each child to the group's parent (attach preserves world transform)
        children.forEach(child => {
            parent.attach(child);
            this.setObjectDefaultUserData(child);
            child.userData.isRuntimeOnly = false;
        });

        // 2. Remove the now-empty group from scene graph
        parent.remove(group);

        // 3. Push undo/redo command to history
        const undoRedo = {
            type: "UngroupCommand",
            name: "Ungroup Objects",
            id: 0,
            inMemory: true,
            execute: () => {
                children.forEach(child => {
                    parent.attach(child);
                    this.setObjectDefaultUserData(child);
                    child.userData.isRuntimeOnly = false;
                });
                parent.remove(group);
                this.engine?.call("sceneGraphChanged");
                return {message: "Ungroup: done", status: "success"};
            },
            undo: () => {
                parent.add(group);
                children.forEach(child => {
                    group.attach(child);
                    child.userData.isRuntimeOnly = true;
                });
                this.engine?.call("sceneGraphChanged");
                return {message: "Ungroup: undone", status: "success"};
            },
            toJSON() {
                return {};
            },
            fromJSON() {},
        };
        this.history.undos.push(undoRedo as any);
        this.history.redos = [];

        // 4. Notify the system to re-render scene tree
        this.engine?.call("sceneGraphChanged");
        this.select(null);
    }

    getTextureCurrentSrcByUUID(object: THREE.Object3D, textureUUID: string) {
        let foundTexture: any = null;

        object.traverse(child => {
            if (child instanceof THREE.Mesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => {
                    for (const key in material) {
                        const value = material[key];
                        if (value && value.isTexture && value.uuid === textureUUID) {
                            foundTexture = value;
                        }
                    }
                });
            }
        });

        if (foundTexture && foundTexture.image) {
            return foundTexture.image.currentSrc || null;
        }

        return null;
    }

    async safeAddBehaviorsForClone(clonedBehaviors: any[]) {
        const behaviorsInScene = await getBehaviorsListForScene(this.sceneID!, this.scene);
        const behaviorsInLibrary = await getBehaviorsList();
        const behaviorConfigs = this.behaviorConfigRegistry.getAllConfigs() || [];
        for (const el of clonedBehaviors) {
            if (behaviorConfigs.some(config => config.id === el.id)) continue;

            const inScene = behaviorsInScene.some(beh => beh.ID === el.id);
            const inLibrary = behaviorsInLibrary.find(beh => beh.ID === el.id);
            if (!inScene && inLibrary) {
                const config = inLibrary.Config as BehaviorConfig;
                this.behaviorConfigRegistry.registerConfig(inLibrary.ID, config);
                this.behaviorScriptRegistry.registerScript(inLibrary.ID, inLibrary.Code);
                await legacyAddBehaviorToScene(inLibrary.ID, this.sceneID!);
                this.syncSceneBehaviorConfigs();
                console.log(`✅ Behavior "${inLibrary.ID}" added to scene.`);
            }
            // TODO: support new Asset API behaviors
        }
    }

    async copy() {
        if (!this.selected) return;

        if (!(this.selected instanceof Array)) {
            const object = this.objectByUuid(this.selected?.uuid);
            if (!object) return;

            const serialized = this.serializeObject(object);

            try {
                await navigator.clipboard.writeText(
                    JSON.stringify({
                        sceneId: this.scene.uuid,
                        data: serialized,
                    }),
                );
                if (!this.engine?.isPlaying) {
                    showToast({type: "success", title: "Object copied!"});
                }
            } catch (err) {
                console.error("[Editor] Failed to copy object:", err);
                showToast({type: "error", title: "Failed to copy object."});
            }
        } else if (Array.isArray(this.selected) && this.selected.length > 0) {
            const objectsToCopy = this.selected.map(sel => this.objectByUuid(sel.uuid)).filter(Boolean);

            if (objectsToCopy.length === 0) return;

            const serializedObjects = objectsToCopy.map(obj => obj && this.serializeObject(obj)).flat();

            try {
                await navigator.clipboard.writeText(
                    JSON.stringify({
                        sceneId: this.scene.uuid,
                        data: serializedObjects,
                    }),
                );
                if (!this.engine?.isPlaying) {
                    showToast({type: "success", title: `${objectsToCopy.length} objects copied!`});
                }
            } catch (err) {
                console.error("[Editor] Failed to copy objects:", err);
                showToast({type: "error", title: "Failed to copy objects."});
            }
        }
    }

    paste() {
        if (this.isPasting) return;
        this.isPasting = true;

        const app = this.engine as EngineRuntime;
        if (!app) return;

        navigator.clipboard
            .readText()
            .then(async text => {
                const parsed = JSON.parse(text);

                const sceneId = parsed.sceneId;
                const objectJSON = parsed.data;
                if (objectJSON.type === AssetType.Prefab) {
                    this.engine?.call("prefabPasted", objectJSON, objectJSON);
                    return;
                }
                const objectArr = Array.isArray(objectJSON) ? objectJSON : [objectJSON];

                // Filter out children whose parent is also in the array.
                // serializeObject() flattens groups into [Group, Child1, Child2, ...],
                // but createObjectClone() already deep-clones children, so pasting
                // each child separately would create duplicates.
                const uuidsInArr = new Set(objectArr.map((o: any) => o.uuid));
                const topLevelArr = objectArr.filter((o: any) => {
                    // Check live scene parent (same-scene paste) or serialized parent UUID (cross-scene paste)
                    const existing = this.objectByUuid(o.uuid);
                    const parentUuid = existing?.parent?.uuid ?? o.parentUuid;
                    return !parentUuid || !uuidsInArr.has(parentUuid);
                });

                const isFromCurrentScene = sceneId === this.scene.uuid;

                const arrayToProcess = isFromCurrentScene ? topLevelArr : objectArr;
                const basePoint: THREE.Vector3 = app.isPlaying
                    ? this.getCameraLookAtPoint(5, true)
                    : new THREE.Vector3(0, 0, 0);

                const clonedObjects: THREE.Object3D[] = [];

                const firstPos = topLevelArr[0]?.position || new THREE.Vector3();

                for (const object of arrayToProcess) {
                    let clonedObject: THREE.Object3D | null = null;

                    const existingObject = this.objectByUuid(object.uuid);
                    if (existingObject) {
                        clonedObject = await this.createObjectClone(existingObject, undefined, true);
                    } else {
                        clonedObject = await this.deserializeObject(object);
                    }

                    if (!clonedObject) continue;

                    if (isFromCurrentScene) {
                        if (object.position) {
                            clonedObject.position.copy(object.position);
                        }
                    } else {
                        const offset =
                            objectArr.length > 1 && object.position
                                ? new THREE.Vector3().subVectors(object.position, firstPos)
                                : new THREE.Vector3();

                        clonedObject.position.copy(basePoint).add(offset);
                    }

                    if (clonedObject.userData.behaviors?.length > 0) {
                        this.safeAddBehaviorsForClone(clonedObject.userData.behaviors);
                    }

                    if (clonedObject.userData._children) {
                        clonedObject.userData._children = [];
                        MeshUtils.traverseUUID(clonedObject.children, clonedObject.userData._children);
                    }

                    let parent: THREE.Object3D | null = null;

                    if (isFromCurrentScene) {
                        const original = this.objectByUuid(object.uuid);
                        parent = original?.parent || this.scene;
                    } else {
                        parent =
                            typeof (clonedObject as any).parentUuid === "string"
                                ? this.scene.getObjectByProperty("uuid", (clonedObject as any).parentUuid)!
                                : clonedObject.parent;
                    }

                    await this.execute(
                        new (AddObjectCommand as any)(clonedObject, parent || this.scene, undefined, true),
                    );

                    clonedObject.updateMatrixWorld();
                    clonedObject.traverse(child => {
                        const childMesh = child as Mesh;
                        if (childMesh.isMesh && childMesh.geometry) {
                            childMesh.geometry.computeBoundingBox();
                            childMesh.geometry.computeBoundingSphere();
                        }
                    });

                    clonedObjects.push(clonedObject);
                }

                if (clonedObjects.length > 0) {
                    if (clonedObjects.length === 1) {
                        this.select(clonedObjects[0]!, true);
                    } else {
                        this.select(clonedObjects, true);
                    }
                }

                if (!app.isPlaying) {
                    showToast({type: "success", title: `${clonedObjects.length} object(s) pasted!`});
                }
            })
            .catch(err => {
                console.error("[Editor] Failed to read clipboard: ", err);
                showToast({
                    type: "error",
                    title: "Failed to read clipboard content.",
                    body: "Make sure you copied valid object(s).",
                });
            })
            .finally(() => {
                this.isPasting = false;
            });
    }

    async deserializeObject(json: any): Promise<Object3D | null> {
        try {
            const assetResolutionContext = getAssetResolutionContext(this.scene);
            const data = this.engine?.converter.deserializeObject(json, {
                options: {
                    ...this.engine?.options,
                    server: this.engine?.options.server || "",
                },
                camera: this.engine?.camera,
                renderer: this.engine?.renderer,
                scripts: this.engine?.scripts,
                assetResolutionContext,
            });

            await data.promise;

            return data.serverObjects[data.serverObjects.length - 1] || data.object || null;
        } catch (error) {
            console.error("Collaboration: Failed to deserialize object:", error);
            return null;
        }
    }

    async deserializeObjectFromArray(json: any[]): Promise<Object3D | null> {
        try {
            const data = await this.engine?.converter.deserializeObjectFromArray(json, {
                options: {
                    ...this.engine?.options,
                    server: this.engine?.options.server || "",
                },
                camera: this.engine?.camera,
                renderer: this.engine?.renderer,
                scripts: this.engine?.scripts,
            });

            return data;
        } catch (error) {
            console.error("Collaboration: Failed to deserialize object:", error);
            return null;
        }
    }

    serializeObject(object: Object3D, isServerObject?: boolean): any[] {
        isServerObject = isServerObject || !!object.userData?.Server;
        return this.engine?.converter.traverse(
            object,
            [],
            [],
            {
                options: this.engine?.options,
                camera: this.engine?.camera,
                renderer: this.engine?.renderer,
                scripts: this.engine?.scripts,
            },
            isServerObject,
        );
    }

    async duplicateObject() {
        const selection = window.getSelection();
        if (selection?.type === "Range") return;

        if (!this.selected) return;

        const selectedArray = Array.isArray(this.selected) ? this.selected : [this.selected];

        const cloned: THREE.Object3D[] = [];

        for (const sel of selectedArray) {
            const result = await this.cloneObjectByUuid(sel.uuid);
            if (result) cloned.push(result);
        }

        // select all clones at the end
        if (cloned.length > 1) {
            this.select(cloned);
        } else if (cloned.length === 1) {
            this.select(cloned[0]!, true);
        }
    }

    removePreviewBoxes() {
        this.sceneHelpers.traverse((object: any) => {
            if (object.userData && object.userData.previewBoxId) {
                const obj = this.scene.getObjectByProperty("uuid", object.userData.previewBoxId);
                if (obj?.userData.physics?.enable_preview) {
                    obj.userData.physics.enable_preview = false;
                }

                this.sceneHelpers.remove(object);
            }
        });
        this.engine?.call("objectChanged", this, this);
    }

    removeOjbectPreviewBox(parent: THREE.Object3D) {
        this.sceneHelpers.traverse((object: any) => {
            if (object.userData && object.userData.previewBoxId === parent.uuid) {
                this.sceneHelpers.remove(object);
            }
        });
    }

    updateObjectPhysics = (object: THREE.Object3D) => {
        this.engine?.physics?.removeObject(object);
        this.engine?.physics?.addObject(object);
    };

    onObjectChanged = (editor: Editor, object: THREE.Object3D) => {
        if (this.sceneHelpers) {
            this.sceneHelpers.children.forEach(helper => {
                if (helper instanceof THREE.CameraHelper && helper.camera === object) {
                    helper.update();
                }
            });
        }
    };

    update = (_clock: unknown, deltaTime?: number) => {
        this.behaviorPluginManager.update(deltaTime ?? 0);
    };

    /**
     * Lazily create (and cache) a UI camera for UIKit rendering inside the editor.
     * Mirrors `GameManager.initUIKit()` (which only runs in play mode) so that
     * `UIKit.Fullscreen` roots can be parented and rendered in editor previews.
     *
     * Behaviors call `await editor.ensureUICamera()` from `onEditorAdded` and
     * parent their UIKit root to the returned camera. Subsequent calls return
     * the cached camera (or the in-flight initialization promise).
     */
    async ensureUICamera(): Promise<PerspectiveCamera> {
        if (this.uiCamera) {
            // Self-heal: scene-swap paths (Editor.clear()) walk
            // `scene.children` and remove everything, including this camera.
            // The cached object identity is still valid — re-mount it so
            // any UIKit roots already parented to it keep rendering, instead
            // of orphaning behaviors that already attached.
            if (!this.uiCamera.parent) {
                this.scene.add(this.uiCamera);
            }
            return this.uiCamera;
        }
        if (this._uiCameraInitPromise) return this._uiCameraInitPromise;

        this._uiCameraInitPromise = (async () => {
            // Lazy-load UIKit to avoid pulling its bundle into editor startup
            // when no UIKit-rendering behavior is active.
            const {initNodeMaterials, initGlyphNodeMaterials} = await import("@ni2khanna/uikit");
            await initNodeMaterials();
            await initGlyphNodeMaterials();

            const uiCamera = this.camera.clone();
            uiCamera.name = "EditorUICamera";

            let hasWarnedInvalidUICameraState = false;
            const isFiniteNumber = (value: unknown): value is number =>
                typeof value === "number" && Number.isFinite(value);
            const hasFiniteTransform = (object: THREE.Object3D): boolean => {
                const {x: px, y: py, z: pz} = object.position;
                const {x: qx, y: qy, z: qz, w: qw} = object.quaternion;
                return (
                    isFiniteNumber(px) &&
                    isFiniteNumber(py) &&
                    isFiniteNumber(pz) &&
                    isFiniteNumber(qx) &&
                    isFiniteNumber(qy) &&
                    isFiniteNumber(qz) &&
                    isFiniteNumber(qw)
                );
            };

            const syncUICamera = () => {
                if (!hasFiniteTransform(this.camera)) {
                    if (!hasWarnedInvalidUICameraState) {
                        hasWarnedInvalidUICameraState = true;
                        console.warn(
                            "Editor: skipping UI camera sync due to non-finite camera transform",
                        );
                    }
                    return;
                }
                uiCamera.copy(this.camera, false);
                const baseNear = isFiniteNumber(this.camera.near) ? this.camera.near : 0.1;
                const baseFar = isFiniteNumber(this.camera.far)
                    ? this.camera.far
                    : Math.max(baseNear + 1, 2000);
                const nextNear = Math.max(0.001, baseNear + 0.1);
                const nextFar = Math.max(nextNear + 0.001, baseFar);
                uiCamera.near = Math.min(nextNear, nextFar - 0.001);
                uiCamera.far = nextFar;
                uiCamera.updateProjectionMatrix();
                uiCamera.name = "EditorUICamera";
                // `Object3D.copy()` overwrites `userData` (deep-clones from
                // source), so the outliner-hide flag must be re-applied here
                // every frame, not only at construction. Without this, the
                // camera surfaces in the outliner after the first render.
                uiCamera.userData.isRuntimeOnly = true;
                if (hasWarnedInvalidUICameraState) hasWarnedInvalidUICameraState = false;
            };

            syncUICamera();

            const originalUpdateMatrixWorld = uiCamera.updateMatrixWorld.bind(uiCamera);
            uiCamera.updateMatrixWorld = force => {
                syncUICamera();
                originalUpdateMatrixWorld(force);
            };

            // `isRuntimeOnly` keeps this internal camera out of the scene
            // outliner (filtered in `ProjectTab._parseData` at the
            // `obj.userData.isRuntimeOnly` check). Must be set before
            // `scene.add` so any concurrent outliner refresh sees it filtered.
            uiCamera.userData.isRuntimeOnly = true;
            this.scene.add(uiCamera);
            this.uiCamera = uiCamera;
            return uiCamera;
        })();

        return this._uiCameraInitPromise;
    }

    disposeUICamera() {
        if (this.uiCamera) {
            this.uiCamera.removeFromParent();
            this.uiCamera = null;
        }
        this._uiCameraInitPromise = null;
    }

    checkForUnsavedChanges = (
        message: string,
        onOK?: () => void,
        onCancel?: () => void,
        okText?: string,
        cancelText?: string,
        onClose?: () => void,
    ) => {
        const hasUnsavedChanges = editorHasUnsavedChanges(this.scene.userData);

        if (!hasUnsavedChanges) return;

        return new Promise<void>((resolve, reject) => {
            ElementsUtils.confirm({
                title: I18n.t("Confirm"),
                content: I18n.t(message),
                okText: okText,
                cancelText: cancelText,
                onOK: () => {
                    resolve();
                    onOK?.();
                },
                onCancel: () => {
                    reject(new Error("cancelAction"));
                    onCancel?.();
                },
                onClose: () => {
                    reject(new Error("closeAction"));
                    onClose?.();
                },
            });
        });
    };

    addEventsListeners() {
        // Add all event listeners to handle editor actions
        window.addEventListener("keydown", this.handleDeleteEvent);
        window.addEventListener("keydown", this.handleCopyEvent);
        window.addEventListener("keydown", this.handleDuplicateEvent);
        window.addEventListener("keydown", this.handlePasteEvent);
        window.addEventListener("keydown", this.handleUndoRedoEvent);
        window.addEventListener("keydown", this.handlePanelsVisibilityEvent);
        window.addEventListener("keydown", this.handleGroupEvent);
        window.addEventListener("keydown", this.handleUngroupEvent);
        window.addEventListener("keydown", this.handleGameSettingsEvent);
        window.addEventListener("keydown", this.handleSaveEvent);
        window.addEventListener("mousemove", this.onMouseMove);
        window.addEventListener("auxclick", this.onAuxClick);
        window.addEventListener("click", this.onMouseClick);
        document.addEventListener("click", this.boundFirstInteractionHandler);
    }
    removeEventsListeners() {
        // Remove all event listeners to prevent memory leaks
        window.removeEventListener("keydown", this.handleDeleteEvent);
        window.removeEventListener("keydown", this.handleCopyEvent);
        window.removeEventListener("keydown", this.handleDuplicateEvent);
        window.removeEventListener("keydown", this.handlePasteEvent);
        window.removeEventListener("keydown", this.handleUndoRedoEvent);
        window.removeEventListener("keydown", this.handlePanelsVisibilityEvent);
        window.removeEventListener("keydown", this.handleGroupEvent);
        window.removeEventListener("keydown", this.handleUngroupEvent);
        window.removeEventListener("keydown", this.handleGameSettingsEvent);
        window.removeEventListener("keydown", this.handleSaveEvent);
        window.removeEventListener("mousemove", this.onMouseMove);
        window.removeEventListener("auxclick", this.onAuxClick);
        window.removeEventListener("click", this.onMouseClick);
        document.removeEventListener("click", this.boundFirstInteractionHandler);
    }

    private handleDeleteEvent = (e: any) => {
        if ((e.key === "Delete" || e.key === "Backspace") && !isInputActive()) {
            if (this.selected instanceof Array) {
                const selectedObjects = [...this.selected];

                selectedObjects.forEach(item => {
                    const object = this.objectByUuid(item.uuid);
                    if (object) {
                        this.execute(new (RemoveObjectCommand as any)(object));
                    }
                });
                this.select(null);
                return;
            }

            if (this.selected) {
                const object = this.objectByUuid(this.selected.uuid);

                if (object) {
                    this.execute(new (RemoveObjectCommand as any)(object));
                    this.select(null);
                }
            }
        }

        if (e.key === "Escape" && this.transformControls && !isInputActive()) {
            this.select(null);
        }
    };

    private handleCopyEvent = (e: any) => {
        const selection = window.getSelection()?.toString();
        if ((e.ctrlKey || e.metaKey) && e.key === "c" && !isInputActive() && !selection) {
            void this.copy();
        }
    };

    private handleDuplicateEvent = (e: any) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "d" && !isInputActive()) {
            e.preventDefault();

            this.duplicateObject();
        }
    };

    private handlePasteEvent = (e: any) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "v" && !isInputActive()) {
            this.paste();
        }
    };

    private handleUndoRedoEvent = (e: any) => {
        const isMac = /Mac/i.test(navigator.userAgent);
        if ((isMac ? e.metaKey : e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
            if (e.shiftKey) {
                this.redo();
            } else {
                this.undo();
            }
        }
    };

    private handlePanelsVisibilityEvent = (e: any) => {
        const isMac = /Mac/i.test(navigator.userAgent);
        if ((isMac && e.metaKey && e.key === ".") || (!isMac && e.ctrlKey && e.key === ".")) {
            this.component?.toggleUI();
        }
    };

    private handleGroupEvent = (e: any) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "g" && !isInputActive()) {
            if (this.selected) {
                this.groupElements(this.selected);
            }
        }
    };

    private handleUngroupEvent = (e: any) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "g" && e.shiftKey && !isInputActive()) {
            if (this.selected && !Array.isArray(this.selected) && this.selected.children?.length > 0) {
                this.ungroupElements(this.selected);
            }
        }
    };

    private handleGameSettingsEvent = (e: any) => {
        if (e.key === "Escape") {
            this.select(null);
            this.component?.props.setActiveRightPanel(RIGHT_PANEL_VERSIONS.GameSettings);
        }
    };

    private handleSaveEvent = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            this.onSaveScene();
            saveScene(true).catch(console.error);
        }
    };

    private onMouseMove = (event: MouseEvent) => {
        this.mousePosition.x = event.clientX;
        this.mousePosition.y = event.clientY;
    };

    private onMouseClick = (event: MouseEvent) => {
        this.mouseClickPosition.x = event.clientX;
        this.mouseClickPosition.y = event.clientY;
    };

    private onAuxClick = (event: MouseEvent) => {
        this.mouseAuxPosition.x = event.clientX;
        this.mouseAuxPosition.y = event.clientY;
    };

    resetInactivityTimer = () => {
        if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = setTimeout(() => {
            this.select(null);
            this.engine?.multiplayerClient?.terminate();
        }, 600000); // 10 minutes
    };

    startInactivityWatcher() {
        window.addEventListener("mousemove", this.resetInactivityTimer);
        window.addEventListener("keydown", this.resetInactivityTimer);
        window.addEventListener("mousedown", this.resetInactivityTimer);
        window.addEventListener("touchstart", this.resetInactivityTimer);

        this.resetInactivityTimer();
    }

    stopInactivityWatcher() {
        if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
        window.removeEventListener("mousemove", this.resetInactivityTimer);
        window.removeEventListener("keydown", this.resetInactivityTimer);
        window.removeEventListener("mousedown", this.resetInactivityTimer);
        window.removeEventListener("touchstart", this.resetInactivityTimer);
    }

    /**
     * Enter curve edit mode - allows 3D manipulation of curve control points
     * @param object
     */
    enterCurveEditMode(object: any) {
        // Lazy initialization: create controls if they don't exist yet
        if (!this.curveEditorControls) {
            const viewport = this.engine?.viewport;

            if (!viewport) {
                console.error("[CurveEditor] Cannot create controls: viewport is not available");
                return;
            }

            this.curveEditorControls = new CurveEditorControls(this.camera, viewport);
            this.sceneHelpers.add(this.curveEditorControls);
            console.log("[CurveEditor] Controls initialized");
        }

        // Detach transform controls
        if (this.transformControls) {
            this.transformControls.detach();
        }

        // Attach curve editor controls to the object
        this.curveEditorControls.attach(object);
    }

    /**
     * Exit curve edit mode
     */
    exitCurveEditMode() {
        if (!this.curveEditorControls) return;

        this.curveEditorControls.detach();

        // Re-attach transform controls to selected object if any
        if (this.selected && !Array.isArray(this.selected) && this.transformControls) {
            this.transformControls.attach(this.selected);
        }
    }
}

export default Editor;

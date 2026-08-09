import * as THREE from "three";
import {STLExporter} from "three/addons/exporters/STLExporter.js";

import {ElementsUtils} from "./ElementsUtils";
import StringUtils from "./StringUtils";
import {renderingEditorToApi} from "@stem/network/api/scene";
import EngineRuntime from "../EngineRuntime";
import {emptyAssetResolutionContext, getAssetResolutionContext} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {collectExportAssetRefs, exportAssets} from "@stem/editor-oss/asset-management/export";
import {DEFAULT_TERRAIN_TEXTURES} from "../behaviors/packs/terrain/EndlessTerrainConstants";
import global from "../global";
import Converter from "../serialization/Converter";
import {showToast} from "@stem/editor-oss/showToast";
import {traverseObjectDepthFirst, updateObjectMatrixWorldDepthFirst} from "./SceneTraverser";

interface ExportOptions {
    /**
     * Indicates whether to include assets in the export (should only be used
     * for internal use)
     */
    includeAssets?: boolean;
}

export const shortKeyMap: Readonly<Record<string, string>> = {
    metadata: "m",
    generator: "gen",
    name: "n",
    parent: "pr",
    position: "p",
    quaternion: "q",
    rotation: "rt",
    order: "o",
    scale: "s",
    children: "ch",
    type: "t",
    uuid: "u",
    userData: "ud",
    geometry: "geo",
    material: "mt",
    sceneSettings: "ss",
    castShadow: "cs",
    receiveShadow: "rs",
    disableCameraCollision: "dcc",
    behaviors: "bh",
    isGameInitialized: "igi",
    isStemObject: "iso",
    physics: "ph",
    spinningFriction: "sf",
    contactStiffness: "cst",
    shapeScale: "ssc",
    shapeExcludesHiddenObjects: "seho",
    collision_material: "cm",
    enable_preview: "ep",
    ERTHLibrary: "erl",
    DeleteEnabled: "de",
    IsAIGenerated: "iai",
    PredictedPhysics: "pp",
    uiTag: "ut",
    SavePath: "sp",
    rigidBodyType: "rbt",
    colliderShape: "csp",
    collisionType: "ct",
    variable: "v",
    Name: "nm",
    AddTime: "at",
    FileName: "fn",
    FileSize: "fs",
    isSelectable: "is",
    anchorScale: "as",
    rollingFriction: "rf",
    ctype: "cot",
    UserID: "ui",
    IsAvatar: "ia",
    bounciness: "bo",
    SaveName: "sn",
    anchorOffset: "ao",
    inertia: "i",
    overrideMaterial: "om",
    postProcessing: "pop",
    behaviorConfigs: "bhc",
    isInGameMenuDefaultBanner: "iigm",
    isStartGameMenuDefaultBanner: "isgm",
    gameUI: "gu",
    cameraHeadHeight: "chh",
    lastEditTime: "let",
    visible: "vi",
    batching: "bch",
    scripts: "sc",
    background: "bg",
};

const oldToNewKeys: Record<string, string> = {
    g: "gen",
    r: "rt",
    b: "bh",
};

export const migrateOldShortKeys = (obj: any): any => {
    if (Array.isArray(obj)) {
        return obj.map(migrateOldShortKeys);
    }

    if (obj && typeof obj === "object") {
        const newObj: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            const newKey = oldToNewKeys[key] || key;
            newObj[newKey] = migrateOldShortKeys(value);
        }
        return newObj;
    }

    return obj;
};

const values = Object.values(shortKeyMap);
const duplicates = values.filter((v, i) => values.indexOf(v) !== i);
if (duplicates.length > 0) {
    window.alert(`ExportUtils: Duplicate short key detected in shortKeyMap: ${duplicates.join(", ")}`);
    throw new Error(`Duplicate short key detected in shortKeyMap: ${duplicates.join(", ")}`);
}

// Texture attribute keys that may contain default terrain texture URLs
const TERRAIN_TEXTURE_ATTRS = [
    "ditchTexture", "ditchNormalTexture", "ditchRoughnessTexture",
    "groundTexture", "normalTexture", "grassRoughnessTexture",
    "rockTexture", "rockNormalTexture", "rockRoughnessTexture",
    "snowTexture", "snowNormalTexture", "snowRoughnessTexture",
] as const;

/**
 * Strips bundled default terrain asset URLs from serialized scene data.
 * Default textures and models are environment-specific (import.meta.url)
 * and should not be embedded in exports — the behavior re-populates them
 * from local defaults on init.
 * @param sceneData
 */
function stripDefaultTerrainAssets(sceneData: any[]): void {
    const defaultTextureUrls = new Set(Object.values(DEFAULT_TERRAIN_TEXTURES));

    for (const item of sceneData) {
        const behaviors = item?.userData?.behaviors;
        if (!Array.isArray(behaviors)) continue;

        for (const behavior of behaviors) {
            if (behavior?.name !== "Terrain") continue;

            const attrs = behavior.attributesData;
            if (!attrs) continue;

            // Strip default texture attributes
            for (const key of TERRAIN_TEXTURE_ATTRS) {
                if (typeof attrs[key] === "string" && defaultTextureUrls.has(attrs[key])) {
                    delete attrs[key];
                }
            }

            // Handle terrainObjects
            if (attrs.isDefaultState === true) {
                // All defaults — strip entirely; behavior repopulates on init
                delete attrs.terrainObjects;
            } else if (Array.isArray(attrs.terrainObjects)) {
                // Keep only entries backed by a user asset or scene object
                attrs.terrainObjects = attrs.terrainObjects.filter(
                    (obj: any) => obj?.modelAsset?.assetId || obj?.modelUUID,
                );
            }

            // Strip runtime-generated preview blob URLs
            if (Array.isArray(attrs.terrainObjects)) {
                for (const obj of attrs.terrainObjects) {
                    delete obj.previewUrl;
                }
            }
        }
    }
}

/**
 * Exports the current scene to a JSON file
 * @param root0
 * @param root0.includeAssets
 */
export const exportSceneToJson = async (
    {includeAssets}: ExportOptions = {
        includeAssets: true,
    },
) => {
    const app = global.app as EngineRuntime;
    if (!app) {
        return;
    }

    const {editor, scene} = app;
    if (!editor || !scene || !editor.sceneID) {
        return;
    }

    const oldSceneAssets = scene.userData.assets;

    // Show loading indicator
    editor.component?.handleLoading(true);

    try {
        const name = await ElementsUtils.querySceneName({onCancel: () => editor.component?.handleLoading(false)});

        // Convert scene to JSON
        const output = new (Converter as any)().toJSON({
            options: app.options,
            camera: app?.camera,
            scripts: app?.scripts,
            scene: scene,
        });

        // Remove bundled default terrain assets — they are environment-specific
        // and every environment already has them locally.
        stripDefaultTerrainAssets(output);

        // Embed asset information in the export. Note that the actual content
        // of the assets is not embedded in the scene. Instead, we embed the
        // asset and revision metadata (including a signed URL to download the
        // asset content).
        let dependencies: Record<string, string> = {};
        if (includeAssets) {
            const {assetIdToRevisionId} = getAssetResolutionContext(scene) || emptyAssetResolutionContext;
            dependencies = assetIdToRevisionId || {};
            const assetRefs = collectExportAssetRefs(scene, dependencies);
            const serializedAssets = await exportAssets(assetRefs);
            output.push(serializedAssets);
        }

        // Add scene settings
        const sceneSettingsUserData: Record<string, unknown> = {};
        if (scene.userData?.snapping) {
            sceneSettingsUserData.snapping = scene.userData.snapping;
        }
        output.push({
            sceneSettings: {
                ShowStats: !!editor.showStats,
                UseAvatar: !!editor.useAvatar,
                AllowAnonymousFirebase: !!editor.allowAnonymousFirebase,
                UseInstancing: !!editor.useInstancing,
                VoiceChatEnabled: !!editor.voiceChatEnabled,
                IsMultiplayer: !!editor.isMultiplayer,
                Rendering: renderingEditorToApi(editor.rendering),
                Thumbnail: editor.sceneThumbnail,
                Description: editor.description,
                Tags: JSON.stringify(editor.tags),
                ShowHUD: editor.showHUD,
                HUDRenderer: editor.hudRenderer,
                AssetsCount: editor.assetsCount,
                IsCollaborative: editor.isCollaborative,
                MaxCollaboratorsInRoom: editor.maxCollaboratorsInRoom || 6,
                MultiplayerAutoJoin: editor.multiplayerAutoJoin,
                MaxMultiplayerClientsPerRoom: editor.maxMultiplayerClientsPerRoom || 4,
                VFXOnMobile: editor.VFXOnMobile,
                MajorVersion: editor.majorVersion || 0,
                MinorVersion: editor.minorVersion || 0,
                Dependencies: dependencies,
                ...Object.keys(sceneSettingsUserData).length > 0 && {
                    userData: sceneSettingsUserData,
                },
            },
        });

        // Stringify the JSON
        const jsonString = JSON.stringify(output);

        StringUtils.saveString(jsonString, `${name}.json`);
        showToast({type: "success", title: "Scene source exported as JSON."});
    } catch (error) {
        console.error("Failed to export scene source:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to export scene source";
        showToast({type: "error", title: errorMessage});
    } finally {
        // Restore original scene assets
        scene.userData.assets = oldSceneAssets;
        // Hide loading indicator
        editor.component?.handleLoading(false);
    }
};

/**
 * Export the current scene as an STL file
 */
export const exportSceneToSTL = async () => {
    const app = global.app as EngineRuntime;
    if (!app) {
        console.error("No app found");
        return;
    }

    const {editor} = app;
    if (!editor) {
        console.error("No editor found");
        return;
    }

    // Use editor.scene instead of app.scene
    const scene = editor.scene;
    if (!scene) {
        console.error("No scene found in editor");
        return;
    }

    // Show loading indicator
    editor.component?.handleLoading(true);

    try {
        const name = await ElementsUtils.querySceneName({onCancel: () => editor.component?.handleLoading(false)});

        // Collect only user-created mesh objects (exclude helpers, grids, sky, batched meshes)
        const exportGroup = new THREE.Group();
        updateObjectMatrixWorldDepthFirst(scene, true);

        let meshCount = 0;
        traverseObjectDepthFirst(scene, (object: any) => {
            // Only export regular Mesh objects that are user-created
            if (
                object.type === "Mesh" &&
                object.geometry &&
                // Exclude system/helper meshes
                !object.name.includes("[DayNightCycle") &&
                !object.name.includes("BatchRoot") &&
                !object.name.includes("Grid") &&
                object.constructor.name === "Mesh"
            ) {
                // Exclude BatchedMesh
                // Clone the mesh and apply world transform
                const meshClone = new THREE.Mesh(object.geometry.clone(), object.material);
                meshClone.applyMatrix4(object.matrixWorld);
                meshClone.name = object.name;

                exportGroup.add(meshClone);
                meshCount++;
            }
        });

        if (meshCount === 0) {
            console.warn("No exportable meshes found in scene");
            showToast({type: "warning", title: "No exportable meshes found"});
            editor.component?.handleLoading(false);
            return;
        }

        // Create STL exporter
        const exporter = new STLExporter();

        // Export the group as ASCII STL
        const stlData = exporter.parse(exportGroup, {binary: false});

        // Create blob and download
        const blob = new Blob([stlData], {type: "text/plain"});
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${name}.stl`;
        link.click();

        // Cleanup
        URL.revokeObjectURL(link.href);
        showToast({type: "success", title: "STL exported successfully!"});
    } catch (error) {
        console.error("Failed to export scene to STL:", error);
        showToast({type: "warning", title: "Failed to export STL"});
    } finally {
        // Hide loading indicator
        editor.component?.handleLoading(false);
    }
};

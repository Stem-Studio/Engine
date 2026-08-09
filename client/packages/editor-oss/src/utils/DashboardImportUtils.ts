import {ChangeEvent} from "react";

import {ImportProgressTracker} from "./ImportProgressTracker";
import {cleanupDefaultTerrainAssets,ImportUtils} from "./ImportUtils";
import {SceneSettings} from "@stem/network/api/scene";
import {createScene, sceneSettingsToCreateRequest} from "@stem/network/api/scene/v2";
import {importAssets, shouldImportAssets} from "@stem/editor-oss/asset-management/import";
import type {ImportProgress} from "../editor/assets/v2/common/ImportProgressDialog";
import global from "../global";
import {showToast} from "@stem/editor-oss/showToast";

interface ImportResult {
    success: boolean;
    sceneId?: string;
    error?: string;
}

interface SceneImportOptions {
    isAdmin?: boolean;
}

//const expandKeyMap = invert(shortKeyMap);

type ProgressCallback = (progress: ImportProgress) => void;

const LOCAL_ASSET_URL_PATTERN = /(localhost|minio)/i;
const IMPORT_ABORT_ERROR_MESSAGE = "The resource specified in the project could not be imported.";
const STEM_ACCESS_ERROR_PATTERN =
    /stem revision is private\/unreleased|not present in the target environment|stem revision is unavailable in this environment|source project cannot be resolved/i;
const PREFAB_REVISION_NOT_FOUND_PATTERN = /Cannot import scene:\s*Prefab revision not found/i;

const formatPrefabRevisionNotFoundError = (rawMessage: string): string => {
    const prefabId = rawMessage.match(/Prefab ID:\s*([^\n]+)/i)?.[1]?.trim();
    const revisionId = rawMessage.match(/Revision ID:\s*([^\n]+)/i)?.[1]?.trim();
    const objectName = rawMessage.match(/Object:\s*([^\n]+)/i)?.[1]?.trim();

    const details = [
        "Cannot import scene: missing prefab revision in this environment.",
        prefabId ? `Prefab ID: ${prefabId}` : "",
        revisionId ? `Revision ID: ${revisionId}` : "",
        objectName ? `Object: ${objectName}` : "",
        "This prefab revision may have been deleted or may not exist in this environment.",
    ].filter(Boolean);

    return details.join("\n");
};

// Import step configuration with weights (must sum to 1.0)
const IMPORT_STEPS = [
    { name: 'Preparing import', weight: 0.03 },        // 3% - Parse JSON + check dependencies
    { name: 'Importing assets', weight: 0.60 },        // 60% - Download + create + derivatives
    { name: 'Uploading legacy assets', weight: 0.30 }, // 30% - Reupload from different server
    { name: 'Saving scene', weight: 0.07 },            // 7% - Save to server
];

const shouldRequestTunnelSetup = (sceneData: any[]): boolean => {
    const assetSerializer = sceneData.find((item: any) => item?.metadata?.generator === "AssetSerializer");
    if (!assetSerializer) {
        return false;
    }

    const revisionUrls = (assetSerializer.revisions || []).map((revision: {dataUrl?: unknown}) => revision?.dataUrl);
    const derivativeUrls = (assetSerializer.derivatives || []).map((derivative: {dataUrl?: unknown}) => derivative?.dataUrl);
    const urls = [...revisionUrls, ...derivativeUrls];

    return urls.some((url) => typeof url === "string" && LOCAL_ASSET_URL_PATTERN.test(url));
};

const normalizeTunnelOrigin = (input: string | null): string | null => {
    if (!input) {
        return null;
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }

    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    try {
        const parsed = new URL(withProtocol);
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return null;
    }
};

const rewriteAssetUrlsToTunnelHost = (sceneData: any[], tunnelOrigin: string): number => {
    const assetSerializer = sceneData.find((item: any) => item?.metadata?.generator === "AssetSerializer");
    if (!assetSerializer) {
        return 0;
    }

    let rewrittenCount = 0;
    const rewriteUrl = (url: unknown): unknown => {
        if (typeof url !== "string" || !LOCAL_ASSET_URL_PATTERN.test(url)) {
            return url;
        }

        try {
            const parsed = new URL(url);
            const newUrl = `${tunnelOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
            rewrittenCount++;
            return newUrl;
        } catch {
            return url;
        }
    };

    assetSerializer.revisions = (assetSerializer.revisions || []).map((revision: any) => ({
        ...revision,
        dataUrl: rewriteUrl(revision?.dataUrl),
    }));

    assetSerializer.derivatives = (assetSerializer.derivatives || []).map((derivative: any) => ({
        ...derivative,
        dataUrl: rewriteUrl(derivative?.dataUrl),
    }));

    return rewrittenCount;
};

const maybePrepareTunnelForImport = (sceneData: any[]): {ok: true} | {ok: false; error: string} => {
    if (!shouldRequestTunnelSetup(sceneData)) {
        return {ok: true};
    }

    const tunnelInput = window.prompt(
        [
            "This import contains localhost/minio asset URLs.",
            "",
            "To set up a remote tunnel so these assets can be imported:",
            "1. Start your local asset server (for example MinIO on port 9000).",
            "2. Run: ngrok http --host-header=rewrite http://localhost:9000",
            "3. Copy the generated URL (example: https://abcd-1234.ngrok-free.app).",
            "",
            "Enter ngrok domain, or leave empty to continue without a tunnel:",
        ].join("\n"),
    );

    // Cancel → abort import
    if (tunnelInput === null) {
        return {ok: false, error: IMPORT_ABORT_ERROR_MESSAGE};
    }

    // Empty string → skip tunnel, proceed with import as-is
    const tunnelOrigin = normalizeTunnelOrigin(tunnelInput);
    if (!tunnelOrigin) {
        return {ok: true};
    }

    rewriteAssetUrlsToTunnelHost(sceneData, tunnelOrigin);
    return {ok: true};
};

/**
 * Dashboard-specific scene import that doesn't require editor context.
 * @param onStart - Called when the file picker resolves with a file.
 * @param onComplete - Called with the result of the import.
 * @param optionsServer - The current server origin, written into the imported scene's OptionsSerializer block.
 * @param onProgress - Progress callback for the import dialog.
 * @param options - Import options (e.g. isAdmin).
 */
export function dashboardSceneImport(
    onStart: () => void,
    onComplete: (result: ImportResult) => void,
    optionsServer: string,
    onProgress?: ProgressCallback,
    options?: SceneImportOptions,
): void {
    let input: HTMLInputElement | null = document.createElement("input");
    input.type = "file";
    input.style.display = "none";
    input.accept = ".json";
    document.body.appendChild(input);

    input.value = "";

    input.onchange = event => {
        if (input) input.onchange = null;
        const inputEvent = event as unknown as ChangeEvent<HTMLInputElement>;

        if (inputEvent.target.files) {
            try {
                onStart();
                const file = inputEvent.target.files[0];

                if (file) {
                    void processImportFile(file, optionsServer, onComplete, onProgress, options);
                } else {
                    onComplete({success: false, error: "No file selected"});
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : "Request failed.";
                showToast({type: "error", body: errorMessage});
                onComplete({success: false, error: errorMessage});
            }
        } else {
            onComplete({success: false, error: "No file selected"});
        }

        // Clean up the input element
        if (input?.parentNode) {
            input.parentNode.removeChild(input);
        }
        input = null;
    };

    input.click();
}

/**
 * Reads the picked file and forwards its contents to {@link processImportFileContent}.
 * @param file - The user-selected JSON file.
 * @param optionsServer - Current server origin, used in OptionsSerializer.
 * @param onComplete - Result callback.
 * @param onProgress - Progress callback for the import dialog.
 * @param options - Import options (e.g. isAdmin).
 */
function processImportFile(
    file: File,
    optionsServer: string,
    onComplete: (result: ImportResult) => void,
    onProgress?: ProgressCallback,
    options?: SceneImportOptions,
): void {
    const reader = new FileReader();
    reader.onload = async event => {
        const fileContent = event.target?.result as string;
        await processImportFileContent(
            fileContent,
            file.name,
            optionsServer,
            onComplete,
            onProgress,
            options,
        );
    };

    reader.onerror = () => {
        onComplete({success: false, error: "Error reading file."});
    };

    reader.readAsText(file);
}

/**
 * Imports a scene JSON payload, reuploading legacy assets and creating a new
 * scene via the v2 createScene flow. Imported scenes always land
 * unpublished and non-public; the user republishes from the editor when ready.
 * @param fileContent - Raw JSON file text.
 * @param fileName - Original file name (used as a scene-name fallback).
 * @param optionsServer - Current server origin, written into OptionsSerializer.
 * @param onComplete - Result callback.
 * @param onProgress - Progress callback for the import dialog.
 * @param options - Import options (e.g. isAdmin).
 */
async function processImportFileContent(
    fileContent: string,
    fileName: string,
    optionsServer: string,
    onComplete: (result: ImportResult) => void,
    onProgress?: ProgressCallback,
    options?: SceneImportOptions,
): Promise<void> {
    // Create progress tracker for overall import progress
    const tracker = new ImportProgressTracker(IMPORT_STEPS);

    // Step 1: Preparing import (parse + check dependencies)
    tracker.setStep(0);
    onProgress?.({
        currentStep: tracker.getCurrentStepName(),
        overallProgress: tracker.getOverallProgress(),
        stepIndicator: tracker.getCurrentStep(),
    });

    // Parse the JSON
    let json: any;
    try {
        json = JSON.parse(fileContent);
        if (!Array.isArray(json)) {
            throw new Error("Invalid file format: Expected an array of objects.");
        }

        //json = expandKeys(json, expandKeyMap);
    } catch (error) {
        console.error("Error while parsing JSON:", error);
        onComplete({success: false, error: "Error parsing JSON file."});
        return;
    }

    // Remove stale default terrain asset URLs before any asset processing.
    // The terrain behavior repopulates local defaults on init.
    cleanupDefaultTerrainAssets(json);

    const tunnelPreparation = maybePrepareTunnelForImport(json);
    if (!tunnelPreparation.ok) {
        onComplete({success: false, error: tunnelPreparation.error});
        return;
    }

    // Process scene settings
    let sceneSettings: SceneSettings = {};
    json.forEach((item: any, index: number) => {
        if (item.sceneSettings) {
            sceneSettings = item.sceneSettings;
            delete item.sceneSettings;
        }

        if (Object.keys(item).length === 0) {
            json.splice(index, 1);
        }
    });

    const sceneJson = json.find((item: any) => item.metadata?.generator === "SceneSerializer");

    // Always reset collaboration mode on import
    sceneSettings.IsCollaborative = false;

    // Determine if this is the same server the scene was exported from.
    const sourceServer = json.find((item: any) => item.metadata?.generator === "OptionsSerializer")?.server;
    const isSameServer = !sourceServer || sourceServer === optionsServer;

    // Determine if we need to import assets or if they already exist.
    let doAssetImport;
    try {
        const userId = global.app?.userId;
        if (!userId) {
            throw new Error("User ID not found.");
        }
        doAssetImport = await shouldImportAssets(isSameServer, json, userId);
    } catch (err) {
        console.error("Error while checking if assets should be imported:", err);
        doAssetImport = true; // Try to import the assets
    }

    if (doAssetImport) {
        // Step 2: Import assets
        tracker.setStep(1);
        console.log("Importing assets...");
        try {
            const oldDependencies = sceneSettings.Dependencies || sceneJson?.userData?.assetResolutionContext?.assetIdToRevisionId || {};
            const { dependencies: newDependencies } = await importAssets(json, oldDependencies, (progress) => {
                // progress.progress is 0-1, convert to 0-100 for step progress
                tracker.setStepProgress(progress.progress * 100);

                onProgress?.({
                    currentStep: progress.currentStep,
                    overallProgress: tracker.getOverallProgress(),
                    stepIndicator: tracker.getCurrentStep(),
                });
            });
            sceneSettings.Dependencies = newDependencies;

            console.log("Done importing assets");
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error("Error while importing assets:", err);

            if (STEM_ACCESS_ERROR_PATTERN.test(errorMessage)) {
                const wantsStemMigration = window.confirm(
                    "This scene includes stems that are not accessible in this environment. " +
                    "Do you want to export those stems from the other environment and import them here?",
                );

                if (!wantsStemMigration) {
                    onComplete({success: false, error: `Error importing assets: ${errorMessage}`});
                    return;
                }

                if (!options?.isAdmin) {
                    onComplete({
                        success: false,
                        error: "Only admins can run stem export/import from another environment. Current import behavior was kept unchanged.",
                    });
                    return;
                }

                onComplete({
                    success: false,
                    error: "Please export the missing stems from the source environment and import them here as your user, then retry the scene import.",
                });
                return;
            }

            if (PREFAB_REVISION_NOT_FOUND_PATTERN.test(errorMessage)) {
                onComplete({
                    success: false,
                    error: formatPrefabRevisionNotFoundError(errorMessage),
                });
                return;
            }

            onComplete({success: false, error: `Error importing assets: ${errorMessage}`});
            return;
        }
    } else {
        // If this is the same server and the user has access to the assets, we
        // don't need to import (copy) them.
        console.log("Skipping asset import - assets already exist.");
        // Mark step as complete
        tracker.setStep(1);
        tracker.setStepProgress(100);
    }

    // Step 3: Upload legacy assets
    tracker.setStep(2);
    let reuploadResult: Awaited<ReturnType<typeof ImportUtils.reuploadAssets>>;
    try {
        reuploadResult = await ImportUtils.reuploadAssets(
            json,
            optionsServer,
            ImportUtils.uploadFile,
            ImportUtils.uploadModel,
            sceneSettings,
            progress => {
                // Update step progress based on sub-progress
                const stepProgress = progress.totalAssets > 0
                    ? progress.processedAssets / progress.totalAssets * 100
                    : 100; // If no assets, mark as complete
                tracker.setStepProgress(stepProgress);

                onProgress?.({
                    currentStep: progress.totalAssets > 0 ? tracker.getCurrentStepName() : "Processing legacy assets...",
                    overallProgress: tracker.getOverallProgress(),
                    stepIndicator: tracker.getCurrentStep(),
                });
            },
        );
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("Error while processing assets:", err);
        onComplete({success: false, error: `Error processing assets: ${errorMessage}`});
        return;
    }

    const processedJson = reuploadResult.sceneData;
    const bannerImage = reuploadResult.bannerImage;
    const uploadedAssets = reuploadResult.uploadedAssets;

    // Note: uploadedAssets contains URLs of all newly uploaded assets
    // This can be used for cleanup if the import fails later
    console.log(`Successfully uploaded ${uploadedAssets.length} assets:`, uploadedAssets);

    const optionsObject = processedJson.find(item => item.metadata?.generator === "OptionsSerializer");
    if (optionsObject) {
        optionsObject.server = optionsServer || optionsObject.server;
    }

    if (bannerImage && "Thumbnail" in sceneSettings) {
        sceneSettings.Thumbnail = bannerImage;
    }

    const serializedScene = JSON.stringify(processedJson);

    // Step 4: Save scene
    tracker.setStep(3);
    onProgress?.({
        currentStep: tracker.getCurrentStepName(),
        overallProgress: tracker.getOverallProgress(),
        stepIndicator: tracker.getCurrentStep(),
    });

    // Imported scenes always land unpublished and non-public — the user
    // republishes from the editor when they're ready.
    const sceneName = sceneSettings.Name || fileName.replace(/\.json$/i, "") || "Imported Scene";
    let created;
    try {
        created = await createScene(serializedScene, sceneSettingsToCreateRequest(sceneSettings, sceneName));
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("Error while saving scene to server:", err);
        onComplete({success: false, error: `Error saving scene to server: ${errorMessage}`});
        return;
    }

    const sceneId = created?.id;
    if (!sceneId) {
        onComplete({
            success: false,
            error: "Import failed: No scene ID returned from server",
        });
        return;
    }

    onComplete({
        success: true,
        sceneId,
    });
}

export const DashboardImportUtils = {
    dashboardSceneImport,
};

export const DashboardImportInternal = {
    normalizeTunnelOrigin,
    shouldRequestTunnelSetup,
    rewriteAssetUrlsToTunnelHost,
};

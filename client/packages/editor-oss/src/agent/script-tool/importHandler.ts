/**
 * Import handler for the script-tool terminal.
 * Opens a native file picker filtered by asset type, then delegates to existing import workflows.
 */

import type {TerminalResult} from "./builtins";
import type {ReadonlyAssetResolutionContext} from "../../asset-management/AssetResolutionContext";
import type {ScriptImportRevisionMap} from "../../script-runtime/scriptImportCore";
import {updateLambdaRegistries} from "../../editor/lambdas/util";
import {showToast} from "../../showToast";
import {isScriptsEnabled} from "../../utils/featureFlags";

export interface ImportTypeConfig {
    description: string;
    accept: Record<string, string[]>;
}

export const IMPORT_TYPES: Record<string, ImportTypeConfig> = {
    model: {
        description: "3D Model files",
        accept: {"model/gltf-binary": [".glb"], "model/gltf+json": [".gltf"], "application/octet-stream": [".fbx", ".obj"], "application/zip": [".zip"]},
    },
    behavior: {
        description: "Behavior YAML files",
        accept: {"text/yaml": [".yaml", ".yml"]},
    },
    lambda: {
        description: "Lambda YAML files",
        accept: {"text/yaml": [".yaml", ".yml"]},
    },
    vfx: {
        description: "VFX configuration files",
        accept: {"text/yaml": [".yaml", ".yml"], "application/json": [".json"]},
    },
    image: {
        description: "Image files",
        accept: {"image/*": [".png", ".jpg", ".jpeg", ".webp", ".svg"]},
    },
    audio: {
        description: "Audio files",
        accept: {"audio/*": [".mp3", ".wav", ".ogg", ".m4a"]},
    },
    video: {
        description: "Video files",
        accept: {"video/*": [".mp4", ".webm"]},
    },
    prefab: {
        description: "Prefab YAML files",
        accept: {"text/yaml": [".yaml", ".yml"]},
    },
    sound: {
        description: "Sound files",
        accept: {"audio/*": [".mp3", ".wav", ".ogg", ".m4a"]},
    },
    script: {
        description: "Script Import (JavaScript helper module, .js or .yaml)",
        accept: {
            "application/javascript": [".js"],
            "text/javascript": [".js"],
            "text/yaml": [".yaml", ".yml"],
        },
    },
    file: {
        description: "Generic data files (JSON, YAML, BIN, plain text, …)",
        accept: {
            "application/json": [".json"],
            "text/yaml": [".yaml", ".yml"],
            "application/octet-stream": [".bin", ".dat"],
            "text/plain": [".txt", ".csv", ".tsv"],
            "text/xml": [".xml"],
        },
    },
};

if (!isScriptsEnabled()) {
    delete IMPORT_TYPES.script;
}

/**
 * Open a file picker for the given asset type and return the selected files.
 * Shows a non-blocking dialog describing the import, then opens the native
 * file picker when the user clicks "Select File". This preserves the user
 * activation required by browsers for the picker API.
 * @param type
 * @param message
 */
async function pickFiles(type: string, message?: string): Promise<File[]> {
    const config = IMPORT_TYPES[type];
    if (!config) {
        throw new Error(`Unknown import type: ${type}. Valid types: ${Object.keys(IMPORT_TYPES).join(", ")}`);
    }

    return new Promise((resolve, reject) => {
        // ── Overlay ────────────────────────────────────────────────
        const overlay = document.createElement("div");
        Object.assign(overlay.style, {
            position: "fixed", inset: "0",
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: "100000",
            fontFamily: "system-ui, -apple-system, sans-serif",
        } as CSSStyleDeclaration);

        const dialog = document.createElement("div");
        Object.assign(dialog.style, {
            background: "#1e1e2e", color: "#cdd6f4",
            borderRadius: "12px", padding: "24px",
            minWidth: "340px", maxWidth: "480px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        } as CSSStyleDeclaration);

        const heading = document.createElement("h3");
        heading.textContent = `Import ${type}`;
        Object.assign(heading.style, {margin: "0 0 8px", fontSize: "16px", fontWeight: "600"});

        const desc = document.createElement("p");
        desc.textContent = message || `Please select ${config.description.toLowerCase()}.`;
        Object.assign(desc.style, {margin: "0 0 16px", fontSize: "13px", color: "#a6adc8"});

        const btnRow = document.createElement("div");
        Object.assign(btnRow.style, {display: "flex", gap: "10px", justifyContent: "flex-end"});

        const cleanup = () => {
            document.removeEventListener("keydown", onKey);
            overlay.remove();
        };

        // ── Skip button ────────────────────────────────────────────
        const skipBtn = document.createElement("button");
        skipBtn.textContent = "Skip";
        Object.assign(skipBtn.style, {
            background: "#585b70", color: "#cdd6f4", border: "none",
            borderRadius: "6px", padding: "8px 16px", cursor: "pointer",
            fontSize: "13px", fontWeight: "500",
        } as CSSStyleDeclaration);
        skipBtn.onclick = () => { cleanup(); reject(new Error("AbortError")); };

        // ── Select File button (click provides user gesture) ──────
        const selectBtn = document.createElement("button");
        selectBtn.textContent = "Select File";
        Object.assign(selectBtn.style, {
            background: "#89b4fa", color: "#1e1e2e", border: "none",
            borderRadius: "6px", padding: "8px 16px", cursor: "pointer",
            fontSize: "13px", fontWeight: "500",
        } as CSSStyleDeclaration);
        selectBtn.onclick = async () => {
            try {
                if (typeof window !== "undefined" && "showOpenFilePicker" in window) {
                    const handles = await (window as any).showOpenFilePicker({
                        types: [{description: config.description, accept: config.accept}],
                        multiple: type === "model",
                    });
                    const files = await Promise.all(
                        (handles as FileSystemFileHandle[]).map(handle => handle.getFile()),
                    );
                    cleanup();
                    if (files.length === 0) reject(new Error("No files selected"));
                    else resolve(files);
                    return;
                }

                const input = document.createElement("input");
                input.type = "file";
                input.accept = Object.values(config.accept).flat().join(",");
                input.multiple = type === "model";
                input.onchange = () => {
                    const files = Array.from(input.files || []);
                    cleanup();
                    if (files.length === 0) reject(new Error("No files selected"));
                    else resolve(files);
                };
                input.oncancel = () => { cleanup(); reject(new Error("AbortError")); };
                input.click();
            } catch (error: unknown) {
                cleanup();
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        };

        btnRow.append(skipBtn, selectBtn);
        dialog.append(heading, desc, btnRow);
        overlay.append(dialog);
        document.body.append(overlay);

        // Close on Escape
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { cleanup(); reject(new Error("AbortError")); }
        };
        document.addEventListener("keydown", onKey);
    });
}

export interface ImportHandlerResult extends TerminalResult {
    /** The selected file, if any — used by callers to pass to processImportedFile. */
    file?: File;
    /** Additional files selected alongside the main model file (e.g. .bin, textures for .gltf). */
    companionFiles?: File[];
}

/**
 * Handle import for a specific asset type.
 * Opens a file picker, returns the selected file and info.
 * The caller is responsible for calling processImportedFile() with the returned file.
 * @param type
 * @param message
 */
export async function handleImport(type: string, message?: string): Promise<ImportHandlerResult> {
    if (!IMPORT_TYPES[type]) {
        return {
            output: `Unknown import type: "${type}"\nValid types: ${Object.keys(IMPORT_TYPES).join(", ")}`,
            status: "error",
        };
    }

    try {
        const files = await pickFiles(type, message);
        const names = files.map(f => f.name).join(", ");
        const msgSuffix = message ? ` (${message})` : "";

        return {
            output: `Selected ${files.length} file(s): ${names}\nImport workflow for "${type}"${msgSuffix} started.`,
            status: "success",
            file: files[0],
            companionFiles: files.slice(1),
        };
    } catch (e) {
        const errMessage = e instanceof Error ? e.message : String(e);
        const errName = e instanceof Error ? e.name : "";
        if (errMessage === "AbortError" || errName === "AbortError") {
            const label = message ? `${type} (${message})` : type;
            showToast({
                type: "warning",
                title: "Import skipped",
                body: `Skipped importing ${label}. The game may not work correctly without this asset.`,
            });
            return {output: `Import skipped: ${label}. The game may not work correctly without this asset.`, status: "info"};
        }
        return {output: `Import error: ${errMessage}`, status: "error"};
    }
}

/**
 * Get flat array of file extensions for a given import type.
 * @param type
 */
export function getExtensionsForType(type: string): string[] {
    const config = IMPORT_TYPES[type];
    if (!config) return [];
    return Object.values(config.accept).flat();
}

/**
 * Get list of supported import types.
 */
export function getSupportedImportTypes(): string[] {
    return Object.keys(IMPORT_TYPES);
}

/**
 * Process an imported file through the real import workflow.
 * Handles uploading, registering, and loading the asset depending on type.
 *
 * All heavy dependencies are dynamically imported to avoid breaking the test
 * environment (ScriptExecutor.test.ts imports this module transitively).
 * @param file
 * @param type
 * @param name
 * @param companionFiles
 */
export type ProcessImportedFileOptions = {
    /** Batch import optimization: caller will flush behavior scene sync once after the batch. */
    deferBehaviorSceneSync?: boolean;
    /** Batch import optimization: caller pre-resolved script import names after script assets imported. */
    scriptImportContext?: ReadonlyAssetResolutionContext;
    /** Batch import optimization: shared cache of fetched script import revision sources. */
    scriptImportRevisionMap?: ScriptImportRevisionMap;
};

type ImportPhaseTimingEntry = {
    type: string;
    label: string;
    phase: string;
    ms: number;
    success: boolean;
    message?: string;
};

const recordImportPhaseTiming = (entry: ImportPhaseTimingEntry): void => {
    const root = globalThis as typeof globalThis & {
        __stemImportPhaseTimings?: ImportPhaseTimingEntry[];
    };
    root.__stemImportPhaseTimings ??= [];
    root.__stemImportPhaseTimings.push(entry);
};

const timeImportPhase = async <T>(
    type: string,
    label: string,
    phase: string,
    task: () => Promise<T>,
): Promise<T> => {
    const start = performance.now();
    try {
        const result = await task();
        recordImportPhaseTiming({
            type,
            label,
            phase,
            ms: Math.round(performance.now() - start),
            success: true,
        });
        return result;
    } catch (error) {
        recordImportPhaseTiming({
            type,
            label,
            phase,
            ms: Math.round(performance.now() - start),
            success: false,
            message: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
};

const loadProcessImportedFileDeps = () => Promise.all([
    import("../../global"),
    import("../../asset-management/AssetResolutionContext"),
    import("@stem/network/api/asset"),
    import("../../editor/asset-management/hooks/assets"),
]);

let processImportedFileDepsPromise: ReturnType<typeof loadProcessImportedFileDeps> | undefined;

const getProcessImportedFileDeps = () => {
    processImportedFileDepsPromise ??= loadProcessImportedFileDeps();
    return processImportedFileDepsPromise;
};

const loadModelImportDeps = () => Promise.all([
    import("../../model/createModelWithData"),
    import("../../model/convertToGlb"),
    import("../../editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/utils/cleanupInvalidTextures"),
    import("../../model/loadModelFromFile"),
    import("../../model/util"),
]);

let modelImportDepsPromise: ReturnType<typeof loadModelImportDeps> | undefined;

const getModelImportDeps = () => {
    modelImportDepsPromise ??= loadModelImportDeps();
    return modelImportDepsPromise;
};

const getModelFileDedupKey = (file: File): string => {
    const relativePath = file.webkitRelativePath || "";
    const identity = relativePath || file.name;
    return `file:${identity}:${file.size}:${file.lastModified || 0}:${file.type || ""}`;
};

const loadBehaviorImportDeps = () => Promise.all([
    import("../../editor/assets/v2/AssetsLibrary/exportImportUtils"),
    import("../../editor/behaviors/util"),
    import("@stem/network/api/asset"),
]);

let behaviorImportDepsPromise: ReturnType<typeof loadBehaviorImportDeps> | undefined;

const getBehaviorImportDeps = () => {
    behaviorImportDepsPromise ??= loadBehaviorImportDeps();
    return behaviorImportDepsPromise;
};

export async function processImportedFile(
    file: File,
    type: string,
    name?: string,
    companionFiles?: File[],
    /**
     * For `behavior` imports: the logical id the surrounding stemscript will
     * use to reference this behavior (from `conversion-manifest.json`).
     * StemStudio-exported behavior YAMLs carry an internal hash `config.id`,
     * but the generated stemscript's `behavior attach behaviorId=…` uses the
     * manifest's logical id. Without this override the two never match and
     * the behavior is imported but never attached to any object.
     */
    behaviorIdOverride?: string,
    /**
     * Run-scoped cache keyed by source-file content hash → the asset created for
     * it. A stemscript that places the same model many times (e.g. pirate-ship's
     * 77 `import model … filepath=models/rocks-a.glb`) otherwise creates a fresh
     * multi-MB inline asset per placement. With this cache, identical source
     * bytes import once and every later placement reuses that one asset (a new
     * scene object still gets created per placement). Pass the same Map for an
     * entire import batch; omit it for one-off imports.
     */
    modelAssetDedupCache?: Map<string, {id: string; headRevisionId: string}>,
    options: ProcessImportedFileOptions = {},
): Promise<{success: boolean; message: string}> {
    // Dynamic imports to keep module resolution lightweight for tests
    const [{default: global}, {setAssetRevision, resolveAssetRevisionId, getAssetResolutionContext}, {AssetType, ModelFormat, createAssetRevisionWithData, isNoChangesError, getAsset}, {createAsset}] = await getProcessImportedFileDeps();

    const app = global.app;
    const editor = app?.editor;
    const scene = app?.scene;

    if (!editor || !scene) {
        return {success: false, message: "Editor not available"};
    }

    try {
        switch (type) {
            case "behavior": {
                const [
                    {importBehaviorFile},
                    {createBehavior, createBehaviorRevision},
                    {getOssAssetsForProject, unregisterOssAsset},
                ] = await timeImportPhase("behavior", name || file.name, "deps", getBehaviorImportDeps);
                const {config, code} = await timeImportPhase("behavior", name || file.name, "importBehaviorFile", () =>
                    importBehaviorFile(file),
                );
                // Re-key the behavior to the id the stemscript references it
                // by (see `behaviorIdOverride` doc above). The override
                // becomes `originalConfigId`, so the behavior registers and
                // aliases under the id `behavior attach` will look up.
                if (behaviorIdOverride && config.id !== behaviorIdOverride) {
                    config.id = behaviorIdOverride;
                }
                const originalConfigId = config.id;
                const behaviorLabel = config.name || name || file.name;

                // Idempotent: create new revision if behavior already exists.
                // Look up by YAML config.id first, then fall back to a unique
                // name match. After a page reload the YAML-id alias may be
                // gone and only the server-assigned 24-char asset ID remains.
                let existingBhvConfig = await timeImportPhase("behavior", behaviorLabel, "existing-lookup", async () => {
                    let existing = editor.behaviorConfigRegistry?.getConfig(originalConfigId);
                    if (!existing && editor.behaviorConfigRegistry) {
                        const nameMatches = editor.behaviorConfigRegistry
                            .getAllConfigs()
                            .filter(c => c.name === config.name);
                        if (nameMatches.length === 1) {
                            existing = nameMatches[0]!;
                        } else if (nameMatches.length > 1) {
                            // Avoid non-deterministic updates when multiple assets share a name.
                            // Fall through to create a new asset so script alias stays deterministic.
                            console.warn(
                                `[ScriptImport] Multiple behaviors named "${config.name}" found; ` +
                                `skipping name fallback for alias "${originalConfigId}"`,
                            );
                        }
                    }
                    return existing;
                });
                let survivorAssetId: string | undefined;
                let resultMessage = `Behavior "${config.name}" imported`;
                if (existingBhvConfig) {
                    const assetId = existingBhvConfig.id || originalConfigId;
                    // Always fetch the asset's actual HEAD revision to avoid stale-parent 409s
                    let headRevisionId: string;
                    try {
                        headRevisionId = await timeImportPhase("behavior", behaviorLabel, "getAssetHead", async () =>
                            (await getAsset(assetId)).headRevisionId,
                        );
                    } catch (err) {
                        // We matched this asset in the scene's behavior configs, so
                        // it exists — a getAsset failure here is unexpected. Falling
                        // back to the scene-pinned revision silently risks building
                        // a revision on a STALE parent (the merge-on-stale path can
                        // then drop the user's first edit). Surface it loudly; the
                        // pinned revision is only a last resort, not a quiet default.
                        console.error(
                            `[ScriptImport] getAsset("${assetId}") failed while resolving HEAD for ` +
                            `behavior "${config.name}"; falling back to scene-pinned revision. ` +
                            `A stale parent here can drop the next edit.`,
                            err,
                        );
                        const context = getAssetResolutionContext(scene);
                        headRevisionId = (context ? resolveAssetRevisionId(assetId, context) : undefined) as string;
                    }
                    if (headRevisionId) {
                        config.id = assetId;
                        const aliasId = originalConfigId !== assetId ? originalConfigId : undefined;

                        await timeImportPhase("behavior", behaviorLabel, "createBehaviorRevision", () =>
                            createBehaviorRevision({
                                assetId,
                                parentRevisionId: headRevisionId,
                                code,
                                config,
                                assetSource: global.app?.editor?.assetSource,
                                aliasId,
                                deferSceneSync: options.deferBehaviorSceneSync,
                                scriptImportContext: options.scriptImportContext,
                                scriptImportRevisionMap: options.scriptImportRevisionMap,
                                retryOnConflict: true,
                            }),
                        );
                        survivorAssetId = assetId;
                        resultMessage = `Behavior "${config.name}" updated (new revision)`;
                    }
                }

                if (!survivorAssetId) {
                    const newBehavior = await timeImportPhase("behavior", behaviorLabel, "createBehavior", () =>
                        createBehavior({
                            assetSource: global.app?.editor?.assetSource,
                            name: config.name,
                            code,
                            config,
                            aliasId: originalConfigId !== config.name ? originalConfigId : undefined,
                            deferSceneSync: options.deferBehaviorSceneSync,
                            scriptImportContext: options.scriptImportContext,
                            scriptImportRevisionMap: options.scriptImportRevisionMap,
                        }),
                    );
                    survivorAssetId = newBehavior.id;
                    resultMessage = `Behavior "${config.name}" imported (${newBehavior.id})`;
                }

                // De-duplicate behavior imports by name. The local asset store
                // has only the latest version, so earlier imports of the same
                // behavior leave orphan records that clutter the Behaviors panel.
                await timeImportPhase("behavior", behaviorLabel, "dedupeRecords", async () => {
                    const projectId = editor.sceneID;
                    if (projectId) {
                        const configRegistry = editor.behaviorConfigRegistry;
                        const scriptRegistry = editor.behaviorScriptRegistry;
                        const dupes = getOssAssetsForProject(projectId).filter(r =>
                            r.type === AssetType.Behavior &&
                            r.name === config.name &&
                            r.assetId !== survivorAssetId &&
                            r.assetId !== originalConfigId,
                        );
                        for (const dup of dupes) {
                            unregisterOssAsset(dup.assetId);
                            configRegistry?.unregisterConfig(dup.assetId, true);
                            scriptRegistry?.unregisterScript(dup.assetId, true);
                        }
                        if (dupes.length) {
                            console.info(
                                `[ScriptImport] dedup: collapsed ${dupes.length} duplicate ` +
                                `"${config.name}" behavior record(s) into ${survivorAssetId}`,
                            );
                        }
                    }
                });

                return {success: true, message: resultMessage};
            }

            case "lambda": {
                const {importLambdaFile} = await import("../../editor/assets/v2/AssetsLibrary/exportImportUtils");
                const {config, code} = await importLambdaFile(file);
                const originalConfigId = config.id;

                // Idempotent: create new revision if lambda already exists.
                // Look up by YAML config.id first, then fall back to a unique
                // name match (the YAML-id alias may be lost after reload).
                let existingLambdaMeta = editor.lambdaConfigRegistry?.getAssetMeta(originalConfigId);
                if (!existingLambdaMeta && editor.lambdaConfigRegistry) {
                    const allConfigs = editor.lambdaConfigRegistry.getAllConfigs();
                    const nameMatches = allConfigs.filter(c => c.name === config.name);
                    if (nameMatches.length === 1) {
                        existingLambdaMeta = editor.lambdaConfigRegistry.getAssetMeta(nameMatches[0]!.id);
                    } else if (nameMatches.length > 1) {
                        console.warn(
                            `[ScriptImport] Multiple lambdas named "${config.name}" found; ` +
                            `skipping name fallback for alias "${originalConfigId}"`,
                        );
                    }
                }
                if (existingLambdaMeta) {
                    const lambdaAssetId = existingLambdaMeta.assetId;

                    const registerLambda = (revisionId: string) => {
                        const meta = {assetId: lambdaAssetId, revisionId};
                        updateLambdaRegistries({lambdaId: originalConfigId, config, assetMeta: meta});
                        if (originalConfigId !== lambdaAssetId) {
                            // YAML config.id alias differs from server asset id —
                            // register under both so lookups by either id resolve.
                            updateLambdaRegistries({lambdaId: lambdaAssetId, config, assetMeta: meta});
                        }
                    };

                    // Always fetch the asset's actual HEAD revision to avoid stale-parent 409s
                    let headRevisionId: string;
                    try {
                        headRevisionId = (await getAsset(lambdaAssetId)).headRevisionId;
                    } catch {
                        headRevisionId = existingLambdaMeta.revisionId;
                    }

                    const createRevision = async (parentId: string) =>
                        createAssetRevisionWithData({
                            assetId: lambdaAssetId,
                            parentRevisionId: parentId,
                            data: JSON.stringify({config: JSON.stringify(config), code}),
                            format: "json",
                            contentType: "application/json",
                        });

                    try {
                        const newRevision = await createRevision(headRevisionId);
                        setAssetRevision(scene, lambdaAssetId, newRevision.id);
                        app?.call("objectChanged", null, scene);
                        registerLambda(newRevision.id);
                        return {success: true, message: `Lambda "${config.name}" updated (new revision)`};
                    } catch (revisionErr) {
                        if (isNoChangesError(revisionErr)) {
                            registerLambda(existingLambdaMeta.revisionId);
                            return {success: true, message: `Lambda "${config.name}" not modified`};
                        }
                        // Retry once on 409 Conflict (stale parent race condition)
                        if ((revisionErr as {statusCode?: number})?.statusCode === 409) {
                            const freshHead = (await getAsset(lambdaAssetId)).headRevisionId;
                            const newRevision = await createRevision(freshHead);
                            setAssetRevision(scene, lambdaAssetId, newRevision.id);
                            app?.call("objectChanged", null, scene);
                            registerLambda(newRevision.id);
                            return {success: true, message: `Lambda "${config.name}" updated (new revision, retried)`};
                        }
                        throw revisionErr;
                    }
                }

                const newLambda = await createAsset({
                    assetSource: app?.editor?.assetSource,
                    type: AssetType.Lambda,
                    name: config.name,
                    data: JSON.stringify({config: JSON.stringify(config), code}),
                    format: "json",
                    contentType: "application/json",
                });
                const newLambdaMeta = {assetId: newLambda.id, revisionId: newLambda.headRevisionId};
                updateLambdaRegistries({lambdaId: originalConfigId, config, assetMeta: newLambdaMeta});
                if (originalConfigId !== newLambda.id) {
                    // YAML config.id alias differs from server asset id —
                    // register under both so lookups by either id resolve.
                    updateLambdaRegistries({lambdaId: newLambda.id, config, assetMeta: newLambdaMeta});
                }
                return {success: true, message: `Lambda "${config.name}" imported (${newLambda.id})`};
            }

            case "model": {
                if (file.size === 0) {
                    return {success: false, message: `Model file "${file.name}" is 0 bytes — the file is empty or was not downloaded correctly. Skipping import.`};
                }
                const modelName = name || file.name.replace(/\.[^.]+$/, "");
                const [
                    {createModelWithData},
                    {convertToGlb},
                    {cleanupInvalidTextures},
                    {loadModelFromFile, AnimationOnlyModelError},
                    {setModelId, setModelRevisionId},
                ] = await timeImportPhase("model", modelName, "deps", getModelImportDeps);

                // Idempotent: skip re-import if model already exists in scene
                const existingModel = await timeImportPhase("model", modelName, "existing-check", async () => scene.getObjectByName(modelName));
                if (existingModel) {
                    return {success: true, message: `Model "${modelName}" already in scene, skipping re-import`};
                }

                // Batch dedup. If the same resolved source file is imported more
                // than once, reuse that asset and just place a new scene object —
                // skipping the whole load/convert/texture-bake pipeline AND
                // avoiding a duplicate multi-MB inline asset.
                let modelDedupKey: string | undefined;
                let sourceFileBuffer: ArrayBuffer | undefined;
                if (modelAssetDedupCache) {
                    modelDedupKey = getModelFileDedupKey(file);
                    const cached = modelAssetDedupCache.get(modelDedupKey);
                    if (cached) {
                        await timeImportPhase("model", modelName, "dedup-place", async () => {
                            setAssetRevision(scene, cached.id, cached.headRevisionId);
                            const {loadModel} = await import("../../model/load-util");
                            const context = scene.userData?.assetResolutionContext || {};
                            const object = await loadModel(cached.id, context);
                            if (name) object.name = name;
                            editor.addObject(object);
                            app?.call("objectChanged", null, scene);
                        });
                        return {success: true, message: `Model "${modelName}" placed (reused shared asset ${cached.id})`};
                    }
                }

                await timeImportPhase("model", modelName, "source-buffer", async () => {
                    sourceFileBuffer = await file.arrayBuffer();
                }).catch(() => {
                    sourceFileBuffer = undefined;
                });

                const abortController = new AbortController();
                const abortSignal = abortController.signal;

                // 1. Load model into Three.js (needed for thumbnail + texture cleanup)
                let model;
                let loadedFormat: string | undefined;
                let loadedRootFile: File | Blob | undefined;
                let loadedAtlas: unknown;
                let loadedTextureOverrides: unknown;
                try {
                    // Sniff the real container. A model import can be EITHER a
                    // ZIP archive bundling model + textures (e.g. pirate-ship's
                    // `.glb` files are actually `PK\x03\x04` zips) OR a raw
                    // model file (`.glb`/`.gltf`/`.fbx`/`.obj`, e.g. 100-cars,
                    // 3d-chess). Hardcoding "application/zip" here forced JSZip
                    // onto raw files, which threw "Can't find end of central
                    // directory" and silently dropped every non-zipped model
                    // from the scene. Detect by magic bytes so both shapes work.
                    const head = new Uint8Array(await timeImportPhase("model", modelName, "sniff", async () =>
                        sourceFileBuffer
                            ? sourceFileBuffer.slice(0, 4)
                            : await file.slice(0, 4).arrayBuffer(),
                    ));
                    const isZipArchive =
                        head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
                    ({
                        model,
                        format: loadedFormat,
                        rootFile: loadedRootFile,
                        atlasData: loadedAtlas,
                        textureOverrides: loadedTextureOverrides,
                    } = await timeImportPhase("model", modelName, "loadModelFromFile", () =>
                        loadModelFromFile(
                            file,
                            abortSignal,
                            companionFiles,
                            isZipArchive ? "application/zip" : "",
                            sourceFileBuffer,
                        ),
                    ));
                } catch (loadErr) {
                    if (loadErr instanceof AnimationOnlyModelError) {
                        return {success: true, message: `Skipped "${modelName}": This file contains only animations (no 3D geometry). Animation files should be imported via the Animation Combiner tool.`};
                    }
                    throw loadErr;
                }

                // 2. Fix broken textures (especially FBX)
                await timeImportPhase("model", modelName, "cleanupInvalidTextures", () => cleanupInvalidTextures(model));

                // 3. Produce the GLB buffer to store.
                // Fast path: a self-contained GLB source (no atlas, no loose
                // texture remapping) is already a valid GLB — reuse its bytes
                // and skip the GLTFExporter round-trip. `convertToGlb` here runs
                // with empty options, so for GLB sources it would only re-encode
                // the same data. The exporter is the dominant synchronous cost
                // per model; skipping it for the common all-GLB asset pack case
                // is what keeps large imports (e.g. 100+ models) from blocking
                // the main thread for many minutes. FBX/OBJ/gltf-with-loose-
                // textures/atlas still need the exporter to normalize into one
                // GLB, so they take the fallback.
                let sourceGlbBuffer: ArrayBuffer;
                if (loadedFormat === "glb" && !loadedAtlas && !loadedTextureOverrides && loadedRootFile) {
                    sourceGlbBuffer = await timeImportPhase("model", modelName, "sourceGlbBuffer", async () =>
                        loadedRootFile === file && sourceFileBuffer
                            ? sourceFileBuffer
                            : await loadedRootFile.arrayBuffer(),
                    );
                } else {
                    sourceGlbBuffer = await timeImportPhase("model", modelName, "convertToGlb", () => convertToGlb(model, abortSignal, {}));
                }

                const modelLods: never[] = [];
                const thumbnailParam = undefined;

                // 6. Upload with LODs and thumbnail
                const asset = await timeImportPhase("model", modelName, "createModelWithData", () =>
                    createModelWithData({
                        name: modelName,
                        blob: sourceGlbBuffer,
                        format: ModelFormat.Glb,
                        contentType: "model/gltf-binary",
                        assetSource: global.app?.editor?.assetSource,
                        lods: modelLods,
                        thumbnail: thumbnailParam,
                    }),
                );
                if (modelAssetDedupCache && modelDedupKey) {
                    modelAssetDedupCache.set(modelDedupKey, {id: asset.id, headRevisionId: asset.headRevisionId});
                }
                await timeImportPhase("model", modelName, "placeModel", async () => {
                    setAssetRevision(scene, asset.id, asset.headRevisionId);
                    setModelId(model, asset.id);
                    setModelRevisionId(model, asset.headRevisionId);
                    if (name) model.name = name;
                    editor.addObject(model);
                    app?.call("objectChanged", null, scene);
                });
                return {success: true, message: `Model "${modelName}" imported and added to scene (${asset.id})`};
            }

            case "sound":
            case "audio":
            case "image":
            case "video": {
                // "sound" is an alias for "audio"
                const resolvedType = type === "sound" ? "audio" : type;
                const assetTypeMap = {
                    audio: AssetType.Audio,
                    image: AssetType.Image,
                    video: AssetType.Video,
                } as const;
                // Server-supported format/contentType pairs
                const SUPPORTED_MEDIA: Record<string, Record<string, string>> = {
                    audio: {mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", wav: "audio/wav"},
                    image: {png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml"},
                    video: {mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime"},
                };
                const ext = file.name.split(".").pop()?.toLowerCase() || "";
                const supported = SUPPORTED_MEDIA[resolvedType] || {};
                if (!supported[ext]) {
                    return {success: false, message: `Unsupported ${resolvedType} format ".${ext}". Supported: ${Object.keys(supported).join(", ")}`};
                }
                if (file.size === 0) {
                    return {success: false, message: `${resolvedType} file "${file.name}" is 0 bytes — the file is empty or was not downloaded correctly. Skipping import.`};
                }
                const assetName = name || file.name;

                // Check for existing asset with same name to avoid duplicates on re-import.
                // Scoped to the active editor context (scene or stem dependency graph) via AssetSource.
                const contextAssetSource = app?.editor?.assetSource;
                if (contextAssetSource) {
                    const {assets: existingAssets} = await contextAssetSource.getAssets({types: [assetTypeMap[resolvedType]]});
                    const existing = existingAssets?.find((a: {name: string}) => a.name === assetName);
                    if (existing) {
                        return {success: true, message: `${type} "${assetName}" already exists (${existing.id}), skipping re-import`};
                    }
                }

                const asset = await createAsset({
                    assetSource: app?.editor?.assetSource,
                    type: assetTypeMap[resolvedType],
                    name: assetName,
                    data: file,
                    format: ext,
                    contentType: supported[ext],
                });
                return {success: true, message: `${type} "${assetName}" uploaded (${asset.id})`};
            }

            case "script": {
                if (!isScriptsEnabled()) {
                    return {success: false, message: "Script import asset support is disabled."};
                }
                if (file.size === 0) {
                    return {success: false, message: `Script file "${file.name}" is 0 bytes — the file is empty or was not downloaded correctly. Skipping import.`};
                }

                // Accept either raw .js files (filename → logical id, no description)
                // or a StemStudio YAML envelope that carries {name, description, code}.
                const ext = file.name.split(".").pop()?.toLowerCase() || "";
                let code: string;
                let importName: string;
                let description: string | undefined;
                if (ext === "yaml" || ext === "yml") {
                    const {importImportFile} = await import("../../editor/assets/v2/AssetsLibrary/exportImportUtils");
                    const parsed = await importImportFile(file);
                    code = parsed.code;
                    importName = name || parsed.config.name;
                    description = parsed.config.description;
                } else {
                    code = await file.text();
                    importName = name || file.name.replace(/\.[^.]+$/, "");
                }

                // Resolve dependencies for the @import graph so the asset is
                // registered with the same metadata the editor would attach
                // when authoring an import asset through the UI.
                const [{buildNameAwareScriptImportContext, getScriptImportDependencyMap}, {seedScriptDependencyEntry}] = await Promise.all([
                    import("../../script-runtime/scriptImportCore"),
                    import("../../script-runtime/scriptDependencyCache"),
                ]);
                const sceneContext = scene.userData?.assetResolutionContext;
                const importContext = await buildNameAwareScriptImportContext(editor.sceneID, sceneContext);
                const dependencies = getScriptImportDependencyMap(code, importContext);

                // Idempotent: if a script import asset with the same name already
                // exists in the editor context (scene or stem), append a new
                // revision instead of duplicating. Scoped via AssetSource.
                const scriptAssetSource = app?.editor?.assetSource;
                if (!scriptAssetSource) {
                    return {success: false, message: "No active editing context (scene or stem) for script import."};
                }
                const {assets: existingAssets} = await scriptAssetSource.getAssets({types: [AssetType.Script]});
                const existing = existingAssets?.find((a: {name: string}) => a.name === importName);
                if (existing) {
                    try {
                        const headRevisionId = (await getAsset(existing.id)).headRevisionId;
                        const revision = await createAssetRevisionWithData({
                            assetId: existing.id,
                            parentRevisionId: headRevisionId,
                            data: JSON.stringify({code}),
                            format: "json",
                            contentType: "application/json",
                            options: {dependencies},
                        });
                        seedScriptDependencyEntry({
                            assetId: existing.id,
                            revisionId: revision.id,
                            ownerType: "import",
                            dependencies,
                        });
                        setAssetRevision(scene, existing.id, revision.id);
                        if (description && description !== existing.description) {
                            const {updateAsset} = await import("@stem/network/api/asset");
                            try {
                                await updateAsset({assetId: existing.id, description});
                            } catch (err) {
                                console.warn(`[ScriptImport] Failed to update description for "${importName}":`, err);
                            }
                        }
                        return {success: true, message: `Script import "${importName}" updated (new revision)`};
                    } catch (err) {
                        if (isNoChangesError(err)) {
                            return {success: true, message: `Script import "${importName}" not modified`};
                        }
                        throw err;
                    }
                }

                const newImport = await createAsset({
                    assetSource: app?.editor?.assetSource,
                    type: AssetType.Script,
                    name: importName,
                    data: JSON.stringify({code}),
                    format: "json",
                    contentType: "application/json",
                    options: {dependencies, ...(description ? {description} : {})},
                });
                seedScriptDependencyEntry({
                    assetId: newImport.id,
                    revisionId: newImport.headRevisionId,
                    ownerType: "import",
                    dependencies,
                });
                setAssetRevision(scene, newImport.id, newImport.headRevisionId);
                return {success: true, message: `Script import "${importName}" imported (${newImport.id})`};
            }

            case "file": {
                // Generic data file (JSON / YAML / BIN / TXT / XML / …) used by
                // behaviors via `this.erth.asset.file.getUrl(ref)`. Mirrors the
                // audio/image/video case but uses AssetType.File and a permissive
                // extension/content-type map (no on-import parsing).
                const FILE_CONTENT_TYPES: Record<string, string> = {
                    json: "application/json",
                    yaml: "text/yaml",
                    yml:  "text/yaml",
                    bin:  "application/octet-stream",
                    dat:  "application/octet-stream",
                    txt:  "text/plain",
                    csv:  "text/csv",
                    tsv:  "text/tab-separated-values",
                    xml:  "text/xml",
                };
                const ext = file.name.split(".").pop()?.toLowerCase() || "";
                const contentType = FILE_CONTENT_TYPES[ext] || file.type || "application/octet-stream";
                if (file.size === 0) {
                    return {success: false, message: `File "${file.name}" is 0 bytes — the file is empty or was not downloaded correctly. Skipping import.`};
                }
                const assetName = name || file.name;

                // Idempotent: if a file asset with the same name is already present
                // in the active editor context, skip re-import.
                const fileAssetSource = app?.editor?.assetSource;
                if (fileAssetSource) {
                    const {assets: existingAssets} = await fileAssetSource.getAssets({types: [AssetType.File]});
                    const existing = existingAssets?.find((a: {name: string}) => a.name === assetName);
                    if (existing) {
                        return {success: true, message: `file "${assetName}" already exists (${existing.id}), skipping re-import`};
                    }
                }

                const asset = await createAsset({
                    assetSource: app?.editor?.assetSource,
                    type: AssetType.File,
                    name: assetName,
                    data: file,
                    format: ext || "bin",
                    contentType,
                });
                return {success: true, message: `file "${assetName}" uploaded (${asset.id})`};
            }

            case "vfx":
            case "prefab":
                return {success: true, message: `Skipped "${type}" import — requires specialized parsing.`};

            default:
                return {success: false, message: `Unknown import type: ${type}`};
        }
    } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        const msg = rawMsg.length > 1024 ? rawMsg.slice(0, 1024) + '...' : rawMsg;
        return {success: false, message: `Import failed for ${type} "${file.name}": ${msg}`};
    }
}

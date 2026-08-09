/**
 * Local replacement for the cloud `saveScene` flow. Installed by
 * `bootstrap.ts` when the persistence singleton is registered. Routes
 * every editor save through the active `ProjectStore` — IndexedDB or File
 * System Access — instead of POSTing to the cloud Scene API.
 *
 * The handler mirrors the cloud flow's high-level shape (read-only guard,
 * copilot preview block, stem-editor redirect, `sceneSaveStart` /
 * `sceneSaved` / `sceneSaveFailed` events, optional toast) while replacing
 * cloud persistence with the local ProjectStore.
 */

import {getOssAssetsForProject} from "@stem/network/api/asset";
import type {Scene} from "three";

import {
    getActiveCopilotPreviewPersistence,
    isCopilotPreviewSceneSaveBlocked,
} from "../agent/copilotPreviewPersistence";
import {saveStemEditor} from "../editor/stem-editor/saveStemEditor";
import Converter from "../serialization/Converter";
import global from "../global";
import {showToast} from "../showToast";
import {restoreEditorPreviewGeometryBudget} from "../utils/editorPreviewGeometryBudget";
import {restoreEditorPreviewInstancingBudget} from "../utils/editorPreviewInstancingBudget";

import {getProjectStore, isCurrentProjectStore} from "./projectStoreFactory";
import type {ProjectBody, ProjectMeta, StoredAsset} from "./types";

type QueuedSave = {
    createThumbnail: boolean;
    shouldShowToast: boolean;
    waiters: Array<{resolve: () => void; reject: (error: unknown) => void}>;
};

let activeSave: Promise<void> | null = null;
let queuedSave: QueuedSave | null = null;
let activeSaveToken: {discarded: boolean} | null = null;

/** Marks the active local autosave stale without blocking the mode transition. */
export function discardOssSave(): void {
    if (activeSaveToken) activeSaveToken.discarded = true;
}

/**
 * Persist the binary local assets (models, images, audio) a project depends
 * on into the active ProjectStore. The asset registry synthesizes these as in-memory
 * `data:` URLs with no asset service behind them; without this the scene
 * JSON's model references would dangle after a reload. A failure here means
 * the scene was saved but its binary assets were NOT — a reload would show a
 * scene with missing models. That is a real save failure, so this throws and
 * the caller surfaces it instead of reporting a clean "Saved".
 */
function collectProjectAssets(projectId: string): StoredAsset[] {
    const splitDataUrl = (url: string): {contentType?: string; base64: string} => {
        // `data:<mime>;base64,<payload>` → {mime, payload}
        const comma = url.indexOf(",");
        if (comma < 0) return {base64: url};
        const header = url.slice(5, comma); // skip "data:"
        const semi = header.indexOf(";");
        const mime = semi >= 0 ? header.slice(0, semi) : header;
        return {contentType: mime || undefined, base64: url.slice(comma + 1)};
    };
    return getOssAssetsForProject(projectId)
        .filter(record => record.dataUrl)
        .map(record => {
            const main = splitDataUrl(record.dataUrl!);
            const thumb = record.thumbnailDataUrl ? splitDataUrl(record.thumbnailDataUrl) : undefined;
            return {
                assetId: record.assetId,
                revisionId: record.revisionId,
                type: record.type,
                format: record.format,
                name: record.name,
                contentType: record.contentType,
                metadata: record.metadata,
                data: main.base64,
                ...(thumb ? {thumbnailData: thumb.base64, thumbnailContentType: thumb.contentType} : {}),
            };
        });
}

/**
 * Build a minimal stable project id when the editor doesn't have one yet
 * (first save of a new local project). Format: `oss-<timestamp>-<rand>`
 * stays unique enough for local-only storage without bringing in a UUID dep.
 */
function generateOSSProjectId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `oss-${ts}-${rand}`;
}

/**
 * Serialize the live editor state and persist it via the registered
 * `ProjectStore`. Wired into `network/scene/setSceneSaveHandler` by the
 * local bootstrap so existing `saveScene(...)` call sites work unchanged.
 */
async function runOssSaveScene(
    _createThumbnail: boolean,
    shouldShowToast: boolean,
    token: {discarded: boolean},
): Promise<void> {
    const app = global.app;
    const editor = app?.editor;
    if (!app || !editor) {
        if (shouldShowToast) showToast({type: "error", title: "Cannot save — editor not ready."});
        return;
    }

    // Read-only inspection mode parity with the cloud flow.
    if (editor.isReadOnly) {
        console.warn("ossSaveScene: ignored — editor is in read-only inspection mode");
        return;
    }

    if (isCopilotPreviewSceneSaveBlocked()) {
        const preview = getActiveCopilotPreviewPersistence();
        console.warn("ossSaveScene: ignored — Copilot temporary preview is active", preview);
        app.call("copilotPreviewSaveBlocked", null, preview);
        return;
    }

    if (app.scene?.userData?.stemEditor) {
        await saveStemEditor();
        return;
    }

    const store = getProjectStore();
    if (store.kind === "remote" || !store.commitProject) {
        const error = new Error("Local ProjectStore does not support atomic project commits");
        app.call("sceneSaveFailed");
        throw error;
    }
    const scene = app.scene;
    const sceneUserData = scene.userData;
    const sceneUuid = scene.uuid;
    const initialSceneId = editor.sceneID;
    const id = initialSceneId || generateOSSProjectId();
    // Snapshot the asset registry before the first await so one operation
    // cannot mix a scene from one project with assets from another.
    const assets = collectProjectAssets(id);

    app.call("sceneSaveStart");

    let experience: unknown;
    let sceneJson: string;
    const editTimestamp = new Date(sceneUserData?.lastEditTime ?? Date.now()).getTime();
    const saveWatermark = Number.isFinite(editTimestamp) ? editTimestamp : Date.now();
    // Editor preview budgets replace live geometry/counts for responsiveness.
    // Serialization must always observe authored data, then restore the
    // preview policy after the JSON snapshot is complete.
    const canRestorePreview = typeof (scene as {traverse?: unknown}).traverse === "function";
    try {
        if (canRestorePreview) {
            restoreEditorPreviewInstancingBudget(scene as unknown as Scene);
            restoreEditorPreviewGeometryBudget(scene as unknown as Scene);
        }
        editor.onSaveScene();
        experience = new (Converter as unknown as new () => {toJSON: (opts: unknown) => unknown})().toJSON({
            options: app.options,
            camera: app.camera,
            scripts: app.scripts,
            scene,
        });
        sceneJson = JSON.stringify(experience);
    } catch (err) {
        console.error("ossSaveScene: serialization failed", err);
        if (shouldShowToast) showToast({type: "error", title: "Save failed — could not serialize scene."});
        app.call("sceneSaveFailed");
        throw err;
    } finally {
        if (canRestorePreview) editor.refreshEditorPreviewInstancingBudget?.();
    }

    // Don't Save may have been chosen while serialization was in progress.
    // Resolve the autosave as intentionally discarded before touching storage.
    if (token.discarded) return;

    const now = new Date().toISOString();
    // Editor doesn't track `sceneCreatedAt` directly; the ProjectStore
    // implementations (IndexedDB / FS Access) preserve the existing
    // `createdAt` on update and only stamp it on first save.
    const body: ProjectBody = {
        meta: {
            id,
            name: editor.sceneName ?? "Untitled",
            updatedAt: now,
            createdAt: now,
            thumbnailUrl: editor.sceneThumbnail || undefined,
        },
        sceneJson,
    };

    // The committed scene carries the captured edit watermark. Local stores
    // publish this project record only after its asset generation is durable.
    if (Array.isArray(experience)) {
        const serializedScene = experience.find(
            entry => entry && typeof entry === "object" && (entry as {uuid?: string}).uuid === sceneUuid,
        ) as {userData?: Record<string, unknown>} | undefined;
        if (serializedScene) {
            serializedScene.userData ??= {};
            serializedScene.userData.lastSaveTime = saveWatermark;
        }
    }

    let saved: ProjectMeta;
    try {
        saved = await store.commitProject({...body, sceneJson: JSON.stringify(experience)}, assets);
    } catch (err) {
        console.error("ossSaveScene: atomic local project commit failed", err);
        if (shouldShowToast) showToast({type: "error", title: "Save failed — previous project kept."});
        app.call("sceneSaveFailed");
        throw err;
    }

    const contextIsCurrent =
        global.app === app &&
        app.editor === editor &&
        app.scene === scene &&
        scene.uuid === sceneUuid &&
        scene.userData === sceneUserData &&
        isCurrentProjectStore(store) &&
        (editor.sceneID === initialSceneId || (!initialSceneId && !editor.sceneID));
    if (!contextIsCurrent) {
        const error = new Error("Save completed for a project that is no longer active");
        console.warn("ossSaveScene: refusing to mark switched scene/store as saved");
        app.call("sceneSaveFailed");
        throw error;
    }

    if (!editor.sceneID) editor.sceneID = saved.id;
    sceneUserData.lastSaveTime = saveWatermark;

    if (shouldShowToast) {
        showToast({type: "success", title: "Saved"});
    }
    app.call("sceneSaved", null, saved);
}

function startQueuedSave(request: QueuedSave): void {
    const token = {discarded: false};
    activeSaveToken = token;
    const operation = runOssSaveScene(request.createThumbnail, request.shouldShowToast, token);
    activeSave = operation;
    void operation
        .then(
            () => request.waiters.forEach(waiter => waiter.resolve()),
            error => request.waiters.forEach(waiter => waiter.reject(error)),
        )
        .finally(() => {
            if (activeSave === operation) activeSave = null;
            if (activeSaveToken === token) activeSaveToken = null;
            const next = queuedSave;
            queuedSave = null;
            if (next) startQueuedSave(next);
        });
}

/**
 * Serialize local saves and coalesce any requests that arrive while a write
 * is active into one follow-up snapshot. This prevents two File System or
 * IndexedDB operations from racing and lets the follow-up include edits made
 * during the first save.
 */
export function ossSaveScene(createThumbnail: boolean, shouldShowToast: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (activeSave) {
            queuedSave ??= {createThumbnail: false, shouldShowToast: false, waiters: []};
            queuedSave.createThumbnail ||= createThumbnail;
            queuedSave.shouldShowToast ||= shouldShowToast;
            queuedSave.waiters.push({resolve, reject});
            return;
        }
        startQueuedSave({createThumbnail, shouldShowToast, waiters: [{resolve, reject}]});
    });
}

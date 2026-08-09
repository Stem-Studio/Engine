import {
    AssetResolutionContext,
    emptyAssetResolutionContext,
    getAssetResolutionContext,
    setAssetResolutionContext,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {cloneJsonCompatible} from "@stem/editor-oss/utils/cloneJsonCompatible";
import type {PerspectiveCamera} from "three";

import Converter from "../../../../serialization/Converter";

export type CopilotPreviewStatus =
    | "capturing-base"
    | "previewing"
    | "applying"
    | "ready"
    | "rejected"
    | "accepted"
    | "failed";

export type CopilotSceneState = "confirmed" | "dirty" | "previewing" | "rejected" | "accepted";

export type CopilotValidationStatus = "pending" | "pass" | "warn" | "fail";

export type CopilotValidationResult = {
    id: string;
    label: string;
    status: CopilotValidationStatus;
    detail?: string;
};

export type CopilotChangedAssetRef = {
    assetId: string;
    revisionId?: string | null;
    kind?: "scene" | "model" | "texture" | "animation" | "sound" | "behavior" | "lambda" | "other";
};

export type CopilotPreviewSnapshot = {
    id: string;
    capturedAt: string;
    sceneJson: unknown[];
    baseSceneId: string | null;
    baseSceneAssetId: string | null;
    baseRevisionId: string | null;
    baseVersionLabel: string;
    sceneName: string;
    assetResolutionContext: {
        logicalIdToAssetId: Record<string, string>;
        assetIdToRevisionId: Record<string, string>;
        nameToAssetId: Record<string, string>;
    };
};

export type SerializedCopilotPreviewAssetResolutionContext = CopilotPreviewSnapshot["assetResolutionContext"];

export type CopilotPreviewSession = {
    previewId: string;
    status: CopilotPreviewStatus;
    baseSceneId: string | null;
    baseRevisionId: string | null;
    baseVersionLabel: string;
    startedAt: string;
    lastAppliedAt: string | null;
    summary: string;
    affectedSystems: string[];
    validationResults: CopilotValidationResult[];
    changedAssetRefs: CopilotChangedAssetRef[];
    snapshot: CopilotPreviewSnapshot;
};

export type CopilotPreviewState = {
    sceneState: CopilotSceneState;
    session: CopilotPreviewSession | null;
    lastSession: CopilotPreviewSession | null;
};

export type StartPreviewSessionOptions = {
    summary?: string;
    affectedSystems?: string[];
};

export type CopilotPreviewAction =
    | {type: "previewStarted"; session: CopilotPreviewSession}
    | {type: "statusChanged"; status: CopilotPreviewStatus; at?: string}
    | {type: "summaryChanged"; summary: string}
    | {type: "affectedSystemsChanged"; affectedSystems: string[]}
    | {type: "validationResultsChanged"; validationResults: CopilotValidationResult[]}
    | {type: "changedAssetRefsChanged"; changedAssetRefs: CopilotChangedAssetRef[]}
    | {type: "previewAccepted"; at?: string}
    | {type: "previewRejected"; at?: string}
    | {type: "previewCleared"; sceneState: CopilotSceneState}
    | {type: "reset"};

export const initialCopilotPreviewState: CopilotPreviewState = {
    sceneState: "confirmed",
    session: null,
    lastSession: null,
};

export const deriveBaseVersionLabel = (revisionId?: string | null): string => {
    if (!revisionId) return "Unsaved Draft";
    return "Current Version";
};

export const getPreviewDisplayLabel = (session: CopilotPreviewSession | null): string => {
    if (!session) return "Current Version";
    return `Preview from ${session.baseVersionLabel}`;
};

export const isPreviewActive = (state: CopilotPreviewState): boolean => {
    const status = state.session?.status;
    return status === "capturing-base" || status === "previewing" || status === "applying" || status === "ready";
};

export const isCopilotPreviewMutationCommand = (command: unknown): boolean => {
    if (typeof command !== "string") return false;
    if (command.startsWith("get_") || command.startsWith("list_") || command.startsWith("search_")) return false;

    return command !== "create_project_task"
        && command !== "update_project_task"
        && command !== "delete_project_task";
};

const cloneRecord = (record?: Readonly<Record<string, string>>): Record<string, string> => ({...(record ?? {})});

const createId = (prefix: string): string => {
    const suffix = Math.random().toString(36).slice(2, 9);
    return `${prefix}-${Date.now()}-${suffix}`;
};

export const captureCopilotPreviewSnapshot = (app: EngineRuntime): CopilotPreviewSnapshot => {
    const editor = app.editor;
    const sceneJson = new (Converter as any)().toJSON({
        options: app.options,
        camera: app.camera,
        scripts: app.scripts,
        scene: app.scene,
    }) as unknown[];
    const assetResolutionContext = app.scene
        ? getAssetResolutionContext(app.scene) ?? emptyAssetResolutionContext
        : emptyAssetResolutionContext;
    const baseRevisionId = editor?.sceneRevisionId ?? null;

    return {
        id: createId("preview-snapshot"),
        capturedAt: new Date().toISOString(),
        sceneJson,
        baseSceneId: editor?.sceneID ?? null,
        baseSceneAssetId: editor?.sceneAssetId ?? null,
        baseRevisionId,
        baseVersionLabel: deriveBaseVersionLabel(baseRevisionId),
        sceneName: editor?.sceneName ?? "Untitled Scene",
        assetResolutionContext: {
            logicalIdToAssetId: cloneRecord(assetResolutionContext.logicalIdToAssetId),
            assetIdToRevisionId: cloneRecord(assetResolutionContext.assetIdToRevisionId),
            nameToAssetId: cloneRecord(assetResolutionContext.nameToAssetId),
        },
    };
};

export const createCopilotPreviewSession = (
    app: EngineRuntime,
    options: StartPreviewSessionOptions = {},
): CopilotPreviewSession => {
    const snapshot = captureCopilotPreviewSnapshot(app);
    const now = new Date().toISOString();

    return {
        previewId: createId("copilot-preview"),
        status: "previewing",
        baseSceneId: snapshot.baseSceneId,
        baseRevisionId: snapshot.baseRevisionId,
        baseVersionLabel: snapshot.baseVersionLabel,
        startedAt: now,
        lastAppliedAt: null,
        summary: options.summary ?? "",
        affectedSystems: options.affectedSystems ?? [],
        validationResults: [],
        changedAssetRefs: [],
        snapshot,
    };
};

const cloneSceneJson = (sceneJson: unknown[]): unknown[] => {
    if (typeof structuredClone === "function") {
        return structuredClone(sceneJson);
    }
    return cloneJsonCompatible(sceneJson);
};

export const createCopilotPreviewSnapshotFromSceneJson = (
    session: CopilotPreviewSession,
    sceneJson: unknown[],
    assetResolutionContext: SerializedCopilotPreviewAssetResolutionContext,
): CopilotPreviewSnapshot => ({
    ...session.snapshot,
    id: `${session.snapshot.id}:preview`,
    capturedAt: new Date().toISOString(),
    sceneJson: cloneSceneJson(sceneJson),
    assetResolutionContext: {
        logicalIdToAssetId: cloneRecord(assetResolutionContext.logicalIdToAssetId),
        assetIdToRevisionId: cloneRecord(assetResolutionContext.assetIdToRevisionId),
        nameToAssetId: cloneRecord(assetResolutionContext.nameToAssetId),
    },
});

const copyCameraState = (app: EngineRuntime, camera: PerspectiveCamera | undefined): void => {
    if (!camera) return;

    app.camera.position.copy(camera.position);
    app.camera.quaternion.copy(camera.quaternion);
    app.camera.up.copy(camera.up);

    if (typeof camera.fov === "number") app.camera.fov = camera.fov;
    if (typeof camera.near === "number") app.camera.near = camera.near;
    if (typeof camera.far === "number") app.camera.far = camera.far;
    app.camera.updateProjectionMatrix();
};

export const restoreCopilotPreviewSnapshot = async (
    app: EngineRuntime,
    snapshot: CopilotPreviewSnapshot,
): Promise<void> => {
    if (!app.editor) {
        throw new Error("Editor is not initialized.");
    }

    const assetResolutionContext: AssetResolutionContext = {
        logicalIdToAssetId: {...snapshot.assetResolutionContext.logicalIdToAssetId},
        assetIdToRevisionId: {...snapshot.assetResolutionContext.assetIdToRevisionId},
        nameToAssetId: {...snapshot.assetResolutionContext.nameToAssetId},
    };
    const result = await new (Converter as any)().fromJson(cloneSceneJson(snapshot.sceneJson), {
        camera: app.camera,
        server: app.options.server,
        domWidth: app.renderer?.domElement?.width,
        domHeight: app.renderer?.domElement?.height,
        assetResolutionContext,
        assetLoader: app.assetLoader,
    });

    if (result?.options) {
        Object.assign(app.options, result.options);
        app.call("optionsChanged", app);
    }
    if (result?.scripts) {
        app.scripts = result.scripts;
        app.call("scriptChanged", app);
    }
    if (result?.camera) {
        copyCameraState(app, result.camera);
    }
    if (!result?.scene) {
        throw new Error("Snapshot did not contain a restorable scene.");
    }

    setAssetResolutionContext(result.scene, assetResolutionContext);
    await app.editor.setScene(result.scene, true);
    app.call("sceneGraphChanged", app);
    app.call("restartRenderer", app);
    app.call("sceneLoaded", app);
};

const updateActiveSession = (
    state: CopilotPreviewState,
    update: (session: CopilotPreviewSession) => CopilotPreviewSession,
): CopilotPreviewState => {
    if (!state.session) return state;
    return {
        ...state,
        session: update(state.session),
    };
};

const getSceneStateForStatus = (
    status: CopilotPreviewStatus,
    currentSceneState: CopilotSceneState,
): CopilotSceneState => {
    if (status === "accepted") return "accepted";
    if (status === "rejected") return "rejected";
    if (status === "failed") return "dirty";
    if (status === "capturing-base" || status === "previewing" || status === "applying" || status === "ready") {
        return "previewing";
    }
    return currentSceneState;
};

export const copilotPreviewReducer = (
    state: CopilotPreviewState,
    action: CopilotPreviewAction,
): CopilotPreviewState => {
    switch (action.type) {
        case "previewStarted":
            return {
                sceneState: "previewing",
                session: action.session,
                lastSession: state.lastSession,
            };
        case "statusChanged": {
            const nextState = updateActiveSession(state, session => ({
                ...session,
                status: action.status,
                lastAppliedAt: action.status === "applying" || action.status === "ready"
                    ? action.at ?? new Date().toISOString()
                    : session.lastAppliedAt,
            }));
            return {
                ...nextState,
                sceneState: getSceneStateForStatus(action.status, state.sceneState),
            };
        }
        case "summaryChanged":
            return updateActiveSession(state, session => ({
                ...session,
                summary: action.summary,
            }));
        case "affectedSystemsChanged":
            return updateActiveSession(state, session => ({
                ...session,
                affectedSystems: action.affectedSystems,
            }));
        case "validationResultsChanged":
            return updateActiveSession(state, session => ({
                ...session,
                validationResults: action.validationResults,
            }));
        case "changedAssetRefsChanged":
            return updateActiveSession(state, session => ({
                ...session,
                changedAssetRefs: action.changedAssetRefs,
            }));
        case "previewAccepted": {
            if (!state.session) return state;
            return {
                sceneState: "confirmed",
                session: null,
                lastSession: {
                    ...state.session,
                    status: "accepted",
                    lastAppliedAt: action.at ?? new Date().toISOString(),
                },
            };
        }
        case "previewRejected": {
            if (!state.session) return state;
            return {
                sceneState: "confirmed",
                session: null,
                lastSession: {
                    ...state.session,
                    status: "rejected",
                    lastAppliedAt: action.at ?? new Date().toISOString(),
                },
            };
        }
        case "previewCleared":
            return {
                sceneState: action.sceneState,
                session: null,
                lastSession: state.session,
            };
        case "reset":
            return initialCopilotPreviewState;
        default:
            return state;
    }
};

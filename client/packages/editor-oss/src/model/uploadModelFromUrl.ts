import {Object3D} from "three";

import { convertToGlb } from './convertToGlb';
import {createModelWithData} from "./createModelWithData";
import { createLods } from './load-util';
import { loadModelFromFile } from './loadModelFromFile';
import {ModelFormat, SUPPORTED_MODEL_CONTENT_TYPES} from "@stem/network/api/asset";
import {saveScene} from "@stem/network/api/scene";
import {
    DEFAULT_UPLOAD_SETTINGS,
    THUMBNAIL_SIZE,
} from "../editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/constants";
import {UploadSettings} from "../editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/types";
import global from "../global";
import Converter from "../utils/Converter";
import {ModelUtils} from "../utils/ModelUtils";
import {backendUrlFromPath} from "../utils/UrlUtils";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {IS_OSS} from "../mode/buildMode";

export type UploadModelFromUrlParams = {
    /** URL of the model to upload (e.g., from Meshy/Tripo CDN) */
    url: string;
    /** Name for the uploaded model */
    name: string;
    /** Upload settings including sceneId for scene association */
    settings?: Partial<UploadSettings>;
    /** Abort signal for cancellation */
    signal?: AbortSignal;
};

export type UploadModelFromUrlResult = {
    /** Asset ID in the new asset system */
    assetId: string;
    /** Revision ID of the uploaded asset */
    revisionId: string;
    /** Loaded Three.js object, ready to add to scene */
    object: Object3D;
};

/**
 * Upload a model from a URL with LOD creation, texture compression, and scene association.
 *
 * This utility is used for AI-generated models (Meshy, Tripo) where we receive a URL
 * from the generation service and need to:
 * 1. Fetch the model
 * 2. Load it into Three.js
 * 3. Create LOD levels for performance
 * 4. Compress textures
 * 5. Generate thumbnail
 * 6. Upload to the asset API with optional scene association
 *
 * @param params - Upload parameters
 * @returns Promise with asset info and loaded Three.js object
 */
export const uploadModelFromUrl = async (params: UploadModelFromUrlParams): Promise<UploadModelFromUrlResult> => {
    const {url, name, settings = {}, signal} = params;
    const uploadSettings = {...DEFAULT_UPLOAD_SETTINGS, ...settings};
    const abortSignal = signal || new AbortController().signal;

    // 1. Fetch the model bytes.
    //
    // The integrated build proxies external CDN downloads through the Go
    // server's `/api/Proxy/Download` to dodge CORS. This OSS build ships no
    // such proxy (the desktop ai-server only fronts provider APIs), so both
    // playground and desktop fetch the provider CDN URL directly — relying on
    // that CDN sending permissive CORS headers (Meshy/Tripo/Rodin CDNs).
    let blob: Blob;
    if (isPlaygroundMode() || IS_OSS) {
        const direct = await fetch(url, {signal: abortSignal});
        if (!direct.ok) {
            throw new Error(`Failed to fetch model: ${direct.statusText}`);
        }
        blob = await direct.blob();
    } else {
        const proxyUrl = backendUrlFromPath("/api/Proxy/Download");
        const response = await fetch(proxyUrl!, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({url}),
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch model: ${response.statusText}`);
        }
        blob = await response.blob();
    }
    const file = new File([blob], `${name}.glb`, {type: "model/gltf-binary"});

    // 2. Load model
    const {model} = await loadModelFromFile(file, abortSignal);
    abortSignal.throwIfAborted();

    // 3. Convert to GLB
    const sourceGlbBuffer = await convertToGlb(model, abortSignal, {});
    abortSignal.throwIfAborted();
    // 4. Create LODs
    const modelLods = await createLods(sourceGlbBuffer, file.name, uploadSettings, abortSignal);
    abortSignal.throwIfAborted();

    // 5. Generate thumbnail
    const thumbnailUrl = await ModelUtils.createThumbnailFromModel(model, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const thumbnailFile = Converter.dataURLtoFile(thumbnailUrl, "thumbnail");

    // 6. Upload asset (with scene association if sceneId provided)
    const contentType = SUPPORTED_MODEL_CONTENT_TYPES[ModelFormat.Glb][0];
    const modelBlob = new Blob([sourceGlbBuffer], {type: "model/gltf-binary"});

    // Use the same function as useModelUploader to ensure consistent behavior
    const asset = await createModelWithData({
        name,
        blob: modelBlob,
        format: ModelFormat.Glb,
        contentType,
        thumbnail: {
            file: thumbnailFile,
            width: THUMBNAIL_SIZE,
            height: THUMBNAIL_SIZE,
        },
        lods: modelLods,
        assetSource: uploadSettings.assetSource,
    });
    abortSignal.throwIfAborted();

    console.log("Uploaded model and LODs to asset server, asset ID:", asset.id);

    // Save scene and fire events
    await saveScene(false, false);
    global.app?.call("finishedModelUpload");
    global.app?.call("fetchModels");

    return {
        assetId: asset.id,
        revisionId: asset.headRevisionId,
        object: model,
    };
};

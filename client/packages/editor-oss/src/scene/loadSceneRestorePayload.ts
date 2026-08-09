import type {
    DomainSceneDto,
    DomainSceneMetadataDto,
} from "@stem/network/api/client/api";
import {getScene as getSceneV2} from "@stem/network/api/scene/v2";

export type SceneRestorePayload = {
    data: unknown;
    metadata: {
        Dependencies: DomainSceneMetadataDto["dependencies"];
        LogicalIDToAssetID: DomainSceneMetadataDto["logicalIdToAssetId"];
    };
};

/**
 * Reload the durable OSS scene snapshot used when leaving Play mode.
 *
 * The v2 scene adapter is the ProjectStore-backed load seam in OSS builds:
 * it restores IndexedDB/filesystem assets and exposes the stored scene JSON
 * as a data URL. Requiring that URL keeps Play -> Edit restoration local and
 * prevents an accidental fallback to the legacy remote Go load endpoint.
 */
export async function loadSceneRestorePayload(
    sceneId: string,
    fetchImpl: typeof fetch = fetch,
): Promise<SceneRestorePayload> {
    const scene = await getSceneV2(sceneId, {
        includeDerivatives: true,
        includeDerivativeDataUrl: true,
    });
    return readSceneRestorePayload(scene, fetchImpl);
}

async function readSceneRestorePayload(
    scene: DomainSceneDto,
    fetchImpl: typeof fetch,
): Promise<SceneRestorePayload> {
    const revision = scene.asset.revision;
    const payloadUrl = revision.dataUrl;
    if (!payloadUrl) {
        throw new Error(`Local scene ${scene.id} has no stored scene payload.`);
    }

    const response = await fetchImpl(payloadUrl);
    if (!response.ok) {
        throw new Error(`Failed to read local scene ${scene.id} (${response.status}).`);
    }

    return {
        data: await response.json(),
        metadata: {
            Dependencies: revision.metadata.dependencies,
            LogicalIDToAssetID: revision.metadata.logicalIdToAssetId,
        },
    };
}

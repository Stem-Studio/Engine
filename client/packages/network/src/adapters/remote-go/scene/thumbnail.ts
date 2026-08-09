import Ajax from "@web-shared/utils/Ajax";
import {backendUrlFromPath} from "@web-shared/utils/UrlUtils";

/**
 * Uploads an image file and updates the scene's Thumbnail metadata.
 * Returns the uploaded thumbnail URL.
 * @param sceneId
 * @param sceneName
 * @param file
 */
export async function uploadSceneThumbnail(sceneId: string, sceneName: string, file: File): Promise<string> {
    // 1. Upload file to /api/Upload
    const uploadResponse = await Ajax.post({
        url: backendUrlFromPath(`/api/Upload`),
        data: {file},
        msgBodyType: "multipart",
    });
    const uploadResult = uploadResponse?.data;
    if (uploadResult?.Code !== 200 || !uploadResult?.Data?.url) {
        throw new Error(uploadResult?.Msg || "Upload failed");
    }

    const thumbnailUrl = uploadResult.Data.url as string;

    // 2. Update scene metadata
    await updateSceneThumbnail(sceneId, sceneName, thumbnailUrl);

    return thumbnailUrl;
}

/**
 * Updates the scene's Thumbnail field with an already-uploaded URL.
 * Use this when the file has already been uploaded (e.g. via UploadField).
 */
/**
 * Lazy migration: if the scene has a bannerImage in userData but no Thumbnail
 * in MongoDB, backfill the Thumbnail field.
 * @param sceneId
 * @param sceneName
 * @param sceneThumbnail
 * @param bannerImage
 */
export async function migrateSceneThumbnailIfNeeded(
    sceneId: string,
    sceneName: string,
    sceneThumbnail: string | null | undefined,
    bannerImage: string | undefined,
): Promise<void> {
    if (sceneThumbnail) return;
    if (!bannerImage) return;

    try {
        await updateSceneThumbnail(sceneId, sceneName, bannerImage);
        console.log(`[thumbnail-migration] Backfilled Thumbnail for scene ${sceneId}`);
    } catch (e) {
        console.warn(`[thumbnail-migration] Failed to migrate thumbnail for scene ${sceneId}:`, e);
    }
}

/**
 *
 * @param sceneId
 * @param sceneName
 * @param thumbnailUrl
 */
export async function updateSceneThumbnail(_sceneId: string, _sceneName: string, _thumbnailUrl: string): Promise<void> {
    // Scene metadata lives in the local ProjectStore. Callers reflect the
    // thumbnail into `editor.sceneConfig.sceneThumbnail`, which persists through
    // the local save path.
}

/**
 * Toggles the scene's AiPromptMode flag. When true, the editor will launch
 * the scene in non-advanced (AI-focused) layout on future opens unless the
 * browser has a project-specific advanced-mode preference. Switching the
 * editor into advanced mode on such a scene should call this with
 * `enabled: false` so the scene reverts to regular behavior.
 *
 * /api/Scene/Edit requires Name — pass the scene's current name through.
 */
export async function setSceneAiPromptMode(
    _sceneId: string,
    _sceneName: string,
    _enabled: boolean,
): Promise<void> {
    // AI prompt mode is stored with the local project body, not a remote scene
    // metadata endpoint.
}

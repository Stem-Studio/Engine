import {PLACEHOLDER_PREFIX, resolvePlaceholderIdentifier} from "../editor/assets/v2/CreateDashboard/GameOverview/placeholderThumbnails";
import {backendUrlFromPath} from "./UrlUtils";

export const getThumbnail = (thumbnailUrl: string) => {
    if (thumbnailUrl === "null" || thumbnailUrl === "undefined" || !thumbnailUrl) return undefined;

    if (thumbnailUrl.startsWith(PLACEHOLDER_PREFIX)) {
        return resolvePlaceholderIdentifier(thumbnailUrl) ?? undefined;
    }

    return thumbnailUrl
        ? thumbnailUrl.includes("data:image") || thumbnailUrl.includes("src/editor")
            ? thumbnailUrl
            : backendUrlFromPath(thumbnailUrl)
        : undefined;
};

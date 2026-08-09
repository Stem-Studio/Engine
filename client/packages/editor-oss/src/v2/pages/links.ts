import {ROUTES} from "@web-shared/routes";
import {isPlaygroundMode} from "@web-shared/playgroundMode";

export type PlaygroundSceneMode = "edit" | "play";

/** Keep the scene name readable while making it safe as a URL label. */
export const sceneNameSlug = (name?: string | null, fallback = "scene") => {
    const slug = (name || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return slug || fallback;
};

export const generatePlaygroundSceneLink = (
    projectId: string,
    sceneName: string | null | undefined,
    mode: PlaygroundSceneMode,
) => {
    const path = ROUTES.CREATE_PROJECT_WITH_MODE
        .replace(":projectID", encodeURIComponent(projectId))
        .replace(":mode", mode);
    const query = new URLSearchParams();
    if (isPlaygroundMode()) {
        query.set("mode", "playground");
        query.set("scene", sceneNameSlug(sceneName, projectId));
    }
    return `${path}${query.toString() ? `?${query.toString()}` : ""}`;
};

/** Replace the current editor URL without remounting the scene. */
export const syncPlaygroundSceneRoute = (
    projectId: string | null | undefined,
    sceneName: string | null | undefined,
    mode: PlaygroundSceneMode,
) => {
    if (!projectId || !isPlaygroundMode()) return;
    const next = generatePlaygroundSceneLink(projectId, sceneName, mode);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== next) {
        window.history.replaceState(window.history.state, "", next);
        // React Router does not observe replaceState by itself. Notify the
        // mounted Playground route owner so a stale `/play` route param cannot
        // re-enter Play after an explicit user stop to `/edit`.
        window.dispatchEvent(new Event("stem:playground-route"));
    }
};

export const getGameUrl = (sceneID: string, slug: string | null) => {
    if (slug) {
        return `${slug}.${process.env.REACT_APP_DNS_SUFFIX?.replace(/^https?:\/\//, "") || "localhost"}`;
    }
    return ROUTES.PLAY.replace(":projectID", encodeURIComponent(sceneID));
};

export const generateProjectLink = (projectId?: string, options?: {readOnly?: boolean}) => {
    const params = new URLSearchParams(window.location.search);
    const hasFTUE = params.get("ftue");
    const builderMode = params.get("builder");

    if (!projectId) {
        return ROUTES.CREATE_PROJECT;
    }

    const query = new URLSearchParams();
    if (hasFTUE) query.set("ftue", "true");
    // The blank-game route creates an ID and then navigates to the canonical
    // project route. Preserve an explicit Builder Studio intent across that
    // redirect so Quick Build/Mesh CAD/BIM Plan does not disappear while the
    // scene finishes loading (particularly on landscape mobile).
    if (builderMode) query.set("builder", builderMode);
    if (options?.readOnly) query.set("readOnly", "1");

    const qs = query.toString();
    return `${ROUTES.CREATE_PROJECT}/${projectId}${qs ? `?${qs}` : ""}`;
};

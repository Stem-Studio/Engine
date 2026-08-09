import { useEffect, useState } from "react";
import { Toaster, toast } from "toastywave";

import {getScene} from "@stem/network/api/scene/v2";
import {useAuthorizationContext} from "../../../context";
import EngineRuntime, { ApplicationMode } from "../../../EngineRuntime";
import global from "../../../global";
import {useRewardReferralTracking} from "../../../hooks/useRewardReferralTracking";
import {PlayerMobileOrientationOverlay} from "@web-shared/player/component/PlayerMobileOrientationOverlay";
import PlayerViewport from "@web-shared/player/component/PlayerViewport";
import {PlayerWatermark} from "@web-shared/player/component/PlayerWatermark";
import { StemStudioLoader } from "../../../ui";
import { AppUpdateManager } from "../../../update/AppUpdateManager";
import { OfflineIndicator } from "../../../update/OfflineIndicator";
import {isInDiscordEnvironment} from "../../../userManagement/playerProfile/discordEnvironment";
import CSPMetaTag, { customCSPPolicies } from "../../../utils/CSPMetaTag";
import {
    DEFAULT_ORIENTATION_POLICY,
    normalizeOrientationPolicy,
    type OrientationPolicy,
} from "../../../utils/orientationPolicy";
import { getSceneLoadErrorDetails } from "../../../utils/SceneLoadErrorUtils";
import { getGameUrl } from "../links";
import { PlayerTopNav } from "./PlayerTopNav";


const getProjectIdFromLocation = () => {
    const splitPath = window.location.pathname.split("/").filter(Boolean);
    return splitPath[0] === "play" ? splitPath[1] : undefined;
};

const getQueryString = (name: string) => {
    const reg = new RegExp("(^|&)" + name + "=([^&]*)(&|$)", "i");
    const r = window.location.search.substr(1).match(reg);
    if (r !== null) {
        return unescape(r[2]!);
    }
    return null;
};

export const Player = () => {
    const projectID = getProjectIdFromLocation() || getQueryString("sceneID") || undefined;
    useRewardReferralTracking(projectID);
    let currentUsername = getQueryString("username");
    const app = global?.app as EngineRuntime | undefined;
    const {isInitializingAuth, dbUser} = useAuthorizationContext();
    const myId = dbUser?.id;
    const [showMask, setShowMask] = useState(true);
    const [isAutoLoadingMask, setIsAutoLoadingMask] = useState(false);
    const [orientationPolicy, setOrientationPolicy] = useState<OrientationPolicy>(DEFAULT_ORIENTATION_POLICY);
    const [sceneSummary, setSceneSummary] = useState<Awaited<ReturnType<typeof getScene>> | null>(null);

    useEffect(() => {
        // Wait for the Firebase SDK to resolve currentUser before any API
        // call. The axios interceptor reads auth.currentUser at request
        // time (api/client.ts getAuthTokenAsync); if it fires before the
        // SDK has rehydrated from IndexedDB, no bearer token attaches and
        // the server treats us as anonymous — 404-ing unpublished scenes
        // the viewer is actually authorized to read.
        if (isInitializingAuth) return;

        // Cancel any in-flight toast/redirect if the effect re-runs or the
        // component unmounts so a stale decision can't win.
        let cancelled = false;
        let redirectHandle: ReturnType<typeof setTimeout> | null = null;

        /**
         *
         */
        async function loadSceneId() {
            if (cancelled || !app) return; //redundant
            const splitPath = window.location.pathname.split("/");

            const isSandboxViewer = EngineRuntime.isSandboxViewer();
            let sceneID = isSandboxViewer ? splitPath[splitPath.length - 1] : projectID || getQueryString("sceneID");
            if (isInDiscordEnvironment()) {
                try {
                    const discordAppId = location.host.split(".")[0];
                    const mappingResponse = await fetch(`/.proxy/resolveSceneId/${discordAppId}`);
                    const mappingData = await mappingResponse.json();
                    console.info(`Discord -> Stem Studio Mapping ${JSON.stringify(mappingData)}`);
                    sceneID = mappingData["game_id"];
                } catch (error) {
                    console.error("Error while loading the project:", error);
                    toast.error("Failed to load Discord game mapping. Please try again.");
                    return;
                }
            }

            if (!sceneID) {
                console.error("Error while loading the project: scene not provided");
                toast.error("No game specified. Please check the URL and try again.");
                return;
            }

            let prefetchedScene: Awaited<ReturnType<typeof getScene>>;
            try {
                prefetchedScene = await getScene(sceneID, {
                    includeDerivatives: true,
                    includeDerivativeDataUrl: true,
                    // Force the pinned publish revision so owners visiting
                    // their own play link see what players see, not the
                    // editor head. Contributors with no pin gracefully fall
                    // back to head server-side.
                    revision: "published",
                });
                if (cancelled) return;
                setSceneSummary(prefetchedScene);
                const isPublished = prefetchedScene.isPublished;

                if (!isPublished) {
                    // A 200 response on an unpublished scene means the server
                    // already authorized us as a contributor (non-contributors
                    // get 404). Surface a heads-up so the viewer knows the
                    // link isn't yet shareable.
                    toast.warning(
                        "This game is private. Only creators and collaborators can view this link — publish the game to share it.",
                    );
                }

                if (isPublished) {
                    try {
                        const {getGameMapping} = await import("@stem/network/api/gameMapping");
                        const mapping = await getGameMapping(sceneID);
                        if (mapping?.Slug) {
                            const publishedUrl = getGameUrl(sceneID, mapping.Slug);
                            const fullUrl = publishedUrl.startsWith("http") ? publishedUrl : `https://${publishedUrl}`;
                            const targetHost = new URL(fullUrl).hostname;
                            if (targetHost.toLowerCase() !== window.location.hostname.toLowerCase()) {
                                window.location.href = fullUrl;
                            }
                        }
                    } catch (slugError) {
                        console.warn("Could not resolve published URL for redirect:", slugError);
                        // Fall through to normal /play behavior
                    }
                }
            } catch (err) {
                console.error("Error while loading the project:", err);
                // Server returns 404 for missing scenes and for unpublished
                // scenes when the caller is not a contributor (existence is
                // not leaked, so the two cases are indistinguishable here).
                const details = getSceneLoadErrorDetails(err);
                if (details.isNotFound || details.isAccessDenied) {
                    toast.error("The game could not be found. Redirecting to dashboard...");
                    redirectHandle = setTimeout(() => {
                        window.location.href = "/dashboard";
                    }, 5000);
                } else {
                    toast.error("Failed to load game data. Please check your connection and try again.");
                }
                return;
            }

            app.authManager.setUserName(currentUsername || "");
            app.options.isPlayModeOnly = true;
            void app
                .setUpScene(sceneID, {prefetchedScene})
                .then(async () => {
                    if (app.editor) {
                        // Keep sandbox scenes playable in the player without exposing sandbox UI.
                        app.editor.isSandbox = false;
                    }

                    setOrientationPolicy(normalizeOrientationPolicy(
                        app.scene?.userData?.game?.orientationPolicy || DEFAULT_ORIENTATION_POLICY,
                    ));
                    // Await so a throw in startPlayer propagates into our catch
                    // block. Previously this was fire-and-forget and any failure
                    // (e.g. an empty draft with no valid scene) left the loader
                    // up indefinitely.
                    await app?.setMode(ApplicationMode.PLAY);
                })
                .catch((error: { message: string | string[] }) => {
                    console.error("Error loading scene:", error);
                    const details = getSceneLoadErrorDetails(error);
                    // Show user-friendly error but continue for backward compatibility
                    if (details.isNetwork) {
                        toast.error("Network error while loading the game. Please check your connection.");
                    } else if (details.isAccessDenied) {
                        toast.error("Access denied. You may not have permission to view this game.");
                    } else if (details.isNotFound) {
                        toast.error("Game not found. Please check the URL and try again.");
                    } else {
                        toast.warning("Game loaded with some issues. You may experience limited functionality.");
                    }
                })
                .finally(() => {
                    // Safety net: drop the full-screen loader no matter how
                    // scene setup ends. Normally startPlayer fires an
                    // unmask() event which flips this via `showMask.Player`,
                    // but an empty/broken draft from /dashboard can fail or
                    // silently short-circuit that path — without this, the
                    // user is stuck on a permanent spinner instead of seeing
                    // the empty viewport + any error toast.
                    if (cancelled) return;
                    setShowMask(false);
                });
        }
        void loadSceneId();

        return () => {
            cancelled = true;
            if (redirectHandle) clearTimeout(redirectHandle);
        };
    }, [app, projectID, isInitializingAuth]);

    const onShowMask = (enabled: boolean, isAuto: boolean = true) => {
        setShowMask(enabled);
        setIsAutoLoadingMask(isAuto);
    };

    useEffect(() => {
        const container = document.getElementById("container");
        if (container) {
            container.style.overflow = "hidden";
        }
        app?.on(`showMask.Player`, onShowMask);
        return () => {
            if (app) {
                app.options.isPlayModeOnly = false;
                app.on(`showMask.Player`, null);
            }
        };
    }, []);

    useEffect(() => {
        if (!app?.container) return;

        const handleContextMenu = (event: MouseEvent) => {
            event.preventDefault();
            app?.call("contextmenu", null, event);
        };

        app.container.addEventListener("contextmenu", handleContextMenu);
        document.addEventListener("contextmenu", handleContextMenu);

        return () => {
            app?.container.removeEventListener("contextmenu", handleContextMenu);
            document.removeEventListener("contextmenu", handleContextMenu);
        };
    }, [app?.container, window.location.pathname]);
    return (
        <>
            <CSPMetaTag customPolicies={customCSPPolicies} />
            <AppUpdateManager />
            <OfflineIndicator />
            <StemStudioLoader show={showMask}
                isAutoLoading={isAutoLoadingMask}
            />
            <PlayerMobileOrientationOverlay policy={orientationPolicy} />
            <Toaster position="bottom-right"
                theme="dark"
            />
            <PlayerViewport />
            <PlayerTopNav scene={sceneSummary}
                viewerId={myId}
            />
            <PlayerWatermark />
        </>
    );
};

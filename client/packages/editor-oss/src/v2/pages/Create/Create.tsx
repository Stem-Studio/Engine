import {useEffect, useRef, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";

import {useAppGlobalContext, useAuthorizationContext, useHomepageContext} from "../../../context";
import {writeAdvancedModePreference} from "../../../context/advancedModeStorage";
import {useAssetResolutionContext} from "../../../context/AssetResolutionContext";
import {AssetSourceProvider} from "../../../context/AssetSourceContext";
import LibrariesContextProvider from "../../../context/LibrariesContext";
import ModelsTabContextProvider from "../../../context/ModelsTabContext";
import {readDashboardCopilotBootstrap} from "../../../editor/assets/v2/AiCopilot/dashboardCopilotBootstrap";
import {peekStemscriptImport} from "../../../agent/script-tool/stemscriptImportStaging";
import {getRandomPlaceholderIdentifier} from "../../../editor/assets/v2/CreateDashboard/GameOverview/placeholderThumbnails";
import {createSandboxStarter, handleSaveScene} from "../../../editor/assets/v2/TemplatePanel/helpers";
import EditorComponent from "../../../editor/EditorComponent";
import {useAddPrefabToScene} from "../../../editor/prefabs/hooks/prefabs";
import Viewport from "../../../editor/viewport/Viewport";
import global from "../../../global";
import {useRewardReferralTracking} from "../../../hooks/useRewardReferralTracking";
import i18n from "../../../i18n/config";
import {ROUTES} from "@web-shared/routes";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {showToast} from "../../../showToast";
import {StemStudioLoader} from "../../../ui";
import {isSceneInaccessibleError} from "../../../utils/SceneLoadErrorUtils";
import {readEditorRouteState} from "../editorHandoff";
import {ApplicationMode} from "../../../EngineRuntime";
import {syncPlaygroundSceneRoute} from "../links";
import {IEditorUser} from "../types";

type CreateLocationState = {
    autoCreate?: boolean;
    sandboxStarter?: boolean;
    revisionId?: string;
    headRevisionId?: string;
    openAvatarCreator?: boolean;
};

export const Create = () => {
    const {projectID, mode: routeMode} = useParams<{projectID?: string; sceneName?: string; mode?: string}>();
    const requestedPlaygroundMode = routeMode === "play" || routeMode === "edit" ? routeMode : undefined;
    useRewardReferralTracking(projectID);
    const {isAuthorized, userInitialized, isInitializingAuth, dbUser, isAdmin, updateRecentlyViewed} =
        useAuthorizationContext();
    const {projectPhase, setProjectPhase, setActiveRightPanel, setIsEditingOldRevision, advancedMode, setAdvancedMode} = useAppGlobalContext();
    const navigate = useNavigate();
    // Start auto-ticking immediately. During the `/create/project` blank-game flow
    // (createEmptyScene → saveScene → navigate) no `showMask` event fires, so without
    // this default the loader would sit visibly at 0% until setShowMask(false).
    const [isAutoLoadingMask, setIsAutoLoadingMask] = useState(true);
    const addPrefabToScene = useAddPrefabToScene();
    const {context} = useAssetResolutionContext();
    const {setShouldRefreshDashboard} = useHomepageContext();

    const app = global?.app;
    const editor = app?.editor;

    const [showMask, setShowMask] = useState(true);
    const [playgroundRouteRevision, setPlaygroundRouteRevision] = useState(0);
    const location = useLocation();
    const handoffStateRef = useRef<CreateLocationState | null>(readEditorRouteState<CreateLocationState>());
    const locationState = (location.state as CreateLocationState | null) ?? handoffStateRef.current;
    const searchParams = new URLSearchParams(location.search);
    const autoCreate = locationState?.autoCreate;
    const sandboxStarter = locationState?.sandboxStarter;
    const openAvatarCreatorOnLoad = locationState?.openAvatarCreator;
    const revisionIdToLoad = locationState?.revisionId ?? searchParams.get("revisionId") ?? undefined;
    const headRevisionId = locationState?.headRevisionId ?? searchParams.get("headRevisionId") ?? undefined;
    const loadedProjectIDRef = useRef<string | null>(null);
    const loadingProjectIDRef = useRef<string | null>(null);
    const failedProjectIDRef = useRef<string | null>(null);
    const dbUserRef = useRef<IEditorUser | null>(null);
    const openedDashboardCopilotRef = useRef(false);
    const startedCreateFlowRef = useRef(false);
    const routeModeFromPath = (typeof window !== "undefined"
        ? window.location.pathname
        : location.pathname).match(/\/(edit|play)\/?$/)?.[1] as "edit" | "play" | undefined;
    const activePlaygroundMode = routeModeFromPath ?? requestedPlaygroundMode;

    useEffect(() => {
        dbUserRef.current = dbUser;
    }, [dbUser]);

    const onShowMask = (enabled: boolean, isAuto: boolean = true) => {
        console.debug(`[Create] onShowMask event: enabled=${enabled}, isAuto=${isAuto}`);
        setShowMask(enabled);
        setIsAutoLoadingMask(isAuto);
    };

    useEffect(() => {
        const initScene = async () => {
            if (!app || projectID || !isAuthorized || !userInitialized || startedCreateFlowRef.current) {
                return;
            }

            if (autoCreate || sandboxStarter || location.pathname === ROUTES.CREATE_PROJECT) {
                startedCreateFlowRef.current = true;
                console.debug(`[Create] initScene starting: autoCreate=${autoCreate}, sandboxStarter=${sandboxStarter}, pathname=${location.pathname}`);
                try {
                    app.editor?.createEmptyScene();

                    const waitForRenderer = () =>
                        new Promise<void>(resolve => {
                            const check = async () => {
                                const renderer = app.editor?.renderer;
                                if (app.editor?.scene && renderer) {
                                    if ("init" in renderer && typeof renderer.init === "function") {
                                        await renderer.init();
                                    }
                                    resolve();
                                } else {
                                    requestAnimationFrame(check);
                                }
                            };
                            requestAnimationFrame(check);
                        });

                    await waitForRenderer();
                    console.debug("[Create] renderer ready, starting save path");
                    if (sandboxStarter) {
                        await createSandboxStarter(app, navigate);
                    } else {
                        const bootstrap = readDashboardCopilotBootstrap();
                        const placeholderThumbnail = bootstrap?.placeholderThumbnail || getRandomPlaceholderIdentifier();
                        if (app.editor) {
                            app.editor.sceneThumbnail = placeholderThumbnail;
                        }
                        await handleSaveScene(app, navigate, "Game Title");
                    }
                    console.debug(`[Create] save+navigate completed: editor.sceneID=${app.editor?.sceneID}`);

                    // commitSaveScene swallows server errors (shows its own toast) and
                    // returns without setting editor.sceneID. Treat that as a failure so
                    // the user isn't trapped on a permanent loading mask at /create/project.
                    if (!app.editor?.sceneID) {
                        throw new Error("saveScene did not produce a sceneID");
                    }

                    // The post-navigate scene-load effect is the canonical place that
                    // clears the loader (editor.sceneID === projectID branch). It has
                    // been observed to miss this in the blank-game flow, leaving the
                    // loader pinned at 100%. Clearing here as a belt-and-suspenders
                    // guarantee — redundant setShowMask(false) is harmless.
                    console.debug("[Create] blank-game path — directly clearing mask after save");
                    setShowMask(false);
                } catch (error) {
                    console.error("[Create] Blank game creation failed:", error);
                    startedCreateFlowRef.current = false;
                    setShowMask(false);
                    void navigate(ROUTES.DASHBOARD, {replace: true});
                    return;
                }
            }
            setProjectPhase(3);
            setShouldRefreshDashboard(true);

            if (openAvatarCreatorOnLoad) {
                app.editor?.component?.openAvatarCreator?.("user");
            }
        };
        void initScene();
    }, [app, autoCreate, sandboxStarter, openAvatarCreatorOnLoad, projectID, isAuthorized, userInitialized, navigate, location.pathname, setProjectPhase, setShouldRefreshDashboard]);

    useEffect(() => {
        if (!isAuthorized && !isInitializingAuth && !location.pathname.includes("/user/")) {
            const returnTo = location.pathname + location.search + location.hash;
            window.location.assign(`${ROUTES.LOGIN}?returnTo=${encodeURIComponent(returnTo)}`);
        }
    }, [isAuthorized, isInitializingAuth, location.pathname, location.search, location.hash]);

    useEffect(() => {
        const container = document.getElementById("container");
        if (container) {
            container.style.overflow = "hidden";
        }
        app?.on(`showMask.Create`, onShowMask);
        app?.on(`showMask.Editor`, onShowMask);
        app?.on(`playerInit.Create`, () => onShowMask(true, false));
        app?.on(`playerStarted.Create`, () => onShowMask(false));
        app?.on(`playerStopped.Create`, () => onShowMask(false));
        return () => {
            app?.on(`showMask.Create`, null);
            app?.on(`playerInit.Create`, null);
            app?.on(`playerStarted.Create`, null);
            app?.on(`playerStopped.Create`, null);
        };
    }, []);

    useEffect(() => {
        if (!isPlaygroundMode()) return;
        const handlePlaygroundRoute = () => setPlaygroundRouteRevision(value => value + 1);
        window.addEventListener("stem:playground-route", handlePlaygroundRoute);
        return () => window.removeEventListener("stem:playground-route", handlePlaygroundRoute);
    }, []);

    useEffect(() => {
        if (Object.keys(context).length !== 0) {
            app?.on(`prefabPasted.Create`, (object: {id?: string} | undefined) => {
                if (!object?.id) return;
                void addPrefabToScene(object.id);
            });
        }

        return () => {
            app?.on(`prefabPasted.Create`, null);
        };
    }, [context]);

    // Clear the "creating new scene" flag when loading a scene by ID.
    // Without this, the template dialog can reappear if projectPhase was left at 2.
    useEffect(() => {
        if (projectID && projectPhase === 2) {
            setProjectPhase(3);
        }
    }, [projectID, projectPhase, setProjectPhase]);

    useEffect(() => {
        if (!app || !isAuthorized || !userInitialized || !projectID) {
            console.log(
                `[Create] Scene load blocked: app=${!!app}, isAuthorized=${isAuthorized}, userInitialized=${userInitialized}, projectID=${projectID}`,
            );
            return;
        }
        console.debug(
            `[Create] load effect: projectID=${projectID}, editor.sceneID=${editor?.sceneID}, loadedRef=${loadedProjectIDRef.current}, loadingRef=${loadingProjectIDRef.current}, revisionIdToLoad=${revisionIdToLoad}, editor.sceneRevisionId=${editor?.sceneRevisionId}`,
        );
        if (
            loadedProjectIDRef.current === projectID
            || loadingProjectIDRef.current === projectID
            || failedProjectIDRef.current === projectID
        ) return;

        // Scene was just created locally (game/sandbox template) — already in memory with correct sceneID.
        // Skip the redundant server fetch. Clone flow is unaffected since cloneScene doesn't set editor.sceneID.
        // Do NOT call editor.setScene() here — the scene is already fully initialized and calling it again
        // would re-fire objectAdded for every object, duplicating outliner entries.
        if (editor?.sceneID === projectID && (!revisionIdToLoad || editor.sceneRevisionId === revisionIdToLoad)) {
            console.debug("[Create] local scene path — calling setShowMask(false)");
            loadedProjectIDRef.current = projectID;
            setIsEditingOldRevision(!!revisionIdToLoad && revisionIdToLoad !== headRevisionId);
            void (async () => {
                await app.setUpLocalScene();
                setShowMask(false);
            })();
            return;
        }

        loadingProjectIDRef.current = projectID;

        void (async () => {
            try {
                await app.setUpScene(projectID, {revisionId: revisionIdToLoad});
                loadedProjectIDRef.current = projectID;
                setIsEditingOldRevision(!!revisionIdToLoad && revisionIdToLoad !== headRevisionId);
            } catch (e) {
                console.error("Error while loading the project:", e);
                failedProjectIDRef.current = projectID;
                // The only durable storage is the local ProjectStore. Any
                // failure here (missing project, corrupt JSON) is unrecoverable
                // from the editor screen, so return to the dashboard instead of
                // leaving the editor in a retry loop.
                if (!isSceneInaccessibleError(e)) {
                    console.warn("[Create] unexpected scene load failure in local project store", e);
                }
                showToast({type: "error", title: i18n.t("Stem Studio project scene could not be loaded.")});
                void navigate(ROUTES.DASHBOARD, {replace: true});
            } finally {
                if (loadingProjectIDRef.current === projectID) {
                    loadingProjectIDRef.current = null;
                }
            }
        })();
    }, [projectID, userInitialized, app, isAuthorized, navigate, revisionIdToLoad, headRevisionId, setIsEditingOldRevision]);

    // Playground links are intentionally self-describing: a refresh of
    // `/.../:mode?mode=playground&scene=:sceneName` restores the same
    // editor/runtime state. The scene ID remains authoritative for local
    // project-store loading; the query slug is a readable URL label only.
    useEffect(() => {
        if (!app || !editor || !projectID || !isPlaygroundMode() || !activePlaygroundMode || showMask) return;
        const desiredMode = activePlaygroundMode === "play" ? ApplicationMode.PLAY : ApplicationMode.EDIT;
        // The application enters EDIT as part of its normal startup sequence.
        // Do not enqueue a second EDIT transition while that sequence is still
        // in IDLE: a user can click Play before the queued transition drains,
        // which would otherwise run after PLAY and immediately kick the game
        // back to the editor. A real user-requested PLAY → EDIT transition is
        // still handled explicitly by the editor controls.
        if (desiredMode === ApplicationMode.EDIT &&
            (app.mode === ApplicationMode.IDLE || app.mode === ApplicationMode.PLAY)) return;
        const alreadyInMode = desiredMode === ApplicationMode.PLAY
            ? app.mode === ApplicationMode.PLAY || app.isPlaying
            : app.mode !== ApplicationMode.PLAY && !app.isPlaying;
        if (alreadyInMode) return;

        let cancelled = false;
        void app.setMode(desiredMode, {editorSavePolicy: "discard"}).catch(error => {
            if (!cancelled) console.error("[Create] Could not restore Playground mode from URL", error);
        });
        return () => {
            cancelled = true;
        };
    }, [app, editor, projectID, activePlaygroundMode, showMask, playgroundRouteRevision]);

    useEffect(() => {
        if (!app || !editor || !projectID || !isPlaygroundMode() || showMask) return;
        const syncRoute = () => {
            const mode = app.mode === ApplicationMode.PLAY || app.isPlaying ? "play" : "edit";
            syncPlaygroundSceneRoute(projectID, editor.sceneName, mode);
        };
        syncRoute();
        app.on("sceneLoaded.CreatePlaygroundRoute", syncRoute);
        app.on("sceneNameUpdated.CreatePlaygroundRoute", syncRoute);
        app.on("playerStarted.CreatePlaygroundRoute", syncRoute);
        app.on("playerStopped.CreatePlaygroundRoute", syncRoute);
        return () => {
            app.on("sceneLoaded.CreatePlaygroundRoute", null);
            app.on("sceneNameUpdated.CreatePlaygroundRoute", null);
            app.on("playerStarted.CreatePlaygroundRoute", null);
            app.on("playerStopped.CreatePlaygroundRoute", null);
        };
    }, [app, editor, projectID, showMask]);

    useEffect(() => {
        if (!app || !isAuthorized || !userInitialized || projectID) return;

        if (projectPhase !== 3) {
            setProjectPhase(3);
        }
    }, [projectID, userInitialized, app, isAuthorized, projectPhase, setProjectPhase]);

    useEffect(() => {
        if (!editor || !app || !isAuthorized || !userInitialized || projectID || !dbUser) return;

        // Fresh local scenes may start without owner metadata.
        // Set owner immediately so Save/Publish permissions resolve for non-admin creators.
        if (editor.projectUserId !== dbUser.id) {
            editor.projectUserId = dbUser.id;
            app.call("projectOwnerChanged");
        }
    }, [editor, app, isAuthorized, userInitialized, projectPhase, dbUser, projectID]);

    // DOT-7545 Gap #3: resolve read-only inspection state once the scene has
    // loaded. A user entering `/editor/:id?readOnly=1` or any authenticated
    // non-owner of a public scene should land in read-only mode. Owners,
    // collaborators and admins always get full edit access regardless of
    // the query flag.
    useEffect(() => {
        if (!editor || !app || !projectID || showMask) return;
        const wantsReadOnly = new URLSearchParams(location.search).get("readOnly") === "1";
        const ownerId = editor.projectUserId;
        const isOwner = !!dbUser?.id && !!ownerId && dbUser.id === ownerId;
        // Collaborator status is resolved asynchronously in useCanEditAsset;
        // we conservatively treat explicit `?readOnly=1` as read-only until
        // the editor proves otherwise. Server-side save guards remain the
        // final authority.
        const nextReadOnly = !isOwner && !isAdmin && wantsReadOnly;
        if (editor.isReadOnly !== nextReadOnly) {
            editor.isReadOnly = nextReadOnly;
            app.call("readOnlyChanged");
        }
    }, [editor, app, projectID, showMask, dbUser, isAdmin, location.search]);

    useEffect(() => {
        app?.on("sceneLoaded.Create", updateRecentlyViewed);

        return () => {
            app?.on("sceneLoaded.Create", null);
        };
    }, []);

    /*
     * Force non-advanced layout for scenes flagged AiPromptMode. This fires
     * on every scene load (initial + revision switches) so switching between
     * an AI-prompt scene and a regular one adjusts the layout without needing
     * a page refresh.
     */
    useEffect(() => {
        if (!app) return;
        const handleSceneLoadedForAiPromptMode = () => {
            const activeEditor = (app as unknown as {editor?: {aiPromptMode?: boolean; sceneID?: string}}).editor;
            if (activeEditor?.aiPromptMode) {
                setAdvancedMode(false);
                writeAdvancedModePreference(false, activeEditor.sceneID);
            }
        };
        app.on("sceneLoaded.CreateAiPrompt", handleSceneLoadedForAiPromptMode);
        return () => {
            app.on("sceneLoaded.CreateAiPrompt", null);
        };
    }, [app, setAdvancedMode]);

    useEffect(() => {
        if (!app || !projectID || showMask || openedDashboardCopilotRef.current) return;

        const dashboardCopilotBootstrap = readDashboardCopilotBootstrap();
        if (!dashboardCopilotBootstrap?.prompt) return;

        openedDashboardCopilotRef.current = true;
        setAdvancedMode(false);
        writeAdvancedModePreference(false, projectID);

        const openCopilotWhenReady = (attempt = 0) => {
            const editorComponent = app.editor?.component;
            if (editorComponent?.openAiCopilot) {
                editorComponent.openAiCopilot();
                return;
            }

            if (attempt < 10) {
                window.setTimeout(() => openCopilotWhenReady(attempt + 1), 150);
            }
        };

        window.setTimeout(() => openCopilotWhenReady(), 150);
    }, [app, projectID, showMask, setAdvancedMode]);

    // Dashboard "Import stemscript folder" handoff. The dashboard stages the
    // script + asset bytes in IndexedDB and navigates here. We auto-open the
    // Copilot panel so the inline terminal hook mounts — that hook consumes
    // the staged payload and runs the same `exec` pipeline the user would
    // invoke manually.
    const openedImportCopilotRef = useRef(false);
    useEffect(() => {
        if (!app || !projectID || showMask) return;
        if (openedImportCopilotRef.current) return;

        let cancelled = false;
        const openCopilotWhenReady = (attempt = 0) => {
            const editorComponent = app.editor?.component;
            if (editorComponent?.openAiCopilot) {
                editorComponent.openAiCopilot();
                return;
            }
            if (attempt < 20) {
                window.setTimeout(() => openCopilotWhenReady(attempt + 1), 150);
            }
        };

        void peekStemscriptImport().then(staged => {
            if (cancelled || !staged || openedImportCopilotRef.current) return;
            openedImportCopilotRef.current = true;
            window.setTimeout(() => openCopilotWhenReady(), 150);
        });

        return () => {
            cancelled = true;
        };
    }, [app, projectID, showMask]);

    // Expose the current advanced/workspace mode on <body> so e2e tests can
    // assert which mode the editor mounted in without instrumenting React.
    useEffect(() => {
        if (typeof document === "undefined") return;
        document.body.dataset.advancedMode = advancedMode ? "true" : "false";
        return () => {
            delete document.body.dataset.advancedMode;
        };
    }, [advancedMode]);

    if (!isAuthorized) return null;

    return (
        <>
            <StemStudioLoader
                show={!!isInitializingAuth || showMask}
                isAutoLoading={isAutoLoadingMask}
            />
            <Viewport workspaceMode={!advancedMode} />
            <AssetSourceProvider>
                <LibrariesContextProvider>
                    <ModelsTabContextProvider>
                        {!isInitializingAuth && (
                            <EditorComponent
                                setActiveRightPanel={setActiveRightPanel}
                                projectPhase={projectPhase}
                                dbUser={dbUser}
                                hasProjectID={!!projectID}
                                isAdmin={isAdmin}
                                advancedMode={advancedMode}
                            />
                        )}
                    </ModelsTabContextProvider>
                </LibrariesContextProvider>
            </AssetSourceProvider>
        </>
    );
};

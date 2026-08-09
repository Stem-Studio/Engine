/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import I18n from "i18next";
import {useCallback, useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import styled from "styled-components";
import {toast as toastywaveToast} from "toastywave";

import {PublishPanel} from "./PublishPanels/PublishPanel";
import {AssetType} from "@stem/network/api/asset";
import {publishCurrentScene, saveScene} from "@stem/network/api/scene";
import {forkScene, updateScene} from "@stem/network/api/scene/v2";
import {useTemplateIds} from "@stem/network/api/templates/hooks";
import {useAuthorizationContext} from "@stem/editor-oss/context";
import {isStemEditor} from "../../../../../../editor/stem-editor/isStemEditor";
import global from "@stem/editor-oss/global";
import {showToast} from "@stem/editor-oss/showToast";
import {DetectDevice} from "@stem/editor-oss/utils/DetectDevice";
import {isTemplateScene} from "@stem/editor-oss/utils/isTemplateScene";
import TimeUtils from "@stem/editor-oss/utils/TimeUtils";
import {generateProjectLink} from "../../../../../../v2/pages/links";
import {useListEditorAssets} from "../../../../../asset-management/hooks/assets";
import {useAutoCreateAssetReleases} from "../../../../../asset-management/hooks/dependencies";
import {Avatar} from "../../../Avatar/Avatar";
import {UserMenu} from "../../../common/AppMenu/UserMenu";
import {Section} from "../../../common/Section";
import {StyledButton} from "../../../common/StyledButton";
import {InGameButton} from "../../../HUD/HUDView/FloatingNav/FloatingNav.style";
import {BorderedWrapper} from "../../RightPanel.style";

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", {numeric: "always"});
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const formatRelativeTime = (date: Date | string | number, baseDate: Date | string | number) => {
    const timestamp = new Date(date).getTime();
    const baseTimestamp = new Date(baseDate).getTime();

    if (!Number.isFinite(timestamp) || !Number.isFinite(baseTimestamp)) {
        return "";
    }

    const diff = timestamp - baseTimestamp;
    const absDiff = Math.abs(diff);

    if (absDiff < 45 * SECOND) {
        return diff < 0 ? "a few seconds ago" : "in a few seconds";
    }

    if (absDiff < 90 * SECOND) {
        return relativeTimeFormatter.format(Math.sign(diff), "minute");
    }

    if (absDiff < 45 * MINUTE) {
        return relativeTimeFormatter.format(Math.round(diff / MINUTE), "minute");
    }

    if (absDiff < 90 * MINUTE) {
        return relativeTimeFormatter.format(Math.sign(diff), "hour");
    }

    if (absDiff < 22 * HOUR) {
        return relativeTimeFormatter.format(Math.round(diff / HOUR), "hour");
    }

    if (absDiff < 36 * HOUR) {
        return relativeTimeFormatter.format(Math.sign(diff), "day");
    }

    if (absDiff < 26 * DAY) {
        return relativeTimeFormatter.format(Math.round(diff / DAY), "day");
    }

    if (absDiff < 45 * DAY) {
        return relativeTimeFormatter.format(Math.sign(diff), "month");
    }

    if (absDiff < 320 * DAY) {
        return relativeTimeFormatter.format(Math.round(diff / MONTH), "month");
    }

    if (absDiff < 548 * DAY) {
        return relativeTimeFormatter.format(Math.sign(diff), "year");
    }

    return relativeTimeFormatter.format(Math.round(diff / YEAR), "year");
};

type Props = {
    inGameUI?: boolean;
};

/**
 * Actions surfaced by the PublishPanel buttons.
 *
 * - "publish": first-time publish of an unpublished scene.
 * - "republish": already-published scene; advance the pinned revision to head.
 * - "unpublish": clear the pinned revision and gallery listing.
 *
 * The orchestrator (`publishCurrentScene`) collapses publish/republish into
 * a single internal action; the distinction only matters in the UI.
 */
export type PublishAction = "publish" | "republish" | "unpublish";

export const TopMenu = ({inGameUI}: Props) => {
    const app = global.app!;
    const autoCreateAssetReleases = useAutoCreateAssetReleases();
    const {dbUser, isAdmin, isCollaborator} = useAuthorizationContext();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [publishPanelOpen, setPublishPanelOpen] = useState(false);

    const userMenuButtonRef = useRef<HTMLButtonElement | null>(null);
    const savingToastIdRef = useRef<number | null>(null);
    const stemEditorMode = isStemEditor(app.editor?.scene);
    // In stem-editor mode, a valid asset token grants the current user edit
    // access via the root-asset edit scope, even without scene collaboration.
    const hasStemEditGrant = stemEditorMode && !!app.assetToken;
    const [canSave, setCanSave] = useState(
        !app.editor?.isReadOnly,
    );
    const [refresher, setRefresher] = useState(false);
    const [lastSaveTime, setLastSaveTime] = useState("");

    const [isPublic, setIsPublic] = useState<boolean>(false);
    const [isAssetPack, setIsAssetPack] = useState<boolean>(!!app.editor!.isAssetPack);
    const [isTopPick, setIsTopPick] = useState<boolean>(!!app.editor!.isTopPick);
    const [isPublished, setIsPublished] = useState<boolean>(!!app.editor!.isPublished);
    const [isCloneable, setIsCloneable] = useState<boolean>(!!app.editor!.isCloneable);
    const {data: templateIds} = useTemplateIds();
    const isApple = ["macOS", "iOS"].includes(DetectDevice.getOS());
    const {data: allSceneAssets} = useListEditorAssets({
        types: Object.values(AssetType),
        includeLatestRelease: true,
    });

    const handleOpenMenu = () => {
        (global as any).app.call("removeGunAimer", this, this);
        setIsMenuOpen(!isMenuOpen);
    };

    const handleCloseMenu = () => {
        setIsMenuOpen(false);
    };

    const handleSettingsSave = (action?: PublishAction) => {
        if (!app.editor) return;

        const sceneID = app.editor.sceneID;
        if (!sceneID) {
            showToast({type: "warning", title: I18n.t("Please open scene first.")});
            return;
        }

        setIsLoading(true);

        // Asset-pack mode auto-publishes constituent assets so they're
        // playable as part of the pack. Same as before — runs regardless of
        // which action is being performed because it depends on the toggle,
        // not the publish action.
        if (isAssetPack) {
            const assetRefs =
                allSceneAssets?.assets
                    .filter(el => !el.latestRelease)
                    .map(el => ({
                        assetId: el.id,
                        revisionId: el.headRevisionId,
                    })) ?? [];

            void autoCreateAssetReleases(assetRefs);
        }

        const onSuccess = () => {
            setIsLoading(false);
            if (!app.editor) return;
            app.editor.isAssetPack = isAssetPack;
            setIsAssetPack(app.editor.isAssetPack);
            app.editor.isTopPick = isTopPick;
            setIsTopPick(app.editor.isTopPick);
            app.editor.isCloneable = isCloneable;
            setIsCloneable(app.editor.isCloneable);
            // isPublic and isPublished are mutated by publishCurrentScene
            // itself when action is publish/republish/unpublish; mirror the
            // editor state into the local component state.
            setIsPublic(!!app.editor.isPublic);
            setIsPublished(!!app.editor.isPublished);
        };
        const onError = () => {
            setIsLoading(false);
        };

        const sharedOptions = {
            isAssetPack,
            isTopPick,
            isCloneable,
            isPublic,
            onSuccess,
            onError,
        };

        if (action === "publish" || action === "republish") {
            void publishCurrentScene("publish", sharedOptions);
        } else if (action === "unpublish") {
            void publishCurrentScene("unpublish", sharedOptions);
        } else {
            // Plain "Update" — PATCH metadata toggles only, no revision
            // creation. To save editor changes, the user clicks the regular
            // Save button in the top menu.
            void updateScene(sceneID, {
                isAssetPack,
                isTopPick,
                isCloneable,
                isPublic,
            })
                .then(() => {
                    // Mirror the panel's isPublic state into the editor so
                    // the shared onSuccess (which reads editor.isPublic to
                    // refresh local component state) sees the new value
                    // instead of the stale pre-PATCH one.
                    if (app.editor) {
                        app.editor.isPublic = isPublic;
                    }
                    onSuccess();
                    showToast({type: "success", title: "Settings updated"});
                })
                .catch((err: any) => {
                    onError();
                    showToast({
                        type: "error",
                        title: "Failed to update settings",
                        body: err?.message,
                    });
                });
        }
    };

    const handleKeyDown = useCallback(
        (event: KeyboardEvent) => {
            const isSaveKey = event.key === "s";

            // Only listen to meta on Apple devices, ctrl on others
            if ((isApple && event.metaKey) || (!isApple && event.ctrlKey)) {
                if (isSaveKey) {
                    event.preventDefault();

                    if (canSave && (app.editor?.isSandbox || isAdmin || !inGameUI)) {
                        handleSaveScene();
                    }
                }
            }
        },
        [canSave, inGameUI],
    );

    const formatLastSaveTime = () => {
        if (app?.editor?.scene.userData.lastSaveTime) {
            const serverTime = TimeUtils.getServerUTCTime();
            const timeAgo = formatRelativeTime(app.editor.scene.userData.lastSaveTime, serverTime);
            setLastSaveTime(timeAgo);
        } else {
            console.debug("scene.userData.lastSaveTime is undefined");
        }
    };

    const loadCurrentStateRef = useRef<() => void>(null);

    const loadCurrentState = () => {
        const isTemplate = isTemplateScene(app.editor?.sceneID);
        const isReadOnly = !!app.editor?.isReadOnly;
        setCanSave(
            !isTemplate
            && !isReadOnly,
        );
        setIsCloneable(!!app.editor?.isCloneable || isTemplate);
    };

    useEffect(() => {
        loadCurrentStateRef.current = loadCurrentState;
    }, [loadCurrentState]);

    // Re-evaluate cloneable state when template IDs become available
    useEffect(() => {
        loadCurrentStateRef.current?.();
    }, [templateIds]);

    useEffect(() => {
        app.on("sceneSaved.TopMenu", (args: any) => {
            loadCurrentStateRef.current?.();
            setIsLoading(false);
            if (savingToastIdRef.current !== null) {
                toastywaveToast.dismiss(savingToastIdRef.current);
                savingToastIdRef.current = null;
            }
            if (args?.showToast !== false) {
                showToast({type: "success", title: I18n.t("Scene Saved")});
            }

            formatLastSaveTime();
        });
        app.on("sceneLoaded.TopMenu", () => {
            loadCurrentStateRef.current?.();
            formatLastSaveTime();
            setIsPublished(!!app.editor?.isPublished);
            setIsPublic(!!app.editor?.isPublic);
            setIsCloneable(!!app.editor?.isCloneable || isTemplateScene(app.editor?.sceneID));
            setIsAssetPack(!!app.editor?.isAssetPack);
            setIsTopPick(!!app.editor?.isTopPick);
        });
        app.on("sceneSaveFailed.TopMenu", () => {
            setIsLoading(false);
            if (savingToastIdRef.current !== null) {
                toastywaveToast.dismiss(savingToastIdRef.current);
                savingToastIdRef.current = null;
            }
        });
        app.on("sceneSaveStart.TopMenu", () => {
            setIsLoading(true);
        });
        app.on("scenePublishStateUpdated.TopMenu", data => {
            // Ignore events targeted at a different scene (defensive for
            // multi-tab / multi-editor scenarios).
            if (data?.sceneId && app.editor?.sceneID && data.sceneId !== app.editor.sceneID) return;
            setIsPublished(!!data.isPublished);
            app.editor!.isPublished = !!data.isPublished;
            app.editor!.publishRevisionId = (data.publishRevisionId as string) ?? "";
            if (data.isPublic !== undefined) {
                setIsPublic(!!data.isPublic);
                app.editor!.isPublic = !!data.isPublic;
            }
        });
        app.on("projectOwnerChanged.TopMenu", () => {
            loadCurrentStateRef.current?.();
        });
        app.on("readOnlyChanged.TopMenu", () => {
            loadCurrentStateRef.current?.();
        });
        app.on(`keydown.TopMenu`, handleKeyDown);
        app.on(`clear.TopMenu`, () => {
            loadCurrentStateRef.current?.();
            setRefresher(!refresher);
        });

        return () => {
            app.on("stoppedPlayingGame.TopMenu", null);
            app.on("sceneSaved.TopMenu", null);
            app.on("sceneLoaded.TopMenu", null);
            app.on("sceneSaveFailed.TopMenu", null);
            app.on("sceneSaveStart.TopMenu", null);
            app.on("projectOwnerChanged.TopMenu", null);
            app.on("readOnlyChanged.TopMenu", null);
            app.on(`keydown.TopMenu`, null);
            app.on(`clear.TopMenu`, null);
            app.on(`scenePublishStateUpdated.TopMenu`, null);
        };
    }, [refresher]);

    useEffect(() => {
        const interval = setInterval(() => {
            formatLastSaveTime();
        }, 60000);

        const handleAutoCreateAssetReleases = (data: any[]) => {
            void autoCreateAssetReleases(data);
        };

        app?.on("autoCreateAssetReleases.TopMenu", handleAutoCreateAssetReleases);

        return () => {
            app?.on("autoCreateAssetReleases.TopMenu", null);
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        const isTemplate = isTemplateScene(app.editor?.sceneID);
        setCanSave(
            !isTemplate,
        );
    }, [isAdmin, isCollaborator, hasStemEditGrant, app.editor, dbUser, refresher]);

    const handleSaveScene = () => {
        if (!app.editor?.sceneName) {
            return showToast({
                type: "confirmation-warning",
                body: "A scene name is required. Please set it in project details before saving.",
            });
        }

        if (!canSave) {
            return showToast({type: "warning", title: "You are not the author of this scene!"});
        }

        savingToastIdRef.current = toastywaveToast.loading(I18n.t("Saving..."), {duration: Infinity, showCountdown: false});
        void saveScene(true);
        app.editor.controls?.saveCamera();
    };

    const handleCloneScene = async () => {
        app.editor?.component?.handleLoading(true);

        // Server-side ForkScene re-checks IsCloneable + ownership; this
        // client gate is just a fast-fail to avoid a round-trip when we
        // already know the scene isn't forkable for non-owners. Owners
        // bypass this since they can always fork their own scene.
        if (!app.editor?.isCloneable && !isTemplateScene(app.editor?.sceneID)) {
            app.editor?.component?.handleLoading(false);
            return showToast({type: "warning", title: "This project is not cloneable."});
        }
        try {
            const res = await forkScene(app.editor?.sceneID || "");
            showToast({type: "success", title: "Scene remixed"});
            const url = generateProjectLink(res.newSceneId);
            window.open(url, "_self");
        } catch (e: any) {
            console.error(e.message);
            showToast({type: "error", title: e?.message || "Failed to remix this scene."});
        } finally {
            app.editor?.component?.handleLoading(false);
        }
    };

    // Update is enabled iff at least one panel toggle differs from the
    // editor's persisted state — i.e., there's something to PATCH.
    const hasUnsavedSettings =
        isPublic !== !!app.editor?.isPublic ||
        isCloneable !== !!app.editor?.isCloneable ||
        isAssetPack !== !!app.editor?.isAssetPack ||
        isTopPick !== !!app.editor?.isTopPick;

    // Republish is enabled iff the saved head revision differs from the
    // pinned publish revision — i.e., the divergence indicator is showing.
    const hasUnpublishedRevision =
        !!app.editor?.publishRevisionId &&
        !!app.editor?.sceneRevisionId &&
        app.editor.publishRevisionId !== app.editor.sceneRevisionId;

    const publishPanel =
        publishPanelOpen && !!app.editor?.sceneID
            ? createPortal(
                  <PublishPanel
                      handleSettingsSave={handleSettingsSave}
                      closePanel={() => setPublishPanelOpen(false)}
                      isAssetPack={isAssetPack}
                      setIsAssetPack={setIsAssetPack}
                      isTopPick={isTopPick}
                      setIsTopPick={setIsTopPick}
                      isPublic={isPublic}
                      setIsPublic={setIsPublic}
                      isCloneable={isCloneable}
                      setIsCloneable={setIsCloneable}
                      isPublished={isPublished}
                      publishRevisionId={app.editor?.publishRevisionId ?? ""}
                      sceneRevisionId={app.editor?.sceneRevisionId ?? null}
                      canUpdate={hasUnsavedSettings}
                      canRepublish={hasUnpublishedRevision}
                      isLoading={isLoading}
                      canSave={canSave}
                  />,
                  document.body,
              )
            : null;

    if (stemEditorMode) {
        return (
            <BorderedWrapper
                height="40px"
                style={{gap: "8px", borderBottom: "none"}}
            >
                {!!lastSaveTime && <LastSaveTime>Saved {lastSaveTime}</LastSaveTime>}
                <Section
                    $gap="8px"
                    $direction="row"
                    $width="auto"
                    $align="center"
                >
                    {canSave && (
                        <StyledButton
                            isActive
                            onClick={handleSaveScene}
                            width="52px"
                            disabled={!canSave}
                        >
                            Save
                        </StyledButton>
                    )}
                </Section>
            </BorderedWrapper>
        );
    }

    if (inGameUI)
        return (
            <>
                {canSave ? (
                    !app.editor?.isSandbox ? null : (
                        <>
                            <InGameButton
                                onClick={handleSaveScene}
                                $background="transparent"
                                disabled={!canSave}
                            >
                                Save
                            </InGameButton>
                        </>
                    )
                ) : (
                    null
                )}
                {publishPanel}
            </>
        );

    return (
        <>
            {publishPanel}
            <BorderedWrapper
                height="40px"
                style={{gap: "8px", borderBottom: "none"}}
            >
                {!!lastSaveTime && <LastSaveTime>Saved {lastSaveTime}</LastSaveTime>}
                <Section
                    $gap="8px"
                    $direction="row"
                    $width="auto"
                    $align="center"
                >
                    {canSave ? (
                        <>
                            <StyledButton
                                isActive
                                onClick={handleSaveScene}
                                width="52px"
                                disabled={!canSave}
                            >
                                Save
                            </StyledButton>
                        </>
                    ) : null}
                </Section>
            </BorderedWrapper>
        </>
    );
};

const LastSaveTime = styled.div`
    font-size: 12px;
    font-weight: 400;
    color: #4a5068;
`;

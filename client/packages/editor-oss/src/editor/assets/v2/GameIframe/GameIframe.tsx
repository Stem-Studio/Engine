import {MutableRefObject, useEffect} from "react";
import ReactDOM from "react-dom";
import styled from "styled-components";

import { renderingEditorToApi } from '@stem/network/api/scene';
import {useAuthorizationContext} from "@stem/editor-oss/context";
import global from "@stem/editor-oss/global";
import {cloneJsonCompatible} from "@stem/editor-oss/utils/cloneJsonCompatible";
import Converter from "../../../../serialization/Converter";
import {showToast} from "@stem/editor-oss/showToast";
import {EDITOR_TOP_NAV_HEIGHT, IFRAME_MESSAGES} from "@stem/editor-oss/types/editor";
import {generateProjectLink, getGameUrl} from "../../../../v2/pages/links";

export const GameIframe = ({iframeRef}: {iframeRef: MutableRefObject<HTMLIFrameElement | null>}) => {
    const app = global.app;
    const {authToken, dbUser} = useAuthorizationContext();

    useEffect(() => {
        const iframe = iframeRef.current;
        const postAuthInfo = (id: string) => {
            if (iframe && iframe.contentWindow && dbUser) {
                const editor = app?.editor;
                const scene = app?.editor?.scene;

                if (!scene || !editor) return showToast({type: "error", title: "Cannot find scene data."});
                const ORIGIN = `${window.location.origin}${generateProjectLink(editor.sceneID ?? undefined)}`;
                const projectData = JSON.parse(
                    JSON.stringify({
                        IsMultiplayer: editor.isMultiplayer,
                        ShowStats: editor.showStats,
                        ShowMemoryStats: editor.showMemoryStats,
                        UseInstancing: editor.useInstancing,
                        Rendering: renderingEditorToApi(editor.rendering),
                        UseAvatar: editor.useAvatar,
                        IsPublished: editor.isPublished,
                        ProjectUserId: editor.projectUserId,
                        VoiceChatEnabled: editor.voiceChatEnabled,
                    }),
                );

                const jsons = new (Converter as any)().toJSON({
                    options: app.options,
                    scene: app.scene,
                    camera: app.camera,
                    scripts: app.scripts,
                });

                const serializableJsons = cloneJsonCompatible(jsons);

                iframe.contentWindow?.postMessage(
                    {
                        id,
                        token: authToken,
                        userId: dbUser.id,
                        username: dbUser.username || dbUser.name,
                        projectData,
                        jsons: serializableJsons,
                    },
                    ORIGIN,
                );
            } else {
                console.error("No access to iframe or user info.");
            }
        };

        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (typeof message === "string" && message.includes(IFRAME_MESSAGES.PLAYER_ADDED_LISTENER)) {
                const id = message.split("?id=")[1];
                postAuthInfo(id ?? "");
            }
        };

        window.addEventListener("message", handleMessage);

        return () => {
            window.removeEventListener("message", handleMessage);
            if (iframe) {
                iframe.src = "about:blank";
                iframeRef.current = null;
            }
        };
    }, []);

    if (!app?.editor) {
        console.error("No editor context");
        showToast({type: "error", title: "Cannot run Player!"});
        return;
    } else {
        const playerUrl = new URL(getGameUrl(app.editor.sceneID || "", null), window.location.origin);
        playerUrl.searchParams.set("isEditorMode", "true");
        playerUrl.searchParams.set("isDebugMode", String(app.storage.debug));
        if (dbUser?.id) playerUrl.searchParams.set("UserID", dbUser.id);

        return ReactDOM.createPortal(
            <IframeWrapper>
                <iframe
                    ref={iframeRef}
                    src={playerUrl.toString()}
                />
            </IframeWrapper>,
            document.body,
        );
    }
};

const IframeWrapper = styled.div`
    position: fixed;
    top: ${EDITOR_TOP_NAV_HEIGHT};
    bottom: 0;
    left: 0;
    right: 0;
    width: 100vw;
    height: calc(100vh - ${EDITOR_TOP_NAV_HEIGHT});
    z-index: 999999999999999;
    iframe {
        width: 100vw;
        height: calc(100vh - ${EDITOR_TOP_NAV_HEIGHT});
    }
`;

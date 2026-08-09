/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {useEffect} from "react";
import styled from "styled-components";

import {useHUDContext} from "@stem/editor-oss/context";
import EngineRuntime, {GLOBAL_BEHAVIOR_HOST, MOBILE_TOUCH_CONTROLS_BEHAVIOR_ID} from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import {BEHAVIOR_UI_CONTAINER_ID} from "@stem/editor-oss/types/editor";
import {findObjectByNameDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {Container} from "../HUDPopup/HUDPopup.style";

export const MobileGameControlsHUD = () => {
    const {closePopup} = useHUDContext();
    const app = global.app as EngineRuntime;
    const behaviorConfigRegistry = app?.editor?.behaviorConfigRegistry;
    const behaviorUIManager = app?.editor?.behaviorUIManager;

    useEffect(closePopup, []);

    const handleOpenBehaviorUI = async () => {
        if (!behaviorUIManager) {
            return console.error("Missing behaviorUIManager");
        }
        if (!behaviorConfigRegistry) {
            return console.error("Missing behaviorConfigRegistry");
        }

        const config = behaviorConfigRegistry.getConfig(MOBILE_TOUCH_CONTROLS_BEHAVIOR_ID);
        if (!config) {
            return console.error("Failed to read config with name: ", MOBILE_TOUCH_CONTROLS_BEHAVIOR_ID);
        }

        const scene = app.editor?.scene;
        if (!scene) {
            return console.error("No scene available");
        }

        const globalHost = findObjectByNameDepthFirst(scene, GLOBAL_BEHAVIOR_HOST);
        if (!globalHost || !Array.isArray(globalHost.userData.behaviors)) {
            console.warn("Global Behaviors Host not found or has no behaviors");
            return;
        }

        const selectedBehavior = globalHost.userData.behaviors.find(
            (b: any) => b.id === MOBILE_TOUCH_CONTROLS_BEHAVIOR_ID,
        );
        if (!selectedBehavior) {
            console.warn(`Behavior ${MOBILE_TOUCH_CONTROLS_BEHAVIOR_ID} not found on ${GLOBAL_BEHAVIOR_HOST}`);
            return;
        }

        const behaviorContextProvider = app.editor?.behaviorContextProvider;
        if (!behaviorContextProvider) {
            return console.error("Missing behaviorContextProvider");
        }

        const behaviorContext = await behaviorContextProvider.getBehaviorContext(
            null,
            scene,
            app.editor?.sceneID || null,
            app.editor?.assetSource ?? null,
        );

        await behaviorUIManager.showBehaviorUI(config, selectedBehavior, behaviorContext, true);
    };

    useEffect(() => {
        void handleOpenBehaviorUI();

        return () => {
            behaviorUIManager?.hideBehaviorUI();
        };
    }, []);

    return (
        <StyledContainer className="hidden-scroll">
            <div
                className="container"
                id={BEHAVIOR_UI_CONTAINER_ID}
            />
        </StyledContainer>
    );
};

const StyledContainer = styled(Container)`
    padding: 12px;
    margin-left: auto;
    .container {
        width: 100%;
    }
`;

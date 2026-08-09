import { useEffect } from "react";

import EngineRuntime, { GLOBAL_BEHAVIOR_HOST, CASCADED_SHADOWS_MAP_BEHAVIOR_ID } from "@stem/editor-oss/EngineRuntime";
import { AttachBehaviorCommand } from "@stem/editor-oss/command/Commands";
import global from "@stem/editor-oss/global";
import { BEHAVIOR_UI_CONTAINER_ID } from "@stem/editor-oss/types/editor";
import {findObjectByNameDepthFirst, findObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import { ContentItem } from "../../common/ContentItem";
import { Separator } from "../../common/Separator";
import { PanelSectionTitle } from "../../RightPanel.style";

export const CascadedShadowMap = () => {
    const app = global.app as EngineRuntime;
    const behaviorConfigRegistry = app?.editor?.behaviorConfigRegistry;
    const behaviorUIManager = app?.editor?.behaviorUIManager;

    const handleOpenBehaviorUI = async () => {
        if (!behaviorUIManager) {
            return console.error("Missing behaviorUIManager");
        }
        if (!behaviorConfigRegistry) {
            return console.error("Missing behaviorConfigRegistry");
        }

        const config = behaviorConfigRegistry.getConfig(CASCADED_SHADOWS_MAP_BEHAVIOR_ID);
        if (!config) {
            return console.error("Failed to read config with name: ", CASCADED_SHADOWS_MAP_BEHAVIOR_ID);
        }

        const scene = app.editor?.scene;
        if (!scene) {
            return console.error("No scene available");
        }

        let target: any = findObjectByNameDepthFirst(scene, GLOBAL_BEHAVIOR_HOST);
        let selectedBehavior: any;

        if (target && Array.isArray(target.userData.behaviors)) {
            selectedBehavior = target.userData.behaviors.find((b: any) => b.id === CASCADED_SHADOWS_MAP_BEHAVIOR_ID);
        }

        if (!selectedBehavior) {
            const stack: any[] = [...scene.children || []];

            while (stack.length && !selectedBehavior) {
                const c = stack.pop();

                if (!c) {
                    continue;
                }

                if (c.isDirectionalLight) {
                    selectedBehavior = (c.userData.behaviors || []).find(
                        (b: any) => b.id === CASCADED_SHADOWS_MAP_BEHAVIOR_ID,
                    );
                    if (selectedBehavior) {
                        target = c;
                        break;
                    }
                }

                if (c.children && c.children.length) {
                    for (let i = c.children.length - 1; i >= 0; i -= 1) {
                        stack.push(c.children[i]);
                    }
                }
            }
        }

        if (!selectedBehavior || !target) {
            // Auto-attach CSM to the first directional light found in the scene
            const firstDirLight = findObjectDepthFirst(scene, c => (c as any).isDirectionalLight) as any;

            if (!firstDirLight) {
                console.warn(`No directional light found to attach ${CASCADED_SHADOWS_MAP_BEHAVIOR_ID}`);
                return;
            }

            await new AttachBehaviorCommand(firstDirLight, CASCADED_SHADOWS_MAP_BEHAVIOR_ID, {
                attributesData: {},
                enabled: true,
            }).execute();
            app.call("objectChanged", app.editor, firstDirLight);

            target = firstDirLight;
            selectedBehavior = (firstDirLight.userData.behaviors || []).find(
                (b: any) => b.id === CASCADED_SHADOWS_MAP_BEHAVIOR_ID,
            );

            if (!selectedBehavior) {
                console.warn(`Failed to attach ${CASCADED_SHADOWS_MAP_BEHAVIOR_ID} to ${firstDirLight.name}`);
                return;
            }
        }

        const behaviorContextProvider = app.editor?.behaviorContextProvider;
        if (!behaviorContextProvider) {
            return console.error("Missing behaviorContextProvider");
        }

        const behaviorContext = await behaviorContextProvider.getBehaviorContext(
            target,
            scene,
            app.editor?.sceneID || null,
            app.editor?.assetSource ?? null,
        );

        behaviorUIManager.showBehaviorUI(config, selectedBehavior, behaviorContext);
    };

    useEffect(() => {
        handleOpenBehaviorUI();

        return () => {
            behaviorUIManager?.hideBehaviorUI();
        };
    }, []);

    return (
        <ContentItem>
            <PanelSectionTitle>Cascade Shadow Maps</PanelSectionTitle>
            <Separator margin="0 0 20px"
                invisible
            />
            <ContentItem $rowGap="16px">
                <div style={{ width: "100%" }}
                    id={BEHAVIOR_UI_CONTAINER_ID}
                />
            </ContentItem>
        </ContentItem>)
        ;
};

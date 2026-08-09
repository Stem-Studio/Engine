import {useEffect, useState} from "react";

import {BorderedWrapper, Container, TabButton} from "./LeftPanel.style";
import {Section} from "../common/Section";
import {AssetsTab} from "./MainTabs/AssetsTab/AssetsTab";
import {ProjectTab} from "./MainTabs/ProjectTab/ProjectTab";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import TimeUtils from "@stem/editor-oss/utils/TimeUtils";
import {StyledButton} from "../common/StyledButton";

export enum TABS {
    project,
    assets,
}

type Props = {
    openAssetsLibrary: () => void;
    drawerMode?: boolean;
    isOpen?: boolean;
    onRequestClose?: () => void;
};

export const LeftPanel = ({openAssetsLibrary, drawerMode = false, isOpen = true, onRequestClose}: Props) => {
    const app = global.app as EngineRuntime;
    const [activeTab, setActiveTab] = useState(TABS.project);

    useEffect(() => {
        const saveEditTime = () => {
            if (!app.editor || app.editor.isApplyingSceneSnapshot) return;
            app.editor.scene.userData.lastEditTime = TimeUtils.getServerUTCTime();
        };

        app.on(`objectChanged.LeftPanel`, saveEditTime);
        app.on(`objectRemoved.LeftPanel`, saveEditTime);
        app.on(`objectAdded.LeftPanel`, saveEditTime);
        app.on(`geometryChanged.LeftPanel`, saveEditTime);

        return () => {
            app.on(`objectChanged.LeftPanel`, null);
            app.on(`objectRemoved.LeftPanel`, null);
            app.on(`objectAdded.LeftPanel`, null);
            app.on(`geometryChanged.LeftPanel`, null);
        };
    }, [app.editor]);

    return (
        <Container
            $drawerMode={drawerMode}
            $isOpen={isOpen}
            aria-label="Project hierarchy and library"
            aria-hidden={drawerMode && !isOpen}
        >
            <BorderedWrapper height="48px">
                {drawerMode && (
                    <button className="panel-close"
                        type="button"
                        aria-label="Close hierarchy"
                        onClick={onRequestClose}
                    >
                        ×
                    </button>
                )}
                <div role="tablist"
                    aria-label="Workspace browser"
                    className="panel-tabs"
                >
                <TabButton
                    $isActive={activeTab === TABS.project}
                    onClick={() => setActiveTab(TABS.project)}
                    data-testid="leftpanel-tab-project"
                    role="tab"
                    aria-selected={activeTab === TABS.project}
                    type="button"
                >
                    Project
                </TabButton>
                <TabButton
                    $isActive={activeTab === TABS.assets}
                    onClick={() => setActiveTab(TABS.assets)}
                    data-testid="leftpanel-tab-library"
                    role="tab"
                    aria-selected={activeTab === TABS.assets}
                    type="button"
                >
                    Library & Tools
                </TabButton>
                </div>
            </BorderedWrapper>

            {activeTab === TABS.assets && (
                <BorderedWrapper style={{padding: "8px", height: "56px", minHeight: "56px"}}>
                    <StyledButton
                        isGreySecondary
                        onClick={openAssetsLibrary}
                    >
                        Manage Library
                    </StyledButton>
                </BorderedWrapper>
            )}

            <Section
                $gap="0px"
                $width="100%"
                $justify="flex-start"
                $height="100%"
            >
                <ProjectTab isVisible={activeTab === TABS.project} />
                <AssetsTab isVisible={activeTab === TABS.assets} />
            </Section>
        </Container>
    );
};

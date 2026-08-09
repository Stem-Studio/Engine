/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {useEffect, useRef, useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";

import {GAME_TEMPLATE_ID, ITemplate, SANDBOX_TEMPLATE_ID} from "./constants/templates";
import {createSandboxStarter, handleSaveScene} from "./helpers";
import {ImportIcon} from "./ImportIcon";
import {TemplateList} from "./TemplateList";
import {BottomBar, Container, FlexIconContainer, HeaderWrapper, Overlay, Title} from "./TemplatePanel.style";
import {getSceneBatch, updateStarterStats} from "@stem/network/api/scene";
import {cloneScene} from "@stem/network/api/scene/v2";
import {useTemplateIds} from "@stem/network/api/templates/hooks";
import EngineRuntime, {ApplicationMode} from "@stem/editor-oss/EngineRuntime";
import {ROUTES} from "@web-shared/routes";
import {useAppGlobalContext} from "@stem/editor-oss/context/AppGlobalContext";
import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import global from "@stem/editor-oss/global";
import {showToast} from "@stem/editor-oss/showToast";
import {generateProjectLink} from "../../../../v2/pages/links";
import {StyledButton} from "../common/StyledButton";
import xIcon from "../icons/x-mark.svg";

const TemplatePanel = () => {
    const app = global.app as EngineRuntime;

    const {setProjectPhase} = useAppGlobalContext();
    const {setShowTemplatePanel} = useHomepageContext();
    const {data: templateIds = [], isLoading: isLoadingTemplateIds} = useTemplateIds();
    const [selectedTemplateId, setSelectedTemplateId] = useState(GAME_TEMPLATE_ID);
    const [templates, setTemplates] = useState<ITemplate[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const ftueCloneTriggeredRef = useRef(false);
    const navigate = useNavigate();
    const location = useLocation();

    const resetEditorScene = () => {
        const children = [...(app?.editor?.scene.children || [])];
        for (const obj of children) {
            app?.editor?.removeObject(obj);
        }
        app?.editor?.reset();
        app?.editor?.createEmptyScene();
    };

    useEffect(() => {
        if (location.pathname !== ROUTES.DASHBOARD) {
            resetEditorScene();
        }
    }, []);

    const trackStarterRemix = async (starterType: "BlankProject" | "SandboxStarter") => {
        try {
            await updateStarterStats(starterType);
        } catch (error) {
            // Remix tracking should never block project creation.
            console.warn(`[TemplatePanel] Failed to update starter stats for ${starterType}`, error);
        }
    };

    const handleCreate = async (id?: string) => {
        if (!app.editor) return;
        if (isCreating) return;

        const currentID = id || selectedTemplateId;

        if (!selectedTemplateId && !id) return;

        setIsCreating(true);
        try {
            if (currentID === GAME_TEMPLATE_ID) {
                await trackStarterRemix("BlankProject");
                await app.clearScene();
                app.editor.isSandbox = false;
                setProjectPhase(3);
                if (location.pathname === ROUTES.DASHBOARD) {
                    await navigate(generateProjectLink(), {state: {autoCreate: true}});
                } else {
                    await handleSaveScene(app, navigate, "Game Title", false);
                }
            } else if (currentID === SANDBOX_TEMPLATE_ID) {
                await trackStarterRemix("SandboxStarter");
                setProjectPhase(3);
                if (location.pathname !== ROUTES.DASHBOARD) {
                    await createSandboxStarter(global.app!, navigate);
                } else {
                    await navigate(generateProjectLink(), {state: {autoCreate: true, sandboxStarter: true}});
                }
            } else {
                const res = await cloneScene(currentID);
                const url = generateProjectLink(res.newSceneId);
                await navigate(url);
                setProjectPhase(3);
            }
        } catch (e: any) {
            console.error(e);
            showToast({type: "error", title: e.message || "Failed to create project!"});
        } finally {
            setIsCreating(false);
            setTimeout(() => {
                setShowTemplatePanel(false);
            }, 50);
        }
    };

    useEffect(() => {
        if (isLoadingTemplateIds) return;

        void (async () => {
            try {
                const res = await getSceneBatch(templateIds);
                if (res) {
                    setTemplates(res);
                }
            } catch (e: any) {
                console.error(e);
                showToast({type: "error", title: "Failed to load templates."});
            } finally {
                setLoadingTemplates(false);
            }
        })();
    }, [isLoadingTemplateIds, templateIds]);

    const createBtnDisabled = !selectedTemplateId || isCreating;

    const generatePlayerMode = async () => {
        await app.setMode(ApplicationMode.PLAY);
        await new Promise(resolve => setTimeout(resolve, 1000));
        app.on("playerStarted.TemplatePanel", () => {
            app.editor?.component?.setPlayerStarted(true);
        });

        return () => {
            app.on("playerStarted.TemplatePanel", null);
        };
    };

    const handleCloneScene = async () => {
        if (isCreating) return false;
        if (!templates[1]?.ID) return false;

        setIsCreating(true);
        try {
            const res = await cloneScene(templates[1].ID);
            const url = generateProjectLink(res.newSceneId);
            await navigate(url);
            setProjectPhase(3);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return true;
        } catch (e: any) {
            console.error(e);
            showToast({type: "error", title: e.message || "Failed to create project!"});
            return false;
        } finally {
            setIsCreating(false);
        }
    };

    useEffect(() => {
        if (ftueCloneTriggeredRef.current) return;

        const params = new URLSearchParams(location.search);
        const isFTUE = params.get("ftue") === "true";
        if (templates.length > 1 && isFTUE) {
            ftueCloneTriggeredRef.current = true;
            app.editor?.component?.handleLoading(true);
            app.editor?.component?.hideUI();
            const asyncAction = async () => {
                const created = await handleCloneScene();
                if (!created) {
                    ftueCloneTriggeredRef.current = false;
                    return;
                }
                await generatePlayerMode();
            };
            void asyncAction();
        }
    }, [templates, location.search]);

    if (loadingTemplates) return null;

    return (
        <Overlay>
            <Container className="hidden-scroll">
                <HeaderWrapper>
                    <div />
                    <Title>Select Project Template</Title>
                    <FlexIconContainer>
                        <ImportIcon />
                        <button
                            className="reset-css"
                            onClick={async () => {
                                await navigate(ROUTES.DASHBOARD);
                                setProjectPhase(1);
                                setShowTemplatePanel(false);
                            }}
                        >
                            <img
                                src={xIcon}
                                alt=""
                            />
                        </button>
                    </FlexIconContainer>
                </HeaderWrapper>
                <div style={{flexGrow: 1, overflowY: "auto", minHeight: 0}}>
                    <TemplateList
                        templates={templates}
                        selectedItemId={selectedTemplateId}
                        onClick={id => setSelectedTemplateId(id)}
                        onDoubleClick={id => {
                            setSelectedTemplateId(id);
                            if (!isCreating) {
                                void handleCreate(id);
                            }
                        }}
                    />
                </div>
                <BottomBar>
                    <StyledButton
                        width="248px"
                        onClick={() => handleCreate()}
                        disabled={createBtnDisabled}
                        isBlueTheme
                        style={{fontWeight: 700, fontSize: "16px"}}
                    >
                        Create New Project
                    </StyledButton>
                </BottomBar>
            </Container>
        </Overlay>
    );
};

export default TemplatePanel;

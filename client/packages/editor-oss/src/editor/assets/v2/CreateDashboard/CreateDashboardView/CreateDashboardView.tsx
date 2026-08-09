import {useEffect, useMemo, useState} from "react";
import i18n from "i18next";
import {useNavigate} from "react-router-dom";
import {useMediaQuery} from "usehooks-ts";

import {BaseGamePickerModal} from "./BaseGamePickerModal";
import {savePickerPrompt, readPickerPrompt, clearPickerPrompt, readPickerPromptAutoStart} from "./baseGamePickerStorage";
import {
    CreateDashboardWrapper,
    EmptyProjects,
    InlineTools,
    PlaceholderCard,
    ProjectCardsGrid,
    Section,
    SectionHeader,
    SectionTitle,
} from "./CreateDashboardView.style";
import {extractKeywords, getPromptMatchedTemplates} from "./templateMatching";
import {getSceneBatch} from "@stem/network/api/scene/batch";
import {getStartersStats, updateStarterStats} from "@stem/network/api/scene/starters";
import {useTemplateIds} from "@stem/network/api/templates/hooks";
import {ROUTES} from "@web-shared/routes";
import {useAppGlobalContext} from "@stem/editor-oss/context/AppGlobalContext";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import {writePendingProjectAdvancedModePreference} from "@stem/editor-oss/context/advancedModeStorage";
import {getOSSPersistenceMode} from "@stem/editor-oss/persistence/mode";
import {showToast} from "@stem/editor-oss/showToast";
import {isStripeCreditsPurchasingEnabled} from "@stem/editor-oss/utils/featureFlags";
import {PRODUCT_ANALYTICS_EVENTS, trackProductEvent} from "@stem/editor-oss/utils/productAnalytics";
import {openEditorRoute} from "../../../../../v2/pages/editorHandoff";
import {generateProjectLink} from "../../../../../v2/pages/links";
import {prepareCopilotChatKeyHandoff} from "../../../../../copilot/playgroundCopilotKeys";
import {
    prepareBlankCopilotWorkspaceEntry,
    prepareCreateFromPromptCopilotEntry,
    prepareRemixCopilotEntry,
} from "../../AiCopilot/copilotWorkspaceEntry";
import {CreditsPurchaseModal} from "../../CreditsPurchaseModal/CreditsPurchaseModal";
import {ImportIcon} from "../../TemplatePanel/ImportIcon";
import {TEMPLATES} from "../../TemplatePanel/constants/templates";
import {FileData} from "../../types/file";
import {MOBILE_DASHBOARD_BREAKPOINT} from "../DashboardLayout/DashboardHeader/DashboardHeader.style";
import {getKeywordMatchedPlaceholder, getRandomPlaceholderIdentifier} from "../GameOverview/placeholderThumbnails";
import {CreateHomepageHero} from "../CreateHomepageHero/CreateHomepageHero";
import {getNextProjectPageFetcher} from "../projectPagination";
import {Filters} from "../SceneList/GamesSections/SectionHeader/Filters/Filters";
import {SceneListItem} from "../SceneList/SceneListItem";

const filterProjectsBySearch = (projects: FileData[], search: string) => {
    if (!search) return projects;

    const query = search.toLowerCase();
    return projects.filter(project => {
        if (project.Name.toLowerCase().includes(query)) return true;

        if (!project.Tags) return false;

        try {
            const tagsArray = JSON.parse(project.Tags);
            return Array.isArray(tagsArray) && tagsArray.some((tag: string) => tag.toLowerCase().includes(query));
        } catch {
            return false;
        }
    });
};

const SANDBOX_STARTER_TEMPLATE_ID = "__sandbox_starter__";

type DashboardTemplate = FileData & {
    starterType?: "sandbox";
};

type Props = {
    hasAnyProjects: boolean;
    projects: FileData[];
    view?: "create" | "projects";
};

export const CreateDashboardView = ({projects, view = "create"}: Props) => {
    const {search, myGamesSection, collaborativeGamesSection, archivedGamesSection} = useHomepageContext();
    const {setAdvancedMode} = useAppGlobalContext();
    const {data: templateIds = [], isLoading: isLoadingTemplateIds} = useTemplateIds();
    const isPhonePortrait = useMediaQuery("(max-width: 480px)");
    const isMobileLandscape = useMediaQuery(`(max-width: ${MOBILE_DASHBOARD_BREAKPOINT})`);
    const isTablet = useMediaQuery("(max-width: 1280px)");
    const [, setCopilotPrompt] = useState("");
    const [templates, setTemplates] = useState<FileData[]>([]);
    const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
    const [starterStats, setStarterStats] = useState({blankProjectCount: 0, sandboxStarterCount: 0});
    const [, setActiveTemplateIndex] = useState(0);
    const [busyAction, setBusyAction] = useState<"copilot" | "engine" | "template" | null>(null);
    const [showBaseGamePicker, setShowBaseGamePicker] = useState(false);
    const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
    const [pendingPromptDecision, setPendingPromptDecision] = useState<string | null>(null);
    const [showCreditsPurchaseModal, setShowCreditsPurchaseModal] = useState(false);
    const {aiCredits, isAuthorized} = useAuthorizationContext();
    const navigate = useNavigate();
    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

    // Grid cols: 4 (default) → 2 (≤1280) → 1 (≤480). Capped at 4 on wide
    // viewports — 5 narrowed cards enough to ellipsis their action buttons.
    // Templates = grid cols - 2 starter cards (min 1)
    const gridColumns = isPhonePortrait ? 1 : isTablet ? 2 : 4;
    const visibleTemplateCount = isPhonePortrait ? 1 : isMobileLandscape ? 2 : Math.max(1, gridColumns - 2);
    const rowCardCount = gridColumns;
    const filteredProjects = useMemo(() => filterProjectsBySearch(projects, search), [projects, search]);

    // DOT-7545: depend on pagination *scalar* fields only. The section
    // objects themselves are recreated every time their `scenes` array
    // changes, which happens each time a new page lands — including when
    // React Query refetches in response to scenePublished / shouldRefresh.
    // Using the full section object as a dep made this effect self-fire on
    // every page-return, racing with refetch() and producing duplicate /
    // out-of-order pages in the infinite-query cache. Depending only on
    // hasNextPage / isFetchingNextPage keeps the "auto-load all my
    // projects" behaviour while preventing the recursive self-trigger.
    const myHasNext = myGamesSection.hasNextPage;
    const myFetching = myGamesSection.isFetchingNextPage;
    const collabHasNext = collaborativeGamesSection.hasNextPage;
    const collabFetching = collaborativeGamesSection.isFetchingNextPage;
    const archivedHasNext = archivedGamesSection.hasNextPage;
    const archivedFetching = archivedGamesSection.isFetchingNextPage;
    useEffect(() => {
        if (view !== "projects") return;
        const fetchNextProjectPage = getNextProjectPageFetcher([
            myGamesSection,
            collaborativeGamesSection,
            archivedGamesSection,
        ]);
        if (!fetchNextProjectPage) return;

        fetchNextProjectPage();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, myHasNext, myFetching, collabHasNext, collabFetching, archivedHasNext, archivedFetching]);

    useEffect(() => {
        if (isLoadingTemplateIds) return;
        if (templateIds.length === 0) {
            setTemplates([]);
            setIsLoadingTemplates(false);
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const response = await getSceneBatch(templateIds);
                if (!cancelled) setTemplates(response || []);
            } catch (error) {
                if (!cancelled) {
                    console.error("[CreateDashboardView] Failed to load templates:", error);
                    showToast({type: "error", title: (error instanceof Error && error.message) || "Failed to load templates."});
                }
            } finally {
                if (!cancelled) setIsLoadingTemplates(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isLoadingTemplateIds, templateIds]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await getStartersStats();
                if (!cancelled && response) {
                    setStarterStats(response);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error("[CreateDashboardView] Failed to load starter stats:", error);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const dashboardTemplates = useMemo<DashboardTemplate[]>(() => {
        const sandboxTemplate = TEMPLATES.find(template => template.IsSandbox);
        const syntheticSandbox: DashboardTemplate[] = sandboxTemplate
            && isLocalhost
            ? [
                  {
                      ID: SANDBOX_STARTER_TEMPLATE_ID,
                      publishRevisionId: "",
                      AssetID: null,
                      Name: sandboxTemplate.Name,
                      Description: "",
                      Thumbnail: sandboxTemplate.Thumbnail || "",
                      PlayCount: 0,
                      RemixCount: starterStats.sandboxStarterCount,
                      ShareCount: 0,
                      Likes: 0,
                      Tags: JSON.stringify(sandboxTemplate.Tags),
                      Url: "",
                      UpdateTime: "",
                      IsPublic: false,
                      IsSandbox: true,
                      IsCloneable: true,
                      IsPublished: false,
                      UserID: "",
                      starterType: "sandbox",
                  },
              ]
            : [];

        return [...syntheticSandbox, ...templates];
    }, [isLocalhost, starterStats.sandboxStarterCount, templates]);

    useEffect(() => {
        const maxIndex = Math.max(0, dashboardTemplates.length - visibleTemplateCount);
        setActiveTemplateIndex(prev => Math.min(prev, maxIndex));
    }, [dashboardTemplates.length, visibleTemplateCount]);

    const isBusy = busyAction !== null;
    const isTemplateMatchingReady = !isLoadingTemplateIds && !isLoadingTemplates;
    const myProjectPlaceholders = Math.max(0, rowCardCount - filteredProjects.length);
    const matchingPickerTemplates = useMemo(
        () => pendingPrompt ? getPromptMatchedTemplates(templates, pendingPrompt) : [],
        [pendingPrompt, templates],
    );

    const startBlankProject = async (options?: {prompt?: string}) => {
        const trimmedPrompt = options?.prompt?.trim();
        trackProductEvent(PRODUCT_ANALYTICS_EVENTS.CREATE_BLANK_STARTED, {
            source: trimmedPrompt ? "prompt" : "blank",
            prompt_length: trimmedPrompt?.length ?? 0,
        });
        if (!isAuthorized) {
            if (trimmedPrompt) {
                savePickerPrompt(trimmedPrompt, {autoStart: true});
            }
            void navigate(ROUTES.LOGIN, {state: {from: ROUTES.HOME}});
            return;
        }
        setBusyAction(trimmedPrompt ? "copilot" : "engine");

        try {
            await updateStarterStats("BlankProject");

            const placeholderThumbnail = trimmedPrompt
                ? getKeywordMatchedPlaceholder(extractKeywords(trimmedPrompt))
                : getRandomPlaceholderIdentifier();

            // "Start from scratch" (no prompt) opens the full editor in advanced
            // mode. The prompt-driven flow stays in default/copilot mode.
            // openEditorRoute triggers a hard page navigation (window.location.assign),
            // so React state is lost — we persist the preference via session storage
            // so the next page boot reads it through resolveAdvancedModePreferenceForProject.
            const wantsAdvanced = !trimmedPrompt;
            setAdvancedMode(wantsAdvanced);
            writePendingProjectAdvancedModePreference(wantsAdvanced);

            if (trimmedPrompt) {
                await prepareCopilotChatKeyHandoff();
                prepareCreateFromPromptCopilotEntry({prompt: trimmedPrompt, placeholderThumbnail});
            } else {
                prepareBlankCopilotWorkspaceEntry();
            }

            openEditorRoute(generateProjectLink(), {autoCreate: true});
        } catch (error) {
            console.error("[CreateDashboardView] Failed to create blank project:", error);
            showToast({type: "error", title: (error instanceof Error && error.message) || "Failed to create project."});
            setBusyAction(null);
        }
    };

    const continuePromptCreation = (prompt: string) => {
        const matchingTemplates = getPromptMatchedTemplates(templates, prompt);
        if (matchingTemplates.length === 0) {
            setShowBaseGamePicker(false);
            setPendingPrompt(null);
            clearPickerPrompt();
            void startBlankProject({prompt});
            return;
        }

        setPendingPrompt(prompt);
        setShowBaseGamePicker(true);
    };

    useEffect(() => {
        if (view !== "create") return;
        if (!pendingPromptDecision) return;
        if (!isTemplateMatchingReady) return;

        const prompt = pendingPromptDecision;
        setPendingPromptDecision(null);
        continuePromptCreation(prompt);
        // `continuePromptCreation` intentionally reads the latest loaded templates.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, pendingPromptDecision, isTemplateMatchingReady, templates]);

    useEffect(() => {
        if (view !== "create") return;
        if (!isAuthorized) return;
        if (pendingPromptDecision) return;
        if (pendingPrompt || showBaseGamePicker) return;
        const saved = readPickerPrompt();
        if (!saved) return;

        setCopilotPrompt(saved);

        if (readPickerPromptAutoStart()) {
            clearPickerPrompt();
            void startBlankProject({prompt: saved});
            return;
        }

        if (!isTemplateMatchingReady) {
            setPendingPromptDecision(saved);
            return;
        }

        continuePromptCreation(saved);
        // `continuePromptCreation` intentionally reads the latest loaded templates.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, isAuthorized, isTemplateMatchingReady, pendingPromptDecision, pendingPrompt, showBaseGamePicker]);

    const beginPromptCreation = (prompt: string) => {
        const trimmed = prompt.trim();
        if (!trimmed || isBusy) return;
        trackProductEvent(PRODUCT_ANALYTICS_EVENTS.CREATE_PROMPT_SUBMITTED, {
            prompt_length: trimmed.length,
        });
        if (!isAuthorized) {
            savePickerPrompt(trimmed, {autoStart: true});
            void navigate(ROUTES.LOGIN, {state: {from: ROUTES.HOME}});
            return;
        }

        if (aiCredits !== null && aiCredits <= 0 && isStripeCreditsPurchasingEnabled()) {
            setShowCreditsPurchaseModal(true);
            return;
        }

        savePickerPrompt(trimmed);
        setCopilotPrompt(trimmed);

        if (!isTemplateMatchingReady) {
            setPendingPromptDecision(trimmed);
            return;
        }

        continuePromptCreation(trimmed);
    };

    const handlePickerSelectGame = async (gameId: string) => {
        if (!pendingPrompt) return;
        setBusyAction("template");
        trackProductEvent(PRODUCT_ANALYTICS_EVENTS.TEMPLATE_REMIX_STARTED, {
            scene_id: gameId,
            source: "base_game_picker",
            prompt_length: pendingPrompt.length,
        });

        try {
            // Prompt-driven remix also goes to the AI-focused layout. See
            // startBlankProject for why we write the preference directly in
            // addition to calling setAdvancedMode.
            setAdvancedMode(false);
            const {cloneScene} = await import("@stem/network/api/scene/actions");
            const result = await cloneScene(gameId);
            if (!result?.newSceneId) {
                throw new Error("Remix did not return a new project.");
            }
            const sourceScene = matchingPickerTemplates.find(template => template.ID === gameId);
            prepareRemixCopilotEntry({
                newSceneId: result.newSceneId,
                sourceScene,
                prompt: pendingPrompt,
            });
            await prepareCopilotChatKeyHandoff();
            clearPickerPrompt();
            setShowBaseGamePicker(false);
            setPendingPrompt(null);
            openEditorRoute(generateProjectLink(result.newSceneId));
        } catch (error) {
            console.error("[CreateDashboardView] Failed to remix for picker:", error);
            showToast({type: "error", title: (error instanceof Error && error.message) || i18n.t("Failed to remix project.")});
            setBusyAction(null);
        }
    };

    const handlePickerBlankProject = () => {
        setShowBaseGamePicker(false);
        clearPickerPrompt();
        const prompt = pendingPrompt;
        setPendingPrompt(null);
        void startBlankProject({prompt: prompt || undefined});
    };

    const handlePickerClose = () => {
        setShowBaseGamePicker(false);
        clearPickerPrompt();
        setPendingPrompt(null);
    };

    return (
        <CreateDashboardWrapper data-testid={view === "create" ? "create-dashboard" : "my-projects-dashboard"}>
            {view === "create" ? (
                <CreateHomepageHero
                    onPromptSubmit={beginPromptCreation}
                    onScratchStart={() => void startBlankProject()}
                    isBusy={isBusy}
                />
            ) : (
                <Section>
                    <SectionHeader style={{justifyContent: "flex-start", gap: "12px"}}>
                        <SectionTitle>{i18n.t("My Projects")}</SectionTitle>
                        <InlineTools>
                            <ImportIcon />
                            <Filters />
                        </InlineTools>
                    </SectionHeader>

                    {filteredProjects.length === 0 ? (
                        <EmptyProjects>
                            {search
                                ? i18n.t("No matching projects found.")
                                : getOSSPersistenceMode() === "filesystem"
                                  ? i18n.t(
                                        "No saved projects in this folder yet. Create one from the Create tab and click Save Project, or import a stemscript folder.",
                                    )
                                  : i18n.t("No projects yet.")}
                        </EmptyProjects>
                    ) : (
                        <ProjectCardsGrid $columns={rowCardCount}>
                            {filteredProjects.map(project => (
                                <SceneListItem
                                    key={project.ID}
                                    item={project}
                                    routeKind="dashboard"
                                    showVisibilityState
                                />
                            ))}
                            {Array.from({length: myProjectPlaceholders}).map((_, index) => (
                                <PlaceholderCard key={`placeholder-${index}`} />
                            ))}
                        </ProjectCardsGrid>
                    )}
                </Section>
            )}
            {view === "create" && showBaseGamePicker && pendingPrompt && matchingPickerTemplates.length > 0 && (
                <BaseGamePickerModal
                    prompt={pendingPrompt}
                    templates={matchingPickerTemplates}
                    onSelectGame={handlePickerSelectGame}
                    onBlankProject={handlePickerBlankProject}
                    onClose={handlePickerClose}
                    isBusy={isBusy}
                />
            )}

            {view === "create" && showCreditsPurchaseModal && (
                <CreditsPurchaseModal onClose={() => setShowCreditsPurchaseModal(false)} />
            )}
        </CreateDashboardWrapper>
    );
};

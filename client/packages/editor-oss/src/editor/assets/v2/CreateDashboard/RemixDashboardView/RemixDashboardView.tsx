import {useEffect, useMemo, useState} from "react";

import {RemixTitleRow} from "./RemixDashboardView.style";
import {getSceneBatch} from "@stem/network/api/scene/batch";
import {fetchPublishedScenes, type FetchScenesParams} from "@stem/network/api/scene/list";
import {useTemplateIds} from "@stem/network/api/templates/hooks";
import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import type {FileData} from "../../types/file";
import {
    CreateDashboardWrapper,
    ProjectCardsGrid,
    Section,
    TemplatesEmpty,
    WelcomeBlock,
    WelcomeTitle,
} from "../CreateDashboardView/CreateDashboardView.style";
import {buildRemixableProjectList, type RemixFilterType} from "../projectSorting";
import {SceneListItem} from "../SceneList/SceneListItem";

const REMIX_FEED_PAGE_SIZE = 50;

const getPlatformFeedParams = (filter: RemixFilterType): FetchScenesParams | null => {
    switch (filter) {
        case "most_remixed":
            return {page: 1, limit: REMIX_FEED_PAGE_SIZE, sort: "most_remixed"};
        case "most_recent":
            return {page: 1, limit: REMIX_FEED_PAGE_SIZE, sort: "recent_remixes", remixesOnly: true};
        case "most_played":
            return {page: 1, limit: REMIX_FEED_PAGE_SIZE, sort: "most_played", cloneableOnly: true};
        case "template_order":
        default:
            return null;
    }
};

const getEnvTemplateIds = () =>
    (process.env.REACT_APP_PROJECT_TEMPLATES || "")
        .split(",")
        .map(id => id.trim())
        .filter(Boolean);

export const RemixDashboardView = () => {
    const {communityGames, myGames, collaborativeGames} = useHomepageContext();
    const {data: resolvedTemplateIds = []} = useTemplateIds();
    const templateIds = useMemo(
        () => Array.from(new Set([...getEnvTemplateIds(), ...resolvedTemplateIds].map(id => String(id)))),
        [resolvedTemplateIds],
    );
    const [templates, setTemplates] = useState<FileData[]>([]);
    const [platformGames, setPlatformGames] = useState<FileData[]>([]);
    const [remixFilter] = useState<RemixFilterType>("template_order");
    const [isLoadingPlatformGames, setIsLoadingPlatformGames] = useState(false);

    useEffect(() => {
        let cancelled = false;

        if (templateIds.length === 0) {
            setTemplates([]);
            return;
        }

        getSceneBatch(templateIds)
            .then(result => {
                if (cancelled) return;
                setTemplates((result || []) as FileData[]);
            })
            .catch(error => {
                if (cancelled) return;
                console.error("[RemixDashboardView] Failed to load templates:", error);
                setTemplates([]);
            });

        return () => {
            cancelled = true;
        };
    }, [templateIds]);

    useEffect(() => {
        const params = getPlatformFeedParams(remixFilter);
        let cancelled = false;

        if (!params) {
            setPlatformGames([]);
            setIsLoadingPlatformGames(false);
            return;
        }

        setIsLoadingPlatformGames(true);
        fetchPublishedScenes(params)
            .then(result => {
                if (cancelled) return;
                setPlatformGames(result?.Scenes || []);
            })
            .catch(error => {
                if (cancelled) return;
                console.error("[RemixDashboardView] Failed to load platform remix feed:", error);
                setPlatformGames([]);
            })
            .finally(() => {
                if (cancelled) return;
                setIsLoadingPlatformGames(false);
            });

        return () => {
            cancelled = true;
        };
    }, [remixFilter]);

    const remixableGames = useMemo(() => {
        if (remixFilter !== "template_order") {
            return platformGames;
        }

        return buildRemixableProjectList({
            templates,
            templateIds,
            myProjects: myGames,
            collaborativeProjects: collaborativeGames,
            communityProjects: communityGames,
            filter: remixFilter,
        });
    }, [collaborativeGames, communityGames, myGames, platformGames, remixFilter, templateIds, templates]);

    return (
        <CreateDashboardWrapper data-testid="remix-dashboard">
            <WelcomeBlock>
                <RemixTitleRow>
                    <WelcomeTitle>Start with a remixable template</WelcomeTitle>
                </RemixTitleRow>
            </WelcomeBlock>

            <Section>
                {remixableGames.length > 0 ? (
                    <ProjectCardsGrid $columns={3}>
                        {remixableGames.map(game => (
                            <SceneListItem
                                key={game.ID}
                                item={game}
                                routeKind="discover"
                            />
                        ))}
                    </ProjectCardsGrid>
                ) : (
                    <TemplatesEmpty>
                        {isLoadingPlatformGames
                            ? "Loading remixable games..."
                            : "No remixable games are available yet."}
                    </TemplatesEmpty>
                )}
            </Section>
        </CreateDashboardWrapper>
    );
};

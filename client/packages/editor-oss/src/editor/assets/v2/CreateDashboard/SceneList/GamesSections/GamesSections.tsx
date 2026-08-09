import {useEffect, useState} from "react";
import {useMediaQuery} from "usehooks-ts";

import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import {FileData} from "../../../types/file";
import {SceneListItem} from "../SceneListItem";
import {EmptyInfo, HorizontalSceneList, SectionWrapper} from "./GamesSections.style";
import {SectionHeader} from "./SectionHeader/SectionHeader";
import {IGamesSection, SECTION} from "../../CreateDashboard";
import {StyledSceneList} from "../SceneList.style";
import {PaginationButton} from "./SectionHeader/PaginationButton";

const NEW_GAME_ITEM: FileData = {
    ID: "new-game",
    UserID: "",
    Name: "Create New Project",
    Description: "",
    PlayCount: 0,
    RemixCount: 0,
    Tags: "",
    Thumbnail: "",
    Url: "",
    UpdateTime: "",
    IsSandbox: false,
    IsPublished: false,
    publishRevisionId: "",
    AssetID: null,
};

type Props = {
    sectionData: IGamesSection;
    defaultExpanded?: boolean;
};

const PAGE_CHUNK_SIZE = 20;

export const GamesSections = ({sectionData, defaultExpanded}: Props) => {
    const {search} = useHomepageContext();
    const {label, scenes, pagination} = sectionData;
    const isTabletL = useMediaQuery("(max-width: 1440px)");
    const isTablet = useMediaQuery("(max-width: 1280px)");
    const isMobile = useMediaQuery("(max-width: 480px)");
    // Cap at 4 columns on wide viewports — see StyledSceneList for why.
    const columnCount = isMobile ? 1 : isTablet ? 2 : 4;
    const gamesPreviewLength = isMobile ? 4 : isTablet ? 4 : isTabletL ? 3 : 4;
    const myGamesPreviewLength = isMobile ? 4 : gamesPreviewLength - 1;
    const isProjectsSection = label === SECTION.PROJECTS;
    const isContinuePlaying = label === SECTION.CONTINUE_PLAYING;
    const isTopPicksSection = label === SECTION.TOP_PICKS;
    const continuePlayingPreview = columnCount;
    const rawPreviewLength = isContinuePlaying
        ? continuePlayingPreview
        : (sectionData.maxItems ?? (isProjectsSection ? myGamesPreviewLength : gamesPreviewLength));
    // Keep most sections row-aligned, but Top Picks should preview exactly 3 rows when available. (12 items on desktop)
    const TOP_PICKS_ROWS = 3;
    const previewLength = isTopPicksSection
        ? columnCount * TOP_PICKS_ROWS
        : Math.max(columnCount, Math.floor(rawPreviewLength / columnCount) * columnCount);

    const [isCollapsed, setIsCollapsed] = useState(!defaultExpanded);
    const [filteredScenes, setFilteredScenes] = useState<FileData[]>([]);
    // How many items to show when expanded (client-side windowing over already-fetched pages)
    const [visibleCount, setVisibleCount] = useState(PAGE_CHUNK_SIZE);

    const hasServerMore = pagination?.hasNextPage ?? false;
    const hasClientMore = !isCollapsed && visibleCount < filteredScenes.length;
    const canExpand = filteredScenes.length > previewLength;
    const showMoreBottom = isCollapsed ? canExpand : hasClientMore || hasServerMore;

    const refreshState = () => {
        if (!search) {
            setFilteredScenes(scenes);
            setVisibleCount(PAGE_CHUNK_SIZE);
            return;
        }

        const query = search.toLowerCase().trim();
        const queryTerms = query.split(/[,\s]+/).filter(Boolean);

        const filtered = scenes?.filter(n => {
            if (n.Name.toLowerCase().includes(query)) return true;

            if (n.Tags) {
                try {
                    const tagsArray: unknown = JSON.parse(n.Tags);
                    if (Array.isArray(tagsArray)) {
                        return tagsArray.some(tag => {
                            if (typeof tag !== "string") return false;
                            const normalizedTag = tag.toLowerCase();
                            return (
                                normalizedTag.includes(query) || queryTerms.some(term => normalizedTag.includes(term))
                            );
                        });
                    }
                } catch {
                    return false;
                }
            }

            return false;
        });

        setFilteredScenes(filtered);
        setVisibleCount(PAGE_CHUNK_SIZE);
    };

    useEffect(() => {
        refreshState();
    }, [search, sectionData]);

    const currentList = isTopPicksSection
        ? filteredScenes.slice(0, isCollapsed ? previewLength : visibleCount)
        : isCollapsed
          ? filteredScenes.slice(0, previewLength)
          : filteredScenes.slice(0, visibleCount);

    const showMore = () => {
        if (isCollapsed) {
            setIsCollapsed(false);
            setVisibleCount(PAGE_CHUNK_SIZE);
            return;
        }

        // If there are more client-side items to show, reveal them
        if (visibleCount < filteredScenes.length) {
            setVisibleCount(prev => prev + PAGE_CHUNK_SIZE);
            return;
        }

        // Otherwise fetch next server page
        if (pagination?.hasNextPage) {
            pagination.fetchNextPage();
            // After fetch completes, filteredScenes will grow via useEffect
            setVisibleCount(prev => prev + PAGE_CHUNK_SIZE);
        }
    };

    const renderSceneItems = (list: FileData[]) => {
        return list.map((item, index) => (
            <SceneListItem
                key={item.ID + index}
                item={item}
                routeKind="discover"
            />
        ));
    };

    if (sectionData.scenes.length === 0 && label !== SECTION.PROJECTS) return null;

    return (
        <SectionWrapper>
            <SectionHeader
                label={label}
                isExpanded={!isCollapsed}
                onCollapse={() => {
                    setIsCollapsed(true);
                    setVisibleCount(PAGE_CHUNK_SIZE);
                }}
            />
            {filteredScenes.length === 0 && !isProjectsSection && <EmptyInfo>No matching projects found.</EmptyInfo>}
            {isContinuePlaying && isCollapsed ? (
                <HorizontalSceneList className="hidden-scroll">{renderSceneItems(currentList)}</HorizontalSceneList>
            ) : (
                <StyledSceneList className="StyledSceneList">
                    {isProjectsSection && (
                        <SceneListItem
                            isNewGameItem
                            item={NEW_GAME_ITEM}
                        />
                    )}
                    {renderSceneItems(currentList)}
                </StyledSceneList>
            )}
            {showMoreBottom && (
                <PaginationButton
                    onClick={showMore}
                    label={pagination?.isFetchingNextPage ? "Loading..." : "See More"}
                    isBottom
                />
            )}
        </SectionWrapper>
    );
};

import React, {useCallback, useEffect, useRef, useState} from "react";
import i18n from "i18next";
import {ClipLoader} from "react-spinners";
import {useOnClickOutside} from "usehooks-ts";

import createProjectCardPlaceholder from "./assets/create-project-card-placeholder.png";
import {
    Backdrop,
    BlankProjectButton,
    CloseButton,
    EmptyResults,
    GameCard,
    GameCardInfo,
    GameCardStats,
    GameCardThumbnail,
    GameCardTitle,
    GameGrid,
    LoadingIndicator,
    PickerContainer,
    PickerFooter,
    PickerHeader,
    PickerTitle,
    PromptPreview,
    ScrollArea,
    SearchInput,
    SectionLabel,
} from "./BaseGamePickerModal.style";
import {extractKeywords} from "./templateMatching";
import {getGamesByQuery} from "@stem/network/api/getGames";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {getThumbnail} from "@stem/editor-oss/utils/thumbnailUrl";
import {IBasicGameInterface} from "../../../../../v2/pages/types";
import {useEscapeDismiss} from "../../common/hooks/useEscapeDismiss";
import {FileData} from "../../types/file";

interface BaseGamePickerModalProps {
    prompt: string;
    templates: FileData[];
    onSelectGame: (gameId: string) => void;
    onBlankProject: () => void;
    onClose: () => void;
    isBusy: boolean;
}

const formatCount = (n?: number) => {
    const v = n ?? 0;
    if (v >= 1_000_000) return `${Math.round((v / 1_000_000) * 10) / 10}M`;
    if (v >= 1000) return `${Math.round((v / 1000) * 10) / 10}k`;
    return `${v}`;
};

export const BaseGamePickerModal = ({
    prompt,
    templates,
    onSelectGame,
    onBlankProject,
    onClose,
    isBusy,
}: BaseGamePickerModalProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<IBasicGameInterface[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [suggestedGames, setSuggestedGames] = useState<IBasicGameInterface[]>([]);
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(true);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const isPlayground = isPlaygroundMode();

    useOnClickOutside(containerRef as React.RefObject<HTMLElement>, onClose);
    useEscapeDismiss({onEscape: onClose});

    // Auto-search using keywords extracted from the user's prompt
    useEffect(() => {
        const keywords = extractKeywords(prompt);
        if (keywords.length === 0) {
            setIsLoadingSuggestions(false);
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                // Search by tags (comma-separated keywords) and by name (joined keywords)
                const [tagResults, nameResults] = await Promise.all([
                    getGamesByQuery({tags: keywords.join(","), limit: "12"}),
                    getGamesByQuery({name: keywords.join(" "), limit: "12"}),
                ]);

                if (cancelled) return;

                // Merge and deduplicate, prioritizing tag matches
                const seen = new Set<string>();
                const merged: IBasicGameInterface[] = [];
                for (const game of [...(tagResults || []), ...(nameResults || [])]) {
                    if (!seen.has(game.ID)) {
                        seen.add(game.ID);
                        merged.push(game);
                    }
                }
                setSuggestedGames(merged.slice(0, 12));
            } catch {
                // Silently fail — matching templates still show as fallback
            } finally {
                if (!cancelled) setIsLoadingSuggestions(false);
            }
        })();

        return () => { cancelled = true; };
    }, [prompt]);

    const performSearch = useCallback(async (query: string) => {
        if (!query.trim()) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        try {
            const results = await getGamesByQuery({name: query.trim(), limit: "12"});
            setSearchResults(results || []);
        } catch {
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    }, []);

    useEffect(() => {
        clearTimeout(debounceRef.current);
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }
        debounceRef.current = setTimeout(() => void performSearch(searchQuery), 300);
        return () => clearTimeout(debounceRef.current);
    }, [searchQuery, performSearch]);

    const renderGameCard = (game: {ID: string; Name: string; Thumbnail?: string; PlayCount?: number; Likes?: number}) => {
        const thumb = getThumbnail(game.Thumbnail ?? "") || createProjectCardPlaceholder;
        return (
            <GameCard
                key={game.ID}
                disabled={isBusy}
                onClick={() => onSelectGame(game.ID)}
            >
                <GameCardThumbnail $src={thumb} />
                <GameCardInfo>
                    <GameCardTitle>{game.Name}</GameCardTitle>
                    {!isPlayground && (
                        <GameCardStats>
                            <span>{i18n.t("{{count}} plays", {count: formatCount(game.PlayCount)})}</span>
                            <span>{i18n.t("{{count}} likes", {count: formatCount(game.Likes)})}</span>
                        </GameCardStats>
                    )}
                </GameCardInfo>
            </GameCard>
        );
    };

    return (
        <Backdrop>
            <PickerContainer ref={containerRef}>
                <PickerHeader>
                    <div>
                        <PickerTitle>{i18n.t("Choose a starting point")}</PickerTitle>
                        <PromptPreview title={prompt}>{prompt}</PromptPreview>
                    </div>
                    <CloseButton onClick={onClose} aria-label={i18n.t("Close")}>
                        &times;
                    </CloseButton>
                </PickerHeader>

                <SearchInput
                    placeholder={i18n.t("Search public games to remix...")}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    autoFocus
                />

                <ScrollArea>
                    {searchQuery.trim() ? (
                        <>
                            <SectionLabel>{i18n.t("Search Results")}</SectionLabel>
                            {isSearching ? (
                                <LoadingIndicator>
                                    <ClipLoader size={24} color="#0284c7" />
                                </LoadingIndicator>
                            ) : searchResults.length === 0 ? (
                                <EmptyResults>{i18n.t("No games found for “{{query}}”", {query: searchQuery})}</EmptyResults>
                            ) : (
                                <GameGrid>
                                    {searchResults.map(game => renderGameCard(game))}
                                </GameGrid>
                            )}
                        </>
                    ) : (
                        <>
                            {isLoadingSuggestions ? (
                                <LoadingIndicator>
                                    <ClipLoader size={24} color="#0284c7" />
                                </LoadingIndicator>
                            ) : suggestedGames.length > 0 ? (
                                <>
                                    <SectionLabel>{i18n.t("Suggested for your prompt")}</SectionLabel>
                                    <GameGrid>
                                        {suggestedGames.map(game => renderGameCard(game))}
                                    </GameGrid>
                                </>
                            ) : null}

                            {templates.length > 0 && (
                                <>
                                    <SectionLabel>{i18n.t("Templates")}</SectionLabel>
                                    <GameGrid>
                                        {templates.map(t => renderGameCard(t))}
                                    </GameGrid>
                                </>
                            )}
                        </>
                    )}
                </ScrollArea>

                <PickerFooter>
                    <BlankProjectButton disabled={isBusy} onClick={onBlankProject}>
                        {isBusy ? i18n.t("Opening...") : i18n.t("Start with blank project")}
                    </BlankProjectButton>
                </PickerFooter>
            </PickerContainer>
        </Backdrop>
    );
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {debounce} from "lodash";
import React, {useCallback, useEffect} from "react";

import {
    ButtonWrapper,
    Content,
    Description,
    ListItem,
    SceneImage,
    SceneName,
    Stats,
    StatsItem,
} from "./SingleTemplate.style";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {getThumbnail} from "@stem/editor-oss/utils/thumbnailUrl";
import {StyledButton} from "../../common/StyledButton";
import {TagsList} from "../../common/Tags/TagsList/TagsList";
import {ITemplate, TEMPLATES} from "../constants/templates";
import gamePlaceholder from "../images/game-thumbnail-default.jpg";
import playIcon from "../images/play-icon.svg";
import remixIcon from "../images/remix-icon.svg";

export const normalizeTags = (tags: string | string[]) => {
    if (!tags) return [];

    if (Array.isArray(tags)) return tags;

    try {
        return JSON.parse(tags) as string[];
    } catch {
        return [];
    }
};

interface Props {
    item: ITemplate;
    onClick: (id: string) => void;
    selectedItemId?: string;
    onDoubleClick: (id: string, newTab?: boolean) => void;
}

const SingleTemplateComponent = ({onClick, onDoubleClick, selectedItemId, item}: Props) => {
    const thumbnail = getThumbnail(item.Thumbnail || "null");
    const isSelected = selectedItemId === item.ID;
    const isPlayground = isPlaygroundMode();

    const debouncedOnClick = useCallback(
        debounce((id: string) => {
            if (onClick) onClick(id);
        }, 200),
        [onClick],
    );

    useEffect(() => {
        return () => {
            debouncedOnClick.cancel();
        };
    }, [debouncedOnClick]);

    const handleOpen = (e: any) => {
        if (e.target.name === "options") return;

        onDoubleClick(item.ID);
    };
    return (
        <ListItem
            onClick={() => debouncedOnClick(item.ID)}
            onDoubleClick={handleOpen}
            $active={!!isSelected}
        >
            <SceneImage
                $bgImage={thumbnail ?? gamePlaceholder}
                data-label={item.IsSandbox ? "Sandbox" : "Game"}
                $noLabel
            />
            {!isPlayground && (
                <Stats>
                    {!TEMPLATES.find(el => el.ID === item.ID) && (
                        <StatsItem>
                            <img
                                src={playIcon}
                                alt="play count"
                            />{" "}
                            {item.PlayCount ?? 0}
                        </StatsItem>
                    )}
                    <StatsItem>
                        <img
                            src={remixIcon}
                            alt="remix count"
                        />{" "}
                        {item.RemixCount ?? 0}
                    </StatsItem>
                </Stats>
            )}
            <Content>
                <SceneName className="sceneName">{item.Name}</SceneName>
                <TagsList
                    stemTags={normalizeTags(item.Tags)}
                    fullWidth
                    readOnly
                    oneLine
                />
                <Description className="hidden-scroll">{item.Description}</Description>
            </Content>
            <ButtonWrapper>
                <StyledButton
                    height="32px"
                    style={{
                        fontSize: "12px",
                        color: "#8B93A7",
                        backgroundColor: "transparent",
                        border: "1px solid #2a2e42",
                        width: "100%",
                    }}
                    customIcon={remixIcon}
                    onClick={() => onDoubleClick(item.ID)}
                >
                    Remix
                </StyledButton>
            </ButtonWrapper>
        </ListItem>
    );
};

export const SingleTemplate = React.memo(SingleTemplateComponent, (prevProps, nextProps) => {
    // Custom comparison function
    return (
        prevProps.item.ID === nextProps.item.ID &&
        prevProps.item.RemixCount === nextProps.item.RemixCount &&
        prevProps.item.Name === nextProps.item.Name &&
        prevProps.item.Thumbnail === nextProps.item.Thumbnail &&
        prevProps.item.IsSandbox === nextProps.item.IsSandbox &&
        prevProps.selectedItemId === prevProps.item.ID &&
        nextProps.selectedItemId === nextProps.item.ID
    );
});

SingleTemplate.displayName = "SingleTemplate";

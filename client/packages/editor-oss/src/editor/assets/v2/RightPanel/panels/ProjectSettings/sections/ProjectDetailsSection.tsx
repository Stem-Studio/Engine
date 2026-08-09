import {DebouncedFunc} from "lodash";
import React, {useEffect, useRef, useState} from "react";
import styled from "styled-components";

import {createSceneScreenShot} from "@stem/network/api/scene";
import {useAppGlobalContext, useAuthorizationContext} from "@stem/editor-oss/context";
import global from "@stem/editor-oss/global";
import {getThumbnail} from "@stem/editor-oss/utils/thumbnailUrl";
import {showToast} from "@stem/editor-oss/showToast";
import {getAIBackend} from "@stem/editor-oss/ai";
import Converter from "@stem/editor-oss/utils/Converter";
import {UploadUtils} from "@stem/editor-oss/utils/UploadUtils";
import {Tooltip} from "../../../../common";
import menuIcon from "../../../../common/StemCard/icons/menu-icon.svg";
import {StyledButton} from "../../../../common/StyledButton";
import {StyledTextarea} from "../../../../common/StyledTextarea";
import {AssetTagsInput} from "../../../../common/Tags/AssetTagsInput";
import {TextInput} from "../../../../common/TextInput";
import {UploadField} from "../../../../common/UploadField/UploadField";
import searchIcon from "../../../../icons/search.svg";
import {ContentItem} from "../../../common/ContentItem";
import expandArrow from "../../../icons/expand-arrow.svg";
import {PanelSectionTitle, PanelSectionTitleSecondary} from "../../../RightPanel.style";
import {ExpandButton, Section, TooltipRowWrapper, Warning, Wrapper} from "../ProjectSettings.style";

const CONTENT_RATING_OPTIONS = ["Unrated", "Everyone", "Everyone 10+", "Teen", "Mature 17+", "Adults Only"];

const StyledSelect = styled.select`
    width: 100%;
    height: 32px;
    padding: 6px 12px;
    border: 1px solid var(--theme-border-color, rgba(255, 255, 255, 0.1));
    border-radius: 4px;
    background-color: var(--theme-grey-bg, #1a1a1a);
    color: var(--theme-text-color, #ffffff);
    font-size: 12px;
    cursor: pointer;
    outline: none;

    &:hover {
        border-color: var(--theme-border-hover-color, rgba(255, 255, 255, 0.2));
    }

    &:focus {
        border-color: var(--theme-accent-color, #3b82f6);
    }

    option {
        background-color: var(--theme-grey-bg, #1a1a1a);
        color: var(--theme-text-color, #ffffff);
    }
`;

const HeroMenuContainer = styled.div`
    position: relative;
`;

const HeroMenuButton = styled.button`
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    opacity: 0.6;
    &:hover {
        opacity: 1;
    }
    &:disabled {
        opacity: 0.3;
        cursor: default;
    }
    img {
        width: 16px;
        height: 16px;
    }
`;

const HeroMenuDropdown = styled.div`
    position: absolute;
    top: 100%;
    right: 0;
    background: var(--theme-grey-bg, #1a1a1a);
    border: 1px solid var(--theme-border-color, rgba(255, 255, 255, 0.1));
    border-radius: 4px;
    padding: 4px 0;
    z-index: 100;
    min-width: 180px;
`;

const HeroMenuOption = styled.button`
    display: block;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    color: var(--theme-text-color, #ffffff);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    &:hover {
        background: rgba(255, 255, 255, 0.1);
    }
`;

const GeneratingOverlay = styled.div`
    width: 100%;
    height: 112px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--theme-grey-bg, #1a1a1a);
    border-radius: 4px;
    color: var(--theme-text-color, #ffffff);
    font-size: 12px;
    opacity: 0.7;
`;

interface GameDetailsProps {
    name: string;
    setName: (value: string) => void;
    description: string;
    setDescription: (value: string) => void;
    tags: string[];
    setTags: (tags: string[]) => void;
    game: {
        uuid: string;
        isGame: boolean;
        lives: number;
        maxScore: number;
        timer: number;
    };
    thumbnail: string;
    onThumbnailChange: (url: string) => void;
    suggestedSlug: string;
    setSuggestedSlug: (value: string) => void;
    isSlugError: boolean;
    slugErrorStatus: string;
    slugLocked: boolean;
    onNameChange: () => void;
    onDescriptionChange: () => void;
    onSaveSlug: () => void;
    onDeleteSlug: () => void;
    onInputChange: (value: any, name: string) => void;
    contentRating: string;
    onContentRatingChange: (rating: string) => void;
    debouncedSceneChange: DebouncedFunc<(data: any) => void>;
}

const GameDetailsSectionComponent = ({
    name,
    setName,
    description,
    setDescription,
    thumbnail,
    onThumbnailChange,
    suggestedSlug,
    setSuggestedSlug,
    isSlugError,
    slugErrorStatus,
    slugLocked,
    onNameChange,
    onDescriptionChange,
    onSaveSlug,
    onDeleteSlug,
    contentRating,
    onContentRatingChange,
    debouncedSceneChange,
}: GameDetailsProps) => {
    const editor = global.app!.editor!;
    const {sceneSize} = useAppGlobalContext();
    const {isAdmin} = useAuthorizationContext();
    const [gameDetailsExpanded, setGameDetailsExpanded] = useState(() => {
        const hasCustomTitle = !!name && name !== "Game Title";
        const hasDescription = !!description;
        return !(hasCustomTitle && hasDescription);
    });
    const [isGeneratingHero, setIsGeneratingHero] = useState(false);
    const [showHeroMenu, setShowHeroMenu] = useState(false);
    const heroMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showHeroMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (heroMenuRef.current && !heroMenuRef.current.contains(e.target as Node)) {
                setShowHeroMenu(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [showHeroMenu]);

    const handleGenerateHeroImage = async () => {
        setShowHeroMenu(false);
        setIsGeneratingHero(true);
        try {
            const file = await createSceneScreenShot();
            if (!file) throw new Error("Failed to capture screenshot");

            const dataUrl = await Converter.blobToDataURL(file);
            const base64 = dataUrl.split(",")[1];

            const response = await getAIBackend().request<{Code: number; Msg?: string; Data?: {image: string}}>(
                "/api/AI/ImageGeneration/HeroImage",
                {
                    method: "POST",
                    body: {screenshot: base64, description},
                    headers: {"X-BYOK-Provider": "openai"},
                },
            );

            const result = response.data;
            if (!response.ok || result?.Code !== 200 || !result?.Data?.image) {
                throw new Error(result?.Msg || "Failed to generate hero image");
            }

            const imageDataUrl = "data:image/png;base64," + result.Data.image;
            const imageFile = Converter.dataURLtoFile(imageDataUrl, "hero-image");

            await UploadUtils.uploadSingleFile(imageFile, "/api/Upload", (obj: any) => {
                if (obj.Data?.url) {
                    const url = obj.Data.url as string;
                    onThumbnailChange(url);
                    showToast({type: "success", body: "Hero image generated successfully!"});
                }
            });
        } catch (error) {
            showToast({type: "error", body: (error instanceof Error && error.message) || "Failed to generate hero image"});
        } finally {
            setIsGeneratingHero(false);
        }
    };

    const handleAddTag = (newTagsArray: string[]) => {
        editor.tags = newTagsArray;
        debouncedSceneChange({name, description, tags: newTagsArray});
    };

    const handleRemoveTag = (tag: string) => {
        const tagsValue = editor.tags.filter(el => el !== tag);
        editor.tags = tagsValue;
        debouncedSceneChange({name, description, tags: tagsValue});
    };

    return (
        <>
            <ContentItem
                $padding={"0 0 8px 4px"}
                $flexDirection="row"
                $justifyContent="space-between"
                $alignItems="center"
            >
                <PanelSectionTitle>Project Details</PanelSectionTitle>
                <ExpandButton $expanded={!gameDetailsExpanded}>
                    <img
                        className="bigArrow"
                        src={expandArrow}
                        onClick={() => setGameDetailsExpanded(!gameDetailsExpanded)}
                    />
                </ExpandButton>
            </ContentItem>
            {gameDetailsExpanded && (
                <Section style={{marginTop: "-8px"}}>
                    {sceneSize && (
                        <ContentItem>
                            <PanelSectionTitleSecondary>
                                Project Size: <span className="bold">{sceneSize.sizeMB} MB</span>{" "}
                            </PanelSectionTitleSecondary>
                            {sceneSize.warning && <Warning>{sceneSize.warning}</Warning>}
                        </ContentItem>
                    )}
                    <ContentItem>
                        <TooltipRowWrapper style={{marginBottom: "8px"}}>
                            <PanelSectionTitleSecondary>Name</PanelSectionTitleSecondary>
                            <Tooltip
                                text="Public title shown to players and in listings."
                                width="180px"
                            />
                        </TooltipRowWrapper>
                        <TextInput
                            value={name}
                            setValue={setName}
                            height="24px"
                            width="100%"
                            onBlur={onNameChange}
                            onEnter={onNameChange}
                        />
                    </ContentItem>
                    {isAdmin && (
                        <ContentItem>
                            <TooltipRowWrapper style={{height: "16px", marginBottom: "8px"}}>
                                <PanelSectionTitleSecondary>Project Slug</PanelSectionTitleSecondary>
                                <Wrapper>
                                    <Tooltip
                                        text="Allocates a subdomain for your game"
                                        width="180px"
                                    />
                                </Wrapper>
                            </TooltipRowWrapper>
                            <ContentItem
                                $padding={"4px 0 0px"}
                                $flexDirection="row"
                            >
                                <TextInput
                                    flex="1 1 auto"
                                    value={suggestedSlug ?? ""}
                                    setValue={value => setSuggestedSlug(value.toLowerCase())}
                                    height="32px"
                                    width="100%"
                                    textColor={isSlugError ? "#e5334d" : undefined}
                                    placeholder={"Slug for your game"}
                                    disabled={slugLocked}
                                />
                                {!slugLocked && (
                                    <span title="Check slug availability">
                                        <StyledButton
                                            customIcon={searchIcon}
                                            style={{fontWeight: "400"}}
                                            width={"40px"}
                                            isBlue
                                            onClick={onSaveSlug}
                                        />
                                    </span>
                                )}
                                {slugLocked && (
                                    <StyledButton
                                        addDeleteIcon
                                        style={{fontWeight: "400"}}
                                        width={"40px"}
                                        isBlue
                                        onClick={onDeleteSlug}
                                    />
                                )}
                            </ContentItem>
                            {isSlugError && slugErrorStatus && <Warning>{slugErrorStatus}</Warning>}
                        </ContentItem>
                    )}
                    <ContentItem>
                        <TooltipRowWrapper style={{marginBottom: "8px"}}>
                            <PanelSectionTitleSecondary>Description</PanelSectionTitleSecondary>
                            <Tooltip
                                text="Short summary used in discovery surfaces and share cards."
                                width="220px"
                            />
                        </TooltipRowWrapper>
                        <StyledTextarea
                            value={description}
                            setValue={setDescription}
                            height="64px"
                            width="100%"
                            placeholder="Write a description..."
                            onBlur={onDescriptionChange}
                        />
                    </ContentItem>
                    <ContentItem>
                        <TooltipRowWrapper style={{marginBottom: "8px"}}>
                            <PanelSectionTitleSecondary>Content Rating</PanelSectionTitleSecondary>
                            <Tooltip
                                text="Age-appropriateness guidance for your project."
                                width="180px"
                            />
                        </TooltipRowWrapper>
                        <StyledSelect
                            value={contentRating}
                            onChange={e => onContentRatingChange(e.target.value)}
                        >
                            {CONTENT_RATING_OPTIONS.map(option => (
                                <option
                                    key={option}
                                    value={option}
                                >
                                    {option}
                                </option>
                            ))}
                        </StyledSelect>
                    </ContentItem>
                    <ContentItem>
                        <TooltipRowWrapper style={{marginBottom: "8px"}}>
                            <PanelSectionTitleSecondary>Image</PanelSectionTitleSecondary>
                            <div style={{display: "flex", alignItems: "center", gap: "4px"}}>
                                <Tooltip
                                    text="Primary thumbnail/banner image for this project."
                                    width="190px"
                                />
                                {isAdmin && (
                                    <HeroMenuContainer ref={heroMenuRef}>
                                        <HeroMenuButton
                                            onClick={() => setShowHeroMenu(!showHeroMenu)}
                                            disabled={isGeneratingHero}
                                        >
                                            <img
                                                src={menuIcon}
                                                alt="menu"
                                            />
                                        </HeroMenuButton>
                                        {showHeroMenu && (
                                            <HeroMenuDropdown>
                                                <HeroMenuOption onClick={handleGenerateHeroImage}>
                                                    Generate Hero Image
                                                </HeroMenuOption>
                                            </HeroMenuDropdown>
                                        )}
                                    </HeroMenuContainer>
                                )}
                            </div>
                        </TooltipRowWrapper>
                        {isGeneratingHero ? (
                            <GeneratingOverlay>Generating hero image...</GeneratingOverlay>
                        ) : (
                            <UploadField
                                width="100%"
                                height="112px"
                                style={{backgroundColor: "var(--theme-grey-bg)"}}
                                withButton
                                uploadedFile={getThumbnail(thumbnail) || thumbnail}
                                setUploadedFile={imageUrl => {
                                    if (typeof imageUrl === "string" && imageUrl) {
                                        onThumbnailChange(imageUrl);
                                    }
                                }}
                                deleteHandler={() => onThumbnailChange("")}
                            />
                        )}
                    </ContentItem>
                    <ContentItem>
                        <AssetTagsInput
                            tags={editor.tags}
                            onTagsAdded={handleAddTag}
                            onTagDeleted={handleRemoveTag}
                        />
                    </ContentItem>
                </Section>
            )}
        </>
    );
};

export const GameDetailsSection = React.memo(GameDetailsSectionComponent);

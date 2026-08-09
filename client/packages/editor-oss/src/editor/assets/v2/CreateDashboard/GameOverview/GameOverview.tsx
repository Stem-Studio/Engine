/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {marked} from "marked";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import {ClipLoader} from "react-spinners";
import {useOnClickOutside} from "usehooks-ts";

import {
    BackLink,
    DescriptionSection,
    DescriptionText,
    EditableInput,
    EditIcon,
    ErrorState,
    GameTitle,
    InfoGrid,
    InfoLabel,
    InfoSection,
    InfoValue,
    MarkdownEditorWrapper,
    MarkdownPreview,
    MarkdownTextarea,
    MarkdownToolbar,
    OverviewContainer,
    SectionLabel,
    SectionLabelRow,
    TagChip,
    TagsRow,
    ThumbnailEditButton,
    ThumbnailWrapper,
    TitleRow,
    ToolbarButton,
    ToolbarDivider,
} from "./GameOverview.style";
import {MoreGamesByUser} from "./MoreGamesByUser";
import {MoreRemixes} from "./MoreRemixes";
import {OverviewActionBar} from "./OverviewActionBar";
import {getPlaceholderThumbnail} from "./placeholderThumbnails";
import {uploadSceneThumbnail} from "@stem/network/api/scene/thumbnail";
import {ROUTES} from "@web-shared/routes";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import {getThumbnail} from "@stem/editor-oss/utils/thumbnailUrl";
import {showToast} from "@stem/editor-oss/showToast";
import Ajax from "@stem/editor-oss/utils/Ajax";
import {PRODUCT_ANALYTICS_EVENTS, trackProductEvent} from "@stem/editor-oss/utils/productAnalytics";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {IEditorUser} from "../../../../../v2/pages/types";
import {useEscapeDismiss} from "../../common/hooks/useEscapeDismiss";
import {ProgressiveImage} from "../../common/ProgressiveImage/ProgressiveImage";
import {AssetTagsInput} from "../../common/Tags/AssetTagsInput";
import {normalizeTags} from "../../TemplatePanel/SingleTemplate/SingleTemplate";
import {FileData} from "../../types/file";
import editIconSvg from "../icons/edit.svg";

const DEFAULT_DESCRIPTION = "This project does not have a description yet.";

const formatMetricValue = (value?: number) => {
    const safeValue = value ?? 0;
    if (safeValue >= 1_000_000) return `${Math.round((safeValue / 1_000_000) * 10) / 10}M`;
    if (safeValue >= 1000) return `${Math.round((safeValue / 1000) * 10) / 10}k`;
    return `${safeValue}`;
};

const formatReleaseDate = (dateStr: string) => {
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString("en-US", {month: "long", year: "numeric"});
    } catch {
        return dateStr;
    }
};

export const GameOverview = () => {
    const {id} = useParams<{id: string}>();
    const location = useLocation();
    const navigate = useNavigate();
    const {getUser, dbUser, isAdmin} = useAuthorizationContext();
    const {myGames, archivedGames, communityGames, collaborativeGames, setShouldRefreshDashboard} =
        useHomepageContext();

    const [scene, setScene] = useState<FileData | null>(null);
    const [gameOwner, setGameOwner] = useState<IEditorUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Editable state
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitle, setEditTitle] = useState("");
    const [isEditingDescription, setIsEditingDescription] = useState(false);
    const [editDescription, setEditDescription] = useState("");
    const [isEditingTags, setIsEditingTags] = useState(false);
    const [savingField, setSavingField] = useState<string | null>(null);

    const titleInputRef = useRef<HTMLInputElement>(null);
    const thumbnailInputRef = useRef<HTMLInputElement>(null);
    const tagsEditorRef = useRef<HTMLDivElement>(null);
    const isPlayground = isPlaygroundMode();

    useOnClickOutside(tagsEditorRef as React.RefObject<HTMLElement>, () => {
        if (isEditingTags) setIsEditingTags(false);
    });

    const isOwner = !!dbUser?.id && scene?.UserID === dbUser.id;
    const isCollaborator = !!collaborativeGames.find(el => el.ID === id);
    const canEdit = isOwner || isCollaborator || isAdmin;

    const returnTo =
        location.state?.returnTo === ROUTES.DISCOVER || location.state?.returnTo === ROUTES.BROWSE
            ? ROUTES.BROWSE
            : ROUTES.DASHBOARD;

    // Route back deterministically. `navigate(-1)` is
    // unreliable here because several surfaces (FTUE guide, tab deep-link
    // cleanup) push history entries via `setSearchParams` without
    // `{replace: true}`, so a single Back press can land on an intermediate
    // same-URL state before reaching the intended dashboard/discover surface.
    const handleBack = useCallback(() => navigate(returnTo), [navigate, returnTo]);

    useEscapeDismiss({onEscape: handleBack});

    const fetchSceneById = useCallback(async (sceneId: string) => {
        try {
            const response = await Ajax.get({
                url: backendUrlFromPath(`/api/Scene/Get?ID=${sceneId}`),
                needAuthorization: false,
            });
            const obj = response?.data;
            if (obj?.Code === 200 && obj.Data) {
                return obj.Data as FileData;
            }
        } catch {
            return null;
        }
        return null;
    }, []);

    // Find scene from context or fetch it
    useEffect(() => {
        let cancelled = false;

        const loadScene = async () => {
            if (!id) {
                setScene(null);
                setGameOwner(null);
                setError("Game not found");
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);
            setGameOwner(null);

            const allGames = [...myGames, ...archivedGames, ...communityGames, ...collaborativeGames];
            console.debug(`[GameOverview] Looking for id="${id}", allGames count=${allGames.length}`);
            const found = allGames.find(g => g.ID === id);
            console.debug(`[GameOverview] Found: name="${found?.Name}", id="${found?.ID}"`);

            if (found) {
                if (cancelled) return;
                setScene(found);
                setLoading(false);
                return;
            }

            const fetchedScene = await fetchSceneById(id);
            if (cancelled) return;

            if (fetchedScene) {
                setScene(fetchedScene);
            } else {
                setScene(null);
                setError("Game not found");
            }

            setLoading(false);
        };

        void loadScene();

        return () => {
            cancelled = true;
        };
    }, [id, myGames, archivedGames, communityGames, collaborativeGames, fetchSceneById]);

    // Fetch owner info
    useEffect(() => {
        let cancelled = false;

        if (!scene?.UserID) {
            setGameOwner(null);
            return;
        }

        const fetchOwner = async () => {
            const user = await getUser(scene.UserID);
            if (!cancelled && user) setGameOwner(user);
        };
        void fetchOwner();

        return () => {
            cancelled = true;
        };
    }, [scene?.UserID, getUser]);

    // Check access for unpublished games
    const isUnpublishedAndNotAllowed = scene && !scene.IsPublished && !canEdit;

    useEffect(() => {
        if (!scene) return;
        trackProductEvent(PRODUCT_ANALYTICS_EVENTS.GAME_DETAIL_VIEWED, {
            scene_id: scene.ID,
            is_owner: isOwner,
            is_published: scene.IsPublished === true,
        });
    }, [isOwner, scene?.ID]);

    const saveField = useCallback(
        async (field: string, value: unknown) => {
            if (!scene) return;
            setSavingField(field);
            try {
                const response = await Ajax.post({
                    url: backendUrlFromPath(`/api/Scene/Edit`),
                    data: {
                        ID: scene.ID,
                        Name: scene.Name,
                        [field]: value,
                    },
                    msgBodyType: "multipart",
                });
                if (response?.data?.Code === 200) {
                    setScene(prev => (prev ? {...prev, [field]: value} : prev));
                    setShouldRefreshDashboard(true);
                    showToast({type: "success", title: "Saved"});
                } else {
                    showToast({type: "error", body: response?.data?.Msg || "Save failed"});
                }
            } catch {
                showToast({type: "error", title: "Failed to save"});
            } finally {
                setSavingField(null);
            }
        },
        [scene],
    );

    const handleTitleSave = () => {
        if (editTitle.trim() && editTitle !== scene?.Name) {
            void saveField("Name", editTitle.trim());
        }
        setIsEditingTitle(false);
    };

    const handleDescriptionSave = () => {
        if (editDescription !== scene?.Description) {
            void saveField("Description", editDescription);
        }
        setIsEditingDescription(false);
    };

    const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !scene) return;

        setSavingField("Thumbnail");
        try {
            const url = await uploadSceneThumbnail(scene.ID, scene.Name, file);
            setScene(prev => (prev ? {...prev, Thumbnail: url} : prev));
            setShouldRefreshDashboard(true);
            showToast({type: "success", title: "Thumbnail updated"});
        } catch (err: any) {
            showToast({type: "error", body: err.message || "Failed to upload thumbnail"});
        } finally {
            setSavingField(null);
        }
    };

    const handleTagsAdded = (newTags: string[]) => {
        if (!scene) return;
        void saveField("Tags", JSON.stringify(newTags));
    };

    const handleTagDelete = (tag: string) => {
        if (!scene) return;
        const currentTags = normalizeTags(scene.Tags);
        void saveField("Tags", JSON.stringify(currentTags.filter(t => t !== tag)));
    };

    if (loading) {
        return (
            <OverviewContainer>
                <ErrorState>
                    <ClipLoader
                        loading
                        size={40}
                        color="#0284c7"
                    />
                </ErrorState>
            </OverviewContainer>
        );
    }

    if (error || !scene) {
        return (
            <OverviewContainer>
                <ErrorState>
                    <span>{error || "Game not found"}</span>
                    <BackLink onClick={handleBack}>Go back</BackLink>
                </ErrorState>
            </OverviewContainer>
        );
    }

    if (isUnpublishedAndNotAllowed) {
        return (
            <OverviewContainer>
                <ErrorState>
                    <span>This game is not published</span>
                    <BackLink onClick={handleBack}>Go back</BackLink>
                </ErrorState>
            </OverviewContainer>
        );
    }

    const resolvedThumbnail = getThumbnail(scene.Thumbnail);
    const thumbnail = resolvedThumbnail || getPlaceholderThumbnail(scene.ID);
    const tags = normalizeTags(scene.Tags);
    const author = gameOwner?.username || gameOwner?.name;

    return (
        <OverviewContainer data-testid="game-overview">
            <BackLink onClick={handleBack}>&lt; Back</BackLink>

            {/* Thumbnail */}
            <ThumbnailWrapper>
                <ProgressiveImage
                    src={thumbnail}
                    alt={scene.Name}
                />
                {canEdit && (
                    <>
                        <ThumbnailEditButton onClick={() => thumbnailInputRef.current?.click()}>
                            {savingField === "Thumbnail" ? (
                                <ClipLoader
                                    loading
                                    size={12}
                                    color="#fff"
                                />
                            ) : (
                                <>
                                    <img
                                        src={editIconSvg}
                                        alt=""
                                    />
                                    Image
                                </>
                            )}
                        </ThumbnailEditButton>
                        <input
                            ref={thumbnailInputRef}
                            type="file"
                            accept="image/*"
                            style={{display: "none"}}
                            onChange={e => void handleThumbnailUpload(e)}
                        />
                    </>
                )}
            </ThumbnailWrapper>

            {/* Action Buttons */}
            <OverviewActionBar
                scene={scene}
                canEdit={canEdit}
                isOwner={isOwner}
                onSceneUpdate={updatedScene => setScene(updatedScene)}
            />

            {/* Game Info (on page background, no card) */}
            <InfoSection>
                {/* Title */}
                {isEditingTitle ? (
                    <EditableInput
                        ref={titleInputRef}
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        onBlur={handleTitleSave}
                        onKeyDown={e => {
                            if (e.key === "Enter") handleTitleSave();
                            if (e.key === "Escape") {
                                e.stopPropagation();
                                setIsEditingTitle(false);
                            }
                        }}
                        autoFocus
                    />
                ) : (
                    <TitleRow>
                        <GameTitle>{scene.Name}</GameTitle>
                        {canEdit && (
                            <EditIcon
                                src={editIconSvg}
                                alt="edit title"
                                onClick={() => {
                                    setEditTitle(scene.Name);
                                    setIsEditingTitle(true);
                                }}
                            />
                        )}
                    </TitleRow>
                )}

                {/* Info grid */}
                <InfoGrid>
                    <InfoLabel>Developer:</InfoLabel>
                    <InfoValue>{author ? `@${author}` : "Stem Studio Community"}</InfoValue>

                    {!isPlayground && (
                        <>
                            <InfoLabel>Total Plays:</InfoLabel>
                            <InfoValue>{formatMetricValue(scene.PlayCount)}</InfoValue>

                            <InfoLabel>Remixes:</InfoLabel>
                            <InfoValue>{formatMetricValue(scene.RemixCount)}</InfoValue>
                        </>
                    )}

                    <InfoLabel>Released:</InfoLabel>
                    <InfoValue>{formatReleaseDate(scene.UpdateTime)}</InfoValue>

                    <InfoLabel>Tags:</InfoLabel>
                    <InfoValue>
                        {isEditingTags ? (
                            <div ref={tagsEditorRef}>
                                <AssetTagsInput
                                    showLabel={false}
                                    tags={tags}
                                    onTagsAdded={handleTagsAdded}
                                    onTagDeleted={handleTagDelete}
                                />
                            </div>
                        ) : (
                            <TagsRow>
                                {canEdit && (
                                    <EditIcon
                                        src={editIconSvg}
                                        alt="edit tags"
                                        onClick={() => setIsEditingTags(true)}
                                    />
                                )}
                                {tags.length > 0 ? (
                                    tags.map(tag => <TagChip key={tag}>#{tag}</TagChip>)
                                ) : (
                                    <span style={{color: "var(--theme-font-tertiary)"}}>No tags</span>
                                )}
                            </TagsRow>
                        )}
                    </InfoValue>
                </InfoGrid>
            </InfoSection>

            {/* Description */}
            <DescriptionSection>
                <SectionLabelRow>
                    <SectionLabel>Game Description</SectionLabel>
                    {canEdit && !isEditingDescription && (
                        <EditIcon
                            src={editIconSvg}
                            alt="edit description"
                            onClick={() => {
                                setEditDescription(scene.Description || "");
                                setIsEditingDescription(true);
                            }}
                        />
                    )}
                </SectionLabelRow>
                {isEditingDescription ? (
                    <MarkdownDescriptionEditor
                        value={editDescription}
                        onChange={setEditDescription}
                        onSave={() => handleDescriptionSave()}
                        onCancel={() => setIsEditingDescription(false)}
                    />
                ) : (
                    <DescriptionMarkdown
                        description={scene.Description || DEFAULT_DESCRIPTION}
                        canEdit={canEdit}
                        onEdit={() => {
                            setEditDescription(scene.Description || "");
                            setIsEditingDescription(true);
                        }}
                    />
                )}
            </DescriptionSection>

            {!isPlayground && (
                <MoreRemixes
                    sceneId={scene.ID}
                    returnTo={returnTo}
                />
            )}

            {/* More Games by User. When the viewer is the owner we pass the
                in-memory lists from HomepageContext — which include private /
                unpublished scenes — so owners see their full catalog instead
                of only their public scenes (the /api/Scene/Public endpoint
                hides non-public games). */}
            {gameOwner && (
                <MoreGamesByUser
                    owner={gameOwner}
                    currentSceneId={scene.ID}
                    returnTo={returnTo}
                    ownerGamesOverride={
                        isOwner ? [...myGames, ...collaborativeGames, ...archivedGames] : undefined
                    }
                />
            )}
        </OverviewContainer>
    );
};

const DescriptionMarkdown = ({
    description,
    canEdit,
    onEdit,
}: {
    description: string;
    canEdit: boolean;
    onEdit: () => void;
}) => {
    const html = useMemo(() => {
        try {
            return marked.parse(description, {gfm: true, breaks: true}) as string;
        } catch {
            return description;
        }
    }, [description]);

    return (
        <DescriptionText
            onClick={canEdit ? onEdit : undefined}
            style={canEdit ? {cursor: "pointer"} : undefined}
            dangerouslySetInnerHTML={{__html: html}}
        />
    );
};

const insertMarkdown = (
    textarea: HTMLTextAreaElement,
    prefix: string,
    suffix: string,
    placeholder: string,
    setValue: (v: string) => void,
) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end) || placeholder;
    const replacement = `${prefix}${selected}${suffix}`;
    const newText = text.substring(0, start) + replacement + text.substring(end);
    setValue(newText);
    requestAnimationFrame(() => {
        textarea.focus();
        const cursorPos = start + prefix.length;
        textarea.setSelectionRange(cursorPos, cursorPos + selected.length);
    });
};

const MarkdownDescriptionEditor = ({
    value,
    onChange,
    onSave,
    onCancel,
}: {
    value: string;
    onChange: (v: string) => void;
    onSave: () => void;
    onCancel: () => void;
}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [showPreview, setShowPreview] = useState(false);

    const previewHtml = useMemo(() => {
        try {
            return marked.parse(value || "*Nothing to preview*", {gfm: true, breaks: true}) as string;
        } catch {
            return value;
        }
    }, [value]);

    const insert = (prefix: string, suffix: string, placeholder: string) => {
        if (textareaRef.current) {
            insertMarkdown(textareaRef.current, prefix, suffix, placeholder, onChange);
        }
    };

    return (
        <MarkdownEditorWrapper>
            <MarkdownToolbar>
                <ToolbarButton
                    title="Bold"
                    onClick={() => insert("**", "**", "bold")}
                >
                    B
                </ToolbarButton>
                <ToolbarButton
                    title="Italic"
                    onClick={() => insert("*", "*", "italic")}
                    style={{fontStyle: "italic"}}
                >
                    I
                </ToolbarButton>
                <ToolbarButton
                    title="Heading"
                    onClick={() => insert("## ", "", "heading")}
                >
                    H
                </ToolbarButton>
                <ToolbarDivider />
                <ToolbarButton
                    title="Link"
                    onClick={() => insert("[", "](url)", "text")}
                >
                    🔗
                </ToolbarButton>
                <ToolbarButton
                    title="Bullet list"
                    onClick={() => insert("- ", "", "item")}
                >
                    •
                </ToolbarButton>
                <ToolbarButton
                    title="Numbered list"
                    onClick={() => insert("1. ", "", "item")}
                >
                    1.
                </ToolbarButton>
                <ToolbarButton
                    title="Code"
                    onClick={() => insert("`", "`", "code")}
                >
                    &lt;/&gt;
                </ToolbarButton>
                <ToolbarDivider />
                <ToolbarButton
                    $active={showPreview}
                    title="Toggle preview"
                    onClick={() => setShowPreview(p => !p)}
                >
                    👁
                </ToolbarButton>
                <div style={{marginLeft: "auto", display: "flex", gap: 4}}>
                    <ToolbarButton
                        title="Cancel"
                        onClick={onCancel}
                        style={{fontSize: 11}}
                    >
                        ✕
                    </ToolbarButton>
                    <ToolbarButton
                        title="Save"
                        onClick={onSave}
                        style={{fontSize: 11, color: "var(--theme-color-success)"}}
                    >
                        ✓
                    </ToolbarButton>
                </div>
            </MarkdownToolbar>
            {showPreview ? (
                <MarkdownPreview dangerouslySetInnerHTML={{__html: previewHtml}} />
            ) : (
                <MarkdownTextarea
                    ref={textareaRef}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Escape") {
                            e.stopPropagation();
                            onCancel();
                        }
                    }}
                    placeholder="Write your game description using Markdown..."
                    autoFocus
                />
            )}
        </MarkdownEditorWrapper>
    );
};

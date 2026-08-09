import {ActionButtons} from "./ActionButtons/ActionButtons";
import {
    AuthorData,
    ButtonWrapper,
    CloseButton,
    Content,
    Description,
    ListItem,
    PositionWrapper,
    SceneImage,
    SceneInfoGrid,
    SceneName,
    Stats,
    StatsItem,
} from "./SceneDetailsPopup.style";
import {ShareScene} from "./ShareScene";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import i18n from "@stem/editor-oss/i18n/config";
import {getThumbnail} from "@stem/editor-oss/utils/thumbnailUrl";
import {IEditorUser} from "../../../../../v2/pages/types";
import {useEscapeDismiss} from "../../common/hooks/useEscapeDismiss";
import {ProgressiveImage} from "../../common/ProgressiveImage/ProgressiveImage";
import {TagsList} from "../../common/Tags/TagsList/TagsList";
import scenePlaceholder from "../../icons/stem-studio-project-placeholder.png";
import {normalizeTags} from "../../TemplatePanel/SingleTemplate/SingleTemplate";
import {FileData} from "../../types/file";
import playIcon from "../icons/play-icon.svg";
import remixIcon from "../icons/remix-icon.svg";
import timeIcon from "../icons/time.svg";
import closeIcon from "../icons/x-mark.svg";

const DEFAULT_DESCRIPTION = "This project does not have a description yet. Change it in Project Settings.";

export interface SceneItemProps {
    isCloneable: boolean;
    scene: FileData;
    setShowLoading?: (arg: boolean) => void;
    onDelete?: (id: string) => void;
    reload?: () => void;
    isCommunityGame: boolean;
    isOwnerSetted: boolean;
    openProject: ((id: string, newTab?: boolean) => void) | undefined;
    gameOwner: IEditorUser | null;
    setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
    onShowRemixPicker?: (data: {remixes: FileData[]; sceneName: string; onCreateNew: () => void}) => void;
}

export const SceneDetailsPopup = (props: SceneItemProps) => {
    const {scene, isCommunityGame, gameOwner} = props;
    const isMyGame = !isCommunityGame;
    const thumbnail = getThumbnail(scene.Thumbnail);
    const isPlayground = isPlaygroundMode();
    useEscapeDismiss({onEscape: () => props.setIsMenuOpen(false)});

    return (
        <PositionWrapper>
            <ListItem>
                <CloseButton
                    onClick={() => props.setIsMenuOpen(false)}
                    className="reset-css"
                >
                    <img
                        src={closeIcon}
                        alt={i18n.t("close")}
                    />
                </CloseButton>
                <SceneImage
                    data-label={scene.IsSandbox ? i18n.t("Sandbox") : i18n.t("Game")}
                >
                    <ProgressiveImage
                        src={thumbnail || scenePlaceholder}
                        alt={scene.Name}
                    />
                </SceneImage>
                {!isPlayground && (
                    <Stats>
                        <StatsItem>
                            <img
                                src={playIcon}
                                alt={i18n.t("play count")}
                            />{" "}
                            {scene.PlayCount ?? 0}
                        </StatsItem>
                        <StatsItem>
                            <img
                                src={remixIcon}
                                alt={i18n.t("remix count")}
                            />{" "}
                            {scene.RemixCount ?? 0}
                        </StatsItem>
                    </Stats>
                )}
                <Content>
                    {isMyGame ? (
                        <SceneInfoGrid>
                            <BasicData
                                scene={scene}
                                gameOwner={gameOwner}
                            />
                            <ShareScene scene={scene} />
                        </SceneInfoGrid>
                    ) : (
                        <BasicData
                            scene={scene}
                            gameOwner={gameOwner}
                        />
                    )}
                    <Description className="hidden-scroll">{scene.Description || i18n.t(DEFAULT_DESCRIPTION)}</Description>
                    <TagsList
                        stemTags={normalizeTags(scene.Tags)}
                        fullWidth
                        readOnly
                        oneLine
                        customColor="#484B52"
                    />
                </Content>
                <ButtonWrapper>
                    <ActionButtons
                        isMyGame={isMyGame}
                        {...props}
                    />
                </ButtonWrapper>
            </ListItem>
        </PositionWrapper>
    );
};

const BasicData = ({scene, gameOwner}: Pick<SceneItemProps, "scene" | "gameOwner">) => {
    return (
        <>
            <SceneName className="sceneName">{scene.Name}</SceneName>
            <AuthorData>
                {gameOwner?.username || gameOwner?.name}{" "}
                <span className="updateTime">
                    <img
                        src={timeIcon}
                        alt={i18n.t("last updated")}
                    />{" "}
                    {new Date(scene.UpdateTime).toLocaleDateString("en-US")}
                </span>
            </AuthorData>
        </>
    );
};

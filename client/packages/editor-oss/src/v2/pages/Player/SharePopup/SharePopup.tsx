import {marked} from "marked";
import {useMemo} from "react";

import {
    ActionButton,
    AdditionalData,
    ButtonsWrapper,
    GameDetails,
    GameTitle,
    LinkBox,
    ModelPreview,
    ShareSpace,
    Wrapper,
    Description,
} from "./SharePopup.style";
import {GetSceneResponse} from "@stem/network/api/scene/v2";
import {useAuthorizationContext} from "../../../../context";
import {getThumbnail} from "../../../../utils/thumbnailUrl";
import {getGameUrl} from "../../services";
import gamePlaceholder from "../icons/stem-studio-project-placeholder.png";

const defaultDescription =
    "No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet.  No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet.  No description yet. No description yet. No description yet. No description yet. No description yet. No description yet. No description yet.";

interface Props {
    handleShare: () => void;
    closePopup: () => void;
    scene: GetSceneResponse | null;
    viewerId: string;
}

export const SharePopup = ({handleShare, closePopup, scene, viewerId}: Props) => {
    const {dbUser} = useAuthorizationContext();
    const author = viewerId === scene?.userId ? dbUser?.username : "unknown";
    const sceneVersion = `${scene?.majorVersion || 0}.${scene?.minorVersion || 0}`;
    // const handleOpenAvatarCreator = () => {
    //     console.log("OPENING...", scene);
    // };

    const descriptionHtml = useMemo(() => {
        const description = scene?.description || defaultDescription;
        const normalizedDescription = description.replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
        return marked.parse(normalizedDescription, {gfm: true, breaks: true}) as string;
    }, [scene?.description]);

    return (
        <Wrapper>
            <ModelPreview $bgImg={getThumbnail(scene?.thumbnail || "") || gamePlaceholder} />
            <ShareSpace>
                <LinkBox>{getGameUrl(scene?.id || "", "")}</LinkBox>
                <ActionButton
                    $background="#414979"
                    $color="#E9E9E9"
                    $widthAuto
                    onClick={handleShare}
                >
                    Copy
                </ActionButton>
            </ShareSpace>

            <GameDetails>
                <GameTitle>{scene?.name}</GameTitle>
                <AdditionalData>@{author}</AdditionalData>
                <AdditionalData style={{marginTop: "-8px"}}>Version {sceneVersion}</AdditionalData>
                <Description className="hidden-scroll">
                    <div dangerouslySetInnerHTML={{__html: descriptionHtml}} />
                </Description>
            </GameDetails>

            <ButtonsWrapper>
                <ActionButton
                    $background="#414979"
                    $color="#E9E9E9"
                    $widthAuto
                    onClick={closePopup}
                >
                    Back to game
                </ActionButton>
                {/* <ActionButton
                    $color="#141729"
                    $background="#C8D144"
                    $widthAuto
                    onClick={handleOpenAvatarCreator}
                    style={{width: "327px"}}
                >
                    Make a friends avatar
                </ActionButton> */}
            </ButtonsWrapper>
        </Wrapper>
    );
};

import { useEffect, useState } from "react";
import {useTranslation} from "react-i18next";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";

import { EditedText, ListItem, SceneDetailsWrapper, SceneImage, SceneName } from "./SingleGame.style";
import { flexCenter } from "../../../../assets/style";
import { useAuthorizationContext } from "../../../../context";
import { Avatar } from "../../../../editor/assets/v2/Avatar/Avatar";
import { getThumbnail } from "../../../../utils/thumbnailUrl";
import gamePlaceholder from "../../../assets/game-controller.svg";
import playIcon from "../../../assets/play-icon.svg";
import { IBasicGameInterface, IEditorUser } from "../../types";

type Props = {
    item: IBasicGameInterface;
    heroSection?: boolean;
};

export const SingleGame = ({ item, heroSection }: Props) => {
    const {t} = useTranslation();
    const { getUser } = useAuthorizationContext();
    const navigate = useNavigate();
    const [gameOwner, setGameOwner] = useState<IEditorUser>();
    const [mouseDownPos, setMouseDownPos] = useState<{ x: number; y: number } | null>(null);
    const username = gameOwner?.username || gameOwner?.name;
    const thumbnail = getThumbnail(item.Thumbnail);

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        setMouseDownPos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseUp = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        if (!mouseDownPos) return;

        const deltaX = Math.abs(e.clientX - mouseDownPos.x);
        const deltaY = Math.abs(e.clientY - mouseDownPos.y);

        const swipeThreshold = 10;
        if (deltaX < swipeThreshold && deltaY < swipeThreshold) {
            openGame();
        }
        setMouseDownPos(null);
    };

    useEffect(() => {
        const getOwner = async () => {
            const response = await getUser(item.UserID);
            if (response) setGameOwner(response);
        };
        getOwner();
    }, []);

    const generateURL = () => {
        return item.Name.toLowerCase().replaceAll(" ", "_");
    };

    const openGame = () => {
        navigate(`/play/id-${item.ID}-${generateURL()}`);
    };

    // const handleGoToProfile = () => {
    //     if (!gameOwner) return;
    //     if (!username) return console.error("Username field doesn't exist.");
    //     navigate(getProfilePath(username));
    // };

    if (heroSection)
        return (
            <ListItem className="heroGameWrapper"
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
            >
                <SceneImage $bgImage={thumbnail}
                    className="game"
                >
                    {!thumbnail && <img className="default-img"
                        src={gamePlaceholder}
                        alt=""
                                   />}
                </SceneImage>
            </ListItem>
        );

    return (
        <ListItem className="singleGame"
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
        >
            <SceneImage $bgImage={thumbnail}>
                {!thumbnail && <img className="default-img"
                    src={gamePlaceholder}
                    alt=""
                               />}
            </SceneImage>

            <SceneDetailsWrapper $flex>
                <div className="textContainer">
                    <SceneName>{item.Name}</SceneName>
                    <EditedText>
                        <FlexContainer>
                            {t("Created by")} <Avatar name={username}
                                image={gameOwner?.avatar}
                                size={12}
                                       />{" "}
                            <span>{username}</span>
                        </FlexContainer>
                    </EditedText>
                </div>
                <PlayButton className="reset-css"
                    onClick={openGame}
                >
                    <img src={playIcon}
                        alt="play"
                    />
                </PlayButton>
            </SceneDetailsWrapper>
        </ListItem>
    );
};

const FlexContainer = styled.div`
    ${flexCenter};
    width: 100%;
    justify-content: flex-start;
    column-gap: 2px;
`;

const PlayButton = styled.button`
    width: 32px;
    height: 32px;
    border-radius: 8px;
    flex-shrink: 0;
    img {
        width: 100%;
        height: 100%;
        border-radius: 8px;
    }
`;

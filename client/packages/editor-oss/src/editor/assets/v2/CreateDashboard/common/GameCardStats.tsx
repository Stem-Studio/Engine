import React, {useEffect, useState} from "react";
import {useNavigate} from "react-router";
import {ClipLoader} from "react-spinners";

import {CardStat, CardStatsRow} from "./GameCard.style";
import {addLikedGame} from "@stem/network/api/updateUser";
import {ROUTES} from "@web-shared/routes";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {HeartIcon} from "../../../../../v2/pages/Home/PlayPage/HeartIcon";
import {FileData} from "../../types/file";
import heartOutlineIcon from "../icons/heart-outline.svg";
import playStatIcon from "../icons/play-stat.svg";
import remixStatIcon from "../icons/remix-stat.svg";
import shareStatIcon from "../icons/share-stat.svg";
import zeroCountIcon from "../icons/zero-count.svg";

export const formatMetricValue = (value?: number) => {
    const safeValue = value ?? 0;
    if (safeValue >= 1_000_000) {
        const compact = Math.round((safeValue / 1_000_000) * 10) / 10;
        return `${compact}M`;
    }
    if (safeValue >= 1000) {
        const compact = Math.round((safeValue / 1000) * 10) / 10;
        return `${compact}k`;
    }
    return `${safeValue}`;
};

export const GameCardStats = ({scene}: {scene: FileData}) => {
    const {setDbUser, handleGetLikedGames, likedGamesIds} = useAuthorizationContext();
    const navigate = useNavigate();
    const isPlayground = isPlaygroundMode();

    const [localLikes, setLocalLikes] = useState(scene.Likes ?? 0);
    const [userLikedGame, setUserLikedGame] = useState(false);
    const [loadingLike, setLoadingLike] = useState(false);

    useEffect(() => {
        if (likedGamesIds) {
            setUserLikedGame(likedGamesIds.includes(scene.ID));
        }
    }, [likedGamesIds, scene.ID]);

    useEffect(() => {
        setLocalLikes(scene.Likes ?? 0);
    }, [scene.Likes]);

    const handleUpdateLikes = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setLoadingLike(true);
        const res = await addLikedGame(scene.ID, setDbUser, () =>
            navigate(ROUTES.LOGIN, {state: {from: location.pathname}}),
        );
        await handleGetLikedGames();
        if (res) {
            setLocalLikes(res.likes);
        }
        setLoadingLike(false);
    };

    const remixCount = scene.RemixCount ?? 0;
    const shareCount = scene.ShareCount ?? 0;
    const isNonRemixable = scene.IsCloneable === false;

    if (isPlayground) {
        return null;
    }

    return (
        <CardStatsRow>
            <CardStat as="div" onClick={handleUpdateLikes} style={{cursor: "pointer"}}>
                {loadingLike ? (
                    <ClipLoader loading size={14} color="#0284c7" aria-label="Loading Spinner" />
                ) : userLikedGame ? (
                    <HeartIcon userLikedGame variant="dashboard" />
                ) : (
                    <img src={heartOutlineIcon} alt="like" />
                )}
                <span>{formatMetricValue(localLikes)}</span>
            </CardStat>
            {shareCount === 0 ? (
                <CardStat $disabled>
                    <img src={shareStatIcon} alt="share count" />
                    <img src={zeroCountIcon} alt="0" className="zero-count" />
                </CardStat>
            ) : (
                <CardStat>
                    <img src={shareStatIcon} alt="share count" />
                    <span>{formatMetricValue(shareCount)}</span>
                </CardStat>
            )}
            {isNonRemixable || remixCount === 0 ? (
                <CardStat $disabled style={isNonRemixable ? {textDecoration: "line-through"} : undefined}>
                    <img
                        src={remixStatIcon}
                        alt="remix count"
                        style={isNonRemixable ? {opacity: 0.5} : undefined}
                    />
                    <img src={zeroCountIcon} alt="0" className="zero-count" />
                </CardStat>
            ) : (
                <CardStat>
                    <img src={remixStatIcon} alt="remix count" />
                    <span>{formatMetricValue(remixCount)}</span>
                </CardStat>
            )}
            <CardStat>
                <img src={playStatIcon} alt="play count" />
                <span>{formatMetricValue(scene.PlayCount ?? 0)}</span>
            </CardStat>
        </CardStatsRow>
    );
};

import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import styled from "styled-components";

import {MoreGamesGrid, MoreGamesSection, MoreGamesTitle} from "./GameOverview.style";
import {getRemixes} from "@stem/network/api/getGames";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {getThumbnail} from "@stem/editor-oss/utils/thumbnailUrl";
import gamePlaceholder from "../../icons/stem-studio-project-placeholder.png";
import {FileData} from "../../types/file";
import {GameCardContainer, CardTitleRow, CardTitle, CardThumbnail} from "../common/GameCard.style";
import {GameCardStats} from "../common/GameCardStats";

interface MoreRemixesProps {
    sceneId: string;
    returnTo: string;
}

export const MoreRemixes = ({sceneId, returnTo}: MoreRemixesProps) => {
    const navigate = useNavigate();
    const {isAdmin} = useAuthorizationContext();
    const [remixes, setRemixes] = useState<FileData[]>([]);

    useEffect(() => {
        let cancelled = false;

        const fetchRemixes = async () => {
            const result = await getRemixes(sceneId);
            if (cancelled || !result) return;
            setRemixes(result.slice(0, 8) as unknown as FileData[]);
        };
        void fetchRemixes();

        return () => {
            cancelled = true;
        };
    }, [sceneId]);

    if (remixes.length === 0) {
        if (!isAdmin) return null;
        // Admin-only placeholder so admins understand why the section is empty
        // (non-admins still see nothing).
        return (
            <MoreGamesSection>
                <MoreGamesTitle>Remixes</MoreGamesTitle>
                <AdminEmptyNotice>
                    No public remixes of this game yet. (Visible to admins only.)
                </AdminEmptyNotice>
            </MoreGamesSection>
        );
    }

    return (
        <MoreGamesSection>
            <MoreGamesTitle>Remixes</MoreGamesTitle>
            <MoreGamesGrid>
                {remixes.map(remix => {
                    const thumbnail = getThumbnail(remix.Thumbnail) || gamePlaceholder;
                    return (
                        <GameCardContainer
                            key={remix.ID}
                            onClick={() => navigate(`/game/${remix.ID}`, {state: {returnTo}})}
                        >
                            <CardTitleRow>
                                <CardTitle>{remix.Name}</CardTitle>
                            </CardTitleRow>
                            <CardThumbnail $bgImage={thumbnail} />
                            <GameCardStats scene={remix} />
                        </GameCardContainer>
                    );
                })}
            </MoreGamesGrid>
        </MoreGamesSection>
    );
};

const AdminEmptyNotice = styled.div`
    padding: 12px 14px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px dashed rgba(255, 255, 255, 0.18);
    color: #8b93a7;
    font-family: "Lexend", sans-serif;
    font-size: 13px;
    line-height: 18px;
    font-style: italic;
`;

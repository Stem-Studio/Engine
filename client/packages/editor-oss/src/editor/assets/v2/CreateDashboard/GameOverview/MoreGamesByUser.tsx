import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import styled from "styled-components";

import {MoreGamesGrid, MoreGamesSection, MoreGamesTitle} from "./GameOverview.style";
import {getGames} from "@stem/network/api/getGames";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {getThumbnail} from "@stem/editor-oss/utils/thumbnailUrl";
import {IEditorUser} from "../../../../../v2/pages/types";
import gamePlaceholder from "../../icons/stem-studio-project-placeholder.png";
import {FileData} from "../../types/file";
import {GameCardContainer, CardTitleRow, CardTitle, CardThumbnail} from "../common/GameCard.style";
import {GameCardStats} from "../common/GameCardStats";

interface MoreGamesByUserProps {
    owner: IEditorUser;
    currentSceneId: string;
    returnTo: string;
    /*
     * When the viewer is the owner, the parent passes their full in-memory
     * catalog (incl. private/unpublished scenes) so we can skip the public
     * games API — which would otherwise only return published scenes and
     * usually produce an empty list for one's own profile.
     */
    ownerGamesOverride?: FileData[];
}

export const MoreGamesByUser = ({
    owner,
    currentSceneId,
    returnTo,
    ownerGamesOverride,
}: MoreGamesByUserProps) => {
    const navigate = useNavigate();
    const {isAdmin} = useAuthorizationContext();
    const [games, setGames] = useState<FileData[]>([]);

    useEffect(() => {
        if (ownerGamesOverride) {
            const seen = new Set<string>();
            const deduped = ownerGamesOverride.filter(g => {
                if (!g?.ID || g.ID === currentSceneId || seen.has(g.ID)) return false;
                seen.add(g.ID);
                return true;
            });
            setGames(deduped.slice(0, 8));
            return;
        }

        const fetchGames = async () => {
            const result = await getGames(owner.id);
            if (result) {
                const filtered = result
                    .filter(g => g.ID !== currentSceneId)
                    .slice(0, 8) as unknown as FileData[];
                setGames(filtered);
            }
        };
        void fetchGames();
    }, [owner.id, currentSceneId, ownerGamesOverride]);

    if (games.length === 0) {
        if (!isAdmin) return null;
        // Admin-only placeholder so admins understand why the section is empty
        // (non-admins still see nothing).
        return (
            <MoreGamesSection>
                <MoreGamesTitle>More Games by {owner.username || owner.name}</MoreGamesTitle>
                <AdminEmptyNotice>
                    No other games by this user. (Visible to admins only.)
                </AdminEmptyNotice>
            </MoreGamesSection>
        );
    }

    return (
        <MoreGamesSection>
            <MoreGamesTitle>More Games by {owner.username || owner.name}</MoreGamesTitle>
            <MoreGamesGrid>
                {games.map(game => {
                    const thumbnail = getThumbnail(game.Thumbnail) || gamePlaceholder;
                    return (
                        <GameCardContainer
                            key={game.ID}
                            onClick={() => navigate(`/game/${game.ID}`, {state: {returnTo}})}
                        >
                            <CardTitleRow>
                                <CardTitle>{game.Name}</CardTitle>
                            </CardTitleRow>
                            <CardThumbnail $bgImage={thumbnail} />
                            <GameCardStats scene={game} />
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

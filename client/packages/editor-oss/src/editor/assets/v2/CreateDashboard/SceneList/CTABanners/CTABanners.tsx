import {useMemo} from "react";

import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {BannerCard, BannerOverlay, BannerStat, BannerTag, BannerTitle, BannersGrid} from "./CTABanners.style";
import {ProgressiveImage} from "../../../common/ProgressiveImage/ProgressiveImage";
import {getThumbnail} from "@stem/editor-oss/utils/thumbnailUrl";
import {FileData} from "../../../types/file";

const formatStat = (value?: number) => {
    const v = value ?? 0;
    if (v >= 1_000_000) return `${Math.round((v / 1_000_000) * 10) / 10}M`;
    if (v >= 1000) return `${Math.round((v / 1000) * 10) / 10}k`;
    return `${v}`;
};

type Props = {
    communityGames: FileData[];
    onGameClick: (game: FileData) => void;
};

export const CTABanners = ({communityGames, onGameClick}: Props) => {
    const isPlayground = isPlaygroundMode();
    const mostPlayed = useMemo(
        () =>
            [...communityGames].sort((a, b) => (b.PlayCount ?? 0) - (a.PlayCount ?? 0))[0] ?? null,
        [communityGames],
    );

    const mostRemixed = useMemo(
        () =>
            [...communityGames].sort((a, b) => (b.RemixCount ?? 0) - (a.RemixCount ?? 0))[0] ?? null,
        [communityGames],
    );

    if (isPlayground || (!mostPlayed && !mostRemixed)) return null;

    return (
        <BannersGrid>
            {mostPlayed && (
                <BannerCard onClick={() => onGameClick(mostPlayed)}>
                    <ProgressiveImage
                        src={getThumbnail(mostPlayed.Thumbnail)}
                        alt={mostPlayed.Name}
                    />
                    <BannerOverlay>
                        <BannerTag>Most Played</BannerTag>
                        <BannerTitle>{mostPlayed.Name}</BannerTitle>
                        <BannerStat>{formatStat(mostPlayed.PlayCount)} plays</BannerStat>
                    </BannerOverlay>
                </BannerCard>
            )}
            {mostRemixed && (
                <BannerCard onClick={() => onGameClick(mostRemixed)}>
                    <ProgressiveImage
                        src={getThumbnail(mostRemixed.Thumbnail)}
                        alt={mostRemixed.Name}
                    />
                    <BannerOverlay>
                        <BannerTag>Most Remixed</BannerTag>
                        <BannerTitle>{mostRemixed.Name}</BannerTitle>
                        <BannerStat>{formatStat(mostRemixed.RemixCount)} remixes</BannerStat>
                    </BannerOverlay>
                </BannerCard>
            )}
        </BannersGrid>
    );
};

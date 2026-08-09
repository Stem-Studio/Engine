import {useMediaQuery} from "usehooks-ts";

import {StyledSceneList} from "./SceneList.style";
import {SceneListItem} from "./SceneListItem";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {LoadMore} from "../../../../../v2/common/LoadMore/LoadMore";
import {FileData} from "../../types/file";

export type SceneListProps = {
    data: FileData[];
    visibleData: FileData[];
    setVisibleData: React.Dispatch<React.SetStateAction<FileData[]>>;
};

export const HomePageSceneList = ({
    data,
    visibleData,
    setVisibleData,
}: SceneListProps) => {
    const {isAuthorized} = useAuthorizationContext();
    const isTabletL = useMediaQuery("(max-width: 1279px)");
    const isTablet = useMediaQuery("(max-width: 1023px)");
    const isMobile = useMediaQuery("(max-width: 767px)");
    const GAMES_VISIBILITY_COUNTER = isMobile ? 3 : isTablet ? 9 : isTabletL ? 12 : 15;

    if (!isAuthorized) {
        return (
            <>
                <StyledSceneList>
                    {visibleData.map((item, index) => (
                        <SceneListItem
                            key={item.ID + index}
                            item={item}
                        />
                    ))}
                </StyledSceneList>
                <LoadMore
                    visibilityCounter={GAMES_VISIBILITY_COUNTER}
                    itemsToLoad={data}
                    setVisibleResults={setVisibleData}
                    margin="20px auto 0"
                />
            </>
        );
    }
};

import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import Marquee from "react-fast-marquee";


import {
    SecondaryText,
    ListItem,
    SceneDetailsWrapper,
    SceneImage,
    SceneName,
    SceneNameContainer,
} from "./Projectslist.style";
import {useLibrariesContext} from "@stem/editor-oss/context";
import {getThumbnail} from "@stem/editor-oss/utils/thumbnailUrl";
import {InfoCard} from "../../../common/InfoCard/InfoCard";
import {InfoIcon} from "../../../common/InfoCard/InfoIcon";
import gamePlaceholder from "../../../icons/stem-studio-project-placeholder.png";
import {FileData} from "../../../types/file";
import {formatAssetCount} from "./projectAssetCount";

export const SingleProject = ({onSceneClick, item}: {onSceneClick: (item: FileData) => void; item: FileData}) => {
    const librariesContext = useLibrariesContext();
    const libraryContainerRef = librariesContext?.libraryContainerRef;
    const [isInfoCardVisible, setIsInfoCardVisible] = useState(false);
    const thumbnail = getThumbnail(item.Thumbnail);

    const assetsCountValue = item.AssetsCount ?? 0;
    const additionalText = formatAssetCount(assetsCountValue);
    return (
        <>
            <ListItem
                $defaultCursor={item.IsArchived}
                onClick={() => onSceneClick(item)}
            >
                <SceneImage
                    $bgImage={thumbnail || gamePlaceholder}
                    className="SceneImage"
                >
                    <InfoIcon
                        size={14}
                        infoIconBg="#ffffff"
                        absoluteIcon={{bottom: "13px", right: "16px"}}
                        setIsCardVisible={setIsInfoCardVisible}
                    />
                    {isInfoCardVisible &&
                        createPortal(
                            <InfoCard
                                item={item}
                                thumbnail={thumbnail || gamePlaceholder}
                                assetsCount={formatAssetCount(assetsCountValue)}
                                isCardVisible={isInfoCardVisible}
                                close={() => setIsInfoCardVisible(false)}
                                inLibrary
                            />,
                            libraryContainerRef.current as HTMLDivElement,
                        )}
                </SceneImage>

                <SceneDetailsWrapper className="SceneDetailsWrapper">
                    <SceneNameContainer $infoCardItem>
                        <MarqueeTitle text={item.Name} />
                        <SecondaryText className="EditedText">{additionalText}</SecondaryText>
                    </SceneNameContainer>
                </SceneDetailsWrapper>
            </ListItem>
        </>
    );
};

const MarqueeTitle = ({text}: {text: string}) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);

    const [isOverflow, setIsOverflow] = useState(false);
    const [isHovering, setIsHovering] = useState(false);

    const checkOverflow = () => {
        if (wrapperRef.current && textRef.current) {
            const wrapperWidth = wrapperRef.current.clientWidth;
            const textWidth = textRef.current.scrollWidth;
            setIsOverflow(textWidth > wrapperWidth);
        }
    };

    useLayoutEffect(() => {
        checkOverflow();
    }, [text]);

    useEffect(() => {
        if (!wrapperRef.current) return;

        const observer = new ResizeObserver(checkOverflow);
        observer.observe(wrapperRef.current);

        return () => observer.disconnect();
    }, []);

    return (
        <SceneName
            className="SceneName"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
        >
            <div
                ref={wrapperRef}
                style={{
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                }}
            >
                {/* hidden span for measurement */}
                <span
                    ref={textRef}
                    style={{
                        position: "absolute",
                        visibility: "hidden",
                        whiteSpace: "nowrap",
                    }}
                >
                    {text}
                </span>

                {isOverflow && isHovering ? (
                    <Marquee
                        speed={25}
                        delay={0}
                    >
                        {text}
                        <div style={{width: "24px"}} />
                    </Marquee>
                ) : (
                    <span
                        style={{
                            display: "block",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {text}
                    </span>
                )}
            </div>
        </SceneName>
    );
};

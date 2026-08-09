import {useState} from "react";

import fullscreenIcon from "./images/fullscreen.svg";
import {SearchInput} from "../common/SearchInput";
import {ActiveTabContent} from "./ActiveTabContent/ActiveTabContent";
import {AnimatedTabs} from "./AnimatedTabs/AnimatedTabs";
import {AssetsContainaer, FlexWrapper, Nav, MainFlexWrapper, Wrapper, InfoContainer} from "./AssetsLibrary.style";
import {Filters} from "./Filters/Filters";
import {Projects} from "./Projects/Projects";
import {TABS} from "./types";
import {Overlay} from "../common/Overlay";
import {FolderContent} from "./FoldersView/FolderContent/FolderContent";
import {FoldersView} from "./FoldersView/FoldersView";
import minimizeIcon from "./images/minimize.svg";
import x from "./images/x.svg";
import {LibraryNavigation} from "./LibraryNavigation/LibraryNavigation";
import {useLibrariesContext} from "@stem/editor-oss/context";

interface Props {
    close: () => void;
}

export const AssetsLibrary = ({close}: Props) => {
    const {activeSceneLibrary, activeTab, activeFolder, search, setSearch, libraryContainerRef} = useLibrariesContext();
    const isScenesTab = activeTab === TABS.ASSET_PACK || activeTab === TABS.Projects;
    const canRenderSceneView = !activeSceneLibrary && !activeFolder;
    const [isFullScreen, setIsFullScreen] = useState(true);
    const renderFilters = !(activeSceneLibrary && !activeFolder);
    return (
        <Overlay>
            <Wrapper
                ref={!isFullScreen ? libraryContainerRef : null}
                $isFullScreen={isFullScreen}
            >
                <Nav>
                    <AnimatedTabs />
                    <FlexWrapper className="library-nav-actions"
                        $gap="0 8px"
                    >
                        <SearchInput
                            width="172px"
                            alwaysOpen
                            value={search}
                            onChange={value => setSearch(value.toLowerCase())}
                        />
                        <FlexWrapper className="library-window-actions">
                            <button className="reset-css"
                                type="button"
                                aria-label={isFullScreen ? "Minimize library" : "Maximize library"}
                                onClick={() => setIsFullScreen(prev => !prev)}
                            >
                                <img
                                    src={isFullScreen ? minimizeIcon : fullscreenIcon}
                                    alt={isFullScreen ? "minimize" : "go full screen"}
                                />
                            </button>
                            <button className="reset-css"
                                type="button"
                                aria-label="Close library"
                                onClick={close}
                            >
                                <img
                                    src={x}
                                    alt="close"
                                />
                            </button>
                        </FlexWrapper>
                    </FlexWrapper>
                </Nav>
                {renderFilters && <Filters isFullScreen={isFullScreen} />}
                <MainFlexWrapper $filtersRendered={renderFilters}>
                    <AssetsContainaer className="hidden-scroll">
                        {isScenesTab && canRenderSceneView && <Projects />}
                        {!isScenesTab && <ActiveTabContent />}
                        {activeSceneLibrary && (
                            <>
                                <LibraryNavigation />
                                {activeFolder ? <FolderContent /> : <FoldersView />}
                            </>
                        )}
                    </AssetsContainaer>
                    {isFullScreen && (
                        <InfoContainer
                            ref={libraryContainerRef}
                            $filtersRendered={renderFilters}
                        >
                            <span className="label">Object Overview</span>
                        </InfoContainer>
                    )}
                </MainFlexWrapper>
            </Wrapper>
        </Overlay>
    );
};

import {useRef} from "react";

import {DashboardHeader} from "./DashboardHeader/DashboardHeader";
import {
    Container,
    FlexContainer,
    HomepageContainer,
    MainColumn,
    RightSideContainer,
} from "./DashboardLayout.style";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {useWindowPathname} from "@stem/editor-oss/hooks/useWindowPathname";
import {ROUTES} from "@web-shared/routes";
import {Footer} from "../../../../../v2/Footer/Footer";
import {CreateHomepageHero} from "../CreateHomepageHero/CreateHomepageHero";

export const DashboardLayout = ({children}: {children: React.ReactNode}) => {
    const ref = useRef<HTMLDivElement>(null);
    const {isAuthorized} = useAuthorizationContext();
    const pathname = useWindowPathname();
    const showPublicContent =
        pathname === ROUTES.BROWSE ||
        pathname === ROUTES.DISCOVER ||
        pathname === ROUTES.REMIX ||
        pathname.startsWith("/game/");
    const showCreateHomepage = pathname === ROUTES.HOME && !showPublicContent;
    const showDashboardFooter =
        showCreateHomepage ||
        pathname === ROUTES.DASHBOARD ||
        pathname === ROUTES.BROWSE ||
        pathname === ROUTES.DISCOVER ||
        pathname === ROUTES.REMIX ||
        pathname === ROUTES.SETTINGS;

    return (
        <>
            <Container
                ref={ref}
                $homepage={showCreateHomepage}
            >
                {isAuthorized || showPublicContent ? (
                    <FlexContainer>
                        <MainColumn>
                            <DashboardHeader />
                            <RightSideContainer>
                                {children}
                                {showDashboardFooter && <Footer />}
                            </RightSideContainer>
                        </MainColumn>
                    </FlexContainer>
                ) : (
                    <>
                        <DashboardHeader />
                        <HomepageContainer>
                            <CreateHomepageHero />
                            <Footer />
                        </HomepageContainer>
                    </>
                )}
            </Container>
        </>
    );
};

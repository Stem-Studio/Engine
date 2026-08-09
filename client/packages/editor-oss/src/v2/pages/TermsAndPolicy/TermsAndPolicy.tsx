import {useEffect} from "react";

import {Attributions} from "./Attributions";
import {PrivacyPolicy} from "./PrivacyPolicy";
import {Container, Content, Wrapper} from "./TermsAndPolicy.style";
import {TOS} from "./TOS";
import {DashboardHeader} from "../../../editor/assets/v2/CreateDashboard/DashboardLayout/DashboardHeader/DashboardHeader";
import {Footer} from "../../Footer/Footer";

// The Terms and Privacy Policy are now written as community-driven
// starting-point templates rather than corporate documents tied to a
// single entity (see TOS.tsx / PrivacyPolicy.tsx). They render in both
// this app shell and downstream forks; public deployments should review
// and customise them for their jurisdiction before relying on them.
const privacyPolicyDate = "May 17, 2026";
const TOSDate = "May 17, 2026";

type TermsAndPolicyProps = {
    privacyPolicy?: boolean;
    attributions?: boolean;
};

export const TermsAndPolicy = ({privacyPolicy, attributions}: TermsAndPolicyProps) => {
    useEffect(() => {
        // Scroll to top when component mounts
        window.scrollTo(0, 0);
    }, []);

    const getTitle = () => {
        if (attributions) return "Third-Party Attributions";
        if (privacyPolicy) return "Privacy Policy";
        return "Terms of Service";
    };

    const getDate = () => {
        if (attributions) return new Date().toLocaleDateString("en-US", {year: "numeric", month: "long", day: "numeric"});
        if (privacyPolicy) return privacyPolicyDate;
        return TOSDate;
    };

    const getContent = () => {
        if (attributions) return <Attributions />;
        if (privacyPolicy) return <PrivacyPolicy />;
        return <TOS />;
    };

    return (
        <Container>
            <DashboardHeader />
            <Wrapper>
                <Content>
                    <header className="title">{getTitle()}</header>
                    {!attributions && <div className="updateDate">Last Revised on {getDate()}.</div>}
                    {attributions && <div className="updateDate">Generated on {getDate()}</div>}
                    <div className="text">{getContent()}</div>
                </Content>
            </Wrapper>
            <Footer />
        </Container>
    );
};

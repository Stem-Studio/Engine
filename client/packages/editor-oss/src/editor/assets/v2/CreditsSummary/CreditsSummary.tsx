import {useEffect, useState} from "react";
import {toast} from "toastywave";

import {SummaryCard, SummaryRow, ButtonRow, ActionButton} from "./CreditsSummary.style";
import {getSubscriptionStatus, openBillingPortal, SubscriptionStatus} from "@stem/network/api/stripe";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {isStripeCreditsPurchasingEnabled} from "@stem/editor-oss/utils/featureFlags";
import {CreditsPurchaseModal} from "../CreditsPurchaseModal/CreditsPurchaseModal";
import {Heading} from "../CreateDashboard/SettingsPage/SettingsPage.style";

export const CreditsSummary = () => {
    const {aiCredits, refreshAiCredits} = useAuthorizationContext();
    const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => {
        if (!isStripeCreditsPurchasingEnabled()) return;
        getSubscriptionStatus()
            .then(setSubscription)
            .catch(() => setSubscription({hasSubscription: false}));
    }, []);

    useEffect(() => {
        if (!isStripeCreditsPurchasingEnabled()) return;

        void refreshAiCredits();
        const intervalId = window.setInterval(() => void refreshAiCredits(), 15000);

        return () => window.clearInterval(intervalId);
    }, [refreshAiCredits]);

    if (!isStripeCreditsPurchasingEnabled()) {
        return null;
    }

    const planName = subscription?.hasSubscription ? subscription.productId : "Free";

    const handleManagePlan = async () => {
        try {
            const url = await openBillingPortal();
            window.location.href = url;
        } catch {
            toast.error("Failed to open billing portal");
        }
    };

    return (
        <>
            <div className="box">
                <Heading>AI Credits</Heading>
                <SummaryCard>
                    <SummaryRow>
                        <label>Balance</label>
                        <span>{aiCredits ?? 0} credits</span>
                    </SummaryRow>
                    <SummaryRow>
                        <label>Plan</label>
                        <span style={{textTransform: "capitalize"}}>{planName}</span>
                    </SummaryRow>
                    <ButtonRow>
                        {subscription?.hasSubscription && (
                            <ActionButton $variant="secondary"
                                onClick={handleManagePlan}
                            >
                                Manage plan
                            </ActionButton>
                        )}
                        <ActionButton $variant="primary"
                            onClick={() => setModalOpen(true)}
                        >
                            Buy credits
                        </ActionButton>
                        <ActionButton
                            $variant="dark"
                            onClick={() => toast.info("BYOK coming soon")}
                        >
                            Enable BYOK
                        </ActionButton>
                    </ButtonRow>
                </SummaryCard>
            </div>

            {modalOpen && <CreditsPurchaseModal onClose={() => setModalOpen(false)} hasSubscription={subscription?.hasSubscription ?? false} />}
        </>
    );
};

import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";

import {AccountTypes} from "./AccountTypes/AccountTypes";
import {Limits} from "./Limits/Limits";
import {Navigation} from "./Navigation/Navigation";
import {Products} from "./Products/Products";
import {Registrations} from "./Registrations/Registrations";
import {Templates} from "./Templates/Templates";
import {URLMapping} from "./URLMapping/URLMapping";
import {WhitelistManagement} from "./Whitelist/WhitelistManagement";
import {ROUTES} from "@web-shared/routes";
import {useAppGlobalContext} from "@stem/editor-oss/context/AppGlobalContext";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {showToast} from "@stem/editor-oss/showToast";
import {Container} from "../SettingsPage/SettingsPage.style";

export enum TABS {
    WHITELIST = "Approved Users",
    REGISTRATIONS = "Registrations",
    AI_LIMITS = "AI Limits",
    ACCOUNT_TYPES = "Account Types",
    MAPPING = "URL Mapping",
    TEMPLATES = "Templates",
    PRODUCTS = "Products",
}

export const AdminPanel = () => {
    const {isAdmin} = useAuthorizationContext();
    const {setMainLoaderState} = useAppGlobalContext();
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState(TABS.WHITELIST);
    const navigate = useNavigate();

    useEffect(() => {
        if (!isAdmin) {
            showToast({type: "error", title: "Access forbidden."});
            void navigate(ROUTES.HOME);
        }
    }, [isAdmin, navigate]);

    useEffect(() => {
        setMainLoaderState({visible: loading, message: ""});
    }, [setMainLoaderState, loading]);

    if (!isAdmin) return;

    return (
        <Container>
            <Navigation
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                tabs={TABS}
            />
            {activeTab === TABS.WHITELIST && (
                <WhitelistManagement
                    loading={loading}
                    setLoading={setLoading}
                />
            )}
            {activeTab === TABS.REGISTRATIONS && <Registrations />}
            {activeTab === TABS.AI_LIMITS && <Limits />}
            {activeTab === TABS.ACCOUNT_TYPES && <AccountTypes />}
            {activeTab === TABS.MAPPING && <URLMapping />}
            {activeTab === TABS.TEMPLATES && <Templates />}
            {activeTab === TABS.PRODUCTS && <Products />}
        </Container>
    );
};

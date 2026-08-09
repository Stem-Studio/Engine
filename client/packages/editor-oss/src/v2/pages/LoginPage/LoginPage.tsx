import {useEffect} from "react";
import {useLocation, useNavigate} from "react-router-dom";

import {ROUTES} from "@web-shared/routes";

export const LoginPage = () => {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const returnTo =
            params.get("returnTo") ||
            params.get("from") ||
            sessionStorage.getItem("loginRedirectFrom") ||
            (location.state?.from as string | undefined) ||
            "";
        sessionStorage.removeItem("loginRedirectFrom");
        const destination = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : ROUTES.DASHBOARD;
        void navigate(destination, {replace: true});
    }, [location.search, location.state, navigate]);

    return null;
};

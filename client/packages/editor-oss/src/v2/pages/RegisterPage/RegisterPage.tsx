import {useEffect} from "react";
import {useNavigate} from "react-router-dom";

import {ROUTES} from "@web-shared/routes";

export interface IForm {
    firstName: string;
    lastName: string;
    company: string;
    email: string;
    role: string;
    aiFamiliarity: string;
}

export const RegisterPage = () => {
    const navigate = useNavigate();

    useEffect(() => {
        void navigate(ROUTES.DASHBOARD, {replace: true});
    }, [navigate]);

    return null;
};

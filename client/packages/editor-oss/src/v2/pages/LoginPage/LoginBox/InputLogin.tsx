import {useTranslation} from "react-i18next";
import {useNavigate} from "react-router";
import styled from "styled-components";

import {ROUTES} from "@web-shared/routes";
import {flexCenter} from "../../../../assets/style";
import {loginButtonCommonCss} from "../LoginPage.style";

export const InputLogin = () => {
    const {t} = useTranslation();
    const navigate = useNavigate();

    return (
        <Wrapper>
            <LoginButton
                type="button"
                data-testid="login-email-submit"
                onClick={() => navigate(ROUTES.DASHBOARD)}
            >
                {t("Continue to local dashboard")}
            </LoginButton>
        </Wrapper>
    );
};

const Wrapper = styled.div`
    width: 100%;
    ${flexCenter};
    flex-direction: column;
    row-gap: 16px;
`;

export const LoginButton = styled.button`
    ${loginButtonCommonCss};
    margin: 0;
    border: 0.5px solid #02c782;
    background: rgba(2, 199, 130, 0.1);
    cursor: pointer;
    color: #f8fafccc;
    text-align: center;
    font-weight: 400;
`;

export const InputContainer = styled.div`
    width: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: flex-start;
    flex-direction: column;
    row-gap: 8px;
`;

import React from "react";
import {useTranslation} from "react-i18next";

import warningIcon from "./icons/warning.svg";
import xIcon from "./icons/x-btn.svg";
import {
    UILogin,
    LoginContainer,
    LoginForm,
    LoginHeader,
    InputWrapper,
    ReminderMessage,
    SubmitBtn,
} from "./InGameLogin.style";
import EventBus, { IN_GAME_EVENTS } from "../../../behaviors/event/EventBus";
import global from "../../../global";
import { IUser } from "../../../userManagement/types";
import {OSS_LOCAL_USER_ID} from "@web-shared/ossUser";

export type LoginProviderType = "email" | "google" | "apple" | "guest" | "discord";

export interface GameLoginData {
    username: string;
    email: string | null;
    avatarUrl?: string | null;
    provider: LoginProviderType;
    token: string | null;
    isGuest: boolean;
}

interface Props {
    isReminder: boolean;
    cleanupPopup: () => void
    setIsGuest: React.Dispatch<React.SetStateAction<boolean>>
}

const OSS_DUMMY_TOKEN = "stemstudio-token";

export const InGameLogin = ({ isReminder, cleanupPopup, setIsGuest }: Props) => {
    const {t} = useTranslation();

    const closePopup = (userData: GameLoginData) => {
        setIsGuest(userData.isGuest);
        EventBus.instance.send(IN_GAME_EVENTS.GAME_LOGIN_SUCCESS, userData);
        cleanupPopup();
    };

    const generateGuestUsername = () => {
        const randomNumber = Math.floor(10000 + Math.random() * 90000);
        return `guest${randomNumber}`;
    };

    const continueAsLocalPlayer = () => {
        const username = global.app?.authManager.getUserName() || "local";
        const token = global.app?.authManager.getAuthToken() || OSS_DUMMY_TOKEN;
        const user: IUser = {
            id: OSS_LOCAL_USER_ID,
            name: username || generateGuestUsername(),
            email: null,
            firebaseId: OSS_LOCAL_USER_ID,
            avatar: "",
            username,
            token,
            isGuest: false,
            platform: "anonymous",
        };
        global.app?.authManager.setUserAndToken(user, token);
        closePopup({
            username,
            email: null,
            provider: "guest",
            token,
            isGuest: false,
        });
    };

    return (
        <UILogin>
            <LoginContainer>
                <LoginForm>
                    <LoginHeader>{isReminder ? <>
                        <img className="warningIcon"
                            src={warningIcon}
                            alt=""
                        />
                        {t("Warning")}
                        <button className="reset-css closeButton"
                            onClick={cleanupPopup}
                        ><img className="xIcon"
                            src={xIcon}
                            alt=""
                        /></button>
                    </>
                        : t("Log In")}
                    </LoginHeader>
                    <InputWrapper>
                        {isReminder &&
                            <ReminderMessage>
                                {t("Local progress is stored on this device.")}
                            </ReminderMessage>
                        }
                    </InputWrapper>
                    <SubmitBtn className="no-highlight" onClick={continueAsLocalPlayer}>
                        <span className="btnLabel">{t("Continue")}</span>
                    </SubmitBtn>
                </LoginForm>
            </LoginContainer>
        </UILogin>
    );
};

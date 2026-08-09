/* eslint-disable @typescript-eslint/no-unused-expressions */
import {getAuthProvider} from "../../../../../auth";
import {useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import {useNavigate} from "react-router-dom";
import {toast} from "toastywave";

import logoutIcon from "./assets/arrow-up-right.svg";
import {BYOKKeysPanel} from "./BYOKKeysPanel/BYOKKeysPanel";
import {
    AccountBox,
    Container,
    DeleteAccountButton,
    DeleteBox,
    ErrorMessage,
    Heading,
    InputWrapper,
    LegalBox,
    LogoutBox,
    ValidationInput,
} from "./SettingsPage.style";
import {ROUTES} from "@web-shared/routes";
import {useAppGlobalContext} from "@stem/editor-oss/context/AppGlobalContext";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {showToast} from "@stem/editor-oss/showToast";
import {Confirm} from "../../../../../ui";
import Ajax from "@stem/editor-oss/utils/Ajax";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import errorIcon from "../../../../../v2/pages/LoginPage/images/error.svg";
import successIcon from "../../../../../v2/pages/LoginPage/images/success.svg";
import {StyledButton} from "../../common/StyledButton";
import {CreditsSummary} from "../../CreditsSummary/CreditsSummary";
import arrow from "../../icons/arrow-up-right.svg";
import deleteIcon from "../../icons/delete-icon.svg";

export const SettingsPage = () => {
    const {t} = useTranslation();
    const {dbUser, validateUsername, saveUsernameInFirebase, handleLogOut, onLogOut} = useAuthorizationContext();
    const {setMainLoaderState} = useAppGlobalContext();
    const navigate = useNavigate();
    const navigationOptions = {state: {from: ROUTES.SETTINGS}};

    const [username, setUsername] = useState(dbUser?.username ?? "");
    const [email, setEmail] = useState(dbUser?.email ?? "");
    const [isUsernameValid, setIsUsernameValid] = useState(false);
    const [showValidationBorder, setShowValidationBorder] = useState(false);
    const [errorMessage, setErrorMessage] = useState(t("Sorry! That username is already taken."));
    const [showLoading, setShowLoading] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const resetUsernameValidation = () => {
        setShowValidationBorder(false);
        setIsUsernameValid(false);
    };

    useEffect(() => {
        const handlevalidateUsername = async () => {
            const usernameAvailable = await validateUsername(username);
            setIsUsernameValid(usernameAvailable);
            setShowValidationBorder(true);
            if (!usernameAvailable) {
                setErrorMessage("Sorry! That username is already taken.");
            }
        };

        if (username === dbUser?.username) {
            resetUsernameValidation();
            return;
        } else if (username.length >= 3) {
            const timerId = setTimeout(() => {
                void handlevalidateUsername();
            }, 300);

            return () => clearTimeout(timerId);
        } else {
            setIsUsernameValid(false);
            setErrorMessage("Username is too short.");
        }
    }, [username]);

    const saveUsername = async () => {
        setShowLoading(true);
        const success = await saveUsernameInFirebase(username);
        success && toast.success("Changes saved!");
        resetUsernameValidation();
        setShowLoading(false);
    };

    useEffect(() => {
        if (dbUser?.username) {
            setUsername(dbUser?.username);
        }
        if (dbUser?.email) {
            setEmail(dbUser?.email);
        }
    }, [dbUser]);

    const handleDeleteAccount = async () => {
        try {
            await Ajax.post({
                url: backendUrlFromPath("/api/User/Delete"),
                msgBodyType: "urlEncoded",
            });
            showToast({type: "success", title: t("Account deleted.")});

            onLogOut();
            await getAuthProvider().signOut();
            window.location.href = ROUTES.HOME;
        } catch (e) {
            console.error("Error deleting account:", e);
            throw e;
        }
    };

    useEffect(() => {
        setMainLoaderState({visible: showLoading, message: ""});
    }, [setMainLoaderState, showLoading]);

    return (
        <>
            <Container>
                {confirmDelete && (
                    <Confirm
                        onOK={handleDeleteAccount}
                        title={t("Are you sure you want to delete your account?")}
                        cancelText={t("Cancel")}
                        okText={t("Confirm")}
                        onCancel={() => setConfirmDelete(false)}
                        onClose={() => setConfirmDelete(false)}
                    >
                        {t("This action will permanently erase all your data and cannot be undone.")}
                    </Confirm>
                )}
                <AccountBox className="box">
                    <Heading>{t("Account Details")}</Heading>
                    <div className={"wrapper"}>
                        <div>
                            <label>{t("Username")}</label>
                            <InputWrapper>
                                <ValidationInput
                                    type="text"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    $valueCorrect={showValidationBorder ? isUsernameValid : undefined}
                                />
                                <StyledButton
                                    width="44px"
                                    height="24px"
                                    isBlue
                                    className="saveButton"
                                    disabled={!showValidationBorder || !isUsernameValid}
                                    onClick={saveUsername}
                                >
                                    {t("Save")}
                                </StyledButton>
                                {showValidationBorder && (
                                    <img
                                        className="icon"
                                        src={isUsernameValid ? successIcon : errorIcon}
                                        alt={isUsernameValid ? "username is available" : "username is not available"}
                                    />
                                )}
                                {!isUsernameValid && showValidationBorder && (
                                    <ErrorMessage>{errorMessage}</ErrorMessage>
                                )}
                            </InputWrapper>
                        </div>
                        <div>
                            <label>{t("Email")}</label>
                            <ValidationInput
                                type="text"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                            />
                        </div>
                        <div>
                            <label>{t("Avatar")}</label>
                            <StyledButton
                                isGreySecondary
                                width="200px"
                                onClick={() => navigate(ROUTES.MY_AVATARS)}
                            >
                                {t("Manage in My Avatars")}
                            </StyledButton>
                        </div>
                    </div>
                </AccountBox>
                <CreditsSummary />
                <BYOKKeysPanel />
                <LogoutBox className="box">
                    <Heading>{t("Logout")}</Heading>
                    <StyledButton
                        width="88px"
                        onClick={handleLogOut}
                        isGreySecondary
                    >
                        <span className="logout">{t("Logout")}</span>
                        <img
                            src={logoutIcon}
                            alt=""
                        />
                    </StyledButton>
                </LogoutBox>
                <DeleteBox className="box">
                    <Heading>{t("Delete Account")}</Heading>
                    <DeleteAccountButton onClick={() => setConfirmDelete(true)}>
                        <img
                            src={deleteIcon}
                            alt=""
                        />{" "}
                        {t("Delete Account")}
                    </DeleteAccountButton>
                </DeleteBox>
                <LegalBox className="box">
                    <Heading>{t("Legal")}</Heading>
                    <div>
                        <StyledButton
                            isGreySecondary
                            width="144px"
                            onClick={() => navigate(ROUTES.TERMS_OF_SERVICE, navigationOptions)}
                        >
                            {t("Terms of Service")}{" "}
                            <img
                                src={arrow}
                                alt={t("Go to link")}
                            />
                        </StyledButton>
                        <StyledButton
                            isGreySecondary
                            width="144px"
                            onClick={() => navigate(ROUTES.PRIVACY_POLICY, navigationOptions)}
                        >
                            {t("Privacy Policy")}{" "}
                            <img
                                src={arrow}
                                alt={t("Go to link")}
                            />
                        </StyledButton>
                        <StyledButton
                            isGreySecondary
                            width="190px"
                            onClick={() => navigate(ROUTES.THIRD_PARTY_ATTRIBUTIONS, navigationOptions)}
                        >
                            {t("Open Source Licenses")}{" "}
                            <img
                                src={arrow}
                                alt={t("Go to link")}
                            />
                        </StyledButton>
                    </div>
                </LegalBox>
            </Container>
        </>
    );
};

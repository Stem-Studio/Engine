import axios from "axios";
import {useEffect, useState} from "react";

import {WhitelistTable} from "./WhitelistTable/WhitelistTables";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {showToast} from "@stem/editor-oss/showToast";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {StyledButton} from "../../../common/StyledButton";
import deleteIcon from "../../../icons/delete-icon.svg";
import {Separator} from "../../../RightPanel/common/Separator";
import {AccountBox} from "../../SettingsPage/SettingsPage.style";
import {InvalidEmailList, Settings, ValidationTextArea} from "../AdminPanel.style";
import {ISubmitButton} from "../types";

interface Props {
    loading: boolean;
    setLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

export const WhitelistManagement = ({loading, setLoading}: Props) => {
    const {authToken} = useAuthorizationContext();

    const [addEmails, setAddEmails] = useState("");
    const [currentWhitelist, setCurrentWhitelist] = useState<string[]>([]);
    const [invalidAddEmails, setInvalidAddEmails] = useState<string[]>([]);
    const [pendingEmail, setPendingEmail] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<"invite" | "reset" | "delete" | null>(null);

    useEffect(() => {
        getWhitelist();
    }, []);

    const handleSubmit = async () => {
        const emailList = addEmails;

        // Split the raw data into emails based on commas or newlines
        const emailArray = emailList
            .split(/[,\n]/) // Split by commas or newlines
            .map(email => email.trim()) // Trim spaces
            .filter(email => email); // Remove empty strings

        // Validate each email and collect invalid ones
        const invalidEmails = emailArray.filter(email => !/^[\w-]+(\.[\w-]+)*@([\w-]+\.)+[a-zA-Z]{2,14}$/.test(email));

        if (invalidEmails.length > 0) {
            setInvalidAddEmails(invalidEmails);

            return showToast({type: "warning", title: "Some emails are invalid. See below for details."});
        }

        setInvalidAddEmails([]); // Clear invalid emails for add

        setLoading(true);

        try {
            const url = "/api/Whitelist/Admin/Add";
            await axios.post(
                backendUrlFromPath(url)!,
                {emails: emailArray},
                {headers: {Authorization: `Bearer ${authToken}`}},
            );
            showToast({type: "success", title: "Emails added successfully to Approved Users."});
            // Clear the input after successful submission
            setAddEmails("");
            await getWhitelist();
        } catch {
            showToast({type: "error", title: "Failed to update Approved Users."});
        } finally {
            setLoading(false);
        }
    };

    const getWhitelist = async () => {
        try {
            const url = "/api/Whitelist/Admin/Get";
            const response = await axios.get(backendUrlFromPath(url)!, {
                headers: {Authorization: `Bearer ${authToken}`},
            });
            if (response.data.Code !== 200) {
                throw Error("Request failed");
            }
            setCurrentWhitelist(response.data.Data.emails || []);
        } catch {
            showToast({type: "error", title: "Failed to fetch Approved Users."});
        } finally {
            setLoading(false);
        }
    };

    const removeSingleEmail = async (email: string) => {
        setLoading(true);
        setPendingEmail(email);
        setPendingAction("delete");

        try {
            const response = await axios.post(
                backendUrlFromPath("/api/Whitelist/Admin/Delete")!,
                {emails: [email]},
                {headers: {Authorization: `Bearer ${authToken}`}},
            );
            if (response.data.Code !== 200) {
                throw Error("Request failed");
            }
            showToast({type: "success", title: "Emails successfully removed from Approved Users."});
            setCurrentWhitelist(prev => prev.filter(el => el !== email));
        } catch {
            showToast({type: "error", title: "Failed to update Approved Users."});
        } finally {
            setPendingEmail(null);
            setPendingAction(null);
            setLoading(false);
        }
    };

    const sendInviteEmail = async (email: string) => {
        setLoading(true);
        setPendingEmail(email);
        setPendingAction("invite");

        try {
            const response = await axios.post(
                backendUrlFromPath("/api/Whitelist/Admin/SendInvite")!,
                {email},
                {headers: {Authorization: `Bearer ${authToken}`}},
            );
            if (response.data.Code !== 200) {
                throw new Error(response.data.Msg || "Request failed");
            }
            showToast({type: "success", title: `Invitation email sent to ${email}.`});
        } catch (error) {
            const message = axios.isAxiosError(error)
                ? error.response?.data?.Msg || "Failed to send invitation email."
                : error instanceof Error
                  ? error.message
                  : "Failed to send invitation email.";
            showToast({type: "error", title: message});
        } finally {
            setPendingEmail(null);
            setPendingAction(null);
            setLoading(false);
        }
    };

    const sendPasswordResetEmail = async (email: string) => {
        setLoading(true);
        setPendingEmail(email);
        setPendingAction("reset");

        try {
            const response = await axios.post(
                backendUrlFromPath("/api/Whitelist/Admin/SendPasswordReset")!,
                {email},
                {headers: {Authorization: `Bearer ${authToken}`}},
            );
            if (response.data.Code !== 200) {
                throw new Error(response.data.Msg || "Request failed");
            }
            showToast({type: "success", title: `Password reset email sent to ${email}.`});
        } catch (error) {
            const message = axios.isAxiosError(error)
                ? error.response?.data?.Msg || "Failed to send password reset email."
                : error instanceof Error
                  ? error.message
                  : "Failed to send password reset email.";
            showToast({type: "error", title: message});
        } finally {
            setPendingEmail(null);
            setPendingAction(null);
            setLoading(false);
        }
    };

    const clearWhitelist = async () => {
        const confirmation = window.confirm(
            "Are you sure you want to clear Approved Users? This action cannot be undone!",
        );

        if (!confirmation) {
            return;
        }

        setLoading(true);
        try {
            await axios.post(
                backendUrlFromPath("/api/Whitelist/Admin/Clear")!,
                {},
                {
                    headers: {Authorization: `Bearer ${authToken}`},
                },
            );
        } catch {
            showToast({type: "error", title: "Failed to clear Approved Users."});
        } finally {
            setLoading(false);
        }
    };

    const emailSections: ISubmitButton[] = [
        {
            action: "add",
            label: "Emails to add",
            value: addEmails,
            setValue: setAddEmails,
            invalidEmails: invalidAddEmails,
            setInvalidEmails: setInvalidAddEmails,
            buttonLabel: "Add to Approved Users",
            isBlue: true,
        },
    ];
    return (
        <AccountBox className="box">
            {emailSections.map(({action, label, value, setValue, invalidEmails, buttonLabel, isBlue, isRed}) => 
                <Settings key={action}
                    className={"wrapper"}
                >
                    <label>{label}</label>
                    <ValidationTextArea
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        placeholder="Paste emails here, separated by commas or new lines"
                    />

                    {invalidEmails.length > 0 && 
                        <InvalidEmailList>Invalid emails: {invalidEmails.join(", ")}</InvalidEmailList>
                    }

                    <StyledButton isRed={!!isRed}
                        isBlue={!!isBlue}
                        onClick={() => handleSubmit()}
                        disabled={loading}
                    >
                        {loading ? "Submitting..." : buttonLabel}
                    </StyledButton>
                </Settings>,
            )}
            <Separator />
            <label>Approved Users</label>
            <label className="greyLabel">Use Send Invite to provision access for an approved user. Reset Password only works after their Firebase account exists.</label>
            <WhitelistTable currentWhitelist={currentWhitelist}
                onDelete={removeSingleEmail}
                onSendInvite={sendInviteEmail}
                onSendPasswordReset={sendPasswordResetEmail}
                pendingEmail={pendingEmail}
                pendingAction={pendingAction}
            />
            <Separator />
            <label>Clear Approved Users</label>
            <label className="greyLabel">This will remove all emails from Approved Users!</label>
            <StyledButton isRed
                onClick={clearWhitelist}
                disabled={loading}
                width="124px"
                height="40px"
            >
                <img src={deleteIcon}
                    alt=""
                /> {loading ? "Submitting..." : "Delete All"}
            </StyledButton>
        </AccountBox>
    );
};

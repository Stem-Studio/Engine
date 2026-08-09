import {useEffect, useState} from "react";

import {Row} from "./Limits.style";
import {useAppGlobalContext} from "@stem/editor-oss/context/AppGlobalContext";
import {showToast} from "@stem/editor-oss/showToast";
import Ajax from "@stem/editor-oss/utils/Ajax";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {BasicComboboxNoPortal} from "../../../common/BasicCombobox/BasicComboboxNoPortal";
import {NumericInput} from "../../../common/NumericInput";
import {StyledButton} from "../../../common/StyledButton";
import {PanelCheckbox} from "../../../RightPanel/common/PanelCheckbox";
import {AccountBox} from "../../SettingsPage/SettingsPage.style";
import {CheckboxContainer, Settings, ValidationTextArea} from "../AdminPanel.style";

enum UpdateTypes {
    INCREACE = "Increase Limits",
    DECREASE = "Decrease Limits",
    SET = "Set Limits",
}

export const Limits = () => {
    const {setMainLoaderState} = useAppGlobalContext();
    const [loading, setLoading] = useState(false);
    const [value, setValue] = useState("");
    const [aiCredits, setAiCredits] = useState(0);
    const [updateAll, setUpdateAll] = useState(false);
    const [updateOption, setUpdateOption] = useState(UpdateTypes.INCREACE);

    const updateOptions = Object.values(UpdateTypes).map(value => {
        return {
            key: value,
            value: value,
        };
    });

    const getEndpoint = () => {
        switch (updateOption) {
            case UpdateTypes.INCREACE:
                return "/api/User/Admin/IncreaseLimits";
            case UpdateTypes.DECREASE:
                return "/api/User/Admin/DecreaseLimits";
            case UpdateTypes.SET:
                return "/api/User/Admin/SetLimits";
            default:
                return "/api/User/Admin/IncreaseLimits";
        }
    };

    const handleSubmit = async () => {
        const confirmation = window.confirm(
            `Are you sure you want to update the limits? Selected type: ${updateOption}`,
        );

        if (!confirmation) {
            return;
        }
        setLoading(true);
        try {
            const res = await Ajax.post({
                url: backendUrlFromPath(getEndpoint()),
                data: JSON.stringify({
                    userEmails: value.split(/[\s,]+/),
                    aiCredits,
                    updateAll,
                }),
                msgBodyType: "json",
            });
            if (res?.data) {
                showToast({type: "success", title: res.data.Msg});
            }
        } catch {
            showToast({type: "error", title: "Failed to update limits."});
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setMainLoaderState({visible: loading, message: ""});
    }, [loading, setMainLoaderState]);

    return (
        <>
            <AccountBox className="box">
                <div className="wrapper">
                    <Settings style={{width: "100%"}}>
                        <label>Users Emails</label>
                        <ValidationTextArea
                            value={value}
                            onChange={e => setValue(e.target.value)}
                            placeholder="Paste emails here, separated by commas or new lines"
                        />
                    </Settings>

                    <CheckboxContainer>
                        <PanelCheckbox
                            text=""
                            checked={updateAll}
                            onChange={() => setUpdateAll(!updateAll)}
                            v2
                            isGray
                            regular
                        />
                        <label htmlFor="common-checkbox-check1">Update every user in database</label>
                    </CheckboxContainer>

                    <Settings style={{width: "504px"}}>
                        <Row>
                            <label>Update Type</label>
                            <BasicComboboxNoPortal
                                disableTyping
                                data={updateOptions}
                                value={updateOptions.find(item => item.value === updateOption)}
                                onChange={item => setUpdateOption(item.value as UpdateTypes)}
                            />
                        </Row>
                        <Row>
                            <label>AI Credits</label>
                            <NumericInput
                                width="320px"
                                height="40px"
                                value={aiCredits}
                                setValue={setAiCredits}
                                min={0}
                            />
                        </Row>
                    </Settings>

                    <StyledButton
                        isBlue
                        onClick={handleSubmit}
                        disabled={loading || (!value && !updateAll)}
                        height="40px"
                        margin="20px 0 0"
                        style={{fontSize: "14px"}}
                    >
                        {loading ? "Submitting..." : "Update Limits"}
                    </StyledButton>
                </div>
            </AccountBox>
        </>
    );
};

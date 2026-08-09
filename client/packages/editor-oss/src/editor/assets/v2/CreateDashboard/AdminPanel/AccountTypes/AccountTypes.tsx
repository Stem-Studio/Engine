import {useEffect, useState} from "react";

import {AccountType, getUsersByAccountType, setUserAccountType} from "@stem/network/api/user";
import {useAppGlobalContext} from "@stem/editor-oss/context/AppGlobalContext";
import {showToast} from "@stem/editor-oss/showToast";
import {BasicComboboxNoPortal} from "../../../common/BasicCombobox/BasicComboboxNoPortal";
import {StyledButton} from "../../../common/StyledButton";
import {PanelCheckbox} from "../../../RightPanel/common/PanelCheckbox";
import {AccountBox} from "../../SettingsPage/SettingsPage.style";
import {
    CheckboxContainer,
    PageInfo,
    PaginationContainer,
    Settings,
    SubTab,
    SubTabContainer,
    UserCount,
    UserListContainer,
    UserListHeader,
    UserListItem,
    ValidationTextArea,
} from "../AdminPanel.style";
import {ExportCSV} from "../ExportCSV";
import {Row} from "../Limits/Limits.style";

const accountTypeOptions = [
    {key: "regular", value: "Regular User"},
    {key: "influencer", value: "Influencer (5x limits)"},
    {key: "admin", value: "Admin (full access)"},
];

type UserTab = "influencers" | "admins";
const USERS_PER_PAGE = 20;

export const AccountTypes = () => {
    const {setMainLoaderState} = useAppGlobalContext();
    const [loading, setLoading] = useState(false);
    const [emails, setEmails] = useState("");
    const [selectedAccountType, setSelectedAccountType] = useState<AccountType>("influencer");
    const [updateLimits, setUpdateLimits] = useState(true);

    // Tab and list state
    const [activeTab, setActiveTab] = useState<UserTab>("influencers");
    const [influencerList, setInfluencerList] = useState<string[]>([]);
    const [adminList, setAdminList] = useState<string[]>([]);
    const [influencersLoaded, setInfluencersLoaded] = useState(false);
    const [adminsLoaded, setAdminsLoaded] = useState(false);

    // Pagination state
    const [influencerPage, setInfluencerPage] = useState(1);
    const [adminPage, setAdminPage] = useState(1);

    const handleSubmit = async () => {
        const emailArray = emails.split(/[\s,]+/).filter(e => e.trim());
        if (emailArray.length === 0) {
            showToast({type: "error", title: "Please enter at least one email."});
            return;
        }

        const confirmation = window.confirm(
            `Are you sure you want to set ${emailArray.length} user(s) to "${selectedAccountType}"?${updateLimits ? " Their credit limits will also be updated." : ""}`,
        );

        if (!confirmation) return;

        setLoading(true);
        try {
            const result = await setUserAccountType(emailArray, selectedAccountType, updateLimits);
            showToast({
                type: "success",
                title: `Updated ${result.modifiedCount} user(s) to ${selectedAccountType}.`,
            });
            setEmails("");
            // Refresh the relevant list
            if (selectedAccountType === "influencer" || influencersLoaded) {
                void loadInfluencers();
            }
            if (selectedAccountType === "admin" || adminsLoaded) {
                void loadAdmins();
            }
        } catch (error: any) {
            showToast({type: "error", title: error.message || "Failed to update account types."});
        } finally {
            setLoading(false);
        }
    };

    const loadInfluencers = async () => {
        setLoading(true);
        try {
            const users = await getUsersByAccountType("influencer");
            setInfluencerList(users.map(u => u.Email));
            setInfluencersLoaded(true);
            setInfluencerPage(1);
        } catch (error: any) {
            showToast({type: "error", title: error.message || "Failed to load influencers."});
        } finally {
            setLoading(false);
        }
    };

    const loadAdmins = async () => {
        setLoading(true);
        try {
            const users = await getUsersByAccountType("admin");
            setAdminList(users.map(u => u.Email));
            setAdminsLoaded(true);
            setAdminPage(1);
        } catch (error: any) {
            showToast({type: "error", title: error.message || "Failed to load admins."});
        } finally {
            setLoading(false);
        }
    };

    // Load data when tab changes
    useEffect(() => {
        if (activeTab === "influencers" && !influencersLoaded) {
            void loadInfluencers();
        } else if (activeTab === "admins" && !adminsLoaded) {
            void loadAdmins();
        }
    }, [activeTab]);

    // Get current list and pagination info based on active tab
    const currentList = activeTab === "influencers" ? influencerList : adminList;
    const currentPage = activeTab === "influencers" ? influencerPage : adminPage;
    const setCurrentPage = activeTab === "influencers" ? setInfluencerPage : setAdminPage;
    const totalPages = Math.ceil(currentList.length / USERS_PER_PAGE);

    // Calculate paginated data
    const startIndex = (currentPage - 1) * USERS_PER_PAGE;
    const endIndex = startIndex + USERS_PER_PAGE;
    const paginatedList = currentList.slice(startIndex, endIndex);

    const handlePrevPage = () => {
        if (currentPage > 1) {
            setCurrentPage(currentPage - 1);
        }
    };

    const handleNextPage = () => {
        if (currentPage < totalPages) {
            setCurrentPage(currentPage + 1);
        }
    };

    useEffect(() => {
        setMainLoaderState({visible: loading, message: ""});
    }, [setMainLoaderState, loading]);

    return (
        <>
            <AccountBox className="box">
                <div className="wrapper">
                    <Settings style={{width: "100%"}}>
                        <label>User Emails</label>
                        <ValidationTextArea
                            value={emails}
                            onChange={e => setEmails(e.target.value)}
                            placeholder="Enter emails to update, separated by commas or new lines"
                        />
                    </Settings>

                    <Settings style={{width: "504px"}}>
                        <Row>
                            <label>Account Type</label>
                            <BasicComboboxNoPortal
                                disableTyping
                                data={accountTypeOptions}
                                value={accountTypeOptions.find(item => item.key === selectedAccountType)}
                                onChange={item => setSelectedAccountType(item.key as AccountType)}
                            />
                        </Row>
                    </Settings>

                    <CheckboxContainer>
                        <PanelCheckbox
                            text=""
                            checked={updateLimits}
                            onChange={() => setUpdateLimits(!updateLimits)}
                            v2
                            isGray
                            regular
                        />
                        <label>Also update credit limits to match account type</label>
                    </CheckboxContainer>

                    <div style={{display: "flex", gap: "12px", marginTop: "20px"}}>
                        <StyledButton
                            isBlue
                            onClick={handleSubmit}
                            disabled={loading || !emails.trim()}
                            height="40px"
                            style={{fontSize: "14px"}}
                        >
                            {loading ? "Updating..." : "Update Account Type"}
                        </StyledButton>
                    </div>

                    {/* Tabs for Influencers and Admins */}
                    <UserListContainer>
                        <SubTabContainer>
                            <SubTab
                                $active={activeTab === "influencers"}
                                onClick={() => setActiveTab("influencers")}
                            >
                                Influencers
                            </SubTab>
                            <SubTab
                                $active={activeTab === "admins"}
                                onClick={() => setActiveTab("admins")}
                            >
                                Admins
                            </SubTab>
                        </SubTabContainer>

                        <UserListHeader>
                            <span style={{color: "#fff", fontWeight: 500}}>
                                {activeTab === "influencers" ? "Influencers" : "Database Admins"}
                            </span>
                            <UserCount>
                                {currentList.length} user{currentList.length !== 1 ? "s" : ""}
                            </UserCount>
                            <ExportCSV
                                data={currentList.map(email => ({email}))}
                                filename={activeTab}
                                columns={[{key: "email", label: "Email"}]}
                            />
                        </UserListHeader>

                        {currentList.length > 0 ? (
                            <>
                                <div>
                                    {paginatedList.map((email, index) => (
                                        <UserListItem key={startIndex + index}>{email}</UserListItem>
                                    ))}
                                </div>

                                {totalPages > 1 && (
                                    <PaginationContainer>
                                        <StyledButton
                                            onClick={handlePrevPage}
                                            disabled={currentPage === 1}
                                            height="32px"
                                            style={{fontSize: "13px", padding: "0 12px"}}
                                        >
                                            Previous
                                        </StyledButton>
                                        <PageInfo>
                                            Page {currentPage} of {totalPages}
                                        </PageInfo>
                                        <StyledButton
                                            onClick={handleNextPage}
                                            disabled={currentPage === totalPages}
                                            height="32px"
                                            style={{fontSize: "13px", padding: "0 12px"}}
                                        >
                                            Next
                                        </StyledButton>
                                    </PaginationContainer>
                                )}
                            </>
                        ) : (
                            <div style={{color: "#a1a1aa", fontSize: "14px"}}>
                                {activeTab === "admins"
                                    ? "No database admins found. Admins may also be set via ADMIN_UIDS env or Firebase claims."
                                    : "No influencers found."}
                            </div>
                        )}
                    </UserListContainer>
                </div>
            </AccountBox>
        </>
    );
};

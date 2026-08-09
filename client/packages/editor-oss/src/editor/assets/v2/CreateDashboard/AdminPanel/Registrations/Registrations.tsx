import axios from "axios";
import {useEffect, useMemo, useState} from "react";

import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {showToast} from "@stem/editor-oss/showToast";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {SearchInput} from "../../../common/SearchInput";
import {StyledButton} from "../../../common/StyledButton";
import {AccountBox} from "../../SettingsPage/SettingsPage.style";
import {PageInfo, PaginationContainer, SubTab, SubTabContainer} from "../AdminPanel.style";
import {ExportCSV} from "../ExportCSV";
import {
    ActionButton,
    ActionsCell,
    FlexWrapper,
    SearchSection,
    Table,
    Td,
    Th,
} from "../Whitelist/WhitelistTable/WhitelistTable";

interface Registration {
    firstName: string;
    lastName: string;
    email: string;
    company?: string;
    role: string;
    aiFamiliarity: string;
    status: string;
    createdAt: string;
}

type FilterStatus = "all" | "pending" | "approved" | "rejected";

export const Registrations = () => {
    const {authToken} = useAuthorizationContext();
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [loading, setLoading] = useState(false);
    const [pendingEmail, setPendingEmail] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterStatus>("all");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(0);
    const pageSize = 15;

    const fetchRegistrations = async () => {
        setLoading(true);
        try {
            const response = await axios.get(backendUrlFromPath("/api/Registration/Admin/List")!, {
                headers: {Authorization: `Bearer ${authToken}`},
            });
            if (response.data.Code !== 200) {
                throw new Error("Request failed");
            }
            setRegistrations(response.data.Data.registrations || []);
        } catch {
            showToast({type: "error", title: "Failed to fetch registrations."});
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void fetchRegistrations();
    }, []);

    const handleApprove = async (email: string) => {
        setPendingEmail(email);
        try {
            const response = await axios.post(
                backendUrlFromPath("/api/Registration/Admin/Approve")!,
                {email},
                {headers: {Authorization: `Bearer ${authToken}`}},
            );
            if (response.data.Code !== 200) {
                throw new Error(response.data.Msg || "Request failed");
            }
            showToast({type: "success", title: `Registration approved for ${email}.`});
            setRegistrations(prev => prev.map(r => (r.email === email ? {...r, status: "approved"} : r)));
        } catch (error) {
            const message = axios.isAxiosError(error)
                ? error.response?.data?.Msg || "Failed to approve registration."
                : "Failed to approve registration.";
            showToast({type: "error", title: message});
        } finally {
            setPendingEmail(null);
        }
    };

    const handleReject = async (email: string) => {
        setPendingEmail(email);
        try {
            const response = await axios.post(
                backendUrlFromPath("/api/Registration/Admin/Reject")!,
                {email},
                {headers: {Authorization: `Bearer ${authToken}`}},
            );
            if (response.data.Code !== 200) {
                throw new Error(response.data.Msg || "Request failed");
            }
            showToast({type: "success", title: `Registration rejected for ${email}.`});
            setRegistrations(prev => prev.map(r => (r.email === email ? {...r, status: "rejected"} : r)));
        } catch (error) {
            const message = axios.isAxiosError(error)
                ? error.response?.data?.Msg || "Failed to reject registration."
                : "Failed to reject registration.";
            showToast({type: "error", title: message});
        } finally {
            setPendingEmail(null);
        }
    };

    const filtered = useMemo(() => {
        let results = registrations;
        if (filter !== "all") {
            results = results.filter(r => r.status === filter);
        }
        if (search.trim()) {
            const q = search.toLowerCase();
            results = results.filter(
                r =>
                    r.firstName.toLowerCase().includes(q) ||
                    r.lastName.toLowerCase().includes(q) ||
                    r.email.toLowerCase().includes(q) ||
                    (r.company && r.company.toLowerCase().includes(q)),
            );
        }
        return results;
    }, [registrations, filter, search]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const paged = useMemo(() => filtered.slice(page * pageSize, (page + 1) * pageSize), [filtered, page]);

    useEffect(() => {
        setPage(0);
    }, [filter, search]);

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString();
        } catch {
            return dateStr;
        }
    };

    const filters: {key: FilterStatus; label: string}[] = [
        {key: "all", label: "All"},
        {key: "pending", label: "Pending"},
        {key: "approved", label: "Approved"},
        {key: "rejected", label: "Rejected"},
    ];

    return (
        <AccountBox
            className="box"
            style={{maxWidth: "100%"}}
        >
            <label>Registration Applications</label>
            <StyledButton
                width="100px"
                height="36px"
                isBlue
                onClick={() => void fetchRegistrations()}
                disabled={loading}
            >
                {loading ? "Loading..." : "Refresh"}
            </StyledButton>

            <SubTabContainer>
                {filters.map(f => (
                    <SubTab
                        key={f.key}
                        $active={filter === f.key}
                        onClick={() => setFilter(f.key)}
                    >
                        {f.label} (
                        {f.key === "all" ? registrations.length : registrations.filter(r => r.status === f.key).length})
                    </SubTab>
                ))}
            </SubTabContainer>

            <FlexWrapper>
                <span>Search</span>
                <SearchSection>
                    <SearchInput
                        onChange={setSearch}
                        value={search}
                        placeholder="Name, email, or company"
                        width="300px"
                    />
                </SearchSection>
                <ExportCSV
                    data={filtered as unknown as Record<string, unknown>[]}
                    filename="registrations"
                    columns={[
                        {key: "firstName", label: "First Name"},
                        {key: "lastName", label: "Last Name"},
                        {key: "email", label: "Email"},
                        {key: "company", label: "Company"},
                        {key: "role", label: "Role"},
                        {key: "aiFamiliarity", label: "AI Familiarity"},
                        {key: "status", label: "Status"},
                        {key: "createdAt", label: "Created At"},
                    ]}
                />
            </FlexWrapper>

            <Table>
                <thead>
                    <tr>
                        <Th $radiusLeft>Name</Th>
                        <Th>Email</Th>
                        <Th>Company</Th>
                        <Th>Role</Th>
                        <Th>AI Familiarity</Th>
                        <Th>Status</Th>
                        <Th>Date</Th>
                        <Th>Actions</Th>
                    </tr>
                </thead>
                <tbody>
                    {paged.map(reg => (
                        <tr key={reg.email}>
                            <Td>
                                {reg.firstName} {reg.lastName}
                            </Td>
                            <Td>{reg.email}</Td>
                            <Td>{reg.company || "—"}</Td>
                            <Td>{reg.role}</Td>
                            <Td>{reg.aiFamiliarity}</Td>
                            <Td>{reg.status}</Td>
                            <Td>{formatDate(reg.createdAt)}</Td>
                            <Td>
                                <ActionsCell>
                                    {reg.status === "pending" && (
                                        <>
                                            <ActionButton
                                                $variant="primary"
                                                onClick={() => void handleApprove(reg.email)}
                                                disabled={pendingEmail === reg.email}
                                            >
                                                {pendingEmail === reg.email ? "..." : "Approve"}
                                            </ActionButton>
                                            <ActionButton
                                                $variant="danger"
                                                onClick={() => void handleReject(reg.email)}
                                                disabled={pendingEmail === reg.email}
                                            >
                                                {pendingEmail === reg.email ? "..." : "Reject"}
                                            </ActionButton>
                                        </>
                                    )}
                                    {reg.status !== "pending" && (
                                        <span style={{color: "#a1a1aa", fontSize: 12}}>—</span>
                                    )}
                                </ActionsCell>
                            </Td>
                        </tr>
                    ))}
                    {filtered.length === 0 && (
                        <tr>
                            <Td
                                colSpan={8}
                                style={{textAlign: "center", color: "#a1a1aa"}}
                            >
                                No registrations found.
                            </Td>
                        </tr>
                    )}
                </tbody>
            </Table>
            {totalPages > 1 && (
                <PaginationContainer>
                    <StyledButton
                        width="80px"
                        height="32px"
                        isGrey
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                    >
                        Previous
                    </StyledButton>
                    <PageInfo>
                        Page {page + 1} of {totalPages}
                    </PageInfo>
                    <StyledButton
                        width="80px"
                        height="32px"
                        isGrey
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                    >
                        Next
                    </StyledButton>
                </PaginationContainer>
            )}
        </AccountBox>
    );
};

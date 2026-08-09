import {useEffect, useState} from "react";
import styled from "styled-components";

import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import {getOSSPersistenceMode} from "@stem/editor-oss/persistence/mode";

const Banner = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: rgba(255, 196, 0, 0.12);
    border: 1px solid rgba(255, 196, 0, 0.35);
    border-radius: 8px;
    color: #ffd266;
    font-size: 13px;
    margin: 8px 16px;
`;

const Reconnect = styled.button`
    background: #ffc400;
    color: #1a1a1a;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-weight: 600;
    cursor: pointer;
    font-size: 12px;
    &:hover { background: #ffd840; }
`;

/**
 * Rendered above the dashboard project list when the user previously
 * chose filesystem storage but the persisted directory handle no longer
 * has permission after a reload. Surfaces a single-click "Reconnect"
 * prompt that re-requests permission inside a user gesture — required
 * by the browser for `FileSystemHandle.requestPermission()`.
 */
export const ReconnectFolderBanner = () => {
    const [needsReconnect, setNeedsReconnect] = useState(false);
    const [busy, setBusy] = useState(false);
    const [hint, setHint] = useState<string | null>(null);
    const {setShouldRefreshDashboard} = useHomepageContext();

    useEffect(() => {
        const desired = getOSSPersistenceMode();
        if (desired !== "filesystem") return;

        let cancelled = false;
        void import("@stem/editor-oss/persistence/projectStoreFactory")
            .then(({getProjectStore}) => {
                if (cancelled) return;
                try {
                    const actual = getProjectStore().kind;
                    if (actual !== "filesystem") setNeedsReconnect(true);
                } catch {
                    // store hasn't been registered yet — handled by AppContainer's
                    // rehydrateProjectStore() effect; component will re-render after.
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (!needsReconnect) return null;

    const handleClick = async () => {
        setBusy(true);
        setHint(null);
        const {reconnectFilesystemFolder} = await import("@stem/editor-oss/persistence/bootstrap");
        const result = await reconnectFilesystemFolder();
        setBusy(false);
        if (result === "reconnected") {
            setNeedsReconnect(false);
            // Refresh the dashboard in-place — do NOT reload the page. The
            // File System Access API does not persist folder permission
            // across page loads, so a reload would land back on boot's
            // gesture-less verifyPermission(), fall back to IndexedDB, and
            // re-show this banner. The store has already been swapped to the
            // FileSystemProjectStore by reconnectFilesystemFolder(); a forced
            // dashboard refresh re-reads the project list from disk.
            setShouldRefreshDashboard(true);
            return;
        }
        if (result === "no-handle") {
            setHint("No saved folder. Open Settings to pick a project folder again.");
        } else {
            setHint("Folder access was denied. Click Reconnect to try again.");
        }
    };

    return (
        <Banner role="status" data-testid="reconnect-folder-banner">
            <span>
                Your project folder needs to be reconnected before saved games can load.
            </span>
            <Reconnect
                type="button"
                onClick={handleClick}
                disabled={busy}
                data-testid="reconnect-folder-button"
            >
                {busy ? "Reconnecting…" : "Reconnect"}
            </Reconnect>
            {hint && <span style={{opacity: 0.8}}>{hint}</span>}
        </Banner>
    );
};

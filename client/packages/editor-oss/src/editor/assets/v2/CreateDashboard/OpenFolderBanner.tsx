import {useEffect, useState} from "react";
import styled from "styled-components";

import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import {FileSystemProjectStore} from "@stem/editor-oss/persistence/FileSystemProjectStore";
import {isFileSystemAccessSupported} from "@stem/editor-oss/persistence/fileSystemAccess";
import {getOSSPersistenceMode, setOSSPersistenceMode} from "@stem/editor-oss/persistence/mode";

const Panel = styled.div`
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 14px 16px;
    background: rgba(16, 22, 36, 0.78);
    border: 1px solid rgba(120, 200, 255, 0.18);
    border-radius: 10px;
    color: #e8f1ff;
    font-size: 12.5px;
    flex: 1 1 0;
    min-width: 0;
    backdrop-filter: blur(6px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    transition: border-color 120ms ease, box-shadow 120ms ease;
    &:hover {
        border-color: rgba(120, 200, 255, 0.32);
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.26);
    }
`;

const Icon = styled.div`
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(120, 200, 255, 0.16);
    color: #b9dcff;
`;

const Body = styled.div`
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    flex: 1 1 auto;
`;

const Title = styled.div`
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: #b9dcff;
    text-transform: uppercase;
`;

const Text = styled.span`
    line-height: 1.4;
    color: #e8f1ff;
`;

const Strong = styled.strong`
    color: #ffffff;
    font-weight: 600;
`;

const Action = styled.button`
    background: linear-gradient(180deg, #5cb6ff 0%, #4aa1f0 100%);
    color: #06121f;
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-weight: 600;
    cursor: pointer;
    font-size: 11.5px;
    align-self: flex-start;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: filter 120ms ease, transform 80ms ease;
    &:hover:not(:disabled) {
        filter: brightness(1.08);
    }
    &:active:not(:disabled) {
        transform: translateY(1px);
    }
    &:disabled {
        opacity: 0.55;
        cursor: default;
    }
`;

const Hint = styled.span`
    opacity: 0.7;
    font-size: 11px;
`;

const ErrorText = styled.span`
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 11.5px;
    line-height: 1.4;
    font-weight: 500;
    color: #ff9b9b;
`;

/**
 * Dashboard banner that lets the user point StemStudio at a local folder for
 * project storage at any time. Always visible when File System Access
 * is supported; copy adapts to the current persistence mode so users can
 * either adopt folder storage for the first time or switch to a different
 * folder later. The reconnect banner sits on top of this one and handles
 * the "filesystem mode but permission revoked" recovery case.
 *
 * The picker must run in a user-gesture click handler (browser requirement),
 * so the button itself triggers `showDirectoryPicker` — no intermediate
 * confirm dialog. On success the active `ProjectStore` is swapped to a
 * `FileSystemProjectStore`, the persistence-mode flag flips to `filesystem`,
 * and the page reloads so the project list refetches from disk.
 */
export const OpenFolderBanner = () => {
    const [supported] = useState<boolean>(() => isFileSystemAccessSupported());
    const [activeKind, setActiveKind] = useState<"indexeddb" | "filesystem" | "remote" | "unknown">("unknown");
    const [folderName, setFolderName] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [hint, setHint] = useState<string | null>(null);
    const [hintIsError, setHintIsError] = useState(false);
    const {setShouldRefreshDashboard} = useHomepageContext();

    useEffect(() => {
        if (!supported) return;
        const mode = getOSSPersistenceMode();
        if (mode !== "filesystem") {
            setActiveKind("indexeddb");
            return;
        }
        let cancelled = false;
        void import("@stem/editor-oss/persistence/projectStoreFactory")
            .then(({getProjectStore}) => {
                if (cancelled) return;
                try {
                    const store = getProjectStore();
                    const kind = store.kind;
                    // We treat "user picked filesystem AND the store is filesystem"
                    // as the only state where the banner advertises a *switch*; the
                    // reconnect banner covers the "picked filesystem, fell back to
                    // IDB" case so we don't compete with it.
                    setActiveKind(mode === "filesystem" && kind === "filesystem" ? "filesystem" : (kind as never));
                    // Surface the picked folder name when available so users can
                    // verify they connected the right directory without having to
                    // re-prompt the OS dialog.
                    const getName = (store as {getDirectoryName?: () => string}).getDirectoryName;
                    if (typeof getName === "function") {
                        try { setFolderName(getName.call(store)); } catch { setFolderName(null); }
                    }
                } catch {
                    setActiveKind("indexeddb");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [supported]);

    if (!supported) return null;
    const inFsMode = activeKind === "filesystem";

    const handleClick = async () => {
        setBusy(true);
        setHint(null);
        setHintIsError(false);
        try {
            const picker = (window as unknown as {
                showDirectoryPicker?: (opts?: {mode?: "read" | "readwrite"}) => Promise<unknown>;
            }).showDirectoryPicker;
            if (!picker) {
                setHintIsError(true);
                setHint(
                    "Folder storage is not available in this browser. " +
                        "Use a Chromium browser (Chrome or Edge) to save projects to a local folder.",
                );
                return;
            }
            const handle = (await picker({mode: "readwrite"})) as never;
            const [{saveHandle}, {setProjectStore}] = await Promise.all([
                import("@stem/editor-oss/persistence/fsHandleStore"),
                import("@stem/editor-oss/persistence/projectStoreFactory"),
            ]);
            setOSSPersistenceMode("filesystem");
            setProjectStore(new FileSystemProjectStore(handle));
            await saveHandle(handle);
            // Reflect the freshly-picked folder in this banner's own copy so
            // the title/name update without remounting.
            setActiveKind("filesystem");
            const pickedName = (handle as {name?: string}).name;
            if (typeof pickedName === "string") setFolderName(pickedName);
            // Refresh the dashboard in-place — do NOT window.location.reload().
            // The store is already swapped above, so an in-place refetch reads
            // the project list from the new folder. A full reload is actively
            // harmful here: (1) inside the public-site playground iframe a
            // document reload re-runs the static-host rewrite, which
            // re-resolves to the `/playground` wrapper and nests the editor in
            // a second playground frame; (2) the File System Access API does
            // not persist folder permission across loads, so boot's
            // gesture-less verifyPermission() fails and silently falls back to
            // IndexedDB. Mirrors ReconnectFolderBanner's deliberate no-reload.
            setShouldRefreshDashboard(true);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // The user clicking "Cancel" in the directory picker raises an
            // AbortError; treat that as a quiet dismissal.
            if (/AbortError|aborted|cancell?ed/i.test(message)) {
                setHint(null);
                setHintIsError(false);
            } else {
                // A real failure (folder unavailable, permission denied, drive
                // unmounted). Surface it prominently instead of leaving the
                // user with a silent banner that "did nothing".
                setHintIsError(true);
                setHint(`Could not open that folder: ${message}. Please try again or pick another folder.`);
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel role="status" data-testid="open-folder-banner">
            <Icon aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
            </Icon>
            <Body>
                <Title>{inFsMode ? "Folder storage" : "Switch to folder storage"}</Title>
                <Text>
                    {inFsMode ? (
                        <>
                            Saving to <Strong>{folderName ?? "selected folder"}</Strong>. New projects land here as <code>.stemscript.json</code>.
                        </>
                    ) : (
                        <>Pick a folder and StemStudio writes each project as a <code>.stemscript.json</code> file you control.</>
                    )}
                </Text>
                <Action
                    type="button"
                    onClick={handleClick}
                    disabled={busy}
                    data-testid="open-folder-button"
                >
                    {busy ? "Opening…" : inFsMode ? "Change folder" : "Open project folder"}
                </Action>
                {hint &&
                    (hintIsError ? (
                        <ErrorText role="alert" data-testid="open-folder-error">
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{flex: "0 0 14px", marginTop: 1}}
                                aria-hidden="true"
                            >
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <span>{hint}</span>
                        </ErrorText>
                    ) : (
                        <Hint>{hint}</Hint>
                    ))}
            </Body>
        </Panel>
    );
};

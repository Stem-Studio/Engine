import {useCallback, useEffect, useState} from "react";

import {isOSSBootstrapped, markOSSBootstrapped} from "../../../../persistence/bootstrapState";
import {FileSystemProjectStore} from "../../../../persistence/FileSystemProjectStore";
import {isFileSystemAccessSupported} from "../../../../persistence/fileSystemAccess";
import {setOSSPersistenceMode} from "../../../../persistence/mode";

import {
    Container,
    ErrorText,
    Footer,
    FooterNote,
    OptionCard,
    OptionDescription,
    OptionTag,
    OptionTitle,
    Options,
    Overlay,
    PrimaryButton,
    Subtitle,
    Title,
} from "./OSSBootstrapModal.style";

type ChoiceKind = "indexeddb" | "filesystem";

/**
 * First-time bootstrap modal. Asks the user how they want project storage to
 * behave (IndexedDB vs Local folder) and persists the choice. Renders only
 * when `localStorage` does not already record the user's earlier decision.
 */
export const OSSBootstrapModal = () => {
    const [visible, setVisible] = useState<boolean>(() => !isOSSBootstrapped());
    const [fsSupported] = useState<boolean>(() => isFileSystemAccessSupported());
    const [choice, setChoice] = useState<ChoiceKind>("indexeddb");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);

    useEffect(() => {
        // If FS Access isn't supported, force IndexedDB.
        if (!fsSupported && choice === "filesystem") {
            setChoice("indexeddb");
        }
    }, [fsSupported, choice]);

    const handleConfirm = useCallback(async () => {
        setSubmitting(true);
        setError(undefined);
        try {
            if (choice === "filesystem") {
                if (!fsSupported) {
                    throw new Error("File System Access is not supported in this browser");
                }
                const picker = (window as unknown as {
                    showDirectoryPicker: (opts?: {mode?: "read" | "readwrite"}) => Promise<unknown>;
                }).showDirectoryPicker;
                const handle = await picker({mode: "readwrite"});
                const [{saveHandle}, {setProjectStore}] = await Promise.all([
                    import("../../../../persistence/fsHandleStore"),
                    import("../../../../persistence/projectStoreFactory"),
                ]);
                setOSSPersistenceMode("filesystem");
                setProjectStore(new FileSystemProjectStore(handle as never));
                // Persist the handle so the choice survives a reload. The
                // browser may still prompt for permission on next session
                // depending on user / Site Settings; rehydrateProjectStore
                // calls verifyPermission() to handle the prompt-or-fail.
                await saveHandle(handle as never);
            } else {
                const [{IndexedDBProjectStore}, {setProjectStore}] = await Promise.all([
                    import("../../../../persistence/IndexedDBProjectStore"),
                    import("../../../../persistence/projectStoreFactory"),
                ]);
                setOSSPersistenceMode("indexeddb");
                setProjectStore(new IndexedDBProjectStore());
            }
            markOSSBootstrapped();
            setVisible(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Setup failed");
        } finally {
            setSubmitting(false);
        }
    }, [choice, fsSupported]);

    if (!visible) return null;

    return (
        <Overlay
            role="dialog"
            aria-modal="true"
            aria-labelledby="oss-bootstrap-title"
            data-oss-bootstrap-modal
        >
            <Container>
                <Title id="oss-bootstrap-title">Welcome to StemStudio</Title>
                <Subtitle>
                    Pick how StemStudio should store your projects on this device. You can change this later in
                    Settings.
                </Subtitle>

                <Options>
                    <OptionCard
                        type="button"
                        $selected={choice === "indexeddb"}
                        onClick={() => setChoice("indexeddb")}
                    >
                        <OptionTag>Recommended</OptionTag>
                        <OptionTitle>Browser storage (IndexedDB)</OptionTitle>
                        <OptionDescription>
                            Changes are saved automatically in this browser after a short pause. No permissions needed.
                            Storage is tied to this browser profile and remains subject to browser quota or data clearing.
                        </OptionDescription>
                    </OptionCard>

                    <OptionCard
                        type="button"
                        $selected={choice === "filesystem"}
                        $disabled={!fsSupported}
                        onClick={() => {
                            if (fsSupported) setChoice("filesystem");
                        }}
                        disabled={!fsSupported}
                    >
                        <OptionTag $tone="warning">{fsSupported ? "Chromium only" : "Not supported here"}</OptionTag>
                        <OptionTitle>Local folder</OptionTitle>
                        <OptionDescription>
                            Pick a folder. Changes are saved automatically as `.stemscript.json` files with packaged
                            assets — git-friendly and independent of browser storage. Requires Chrome / Edge / Brave / Arc.
                        </OptionDescription>
                    </OptionCard>
                </Options>

                {error ? <ErrorText>{error}</ErrorText> : null}

                <Footer>
                    <FooterNote>
                        You can switch modes later. Existing projects don&apos;t migrate automatically.
                    </FooterNote>
                    <PrimaryButton type="button" onClick={handleConfirm} $disabled={submitting}>
                        {submitting ? "Setting up…" : "Continue"}
                    </PrimaryButton>
                </Footer>
            </Container>
        </Overlay>
    );
};

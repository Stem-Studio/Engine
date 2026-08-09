import {useEffect, useState} from "react";
import {createPortal} from "react-dom";
import styled from "styled-components";

import {getSystemImportPacks, type ImportPack} from "../../../../scripts/builtinPacks";
import {showToast} from "@stem/editor-oss/showToast";
import {Overlay} from "../DetailsPopup/DetailsPopup.style";

interface Props {
    open: boolean;
    onClose: () => void;
    /**
     * Called once the user picks a pack and confirms add. Receives the pack
     * to clone into the active scene. Caller is responsible for creating the
     * scene-level Import asset (so the picker stays decoupled from scene
     * context and the create-import hook).
     */
    onAddPack: (pack: ImportPack) => Promise<void> | void;
    /**
     * Names of import packs already present in the project. Used to render a
     * check indicator and prevent re-adding. Local optimistic adds inside the
     * dialog are unioned with this list, so the dialog can stay open across
     * multiple adds.
     */
    existingPackNames?: string[];
}

type LoadState =
    | {kind: "idle"}
    | {kind: "loading"}
    | {kind: "ready"; packs: ImportPack[]}
    | {kind: "error"; message: string};

export const ImportPacksPicker = ({open, onClose, onAddPack, existingPackNames}: Props) => {
    const [state, setState] = useState<LoadState>({kind: "idle"});
    const [pendingPack, setPendingPack] = useState<string | null>(null);
    const [addedNames, setAddedNames] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!open || state.kind !== "idle") return;
        setState({kind: "loading"});
        getSystemImportPacks()
            .then(packs => setState({kind: "ready", packs}))
            .catch(err => {
                console.error("Failed to load system import packs:", err);
                const message = err instanceof Error ? err.message : "Failed to load packs";
                setState({kind: "error", message});
            });
    }, [open, state.kind]);

    useEffect(() => {
        if (!open) setAddedNames(new Set());
    }, [open]);

    if (!open) return null;

    const existingSet = new Set(existingPackNames ?? []);
    const isAlreadyAdded = (name: string) => addedNames.has(name) || existingSet.has(name);

    const handlePick = async (pack: ImportPack) => {
        if (isAlreadyAdded(pack.name) || pendingPack !== null) return;
        setPendingPack(pack.name);
        try {
            await onAddPack(pack);
            setAddedNames(prev => {
                const next = new Set(prev);
                next.add(pack.name);
                return next;
            });
        } catch (err) {
            console.error("Failed to add pack:", err);
            const message = err instanceof Error ? err.message : "Failed to add pack";
            showToast({type: "error", title: message});
        } finally {
            setPendingPack(null);
        }
    };

    // Portal into <body> for the same reason as AddImportMenu — ancestor
    // transforms / filters in the outliner re-anchor position:fixed and
    // clip the modal otherwise.
    return createPortal(
        <Overlay onClick={onClose}>
            <Card onClick={e => e.stopPropagation()}>
                <Header>Browse script packs</Header>
                <Body>
                    {state.kind === "loading" && <Empty>Loading packs…</Empty>}
                    {state.kind === "error" && (
                        <Empty>
                            <p>Could not load packs.</p>
                            <small>{state.message}</small>
                        </Empty>
                    )}
                    {state.kind === "ready" && state.packs.length === 0 && (
                        <Empty>
                            <p>No built-in packs are available yet.</p>
                            <small>Use Upload file or New empty import for now.</small>
                        </Empty>
                    )}
                    {state.kind === "ready" && state.packs.length > 0 && (
                        <List>
                            {state.packs.map(pack => {
                                const added = isAlreadyAdded(pack.name);
                                return (
                                    <PackButton
                                        key={pack.name}
                                        disabled={pendingPack !== null || added}
                                        $added={added}
                                        onClick={() => void handlePick(pack)}
                                    >
                                        <PackHeader>
                                            <Name>{pack.name}</Name>
                                            {added && <Check aria-label="Already in project">✓</Check>}
                                        </PackHeader>
                                        {pack.description && <Description>{pack.description}</Description>}
                                        {pendingPack === pack.name && <Pending>Adding…</Pending>}
                                    </PackButton>
                                );
                            })}
                        </List>
                    )}
                </Body>
                <Footer>
                    <CloseButton onClick={onClose}>Close</CloseButton>
                </Footer>
            </Card>
        </Overlay>,
        document.body,
    );
};

const Card = styled.div`
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    background: var(--theme-dialog-bg);
    border-radius: var(--theme-dialog-border-radius);
    box-shadow: var(--theme-dialog-shadow);
    color: white;
    z-index: 10001;
    display: flex;
    flex-direction: column;
    padding: 20px 24px;
    gap: 16px;
`;

const PackButton = styled.button<{$added?: boolean}>`
    all: unset;
    cursor: pointer;
    padding: 12px 14px;
    border-radius: 8px;
    background: var(--theme-container-secondary-dark);
    display: flex;
    flex-direction: column;
    gap: 4px;

    &:hover:not(:disabled) {
        background: var(--theme-container-divider);
    }

    &:disabled {
        opacity: ${p => (p.$added ? 0.7 : 0.55)};
        cursor: ${p => (p.$added ? "default" : "progress")};
    }
`;

const PackHeader = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
`;

const Check = styled.span`
    color: var(--theme-container-active-blue);
    font-size: 14px;
    font-weight: var(--theme-font-bold);
`;

const Header = styled.div`
    font-size: var(--theme-font-size-l);
    font-weight: var(--theme-font-bold);
`;

const Body = styled.div`
    font-size: var(--theme-font-size-s);
    color: #c8c8d0;
    line-height: 1.5;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
`;

const Empty = styled.div`
    padding: 24px 0;
    text-align: center;
    color: #888;

    small {
        display: block;
        margin-top: 6px;
        color: #666;
    }
`;

const List = styled.div`
    display: flex;
    flex-direction: column;
    gap: 8px;
`;

const Name = styled.span`
    font-weight: var(--theme-font-medium-plus);
    color: white;
    font-size: 13px;
`;

const Description = styled.span`
    font-size: 12px;
    color: #a1a1aa;
    white-space: pre-wrap;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
`;

const Pending = styled.span`
    font-size: 11px;
    color: var(--theme-container-active-blue);
`;

const Footer = styled.div`
    display: flex;
    justify-content: flex-end;
`;

const CloseButton = styled.button`
    all: unset;
    cursor: pointer;
    padding: 8px 18px;
    border-radius: 6px;
    background: var(--theme-container-secondary-dark);
    color: white;
    font-size: var(--theme-font-size-s);

    &:hover {
        background: var(--theme-container-divider);
    }
`;

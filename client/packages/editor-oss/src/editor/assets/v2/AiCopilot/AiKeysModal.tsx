import {useCallback, useEffect, useMemo, useState} from "react";
import styled from "styled-components";

import {
    COPILOT_KEYS_CHANGED_EVENT,
    COPILOT_MODEL_OPTIONS,
    getCopilotModelSelectionSync,
    resolveCopilotChatKeys,
    setCopilotModelSelection,
} from "../../../../copilot/playgroundCopilotKeys";
import type {CopilotChatKey, CopilotChatProvider} from "../../../../copilot/playgroundCopilotKeys";
import {BYOKKeysPanel} from "../CreateDashboard/SettingsPage/BYOKKeysPanel/BYOKKeysPanel";

/**
 * AiKeysModal — lets a playground visitor configure their own AI provider
 * keys without leaving the copilot panel.
 *
 * The dashboard `SettingsPage` (which also hosts `BYOKKeysPanel`) is hidden in
 * playground mode, so this modal is the only key-config surface there. Keys
 * entered here are persisted locally by `BYOKKeysPanel` itself — IndexedDB
 * (`stemstudio-byok`), optionally AES-GCM encrypted behind a passphrase. They
 * never leave the machine.
 */

const Overlay = styled.div`
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
`;

const Dialog = styled.div`
    width: min(520px, calc(100vw - 48px));
    max-height: calc(100vh - 96px);
    overflow-y: auto;
    background: #1c1f26;
    border: 1px solid #2c323d;
    border-radius: 10px;
    padding: 20px;
`;

const CloseRow = styled.div`
    display: flex;
    justify-content: flex-end;
    margin-bottom: 8px;
`;

const CloseButton = styled.button`
    background: transparent;
    border: 1px solid #3a414d;
    color: #c8d0dc;
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;

    &:hover {
        background: #2a2f38;
    }
`;

const ModelSection = styled.div`
    margin-bottom: 16px;
    padding: 12px;
    border: 1px solid #2c323d;
    border-radius: 8px;
    background: #181b22;
`;

const ModelLabel = styled.label`
    display: grid;
    gap: 8px;
    color: #d8dee8;
    font-size: 13px;
    font-weight: 600;
`;

const ModelSelect = styled.select`
    width: 100%;
    background: #10131a;
    border: 1px solid #394150;
    border-radius: 6px;
    color: #d8dee8;
    padding: 8px 10px;
`;

const providerLabels: Record<CopilotChatProvider, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    gemini: "Gemini",
};

export const AiKeysModal = ({onClose}: {onClose: () => void}) => {
    const [chatKeys, setChatKeys] = useState<CopilotChatKey[]>([]);
    const [selection, setSelection] = useState(getCopilotModelSelectionSync);

    const refreshChatKeys = useCallback(async () => {
        const keys = await resolveCopilotChatKeys({consumeHandoff: false});
        setChatKeys(keys);
        setSelection(getCopilotModelSelectionSync());
    }, []);

    useEffect(() => {
        void refreshChatKeys();
        window.addEventListener(COPILOT_KEYS_CHANGED_EVENT, refreshChatKeys);
        return () => window.removeEventListener(COPILOT_KEYS_CHANGED_EVENT, refreshChatKeys);
    }, [refreshChatKeys]);

    const modelOptions = useMemo(
        () => chatKeys.flatMap(key =>
            COPILOT_MODEL_OPTIONS[key.provider].map(option => ({
                provider: key.provider,
                model: option.model,
                label: `${providerLabels[key.provider]} — ${option.label}`,
            })),
        ),
        [chatKeys],
    );

    const selectedValue = selection ? `${selection.provider}:${selection.model}` : "";

    const handleModelChange = useCallback((value: string) => {
        const [provider, ...modelParts] = value.split(":");
        const model = modelParts.join(":");
        if (!provider || !model) return;
        setCopilotModelSelection(provider as CopilotChatProvider, model);
        setSelection({provider: provider as CopilotChatProvider, model});
    }, []);

    const handleOverlayClick = useCallback(
        (e: React.MouseEvent) => {
            if (e.target === e.currentTarget) onClose();
        },
        [onClose],
    );

    return (
        <Overlay onClick={handleOverlayClick}>
            <Dialog>
                <CloseRow>
                    <CloseButton type="button" onClick={onClose}>
                        Close
                    </CloseButton>
                </CloseRow>
                {chatKeys.length > 1 ? (
                    <ModelSection>
                        <ModelLabel>
                            Copilot model
                            <ModelSelect
                                aria-label="Copilot model"
                                value={selectedValue}
                                onChange={event => handleModelChange(event.target.value)}
                            >
                                <option value="" disabled>
                                    Choose model
                                </option>
                                {modelOptions.map(option => (
                                    <option
                                        key={`${option.provider}:${option.model}`}
                                        value={`${option.provider}:${option.model}`}
                                    >
                                        {option.label}
                                    </option>
                                ))}
                            </ModelSelect>
                        </ModelLabel>
                    </ModelSection>
                ) : null}
                <BYOKKeysPanel statusMode="local" />
            </Dialog>
        </Overlay>
    );
};

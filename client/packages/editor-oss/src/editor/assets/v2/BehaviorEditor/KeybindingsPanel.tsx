/**
 * VS Code-style floating keybindings reference panel.
 * Opens on click, closes via close button or clicking outside.
 */
import {useCallback, useRef} from "react";
import {createPortal} from "react-dom";
import {HiOutlineXMark} from "react-icons/hi2";
import styled from "styled-components";

import i18n from "@stem/editor-oss/i18n/config";
import {
    FloatingPanelCloseButton,
    FloatingPanelContainer,
    FloatingPanelHeader,
    FloatingPanelOverlay,
    FloatingPanelTitle,
} from "../common/FloatingPanelShell";
import {useEscapeDismiss} from "../common/hooks/useEscapeDismiss";

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const mod = isMac ? "\u2318" : "Ctrl";
const alt = isMac ? "\u2325" : "Alt";
const shift = isMac ? "\u21E7" : "Shift";

export interface Binding {
    label: string;
    keys: string;
    section: string;
}

const CODE_EDITOR_KEYBINDINGS: Binding[] = [
    {label: "Save", keys: `${mod}+S`, section: "File"},
    {label: "Save All", keys: `${mod}+${shift}+S`, section: "File"},
    {label: "Quick Open", keys: `${mod}+P`, section: "File"},
    {label: "Search Across Files", keys: `${mod}+${shift}+F`, section: "File"},
    {label: "Find in File", keys: `${mod}+F`, section: "Navigation"},
    {label: "Find and Replace", keys: `${mod}+${shift}+R`, section: "Navigation"},
    {label: "Go to Line", keys: `${mod}+G`, section: "Navigation"},
    {label: "Go to Definition", keys: `F12`, section: "Navigation"},
    {label: "Duplicate Line", keys: `${mod}+D`, section: "Editing"},
    {label: "Delete Line", keys: `${mod}+Y`, section: "Editing"},
    {label: "Move Line Up", keys: `${alt}+${shift}+\u2191`, section: "Editing"},
    {label: "Move Line Down", keys: `${alt}+${shift}+\u2193`, section: "Editing"},
    {label: "Toggle Comment", keys: `${mod}+/`, section: "Editing"},
    {label: "Block Comment", keys: `${mod}+${shift}+/`, section: "Editing"},
    {label: "Indent/Outdent", keys: `${mod}+[/]`, section: "Editing"},
    {label: "Join Lines", keys: `${mod}+${shift}+J`, section: "Editing"},
    {label: "Reformat Code", keys: `${mod}+${alt}+L`, section: "Editing"},
    {label: "Undo", keys: `${mod}+Z`, section: "Editing"},
    {label: "Redo", keys: `${mod}+${shift}+Z`, section: "Editing"},
    {label: "Expand Selection", keys: `${shift}+${alt}+\u2192`, section: "Selection"},
    {label: "Shrink Selection", keys: `${shift}+${alt}+\u2190`, section: "Selection"},
    {label: "Next Occurrence", keys: `${alt}+J`, section: "Selection"},
    {label: "All Occurrences", keys: `${mod}+${shift}+${alt}+J`, section: "Selection"},
    {label: "Toggle Fold", keys: `${mod}+.`, section: "Folding"},
    {label: "Fold All", keys: `${mod}+${shift}+-`, section: "Folding"},
    {label: "Unfold All", keys: `${mod}+${shift}+=`, section: "Folding"},
];

export const EDITOR_KEYBINDINGS: Binding[] = [
    {label: "Undo", keys: `${mod}+Z`, section: "General"},
    {label: "Redo", keys: `${mod}+${shift}+Z`, section: "General"},
    {label: "Copy", keys: `${mod}+C`, section: "General"},
    {label: "Paste", keys: `${mod}+V`, section: "General"},
    {label: "Duplicate", keys: `${mod}+D`, section: "General"},
    {label: "Delete", keys: "Delete", section: "Objects"},
    {label: "Deselect", keys: "Esc", section: "Objects"},
    {label: "Group", keys: `${mod}+G`, section: "Objects"},
    {label: "Ungroup", keys: `${mod}+${shift}+G`, section: "Objects"},
    {label: "Toggle UI Panels", keys: `${mod}+.`, section: "View"},
    {label: "Quick Build tool shortcuts", keys: "0-9, B/E/L/U/V", section: "Build Tools"},
    {label: "Rotate Quick Build stamp", keys: "R", section: "Build Tools"},
    {label: "Reverse Quick Build rotation", keys: `${shift}+R`, section: "Build Tools"},
    {label: "Quick Build brush radius", keys: "[/]", section: "Build Tools"},
    {label: "Finish BIM polygon", keys: "Enter", section: "Build Tools"},
    {label: "Remove last BIM polygon point", keys: "Backspace", section: "Build Tools"},
    {label: "Cancel or close active builder mode", keys: "Esc", section: "Build Tools"},
];

// ── Styles ──────────────────────────────────────────────────────────────────

const Popover = styled(FloatingPanelContainer)`
    width: 300px;
    max-height: 420px;
`;

const Body = styled.div`
    padding: 4px 12px 10px;
    overflow-y: auto;
    flex: 1;

    &::-webkit-scrollbar {
        width: 4px;
    }
    &::-webkit-scrollbar-thumb {
        background: #555;
        border-radius: 2px;
    }
`;

const SectionTitle = styled.div`
    font-size: 10px;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 8px 0 3px;
`;

const Row = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 4px;
    border-radius: 3px;

    &:hover {
        background: #2a2d2e;
    }
`;

const Label = styled.span`
    font-size: 11px;
    color: #ccc;
`;

const Keys = styled.span`
    display: inline-flex;
    gap: 2px;
    flex-shrink: 0;
    margin-left: 12px;
`;

const Kbd = styled.kbd`
    display: inline-block;
    padding: 1px 5px;
    font-size: 10px;
    font-family: inherit;
    color: #ccc;
    background: #252526;
    border: 1px solid #555;
    border-radius: 3px;
    box-shadow: 0 1px 0 #333;
    line-height: 1.4;
    white-space: nowrap;
`;

// ── Component ───────────────────────────────────────────────────────────────

interface KeybindingsPanelProps {
    anchorRef: React.RefObject<HTMLElement | null>;
    onClose: () => void;
    bindings?: Binding[];
    title?: string;
}

export const KeybindingsPanel = ({anchorRef, onClose, bindings, title}: KeybindingsPanelProps) => {
    const keybindings = bindings ?? CODE_EDITOR_KEYBINDINGS;
    const panelTitle = title ?? i18n.t("Keyboard Shortcuts");
    const panelRef = useRef<HTMLDivElement>(null);

    // Use the anchor's ownerDocument so the portal renders in the correct window
    // (pop-out window vs main window)
    const ownerDoc = anchorRef.current?.ownerDocument ?? document;
    const ownerWin = ownerDoc.defaultView ?? window;

    // Position the popover below the anchor button
    const getPosition = useCallback(() => {
        const anchor = anchorRef.current;
        if (!anchor) return {top: 100, left: 100};
        const rect = anchor.getBoundingClientRect();
        let top = rect.bottom + 6;
        let left = rect.right - 300; // align right edge with button

        // Clamp to viewport
        if (left < 8) left = 8;
        if (top + 420 > ownerWin.innerHeight) {
            top = rect.top - 420 - 6; // flip above if no room below
        }
        return {top, left};
    }, [anchorRef, ownerWin]);

    const pos = getPosition();

    // Close on Escape
    useEscapeDismiss({onEscape: onClose, ownerWindow: ownerWin});

    return createPortal(
        <>
            <FloatingPanelOverlay onClick={onClose} />
            <Popover ref={panelRef}
                style={{top: pos.top, left: pos.left}}
            >
                <FloatingPanelHeader>
                    <FloatingPanelTitle>{panelTitle}</FloatingPanelTitle>
                    <FloatingPanelCloseButton onClick={onClose}>
                        <HiOutlineXMark width={14}
                            height={14}
                        />
                    </FloatingPanelCloseButton>
                </FloatingPanelHeader>
                <Body>
                    {[...new Set(keybindings.map(b => b.section))].map(section => 
                        <div key={section}>
                            <SectionTitle>{i18n.t(section)}</SectionTitle>
                            {keybindings
                                .filter(b => b.section === section)
                                .map(b => 
                                    <Row key={b.label}>
                                        <Label>{i18n.t(b.label)}</Label>
                                        <Keys>
                                            {b.keys.split("+").map((k, i) => 
                                                <Kbd key={i}>{k}</Kbd>,
                                            )}
                                        </Keys>
                                    </Row>,
                                )}
                        </div>,
                    )}
                </Body>
            </Popover>
        </>,
        ownerDoc.body,
    );
};

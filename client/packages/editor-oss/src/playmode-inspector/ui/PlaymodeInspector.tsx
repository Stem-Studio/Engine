import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import styled, {StyleSheetManager} from "styled-components";
import * as THREE from "three";

import {PlaymodeHierarchy} from "./PlaymodeHierarchy";
import {PlaymodeProperties} from "./PlaymodeProperties";
import {PlaymodeQuickOpen} from "./PlaymodeQuickOpen";
import {usePopoutWindow} from "./usePopoutWindow";
import global from "../../global";
import {showToast} from "../../showToast";
import {diffPlaymodeSnapshot, formatPlaymodeDiff} from "../playmodeSnapshot";
import {findObjectByUuidDepthFirst} from "../../utils/SceneTraverser";

const Z_INDEX = 14990;
const POSITION_STORAGE_KEY = "playmodeInspector.position";
const MINIMIZED_STORAGE_KEY = "playmodeInspector.minimized";
const DEFAULT_WIDTH = 540;
const MINIMIZED_HEIGHT = 42;
const SCREEN_PADDING = 8;

type Position = {x: number; y: number};

const readStoredPosition = (): Position | null => {
    try {
        const raw = localStorage.getItem(POSITION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Position;
        if (typeof parsed?.x === "number" && typeof parsed?.y === "number") return parsed;
    } catch {
        /* ignore */
    }
    return null;
};

const readStoredMinimized = (): boolean => {
    try {
        return localStorage.getItem(MINIMIZED_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
};

const clampToViewport = (pos: Position, panelWidth: number, panelHeight: number): Position => {
    const maxX = Math.max(SCREEN_PADDING, window.innerWidth - panelWidth - SCREEN_PADDING);
    const maxY = Math.max(SCREEN_PADDING, window.innerHeight - panelHeight - SCREEN_PADDING);
    return {
        x: Math.min(Math.max(pos.x, SCREEN_PADDING), maxX),
        y: Math.min(Math.max(pos.y, SCREEN_PADDING), maxY),
    };
};

export const PlaymodeInspector: React.FC = () => {
    const app = global.app;
    const [hidden, setHidden] = useState(false);
    const [minimized, setMinimized] = useState(readStoredMinimized);
    const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
    const [freeCameraActive, setFreeCameraActive] = useState(false);
    const [hierarchyQuery, setHierarchyQuery] = useState("");
    const [hideInactive, setHideInactive] = useState(false);
    const [propertiesQuery, setPropertiesQuery] = useState("");
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [popoutOpen, setPopoutOpen] = useState(false);
    const [position, setPosition] = useState<Position | null>(readStoredPosition);
    const [, forceTick] = useState(0);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const dragOffsetRef = useRef<Position | null>(null);

    // Persist position + minimized state.
    useEffect(() => {
        try {
            if (position) localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
        } catch {
            /* ignore */
        }
    }, [position]);

    useEffect(() => {
        try {
            localStorage.setItem(MINIMIZED_STORAGE_KEY, minimized ? "1" : "0");
        } catch {
            /* ignore */
        }
    }, [minimized]);

    // Re-clamp position when the window resizes so the panel doesn't end up offscreen.
    useEffect(() => {
        const onResize = () => {
            setPosition(prev => {
                if (!prev) return prev;
                const el = containerRef.current;
                const w = el?.offsetWidth ?? DEFAULT_WIDTH;
                const h = el?.offsetHeight ?? MINIMIZED_HEIGHT;
                return clampToViewport(prev, w, h);
            });
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
        // Only drag from the bare title-bar surface — buttons and inputs handle their own clicks.
        if (e.target !== e.currentTarget) {
            const target = e.target as HTMLElement;
            if (target.closest("button, input, label, kbd")) return;
        }
        const el = containerRef.current;
        if (!el) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        dragOffsetRef.current = {x: e.clientX - rect.left, y: e.clientY - rect.top};
        // Prime position from the current rect so the first move doesn't jump if we were
        // anchored via the default top/right CSS.
        setPosition({x: rect.left, y: rect.top});

        const onMove = (ev: MouseEvent) => {
            const off = dragOffsetRef.current;
            if (!off) return;
            const next: Position = {x: ev.clientX - off.x, y: ev.clientY - off.y};
            const w = el.offsetWidth || DEFAULT_WIDTH;
            const h = el.offsetHeight || MINIMIZED_HEIGHT;
            setPosition(clampToViewport(next, w, h));
        };
        const onUp = () => {
            dragOffsetRef.current = null;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    // Re-render periodically so newly spawned objects appear and live values refresh.
    useEffect(() => {
        const id = window.setInterval(() => forceTick(n => (n + 1) % 1_000_000), 250);
        return () => window.clearInterval(id);
    }, []);

    useEffect(() => {
        if (!app) return;
        const handleCanvasSelection = (object: THREE.Object3D | null) => {
            setSelectedUuid(object?.uuid ?? null);
        };
        app.on("playmodeInspectorObjectSelected.PlaymodeInspector", handleCanvasSelection);
        return () => {
            app.on("playmodeInspectorObjectSelected.PlaymodeInspector", null);
        };
    }, [app]);

    // Cmd/Ctrl-K (or Cmd/Ctrl-P) opens the palette, Esc closes it.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const cmd = e.metaKey || e.ctrlKey;
            if (cmd && (e.key === "k" || e.key === "K" || e.key === "p" || e.key === "P")) {
                e.preventDefault();
                e.stopPropagation();
                setPaletteOpen(v => !v);
            }
        };
        window.addEventListener("keydown", handler, true);
        return () => window.removeEventListener("keydown", handler, true);
    }, []);

    const sceneProvider = useCallback(() => app?.game?.scene ?? null, [app]);
    const game = app?.game ?? null;
    const scene = app?.game?.scene ?? null;

    const selectedObject = useMemo<THREE.Object3D | null>(() => {
        if (!selectedUuid || !scene) return null;
        return findObjectByUuidDepthFirst(scene, selectedUuid);
    }, [selectedUuid, scene]);

    const handleToggleFreeCamera = () => {
        if (!app) return;
        const next = app.togglePlaymodeFreeCamera();
        setFreeCameraActive(next);
    };

    const handlePrintSummary = async () => {
        if (!app || !scene) return;
        const snap = app.getPlaymodeSnapshot();
        if (!snap) {
            showToast({type: "warning", title: "No snapshot available — inspector toggled on after play started?"});
            return;
        }
        const diff = diffPlaymodeSnapshot(scene, snap);
        const summary = formatPlaymodeDiff(diff);
         
        console.log("[Playmode Inspector] Changes summary:\n" + summary);
        try {
            await navigator.clipboard.writeText(summary);
            const total = diff.transforms.length + diff.behaviorAttributes.length;
            showToast({
                type: "info",
                title:
                    total === 0
                        ? "No changes since play started"
                        : `Copied ${total} change(s) — also logged to console`,
            });
        } catch (err) {
            console.warn("[Playmode Inspector] Clipboard write failed", err);
            showToast({type: "info", title: "Logged to console (clipboard blocked)"});
        }
    };

    const handlePaletteClose = useCallback(() => setPaletteOpen(false), []);
    const handlePalettePick = useCallback((uuid: string) => setSelectedUuid(uuid), []);
    const handlePopoutExternalClose = useCallback(() => setPopoutOpen(false), []);

    const popoutHandle = usePopoutWindow(popoutOpen, "StemStudio Inspector", handlePopoutExternalClose);

    if (hidden) {
        return (
            <RestoreButton onClick={() => setHidden(false)} title="Show Play-mode Inspector">
                🔍
            </RestoreButton>
        );
    }

    const inspectorBody = (
        <Body>
            <Pane>
                <PaneTitle>
                    <span>Hierarchy</span>
                    <PaneToolbar>
                        <SmallSearch
                            placeholder="Filter…"
                            value={hierarchyQuery}
                            onChange={e => setHierarchyQuery(e.target.value)}
                        />
                        <ToggleChip
                            $active={hideInactive}
                            onClick={() => setHideInactive(v => !v)}
                            title="Hide objects with .visible=false"
                        >
                            Active only
                        </ToggleChip>
                    </PaneToolbar>
                </PaneTitle>
                <PlaymodeHierarchy
                    sceneProvider={sceneProvider}
                    selectedUuid={selectedUuid}
                    onSelect={setSelectedUuid}
                    query={hierarchyQuery}
                    hideInactive={hideInactive}
                />
            </Pane>
            <Pane>
                <PaneTitle>
                    <span>Properties</span>
                    <PaneToolbar>
                        <SmallSearch
                            placeholder="Filter attributes…"
                            value={propertiesQuery}
                            onChange={e => setPropertiesQuery(e.target.value)}
                        />
                    </PaneToolbar>
                </PaneTitle>
                <PlaymodeProperties object={selectedObject} game={game} query={propertiesQuery} />
            </Pane>
        </Body>
    );

    const inspectorFooter = (
        <Footer>
            Edits revert on Stop · {scene?.children.length ?? 0} root objects ·
            <Kbd>{navigator.platform.includes("Mac") ? "⌘K" : "Ctrl+K"}</Kbd> for quick open
        </Footer>
    );

    const inspectorChrome = (popoutTarget: boolean) => (
        <TopBar
            onMouseDown={popoutTarget ? undefined : startDrag}
            $draggable={!popoutTarget}
        >
            <Title>Inspector{popoutTarget && " (popout)"}</Title>
            <Spacer />
            <ActionButton
                $active={freeCameraActive}
                onClick={handleToggleFreeCamera}
                title={freeCameraActive ? "Return to game camera" : "Detach to free-fly debug camera"}
            >
                {freeCameraActive ? "● Free Cam" : "Free Cam"}
            </ActionButton>
            <IconButton onClick={() => setPaletteOpen(true)} title="Quick open (Cmd/Ctrl-K)">
                🔎
            </IconButton>
            <IconButton onClick={handlePrintSummary} title="Copy a summary of all changes since play started">
                📋
            </IconButton>
            {!popoutTarget && (
                <IconButton onClick={() => setPopoutOpen(true)} title="Open inspector in a separate window">
                    ⧉
                </IconButton>
            )}
            {!popoutTarget && (
                <IconButton
                    onClick={() => setMinimized(v => !v)}
                    title={minimized ? "Expand inspector" : "Minimize inspector (keep title bar)"}
                >
                    {minimized ? "▢" : "—"}
                </IconButton>
            )}
            <IconButton onClick={() => setHidden(true)} title="Hide inspector for this session">
                ×
            </IconButton>
        </TopBar>
    );

    const positionStyle: React.CSSProperties = position
        ? {top: position.y, left: position.x, right: "auto"}
        : {};
    if (minimized) {
        positionStyle.height = "auto";
        positionStyle.maxHeight = "none";
    }

    // When popped out: render an empty placeholder in the host plus a portal to the popout window.
    return (
        <>
            {!popoutHandle && (
                <Container ref={containerRef} style={positionStyle}>
                    {inspectorChrome(false)}
                    {!minimized && inspectorBody}
                    {!minimized && inspectorFooter}
                </Container>
            )}

            {popoutHandle &&
                createPortal(
                    <StyleSheetManager target={popoutHandle.win.document.head}>
                        <PopoutShell>
                            {inspectorChrome(true)}
                            {inspectorBody}
                            {inspectorFooter}
                        </PopoutShell>
                    </StyleSheetManager>,
                    popoutHandle.container,
                )}

            {paletteOpen && (
                <PlaymodeQuickOpen
                    sceneProvider={sceneProvider}
                    onClose={handlePaletteClose}
                    onPick={handlePalettePick}
                />
            )}
        </>
    );
};

const Container = styled.div`
    position: fixed;
    top: 100px;
    right: 20px;
    width: 540px;
    max-width: calc(100vw - 40px);
    height: calc(100vh - 140px);
    max-height: 740px;
    background: rgba(18, 18, 18, 0.96);
    border: 1px solid #444;
    border-radius: 8px;
    color: #ddd;
    font-family: "Roboto", sans-serif;
    z-index: ${Z_INDEX};
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    pointer-events: auto;
`;

const PopoutShell = styled.div`
    position: fixed;
    inset: 0;
    background: rgba(18, 18, 18, 0.96);
    color: #ddd;
    display: flex;
    flex-direction: column;
    overflow: hidden;
`;

const TopBar = styled.div<{$draggable?: boolean}>`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid #2a2a2a;
    background: rgba(0, 0, 0, 0.4);
    cursor: ${p => (p.$draggable ? "move" : "default")};
    user-select: none;
`;

const Title = styled.div`
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.4px;
`;

const Spacer = styled.div`
    flex: 1;
`;

const ActionButton = styled.button<{$active?: boolean}>`
    background: ${p => (p.$active ? "rgba(0, 153, 255, 0.30)" : "rgba(255, 255, 255, 0.08)")};
    border: 1px solid ${p => (p.$active ? "#0099ff" : "#444")};
    color: #ddd;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;

    &:hover {
        background: ${p => (p.$active ? "rgba(0, 153, 255, 0.40)" : "rgba(255, 255, 255, 0.14)")};
    }
`;

const IconButton = styled.button`
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid #333;
    color: #ddd;
    border-radius: 4px;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;

    &:hover {
        background: rgba(255, 255, 255, 0.14);
        color: #fff;
    }
`;

const RestoreButton = styled.button`
    position: fixed;
    top: 100px;
    right: 20px;
    width: 36px;
    height: 36px;
    background: rgba(0, 0, 0, 0.7);
    border: 1px solid #444;
    border-radius: 50%;
    color: #fff;
    font-size: 16px;
    cursor: pointer;
    z-index: ${Z_INDEX};
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;

    &:hover {
        background: rgba(0, 0, 0, 0.9);
        border-color: #666;
    }
`;

const Body = styled.div`
    display: flex;
    flex: 1;
    min-height: 0;
`;

const Pane = styled.div`
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid #2a2a2a;

    &:last-child {
        border-right: none;
    }
`;

const PaneTitle = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid #2a2a2a;
    font-size: 10px;
    font-weight: 700;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;

    & > span:first-child {
        flex-shrink: 0;
    }
`;

const PaneToolbar = styled.div`
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    justify-content: flex-end;
    text-transform: none;
    letter-spacing: 0;
    font-weight: normal;
`;

const SmallSearch = styled.input`
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid #333;
    border-radius: 3px;
    color: #ddd;
    font-size: 11px;
    padding: 3px 6px;
    width: 100%;
    max-width: 140px;
    outline: none;

    &:focus {
        border-color: #0099ff;
        background: rgba(255, 255, 255, 0.08);
    }

    &::placeholder {
        color: #666;
    }
`;

const ToggleChip = styled.button<{$active: boolean}>`
    background: ${p => (p.$active ? "rgba(0, 153, 255, 0.25)" : "rgba(255, 255, 255, 0.05)")};
    border: 1px solid ${p => (p.$active ? "#0099ff" : "#333")};
    color: ${p => (p.$active ? "#fff" : "#aaa")};
    border-radius: 3px;
    font-size: 10px;
    padding: 3px 6px;
    cursor: pointer;
    white-space: nowrap;

    &:hover {
        color: #fff;
    }
`;

const Footer = styled.div`
    padding: 4px 10px;
    font-size: 10px;
    color: #666;
    border-top: 1px solid #2a2a2a;
    text-align: right;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
`;

const Kbd = styled.kbd`
    font-family: ui-monospace, monospace;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid #333;
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 10px;
    color: #aaa;
`;

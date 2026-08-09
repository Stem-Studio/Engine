import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";

import {Backdrop, Item, Menu} from "./AddImportMenu.style";

interface Props {
    anchor: DOMRect | null;
    onClose: () => void;
    onBrowsePacks: () => void;
    onUploadFile: () => void;
    onNewEmpty: () => void;
}

const MENU_GAP = 4;
const VIEWPORT_PADDING = 8;

export const AddImportMenu = ({anchor, onClose, onBrowsePacks, onUploadFile, onNewEmpty}: Props) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({top: 0, left: 0});

    const initial = useMemo(() => {
        if (!anchor) return {top: 0, left: 0};
        return {top: anchor.bottom + MENU_GAP, left: anchor.left};
    }, [anchor]);

    useLayoutEffect(() => {
        if (!anchor || !menuRef.current) {
            setPosition(initial);
            return;
        }
        const rect = menuRef.current.getBoundingClientRect();
        const maxLeft = window.innerWidth - rect.width - VIEWPORT_PADDING;
        const maxTop = window.innerHeight - rect.height - VIEWPORT_PADDING;
        setPosition({
            top: Math.max(VIEWPORT_PADDING, Math.min(initial.top, maxTop)),
            left: Math.max(VIEWPORT_PADDING, Math.min(initial.left, maxLeft)),
        });
    }, [anchor, initial]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    if (!anchor) return null;

    const handle = (action: () => void) => () => {
        action();
        onClose();
    };

    // Portal into <body> so the menu escapes any ancestor that creates a
    // containing block for position:fixed descendants — `transform`,
    // `filter`, `perspective`, `backdrop-filter`, `will-change` on an
    // ancestor all silently re-anchor fixed positioning, which is why the
    // menu was getting clipped inside the outliner panel.
    return createPortal(
        <>
            <Backdrop onClick={onClose} />
            <Menu ref={menuRef}
                $top={position.top}
                $left={position.left}
            >
                <Item onClick={handle(onBrowsePacks)}>
                    <span className="label">Browse packs</span>
                    <span className="hint">Built-in modules: state machines, noise, octree, …</span>
                </Item>
                <Item onClick={handle(onUploadFile)}>
                    <span className="label">Upload file</span>
                    <span className="hint">.js or .yaml export</span>
                </Item>
                <Item onClick={handle(onNewEmpty)}>
                    <span className="label">New empty import</span>
                    <span className="hint">Start from a blank module</span>
                </Item>
            </Menu>
        </>,
        document.body,
    );
};

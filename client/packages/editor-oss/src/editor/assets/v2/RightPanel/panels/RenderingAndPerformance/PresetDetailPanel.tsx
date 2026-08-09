import { useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { HiOutlineXMark } from "react-icons/hi2";
import styled from "styled-components";

import { QualityPresets } from "../../../../../../core/quality/QualityPresets";
import {
    FloatingPanelCloseButton,
    FloatingPanelContainer,
    FloatingPanelHeader,
    FloatingPanelOverlay,
    FloatingPanelTitle,
} from "../../../common/FloatingPanelShell";
import {useEscapeDismiss} from "../../../common/hooks/useEscapeDismiss";

const Popover = styled(FloatingPanelContainer)`
    width: 300px;
    max-height: 460px;
`;

const Body = styled.div`
    padding: 4px 12px 10px;
    overflow-y: auto;
    flex: 1;
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: #555; border-radius: 2px; }
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
    &:hover { background: #2a2d2e; }
`;

const Label = styled.span`
    font-size: 11px;
    color: #ccc;
`;

const Value = styled.span`
    font-size: 11px;
    color: #9cdcfe;
    flex-shrink: 0;
    margin-left: 12px;
`;

interface PresetDetailPanelProps {
    anchorRef: React.RefObject<HTMLElement | null>;
    presetKey: string;
    onClose: () => void;
}

/**
 *
 * @param v
 */
function formatValue(v: unknown): string {
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
}

export const PresetDetailPanel = ({ anchorRef, presetKey, onClose }: PresetDetailPanelProps) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const preset = QualityPresets.getPreset(presetKey);
    const settings = preset?.settings;

    const ownerDoc = anchorRef.current?.ownerDocument ?? document;
    const ownerWin = ownerDoc.defaultView ?? window;

    const getPosition = useCallback(() => {
        const anchor = anchorRef.current;
        if (!anchor) return { top: 100, left: 100 };
        const rect = anchor.getBoundingClientRect();
        let top = rect.bottom + 6;
        let left = rect.right - 300;
        if (left < 8) left = 8;
        if (top + 460 > ownerWin.innerHeight) {
            top = rect.top - 460 - 6;
        }
        return { top, left };
    }, [anchorRef, ownerWin]);

    const pos = getPosition();

    useEscapeDismiss({onEscape: onClose, ownerWindow: ownerWin});

    if (!settings) return null;

    const sections: { title: string; rows: [string, string][] }[] = [
        {
            title: "Rendering",
            rows: [
                ["Pixel Ratio", formatValue(settings.rendering.pixelRatio)],
                ["Shadow Quality", formatValue(settings.rendering.shadowQuality)],
                ["Antialiasing", formatValue(settings.rendering.antialiasing)],
                ["Max Lights", formatValue(settings.rendering.maxLights)],
                ["Texture Quality", formatValue(settings.rendering.textureQuality)],
                ["Post Processing", formatValue(settings.rendering.postProcessing)],
                ["Bloom", formatValue(settings.rendering.bloom)],
                ["SSAO", formatValue(settings.rendering.ssao)],
                ["Reflections", formatValue(settings.rendering.reflections)],
                ["Instancing", formatValue(settings.rendering.useInstancing)],
            ],
        },
        {
            title: "Physics",
            rows: [
                ["Update Rate", `${settings.physics.updateRate} Hz`],
                ["Substeps", formatValue(settings.physics.substeps)],
                ["Max Steps Per Frame", formatValue(settings.physics.maxStepsPerFrame)],
                ["Solver Iterations", formatValue(settings.physics.solverIterations ?? 4)],
            ],
        },
        {
            title: "Scene",
            rows: [
                ["View Distance", `${settings.scene.viewDistance}m`],
                ["LOD Distances", formatValue(settings.scene.lodDistances)],
                ["Max Draw Calls", formatValue(settings.scene.maxDrawCalls)],
                ["Max Triangles", formatValue(settings.scene.maxTriangles)],
                ["Dynamic Batching", formatValue(settings.scene.dynamicBatching)],
                ["Culling", formatValue(settings.scene.cullingAggressiveness)],
            ],
        },
    ];

    return createPortal(
        <>
            <FloatingPanelOverlay onClick={onClose} />
            <Popover ref={panelRef}
                style={{ top: pos.top, left: pos.left }}
            >
                <FloatingPanelHeader>
                    <FloatingPanelTitle>{preset?.displayName ?? presetKey} Preset</FloatingPanelTitle>
                    <FloatingPanelCloseButton onClick={onClose}>
                        <HiOutlineXMark width={14}
                            height={14}
                        />
                    </FloatingPanelCloseButton>
                </FloatingPanelHeader>
                <Body>
                    {sections.map(({ title, rows }) => 
                        <div key={title}>
                            <SectionTitle>{title}</SectionTitle>
                            {rows.map(([label, value]) => 
                                <Row key={label}>
                                    <Label>{label}</Label>
                                    <Value>{value}</Value>
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

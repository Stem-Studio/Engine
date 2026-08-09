import {useEffect, useState} from "react";
import styled from "styled-components";
import * as THREE from "three";

import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import CustomTube, { CurveType } from "../../../../../object/geometry/CustomTube";
import { StyledRange } from "../../common/StyledRange";
import { Separator } from "../common/Separator";

const Container = styled.div`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px;
`;

const InputGroup = styled.div`
    display: flex;
    flex-direction: column;
    gap: 4px;
`;

const Label = styled.label`
    color: var(--theme-font-unselected-color);
    font-size: 11px;
    font-weight: 500;
`;

const Input = styled.input`
    width: 100%;
    padding: 6px 10px;
    background: var(--theme-grey-bg);
    border: 1px solid var(--theme-container-divider);
    border-radius: 4px;
    color: var(--theme-font-main-selected-color);
    font-size: 13px;
    outline: none;

    &:focus {
        border-color: var(--theme-primary-color);
    }
`;

const Select = styled.select`
    width: 100%;
    padding: 6px 10px;
    background: var(--theme-grey-bg);
    border: 1px solid var(--theme-container-divider);
    border-radius: 4px;
    color: var(--theme-font-main-selected-color);
    font-size: 13px;
    outline: none;
    cursor: pointer;

    &:focus {
        border-color: var(--theme-primary-color);
    }
`;

const SliderRow = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
`;

const SliderValue = styled.span`
    color: var(--theme-font-main-selected-color);
    font-size: 12px;
    min-width: 40px;
    text-align: right;
`;

const TwoColumnInputs = styled.div`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
`;

const CheckboxRow = styled.label`
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--theme-font-main-selected-color);
    font-size: 13px;
`;

const Checkbox = styled.input`
    width: 16px;
    height: 16px;
    cursor: pointer;
`;


const Button = styled.button<{ variant?: "primary" }>`
    width: 100%;
    padding: 10px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: ${props =>
        props.variant === "primary" ? "none" : "1px solid var(--theme-grey-bg)"};
    background: ${props =>
        props.variant === "primary"
            ? "var(--theme-primary-color)"
            : "var(--theme-container-secondary-dark)"};
    color: var(--theme-font-main-selected-color);

    &:hover {
        opacity: 0.8;
        transform: translateY(-1px);
    }

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
    }
`;

const HelpText = styled.div`
    color: var(--theme-font-unselected-color);
    font-size: 11px;
    line-height: 1.4;
    padding: 8px;
    background: var(--theme-container-secondary-dark);
    border-radius: 4px;
    border-left: 3px solid var(--theme-primary-color);
`;

/**
 * Helper function to determine if we can add more control points based on curve type
 * @param curveType
 * @param currentCount
 */
const canAddPoints = (curveType: CurveType, currentCount: number): boolean => {
    const fixedPointRequirements: { [key in CurveType]?: number } = {
        [CurveType.QUADRATIC_BEZIER]: 3,
        [CurveType.CUBIC_BEZIER]: 4,
    };

    const requiredPoints = fixedPointRequirements[curveType];
    if (requiredPoints === undefined) {
        return true; // No fixed requirement, can add points
    }

    return currentCount < requiredPoints;
};

export const CurveEditorPanel = () => {
    const app = (global.app as EngineRuntime) || null;

    const [curveType, setCurveType] = useState<CurveType>(CurveType.CATMULL_ROM);
    const [tubularSegments, setTubularSegments] = useState(64);
    const [radius, setRadius] = useState(0.2);
    const [radialSegments, setRadialSegments] = useState(8);
    const [closed, setClosed] = useState(false);
    const [extrudeDepth, setExtrudeDepth] = useState(0);
    const [selectedPointInfo, setSelectedPointInfo] = useState<{ index: number; prevDistance: number | null; nextDistance: number | null } | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [currentPointCount, setCurrentPointCount] = useState(0);

    // Load curve properties from selected object and auto-enter edit mode
    useEffect(() => {
        const selected = app?.editor?.selected;
        let enteredEditMode = false;

        if (selected && !Array.isArray(selected) && selected instanceof CustomTube) {
            const userData = selected.userData;

            setCurveType(userData.curveType || CurveType.CATMULL_ROM);
            setTubularSegments(userData.tubularSegments || 64);
            setRadius(userData.radius || 0.2);
            setRadialSegments(userData.radialSegments || 8);
            setClosed(userData.closed || false);
            setExtrudeDepth(userData.extrudeDepth || 0);
            setIsInitialized(true);

            // Auto-enter curve edit mode
            app.editor?.enterCurveEditMode?.(selected);
            enteredEditMode = true;
        }

        // Cleanup: exit edit mode ONLY if we entered it in this effect
        return () => {
            if (enteredEditMode) {
                app.editor?.exitCurveEditMode?.();
            }
        };
    }, [app?.editor?.selected]);

    // Poll for selected point info updates and update gizmo positions
    useEffect(() => {
        const interval = setInterval(() => {
            const info = app?.editor?.curveEditorControls?.getSelectedPointInfo?.();
            setSelectedPointInfo(info || null);

            // Update current point count
            const selected = app?.editor?.selected;
            if (selected && !Array.isArray(selected) && selected instanceof CustomTube) {
                const pointCount = (selected.userData.curvePoints || []).length;
                setCurrentPointCount(pointCount);
            }

            // Update gizmo positions to follow object transforms
            app?.editor?.curveEditorControls?.updateGizmoPositions?.();
        }, 100); // Update 10 times per second

        return () => clearInterval(interval);
    }, [app?.editor?.curveEditorControls]);

    // Enforce point count when curve type changes
    useEffect(() => {
        if (!isInitialized) return;
        if (!app?.editor?.curveEditorControls) return;

        // Enforce point count for specific curve types
        app.editor.curveEditorControls.enforcePointCount(curveType);
    }, [curveType, isInitialized]);

    // Auto-update curve when properties change (real-time)
    useEffect(() => {
        // Don't update until we've loaded initial values from the selected object
        if (!isInitialized) return;

        const selected = app?.editor?.selected;
        if (!selected || Array.isArray(selected) || !(selected instanceof CustomTube)) return;

        // Get current control points from userData (updated by CurveEditorControls)
        const currentPoints = (selected.userData.curvePoints || []).map((p: any) =>
            new THREE.Vector3(p.x, p.y, p.z),
        );

        // Update CustomTube with new parameters
        selected.updateTube(
            currentPoints,
            curveType,
            tubularSegments,
            radius,
            radialSegments,
            closed,
            extrudeDepth,
        );

        // Trigger object update
        app.call?.("objectChanged", app.editor, selected);
    }, [curveType, tubularSegments, radius, radialSegments, closed, extrudeDepth, isInitialized, app?.editor?.selected]);

    return (
        <>
            <span className="common-text white-bold">Curve Editor</span>
            <Separator invisible />
            <Container>
                <HelpText>
                    • Drag control points to reshape curve<br />
                    {canAddPoints(curveType, currentPointCount) && "• Double-click on curve to add point<br />"}
                    • Select point and press Delete to remove<br />
                    {curveType === CurveType.QUADRATIC_BEZIER && `• Quadratic Bezier requires exactly 3 points (${currentPointCount}/3)`}
                    {curveType === CurveType.CUBIC_BEZIER && `• Cubic Bezier requires exactly 4 points (${currentPointCount}/4)`}
                </HelpText>

                <Button
                    onClick={() => {
                        const selected = app?.editor?.selected;
                        if (selected && !Array.isArray(selected) && selected instanceof CustomTube) {
                            // Add point at the end of the curve
                            const points = (selected.userData.curvePoints || []).map((p: any) =>
                                new THREE.Vector3(p.x, p.y, p.z),
                            );
                            if (points.length > 0) {
                                const lastPoint = points[points.length - 1];
                                const newPoint = lastPoint.clone().add(new THREE.Vector3(1, 0, 0));
                                app.editor?.curveEditorControls?.addControlPoint(selected.localToWorld(newPoint.clone()));
                            }
                        }
                    }}
                    disabled={!canAddPoints(curveType, currentPointCount)}
                >
                    + Add Control Point
                </Button>

                {selectedPointInfo &&
                    <>
                        <Separator invisible />
                        <HelpText style={{ borderLeft: "3px solid #ff5722" }}>
                            <strong>Point {selectedPointInfo.index + 1} Selected</strong><br />
                            {selectedPointInfo.prevDistance !== null &&
                                <>Distance to previous: {selectedPointInfo.prevDistance.toFixed(2)} units<br /></>
                            }
                            {selectedPointInfo.nextDistance !== null &&
                                <>Distance to next: {selectedPointInfo.nextDistance.toFixed(2)} units</>
                            }
                            {selectedPointInfo.prevDistance === null && selectedPointInfo.nextDistance === null &&
                                <>No adjacent points</>
                            }
                        </HelpText>
                    </>
                }

                <Separator />

                <InputGroup>
                    <Label>Curve Type</Label>
                    <Select
                        value={curveType}
                        onChange={(e) => setCurveType(e.target.value as CurveType)}
                    >
                        <option value={CurveType.CATMULL_ROM}>Catmull-Rom (Smooth)</option>
                        <option value={CurveType.LINE}>Straight Line</option>
                        <option value={CurveType.QUADRATIC_BEZIER}>Quadratic Bezier</option>
                        <option value={CurveType.CUBIC_BEZIER}>Cubic Bezier</option>
                    </Select>
                </InputGroup>

                <InputGroup>
                    <Label>Extrude Depth (0 = tube, &gt;0 = extruded shape)</Label>
                    <SliderRow>
                        <StyledRange
                            value={extrudeDepth}
                            setValue={setExtrudeDepth}
                            min={0}
                            max={10}
                            step={0.1}
                        />
                        <SliderValue>{extrudeDepth.toFixed(1)}</SliderValue>
                    </SliderRow>
                </InputGroup>

                <TwoColumnInputs>
                    <InputGroup>
                        <Label>Tubular Segments</Label>
                        <Input
                            type="number"
                            min="3"
                            max="200"
                            value={tubularSegments}
                            onChange={(e) => setTubularSegments(parseInt(e.target.value) || 64)}
                        />
                    </InputGroup>

                    <InputGroup>
                        <Label>Tube Radius</Label>
                        <Input
                            type="number"
                            min="0.01"
                            max="2"
                            step="0.01"
                            value={radius}
                            onChange={(e) => setRadius(parseFloat(e.target.value) || 0.2)}
                        />
                    </InputGroup>
                </TwoColumnInputs>

                <InputGroup>
                    <Label>Radial Segments (circle resolution)</Label>
                    <Input
                        type="number"
                        min="3"
                        max="32"
                        value={radialSegments}
                        onChange={(e) => setRadialSegments(parseInt(e.target.value) || 8)}
                    />
                </InputGroup>

                <CheckboxRow>
                    <Checkbox
                        type="checkbox"
                        checked={closed}
                        onChange={(e) => setClosed(e.target.checked)}
                    />
                    Closed Loop
                </CheckboxRow>
            </Container>
        </>
    );
};

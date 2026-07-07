import {useEffect, useMemo, useReducer, useRef, useState, type ReactNode} from "react";
import styled from "styled-components";
import * as THREE from "three";

import {ActionButton, Separator} from "./ActionBar.style";
import {
    ChevronUpIcon,
    CloseIcon,
    CubeIcon,
    MoveIcon as ArrowsExpandIcon,
    PencilIcon as PencilAltIcon,
    RefreshIcon,
    ScaleIcon,
    ViewGridIcon,
} from "./icons/ActionBarIcons";
import {
    ApplyCheckIcon,
    AxisIcon,
    BevelIcon,
    EdgeSelectIcon,
    ExtrudeIcon,
    FaceSelectIcon,
    FlatProfileIcon,
    InsetIcon,
    LassoSelectIcon,
    RoundProfileIcon,
    RulerIcon,
    VertexSelectIcon,
} from "./icons/CADIcons";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import {useEditorSelection} from "@stem/editor-oss/hooks/useEditorSelection";
import {isCADToolsEnabled} from "../../../cad/settings";
import {CADAxisConstraint, CADSelectionMode, CADSelectionShape, CADTool} from "../../../cad/types";
import {Tooltip} from "../common";
import {NumericInput} from "../common/NumericInput";
import {builderToolbarTokens, focusVisibleRing} from "../common/builderToolbar";
import {getLogger} from "@stem/editor-oss/utils/Logger";

const CadButton = styled(ActionButton)<{$active?: boolean; $iconOnly?: boolean}>`
    width: ${({$iconOnly}) => $iconOnly ? "32px" : "auto"};
    min-width: 32px;
    padding: ${({$iconOnly}) => $iconOnly ? "0" : "0 10px"};
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.03em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: ${({$active}) => ($active ? "var(--theme-font-main-selected-color)" : "white")};
    background: ${({$active}) => ($active ? "var(--theme-grey-bg-secondary-button)" : "transparent")};
`;

const CadIcon = styled.span`
    display: inline-flex;
    width: 16px;
    height: 16px;
    align-items: center;
    justify-content: center;
    color: inherit;
    svg {
        width: 16px;
        height: 16px;
        display: block;
    }
`;

const CadField = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
`;

const MeshCadStrip = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: min(900px, calc(100vw - 560px));
    overflow-x: auto;
    overflow-y: visible;
    scrollbar-width: thin;
    scrollbar-color: ${builderToolbarTokens.borderSubtle} transparent;
    overscroll-behavior-x: contain;

    &::-webkit-scrollbar {
        height: 6px;
    }

    &::-webkit-scrollbar-track {
        background: transparent;
    }

    &::-webkit-scrollbar-thumb {
        background: ${builderToolbarTokens.borderSubtle};
        border-radius: 999px;
    }

    @media (max-width: 1180px) {
        max-width: calc(100vw - 32px);
    }
`;

const CadMenuGroup = styled.div`
    position: relative;
    display: flex;
    align-items: center;
`;

const CadMenuTrigger = styled(CadButton)<{$open?: boolean}>`
    min-width: 40px;
    padding: 0 8px 0 10px;
    gap: 6px;
    background: ${({$active, $open}) =>
        $open || $active ? "var(--theme-grey-bg-secondary-button)" : "transparent"};
`;

const CadTriggerChevron = styled.span<{$open?: boolean}>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    opacity: 0.72;
    transform: ${({$open}) => ($open ? "rotate(180deg)" : "rotate(0deg)")};
    transition: transform 120ms ease;

    svg {
        width: 12px;
        height: 12px;
        display: block;
    }
`;

const CadMenuSheet = styled.div`
    position: absolute;
    left: 50%;
    bottom: calc(100% + 10px);
    transform: translateX(-50%);
    min-width: 220px;
    max-width: 300px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-radius: 14px;
    border: 1px solid ${builderToolbarTokens.borderMuted};
    background: var(--theme-container-minor-dark);
    box-shadow: 0 20px 50px ${builderToolbarTokens.shadowStrong};
    z-index: 12;
`;

const CadMenuItem = styled.button<{$active?: boolean}>`
    width: 100%;
    padding: 9px 10px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    border: 0;
    border-radius: 10px;
    text-align: left;
    color: white;
    background: ${({$active}) => ($active ? "var(--theme-grey-bg-secondary-button)" : "transparent")};
    cursor: pointer;

    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    ${focusVisibleRing}
`;

const CadMenuItemText = styled.span`
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
`;

const CadMenuItemLabel = styled.span`
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
`;

const CadMenuItemDescription = styled.span`
    font-size: 10px;
    line-height: 1.35;
    color: ${builderToolbarTokens.textMuted};
`;

const CadAxisPillRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
`;

const CadAxisPill = styled.button<{$active?: boolean}>`
    border: 0;
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 10px;
    font-weight: 700;
    color: white;
    background: ${({$active}) => ($active ? "var(--theme-container-main-blue)" : "var(--theme-grey-bg)")};
    cursor: pointer;
`;

const CadTooltipContent = styled.div`
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 260px;
`;

const CadTooltipTitle = styled.div`
    font-size: 12px;
    font-weight: 700;
    color: white;
`;

const CadTooltipBody = styled.div`
    font-size: 11px;
    line-height: 1.45;
    color: ${builderToolbarTokens.textSecondary};
`;

interface CadDropdownOption {
    id: string;
    label: string;
    description: string;
    icon?: ReactNode;
    active?: boolean;
    disabled?: boolean;
    group?: string;
    shortcut?: string;
    onSelect: () => void;
}

const CadMenuSeparator = styled.hr`
    border: 0;
    height: 1px;
    background: ${builderToolbarTokens.borderMuted};
    margin: 2px 0;
`;

const CadMenuItemShortcut = styled.span`
    font-size: 10px;
    font-weight: 600;
    color: ${builderToolbarTokens.textDisabled};
    margin-left: auto;
    white-space: nowrap;
    padding-left: 12px;
`;

const CAD_AXES: CADAxisConstraint[] = ["x", "y", "z"];

interface CADActionBarControlsProps {
    forceVisible?: boolean;
    allowAutoVisible?: boolean;
    onClose?: () => void;
}

type CadMenuId =
    | "selectionMode"
    | "transformTool"
    | "selectionShape"
    | "surfaceOperation"
    | "axis"
    | "selectionActions"
    | "annotate";

function logMeshCad(stage: string, details?: Record<string, unknown>, level: "info" | "warn" = "info") {
    const logger = getLogger();
    const payload = details ? [details] : [];
    logger?.[level]?.(`[MeshCAD] ${stage}`, ...payload);
}

export const CADActionBarControls = ({forceVisible = false, allowAutoVisible = true, onClose}: CADActionBarControlsProps) => {
    const app = global.app as EngineRuntime;
    const {selected, editor} = useEditorSelection("CADActionBarControls");
    const [, forceCadRefresh] = useReducer((count: number) => count + 1, 0);
    const [openCadMenu, setOpenCadMenu] = useState<null | CadMenuId>(null);
    const [cadAmount, setCadAmount] = useState(0.25);
    const [bevelSteps, setBevelSteps] = useState(1);
    const [bevelProfile, setBevelProfile] = useState<"flat" | "round">("flat");
    const [edgeLength, setEdgeLength] = useState(1);
    const cadMenusRef = useRef<HTMLDivElement>(null);

    const selectedMesh = !Array.isArray(selected) && selected instanceof THREE.Mesh ? selected : null;
    const cadToolsEnabled = !!editor && isCADToolsEnabled(editor.scene);
    const cadSupport = cadToolsEnabled && selectedMesh ? editor?.getCADSupport(selectedMesh) : null;
    const isEditingSelectedMesh = !!(
        editor?.cadMode &&
        selectedMesh &&
        editor.cadEditedObject &&
        editor.cadEditedObject.uuid === selectedMesh.uuid
    );
    const canUseCAD = cadToolsEnabled && !!(
        forceVisible ||
        isEditingSelectedMesh ||
        (allowAutoVisible && cadSupport?.supported)
    );
    const canEnterCADMode = !!selectedMesh && !!cadSupport?.supported;
    const activeCADOperation =
        editor?.cadTool === "extrude" || editor?.cadTool === "inset" || editor?.cadTool === "bevel" ? editor.cadTool : null;
    const isFaceOnlyToolActive = !!activeCADOperation;
    const selectedEdgeCount = editor?.cadController?.selectedEdgeIds?.size || 0;
    const selectedVertexCount = editor?.cadController?.selectedVertexIds?.size || 0;
    const selectedFaceCount = editor?.cadController?.selectedFaceIds?.size || 0;
    const cadAxisConstraint = editor?.cadAxisConstraint || CAD_AXES;
    const selectedEdgeLength =
        isEditingSelectedMesh && editor?.cadSelectionMode === "edge" ? editor.cadController?.getSelectedEdgeLength() ?? null : null;
    const canEditEdgeLength = isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && selectedEdgeCount > 0;
    const canApplyCADOperation = !!(
        isEditingSelectedMesh &&
        editor?.cadSelectionMode === "face" &&
        activeCADOperation &&
        (activeCADOperation === "extrude" ? selectedFaceCount > 0 : selectedFaceCount === 1)
    );
    const cadApplyDisabledReason =
        !isEditingSelectedMesh
            ? "Enter Mesh CAD edit mode first."
            : editor?.cadSelectionMode !== "face"
                ? "Switch to face selection to apply this operation."
                : !activeCADOperation
                    ? "Choose Extrude, Inset, or Bevel first."
                    : activeCADOperation === "extrude"
                        ? "Select at least one face to apply Extrude."
                        : `Select exactly one face to apply ${activeCADOperation.charAt(0).toUpperCase()}${activeCADOperation.slice(1)}.`;
    const cadApplyTooltipDescription = canApplyCADOperation
        ? "Apply the current surface operation."
        : cadApplyDisabledReason;
    const disabledSelectionModeReason = activeCADOperation
        ? activeCADOperation === "extrude"
            ? "Extrude is active and currently works on face selections only."
            : `${activeCADOperation.charAt(0).toUpperCase()}${activeCADOperation.slice(1)} is active and currently works on one selected face only.`
        : null;
    const canDeleteCAD = !!(
        isEditingSelectedMesh &&
        ((editor?.cadSelectionMode === "vertex" && selectedVertexCount > 0) ||
            (editor?.cadSelectionMode === "edge" && selectedEdgeCount > 0) ||
            (editor?.cadSelectionMode === "face" && selectedFaceCount > 0))
    );
    const canMergeCAD = isEditingSelectedMesh && editor?.cadSelectionMode === "vertex" && selectedVertexCount >= 2;
    const canKnifeCAD = isEditingSelectedMesh && editor?.cadSelectionMode === "vertex" && selectedVertexCount === 2;
    const canEdgeBevel = isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && selectedEdgeCount >= 1;
    const canDissolveCAD = isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && selectedEdgeCount > 0;
    const canLoopSelectCAD = isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && selectedEdgeCount > 0;
    const edgeSelectionDisabledReason =
        !isEditingSelectedMesh
            ? "Enter Mesh CAD edit mode first."
            : editor?.cadSelectionMode !== "edge"
                ? "Switch to edge selection first."
                : "Select at least one edge first.";
    const edgeLengthTooltipDescription = canEditEdgeLength
        ? "Apply the edge length."
        : edgeSelectionDisabledReason;
    const edgeBevelTooltipDescription = canEdgeBevel
        ? "Apply edge bevel to selection."
        : edgeSelectionDisabledReason;
    const canLoopCutCAD = isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && selectedEdgeCount === 1;
    const canBridgeCAD = isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && selectedEdgeCount === 2;
    const canFillCAD = isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && selectedEdgeCount >= 3;
    const canLinkedCAD = !!(
        isEditingSelectedMesh &&
        ((editor?.cadSelectionMode === "vertex" && selectedVertexCount > 0) ||
            (editor?.cadSelectionMode === "edge" && selectedEdgeCount > 0) ||
            (editor?.cadSelectionMode === "face" && selectedFaceCount > 0))
    );
    const canUseAxisConstraint = !!(
        isEditingSelectedMesh &&
        (editor?.cadTool === "move" || editor?.cadTool === "rotate" || editor?.cadTool === "scale")
    );

    const setCADMode = (enabled: boolean) => {
        if (!editor) {
            return;
        }

        if (enabled) {
            if (!canEnterCADMode) {
                logMeshCad("Edit mode blocked", {
                    selectedType: selected ? (Array.isArray(selected) ? "array" : selected.type) : "none",
                    reason: cadSupport?.reason ?? "Select one supported mesh.",
                }, "warn");
                return;
            }
            logMeshCad("Entering edit mode", {object: selectedMesh?.name || selectedMesh?.uuid});
            editor.enterCADMode(selectedMesh);
            return;
        }

        logMeshCad("Exiting edit mode");
        editor.exitCADMode();
    };

    const closeMeshCadPanel = () => {
        if (editor?.cadMode) {
            logMeshCad("Closing panel and exiting edit mode");
            editor.exitCADMode();
        } else {
            logMeshCad("Closing panel");
        }
        setOpenCadMenu(null);
        onClose?.();
    };

    const setCADSelectionMode = (mode: CADSelectionMode) => editor?.setCADSelectionMode(mode);
    const setCADSelectionShape = (shape: CADSelectionShape) => editor?.setCADSelectionShape(shape);
    const setCADTool = (tool: CADTool) => editor?.setCADTool(tool);

    const setAllAxes = () => editor?.setCADAxisConstraint([...CAD_AXES]);
    const toggleAxis = (axis: CADAxisConstraint) => {
        if (!editor) {
            return;
        }
        const next = cadAxisConstraint.includes(axis)
            ? cadAxisConstraint.filter(currentAxis => currentAxis !== axis)
            : [...cadAxisConstraint, axis];
        editor.setCADAxisConstraint(next);
    };

    const applyCADOperation = () => {
        if (!editor || !activeCADOperation) {
            return;
        }

        if (activeCADOperation === "extrude") {
            editor.applyCADExtrude(cadAmount);
            return;
        }

        if (activeCADOperation === "inset") {
            editor.applyCADInset(cadAmount);
            return;
        }

        editor.applyCADBevel(cadAmount);
    };

    const applyEdgeLength = () => {
        if (!editor || !canEditEdgeLength) {
            return;
        }

        editor.applyCADEdgeLength(edgeLength);
    };

    const applyCADEdgeBevel = () => {
        if (!editor || !canEdgeBevel) {
            return;
        }

        editor.applyCADEdgeBevel(cadAmount, bevelSteps, bevelProfile);
    };

    useEffect(() => {
        app.on("cadModeChanged.CADActionBarControls", forceCadRefresh);
        app.on("cadSelectionModeChanged.CADActionBarControls", forceCadRefresh);
        app.on("cadSelectionShapeChanged.CADActionBarControls", forceCadRefresh);
        app.on("cadAxisConstraintChanged.CADActionBarControls", forceCadRefresh);
        app.on("cadToolChanged.CADActionBarControls", forceCadRefresh);
        app.on("cadToolsSettingsChanged.CADActionBarControls", forceCadRefresh);
        app.on("objectChanged.CADActionBarControls", (_source: unknown, object: THREE.Object3D) => {
            if (editor?.cadEditedObject && object?.uuid === editor.cadEditedObject.uuid) {
                forceCadRefresh();
            }
        });

        return () => {
            app.on("cadModeChanged.CADActionBarControls", null);
            app.on("cadSelectionModeChanged.CADActionBarControls", null);
            app.on("cadSelectionShapeChanged.CADActionBarControls", null);
            app.on("cadAxisConstraintChanged.CADActionBarControls", null);
            app.on("cadToolChanged.CADActionBarControls", null);
            app.on("cadToolsSettingsChanged.CADActionBarControls", null);
            app.on("objectChanged.CADActionBarControls", null);
        };
    }, [app, editor]);

    useEffect(() => {
        if (selectedEdgeLength !== null) {
            setEdgeLength(Number(selectedEdgeLength.toFixed(4)));
        }
    }, [selectedEdgeLength]);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            if (!cadMenusRef.current?.contains(event.target as Node)) {
                setOpenCadMenu(null);
            }
        };

        window.addEventListener("mousedown", handlePointerDown);
        return () => window.removeEventListener("mousedown", handlePointerDown);
    }, []);

    useEffect(() => {
        setOpenCadMenu(null);
    }, [
        editor?.cadMode,
        editor?.cadSelectionMode,
        editor?.cadSelectionShape,
        editor?.cadTool,
        selectedMesh?.uuid,
        cadToolsEnabled,
    ]);

    const renderCadTooltip = (title: string, body: string, compare?: string) => (
        <CadTooltipContent>
            <CadTooltipTitle>{title}</CadTooltipTitle>
            <CadTooltipBody>{body}</CadTooltipBody>
            {compare && <CadTooltipBody>{compare}</CadTooltipBody>}
        </CadTooltipContent>
    );

    const cadTooltipProps = {
        height: "auto",
        stayOpenOnHover: true,
        offsetY: -10,
    } as const;

    const selectionModeTrigger = editor?.cadSelectionMode === "edge"
        ? {label: "Edge", icon: <EdgeSelectIcon />}
        : editor?.cadSelectionMode === "face"
            ? {label: "Face", icon: <FaceSelectIcon />}
            : {label: "Vertex", icon: <VertexSelectIcon />};
    const transformTrigger = editor?.cadTool === "rotate"
        ? {label: "Rotate", icon: <RefreshIcon />}
        : editor?.cadTool === "scale"
            ? {label: "Scale", icon: <ScaleIcon />}
            : {label: "Move", icon: <ArrowsExpandIcon />};
    const selectionShapeTrigger = editor?.cadSelectionShape === "lasso"
        ? {label: "Lasso", icon: <LassoSelectIcon />}
        : {label: "Box", icon: <ViewGridIcon />};
    const surfaceOperationTrigger = activeCADOperation === "inset"
        ? {label: "Inset", icon: <InsetIcon />}
        : activeCADOperation === "bevel"
            ? {label: "Bevel", icon: <BevelIcon />}
            : {label: "Extrude", icon: <ExtrudeIcon />};
    const axisLabel = cadAxisConstraint.length === 3
        ? "All"
        : cadAxisConstraint.length === 0
            ? "None"
            : cadAxisConstraint.map(axis => axis.toUpperCase()).join("");

    const selectionModeOptions: CadDropdownOption[] = [
        {
            id: "vertex",
            label: "Vertex",
            description: disabledSelectionModeReason || "Pick individual points for the most precise shape edits.",
            icon: <VertexSelectIcon />,
            active: editor?.cadSelectionMode === "vertex",
            disabled: !isEditingSelectedMesh || isFaceOnlyToolActive,
            onSelect: () => setCADSelectionMode("vertex"),
        },
        {
            id: "edge",
            label: "Edge",
            description: disabledSelectionModeReason || "Pick edge segments to control borders, lengths, and edge-only tools.",
            icon: <EdgeSelectIcon />,
            active: editor?.cadSelectionMode === "edge",
            disabled: !isEditingSelectedMesh || isFaceOnlyToolActive,
            onSelect: () => setCADSelectionMode("edge"),
        },
        {
            id: "face",
            label: "Face",
            description: activeCADOperation
                ? `${activeCADOperation.charAt(0).toUpperCase()}${activeCADOperation.slice(1)} uses face selection while it is active.`
                : "Pick full polygons for surface-wide edits like extrude, inset, and face bevel.",
            icon: <FaceSelectIcon />,
            active: editor?.cadSelectionMode === "face",
            disabled: !isEditingSelectedMesh,
            onSelect: () => setCADSelectionMode("face"),
        },
    ];

    const transformToolOptions: CadDropdownOption[] = [
        {
            id: "move",
            label: "Move",
            description: "Translate the current vertex, edge, or face selection without creating new geometry.",
            icon: <ArrowsExpandIcon />,
            active: editor?.cadTool === "move",
            disabled: !isEditingSelectedMesh,
            onSelect: () => setCADTool("move"),
        },
        {
            id: "rotate",
            label: "Rotate",
            description: "Rotate only the selected mesh components around the CAD selection center.",
            icon: <RefreshIcon />,
            active: editor?.cadTool === "rotate",
            disabled: !isEditingSelectedMesh,
            onSelect: () => setCADTool("rotate"),
        },
        {
            id: "scale",
            label: "Scale",
            description: "Scale only the selected mesh components around the CAD selection center.",
            icon: <ScaleIcon />,
            active: editor?.cadTool === "scale",
            disabled: !isEditingSelectedMesh,
            onSelect: () => setCADTool("scale"),
        },
    ];

    const selectionShapeOptions: CadDropdownOption[] = [
        {
            id: "box",
            label: "Box",
            description: "Drag a rectangular marquee to select components quickly.",
            icon: <ViewGridIcon />,
            active: editor?.cadSelectionShape === "box",
            disabled: !isEditingSelectedMesh,
            onSelect: () => setCADSelectionShape("box"),
        },
        {
            id: "lasso",
            label: "Lasso",
            description: "Draw a freeform region to capture irregular component groups.",
            icon: <LassoSelectIcon />,
            active: editor?.cadSelectionShape === "lasso",
            disabled: !isEditingSelectedMesh,
            onSelect: () => setCADSelectionShape("lasso"),
        },
    ];

    const surfaceOperationOptions: CadDropdownOption[] = [
        {
            id: "extrude",
            label: "Extrude",
            description: "Add new geometry by pulling the selected face region outward.",
            icon: <ExtrudeIcon />,
            active: editor?.cadTool === "extrude",
            disabled: !isEditingSelectedMesh,
            onSelect: () => setCADTool("extrude"),
        },
        {
            id: "inset",
            label: "Inset",
            description: "Create a smaller inner face and border on the selected face.",
            icon: <InsetIcon />,
            active: editor?.cadTool === "inset",
            disabled: !isEditingSelectedMesh,
            onSelect: () => setCADTool("inset"),
        },
        {
            id: "bevel",
            label: "Bevel",
            description: "Chamfer the selected face with a softened transition ring.",
            icon: <BevelIcon />,
            active: editor?.cadTool === "bevel",
            disabled: !isEditingSelectedMesh,
            onSelect: () => setCADTool("bevel"),
        },
    ];

    const canInvertNormals = isEditingSelectedMesh && editor?.cadSelectionMode === "face";
    const canSubdivide = isEditingSelectedMesh && editor?.cadSelectionMode === "face" && selectedFaceCount > 0;
    const canExtrudeEdge = isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && selectedEdgeCount > 0;
    const canMergeCoplanar = isEditingSelectedMesh && editor?.cadSelectionMode === "face" && selectedFaceCount >= 2;
    const canEdgeToEdgeCut = isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && selectedEdgeCount === 2;
    const canArcEdge = isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && selectedEdgeCount > 0;
    const canMergeEdges = isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && selectedEdgeCount >= 1;
    const canFillFromVertices = isEditingSelectedMesh && editor?.cadSelectionMode === "vertex" && selectedVertexCount >= 3;

    const selectionActionOptions = useMemo<CadDropdownOption[]>(() => {
        if (editor?.cadSelectionMode === "vertex") {
            return [
                {
                    id: "link",
                    label: "Linked",
                    description: "Expand the current vertex selection to the full connected component.",
                    group: "selection",
                    disabled: !canLinkedCAD,
                    onSelect: () => editor?.applyCADSelectLinked(),
                },
                {
                    id: "merge",
                    label: "Merge",
                    description: "Weld the selected vertices into one vertex at their average position.",
                    group: "edit",
                    shortcut: "M",
                    disabled: !canMergeCAD,
                    onSelect: () => editor?.applyCADMerge(),
                },
                {
                    id: "knife",
                    label: "Knife",
                    description: "Split a face between two selected vertices on the same face.",
                    group: "edit",
                    disabled: !canKnifeCAD,
                    onSelect: () => editor?.applyCADKnife(),
                },
                {
                    id: "fillVertices",
                    label: "Fill",
                    description: "Create a new face from the selected vertices ordered around their centroid.",
                    group: "edit",
                    disabled: !canFillFromVertices,
                    onSelect: () => editor?.applyCADFillFromVertices(),
                },
                {
                    id: "delete",
                    label: "Delete",
                    description: "Delete the selected vertices and attached topology from the editable mesh.",
                    group: "delete",
                    disabled: !canDeleteCAD,
                    onSelect: () => editor?.applyCADDelete(),
                },
            ];
        }

        if (editor?.cadSelectionMode === "edge") {
            return [
                {
                    id: "loop",
                    label: "Loop",
                    description: "Extend the current edge selection along the straightest connected loop.",
                    group: "selection",
                    disabled: !canLoopSelectCAD,
                    onSelect: () => editor?.applyCADSelectLoop(),
                },
                {
                    id: "ring",
                    label: "Ring",
                    description: "Extend the current edge selection across opposite edges on quad strips.",
                    group: "selection",
                    disabled: !canLoopSelectCAD,
                    onSelect: () => editor?.applyCADSelectRing(),
                },
                {
                    id: "link",
                    label: "Linked",
                    description: "Expand the current edge selection to the full connected edge component.",
                    group: "selection",
                    disabled: !canLinkedCAD,
                    onSelect: () => editor?.applyCADSelectLinked(),
                },
                {
                    id: "extrudeEdge",
                    label: "Edge Extrude",
                    description: "Create a new quad face by extruding the selected boundary edge along the face normal.",
                    group: "create",
                    disabled: !canExtrudeEdge,
                    onSelect: () => editor?.applyCADExtrudeEdge(cadAmount),
                },
                {
                    id: "bridge",
                    label: "Bridge",
                    description: "Create a face between two selected edges.",
                    group: "create",
                    disabled: !canBridgeCAD,
                    onSelect: () => editor?.applyCADBridge(),
                },
                {
                    id: "fill",
                    label: "Fill",
                    description: "Fill a closed boundary made from the selected edge loop.",
                    group: "create",
                    disabled: !canFillCAD,
                    onSelect: () => editor?.applyCADFill(),
                },
                {
                    id: "edgeToEdgeCut",
                    label: "Edge-to-Edge Cut",
                    description: "Split the shared face between two selected edges by inserting midpoints.",
                    group: "create",
                    shortcut: "K",
                    disabled: !canEdgeToEdgeCut,
                    onSelect: () => editor?.applyCADEdgeToEdgeCut(),
                },
                {
                    id: "arc",
                    label: "Arc Edge",
                    description: "Replace straight edges with a circular arc subdivided into segments.",
                    group: "modify",
                    shortcut: "A",
                    disabled: !canArcEdge,
                    onSelect: () => editor?.applyCADArcEdge(cadAmount, 8),
                },
                {
                    id: "mergeEdges",
                    label: "Merge Edges",
                    description: "Collapse selected edges by merging connected vertices to their average position.",
                    group: "modify",
                    disabled: !canMergeEdges,
                    onSelect: () => editor?.applyCADMergeEdges(),
                },
                {
                    id: "dissolve",
                    label: "Dissolve",
                    description: "Remove the selected edge and merge its adjacent faces when the edge is manifold.",
                    group: "modify",
                    disabled: !canDissolveCAD,
                    onSelect: () => editor?.applyCADDissolve(),
                },
                {
                    id: "cut",
                    label: "Cut",
                    description: "Insert a midpoint loop cut across a quad strip starting from the selected edge.",
                    group: "modify",
                    disabled: !canLoopCutCAD,
                    onSelect: () => editor?.applyCADLoopCut(),
                },
                {
                    id: "delete",
                    label: "Delete",
                    description: "Delete the selected edges and attached topology from the editable mesh.",
                    group: "delete",
                    disabled: !canDeleteCAD,
                    onSelect: () => editor?.applyCADDelete(),
                },
            ];
        }

        if (editor?.cadSelectionMode === "face") {
            return [
                {
                    id: "link",
                    label: "Linked",
                    description: "Expand the current face selection to all connected faces in the same mesh island.",
                    group: "selection",
                    disabled: !canLinkedCAD,
                    onSelect: () => editor?.applyCADSelectLinked(),
                },
                {
                    id: "subdivide",
                    label: "Subdivide",
                    description: "Split each selected face into a grid of smaller faces.",
                    group: "create",
                    shortcut: "D",
                    disabled: !canSubdivide,
                    onSelect: () => editor?.applyCADSubdivide(2),
                },
                {
                    id: "invertNormals",
                    label: "Invert Normals",
                    description: "Reverse the winding order of selected faces (or all faces if none selected).",
                    group: "modify",
                    shortcut: "N",
                    disabled: !canInvertNormals,
                    onSelect: () => editor?.applyCADInvertNormals(),
                },
                {
                    id: "mergeCoplanar",
                    label: "Merge Coplanar",
                    description: "Merge selected faces that share an edge and have the same normal.",
                    group: "modify",
                    shortcut: "M",
                    disabled: !canMergeCoplanar,
                    onSelect: () => editor?.applyCADMergeCoplanar(),
                },
                {
                    id: "delete",
                    label: "Delete",
                    description: "Delete the selected faces from the editable mesh.",
                    group: "delete",
                    disabled: !canDeleteCAD,
                    onSelect: () => editor?.applyCADDelete(),
                },
            ];
        }

        return [];
    }, [
        cadAmount,
        canArcEdge,
        canBridgeCAD,
        canDeleteCAD,
        canDissolveCAD,
        canEdgeToEdgeCut,
        canExtrudeEdge,
        canFillCAD,
        canFillFromVertices,
        canInvertNormals,
        canKnifeCAD,
        canLinkedCAD,
        canLoopCutCAD,
        canLoopSelectCAD,
        canMergeCAD,
        canMergeCoplanar,
        canMergeEdges,
        canSubdivide,
        editor,
    ]);

    const renderCadDropdown = (
        menuId: Exclude<CadMenuId, "axis">,
        triggerLabel: string,
        triggerIcon: ReactNode,
        options: CadDropdownOption[],
        disabled: boolean,
        tooltipDescription?: string,
    ) => (
        <CadMenuGroup>
            <Tooltip
                content={openCadMenu === menuId ? undefined : renderCadTooltip(triggerLabel, tooltipDescription || "")}
                {...cadTooltipProps}
            >
                <CadMenuTrigger
                    $active={options.some(option => option.active) || menuId === "selectionActions"}
                    $open={openCadMenu === menuId}
                    data-testid={`mesh-cad-menu-${menuId}`}
                    disabled={disabled}
                    onClick={() => setOpenCadMenu(current => current === menuId ? null : menuId)}
                >
                    <CadIcon>{triggerIcon}</CadIcon>
                    <CadTriggerChevron $open={openCadMenu === menuId}>
                        <ChevronUpIcon />
                    </CadTriggerChevron>
                </CadMenuTrigger>
            </Tooltip>
            {openCadMenu === menuId && !disabled && (
                <CadMenuSheet>
                    {options.map((option, index) => {
                        const prevGroup = index > 0 ? options[index - 1]?.group : undefined;
                        const showSeparator = index > 0 && option.group && prevGroup && option.group !== prevGroup;
                        return (
                            <span key={option.id}>
                                {showSeparator && <CadMenuSeparator />}
                                <CadMenuItem
                                    $active={option.active}
                                    disabled={option.disabled}
                                    data-testid={`mesh-cad-option-${option.id}`}
                                    onClick={() => {
                                        if (option.disabled) {
                                            return;
                                        }
                                        option.onSelect();
                                        setOpenCadMenu(null);
                                    }}
                                >
                                    {option.icon && <CadIcon>{option.icon}</CadIcon>}
                                    <CadMenuItemText>
                                        <CadMenuItemLabel>{option.label}</CadMenuItemLabel>
                                        <CadMenuItemDescription>{option.description}</CadMenuItemDescription>
                                    </CadMenuItemText>
                                    {option.shortcut && <CadMenuItemShortcut>{option.shortcut}</CadMenuItemShortcut>}
                                </CadMenuItem>
                            </span>
                        );
                    })}
                </CadMenuSheet>
            )}
        </CadMenuGroup>
    );

    if (!canUseCAD) {
        return null;
    }

    const cadAmountLabel =
        activeCADOperation === "extrude" ? "Depth" : activeCADOperation === "inset" ? "Inset" : activeCADOperation === "bevel" ? "Width" : "";

    return (
        <>
            <MeshCadStrip
                ref={cadMenusRef}
                data-testid="mesh-cad-toolbar"
            >
                {(forceVisible || isEditingSelectedMesh) && onClose && (
                    <Tooltip
                        content={renderCadTooltip("Close Mesh CAD", "Hide the mesh CAD tools and return to normal object editing.")}
                        {...cadTooltipProps}
                    >
                        <CadButton
                            $iconOnly
                            aria-label="Close Mesh CAD"
                            data-testid="mesh-cad-close"
                            onClick={closeMeshCadPanel}
                        >
                            <CadIcon><CloseIcon /></CadIcon>
                        </CadButton>
                    </Tooltip>
                )}
                <Tooltip content={isEditingSelectedMesh
                    ? renderCadTooltip("Object Mode", "Leave component editing and go back to whole-object transforms and selection.")
                    : selectedMesh
                        ? renderCadTooltip("Edit Mode", cadSupport?.reason || "Edit the mesh directly by selecting vertices, edges, and faces instead of moving the whole object.")
                        : renderCadTooltip("Select Mesh", "Select one mesh object to enable Mesh CAD tools.")}
                    {...cadTooltipProps}
                >
                    <CadButton
                        $active={isEditingSelectedMesh}
                        $iconOnly
                        aria-label={isEditingSelectedMesh ? "Object mode" : "Edit mode"}
                        data-testid="mesh-cad-edit-mode"
                        disabled={!isEditingSelectedMesh && !canEnterCADMode}
                        onClick={() => setCADMode(!isEditingSelectedMesh)}
                    >
                        <CadIcon>
                            {isEditingSelectedMesh ? <CubeIcon /> : <PencilAltIcon />}
                        </CadIcon>
                    </CadButton>
                </Tooltip>
                {renderCadDropdown("selectionMode", selectionModeTrigger.label, selectionModeTrigger.icon, selectionModeOptions, !isEditingSelectedMesh, "Switch between vertex, edge, and face selection.")}
                {renderCadDropdown("transformTool", transformTrigger.label, transformTrigger.icon, transformToolOptions, !isEditingSelectedMesh, "Choose a transform tool for the selection.")}
                {renderCadDropdown("selectionShape", selectionShapeTrigger.label, selectionShapeTrigger.icon, selectionShapeOptions, !isEditingSelectedMesh, "Choose how to drag-select components.")}
                {renderCadDropdown("surfaceOperation", surfaceOperationTrigger.label, surfaceOperationTrigger.icon, surfaceOperationOptions, !isEditingSelectedMesh, "Pick a face operation: extrude, inset, or bevel.")}
                {selectionActionOptions.length > 0 &&
                    renderCadDropdown(
                        "selectionActions",
                        editor?.cadSelectionMode === "edge" ? "Edge Ops" : editor?.cadSelectionMode === "face" ? "Face Ops" : "Vertex Ops",
                        editor?.cadSelectionMode === "edge" ? <EdgeSelectIcon /> : editor?.cadSelectionMode === "face" ? <FaceSelectIcon /> : <VertexSelectIcon />,
                        selectionActionOptions,
                        !isEditingSelectedMesh,
                        "Available operations for the current selection.",
                    )}
                {renderCadDropdown(
                    "annotate",
                    "Annotate",
                    <RulerIcon />,
                    [
                        {
                            id: "ann-distance",
                            label: "Distance",
                            description: "Pick two points; label shows distance between them.",
                            disabled: false,
                            onSelect: () => { void editor?.startAnnotating("distance"); },
                        },
                        {
                            id: "ann-angle",
                            label: "Angle",
                            description: "Pick three points (apex is the middle pick); label shows the angle.",
                            disabled: false,
                            onSelect: () => { void editor?.startAnnotating("angle"); },
                        },
                        {
                            id: "ann-polyline",
                            label: "Polyline",
                            description: "Pick 2+ points, double-click to finish. Label shows total length.",
                            disabled: false,
                            onSelect: () => { void editor?.startAnnotating("polyline"); },
                        },
                        {
                            id: "ann-area",
                            label: "Area",
                            description: "Pick 3+ points, double-click to finish. Label shows enclosed area.",
                            disabled: false,
                            onSelect: () => { void editor?.startAnnotating("area"); },
                        },
                        {
                            id: "ann-pointNote",
                            label: "Point Note",
                            description: "Pick one point; attach a text note.",
                            disabled: false,
                            onSelect: () => { void editor?.startAnnotating("pointNote", {text: "Note"}); },
                        },
                    ],
                    false,
                    "Pick dimensions and notes that save with the scene. Press Esc to cancel.",
                )}
                {activeCADOperation && (
                    <CadField>
                        <Tooltip content={renderCadTooltip(cadAmountLabel, "Set the amount for the active surface operation.")} {...cadTooltipProps}>
                            <NumericInput
                                value={cadAmount}
                                setValue={setCadAmount}
                                width="72px"
                                height="28px"
                                decimalPlaces={4}
                                min={0}
                                dragStep={0.01}
                                disabled={!isEditingSelectedMesh}
                            />
                        </Tooltip>
                        <Tooltip content={renderCadTooltip("Apply", cadApplyTooltipDescription)} {...cadTooltipProps}>
                            <CadButton
                                $iconOnly
                                aria-label={canApplyCADOperation ? "Apply Mesh CAD operation" : `Apply Mesh CAD operation disabled: ${cadApplyDisabledReason}`}
                                data-testid="mesh-cad-apply-operation"
                                disabled={!canApplyCADOperation}
                                title={cadApplyTooltipDescription}
                                onClick={applyCADOperation}
                            >
                                <CadIcon><ApplyCheckIcon /></CadIcon>
                            </CadButton>
                        </Tooltip>
                    </CadField>
                )}
                {canUseAxisConstraint && (
                    <CadMenuGroup>
                        <Tooltip
                            content={openCadMenu === "axis" ? undefined : renderCadTooltip(`Axis: ${axisLabel}`, "Constrain transforms to selected axes.")}
                            {...cadTooltipProps}
                        >
                            <CadMenuTrigger
                                $active={cadAxisConstraint.length > 0}
                                $open={openCadMenu === "axis"}
                                data-testid="mesh-cad-axis-menu"
                                onClick={() => setOpenCadMenu(current => current === "axis" ? null : "axis")}
                            >
                                <CadIcon><AxisIcon /></CadIcon>
                                <CadTriggerChevron $open={openCadMenu === "axis"}>
                                    <ChevronUpIcon />
                                </CadTriggerChevron>
                            </CadMenuTrigger>
                        </Tooltip>
                        {openCadMenu === "axis" && (
                            <CadMenuSheet>
                                <CadMenuItem
                                    $active={cadAxisConstraint.length === 3}
                                    data-testid="mesh-cad-axis-all"
                                    onClick={() => setAllAxes()}
                                >
                                    <CadMenuItemText>
                                        <CadMenuItemLabel>All Axes</CadMenuItemLabel>
                                        <CadMenuItemDescription>Enable X, Y, and Z together.</CadMenuItemDescription>
                                    </CadMenuItemText>
                                </CadMenuItem>
                                <CadAxisPillRow>
                                    {CAD_AXES.map(axis => (
                                        <CadAxisPill
                                            key={axis}
                                            $active={cadAxisConstraint.includes(axis)}
                                            data-testid={`mesh-cad-axis-${axis}`}
                                            onClick={() => toggleAxis(axis)}
                                        >
                                            {axis.toUpperCase()}
                                        </CadAxisPill>
                                    ))}
                                </CadAxisPillRow>
                            </CadMenuSheet>
                        )}
                    </CadMenuGroup>
                )}
                {isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && (
                    <CadField>
                        <Tooltip content={renderCadTooltip("Edge Length", "Set the exact length of selected edges.")} {...cadTooltipProps}>
                            <NumericInput
                                value={edgeLength}
                                setValue={setEdgeLength}
                                width="72px"
                                height="28px"
                                decimalPlaces={4}
                                min={0.0001}
                                dragStep={0.01}
                                disabled={!canEditEdgeLength}
                            />
                        </Tooltip>
                        <Tooltip content={renderCadTooltip("Resize", edgeLengthTooltipDescription)} {...cadTooltipProps}>
                            <CadButton
                                $iconOnly
                                aria-label={canEditEdgeLength ? "Apply Mesh CAD edge length" : `Apply Mesh CAD edge length disabled: ${edgeSelectionDisabledReason}`}
                                data-testid="mesh-cad-apply-edge-length"
                                disabled={!canEditEdgeLength}
                                title={edgeLengthTooltipDescription}
                                onClick={applyEdgeLength}
                            >
                                <CadIcon><RulerIcon /></CadIcon>
                            </CadButton>
                        </Tooltip>
                    </CadField>
                )}
                {isEditingSelectedMesh && editor?.cadSelectionMode === "edge" && (
                    <CadField>
                        <Tooltip content={renderCadTooltip("Bevel Width", "Width of the edge bevel.")} {...cadTooltipProps}>
                            <NumericInput
                                value={cadAmount}
                                setValue={setCadAmount}
                                width="60px"
                                height="28px"
                                decimalPlaces={4}
                                min={0}
                                dragStep={0.01}
                                disabled={!isEditingSelectedMesh}
                            />
                        </Tooltip>
                        <Tooltip content={renderCadTooltip("Steps", "Number of bevel segments (1-8).")} {...cadTooltipProps}>
                            <NumericInput
                                value={bevelSteps}
                                setValue={(v: number) => setBevelSteps(Math.round(v))}
                                width="40px"
                                height="28px"
                                decimalPlaces={0}
                                min={1}
                                max={8}
                                dragStep={1}
                                disabled={!isEditingSelectedMesh}
                            />
                        </Tooltip>
                        <Tooltip
                            content={renderCadTooltip(
                                bevelProfile === "flat" ? "Profile: Flat" : "Profile: Round",
                                canEdgeBevel ? "Toggle between flat chamfer and round bevel." : edgeSelectionDisabledReason,
                            )}
                            {...cadTooltipProps}
                        >
                            <CadButton
                                $iconOnly
                                aria-label={canEdgeBevel ? "Toggle Mesh CAD edge bevel profile" : `Toggle Mesh CAD edge bevel profile disabled: ${edgeSelectionDisabledReason}`}
                                disabled={!canEdgeBevel}
                                title={canEdgeBevel ? "Toggle between flat chamfer and round bevel." : edgeSelectionDisabledReason}
                                onClick={() => setBevelProfile(bevelProfile === "flat" ? "round" : "flat")}
                                style={{minWidth: "28px", padding: "0 4px"}}
                            >
                                <CadIcon>{bevelProfile === "flat" ? <FlatProfileIcon /> : <RoundProfileIcon />}</CadIcon>
                            </CadButton>
                        </Tooltip>
                        <Tooltip content={renderCadTooltip("Apply Bevel", edgeBevelTooltipDescription)} {...cadTooltipProps}>
                            <CadButton
                                $iconOnly
                                aria-label={canEdgeBevel ? "Apply Mesh CAD edge bevel" : `Apply Mesh CAD edge bevel disabled: ${edgeSelectionDisabledReason}`}
                                data-testid="mesh-cad-apply-edge-bevel"
                                disabled={!canEdgeBevel}
                                title={edgeBevelTooltipDescription}
                                onClick={applyCADEdgeBevel}
                            >
                                <CadIcon><BevelIcon /></CadIcon>
                            </CadButton>
                        </Tooltip>
                    </CadField>
                )}
            </MeshCadStrip>
            <Separator />
        </>
    );
};

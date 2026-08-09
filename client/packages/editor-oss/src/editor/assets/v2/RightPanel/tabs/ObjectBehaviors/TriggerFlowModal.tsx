import React, { useMemo } from "react";
import { createPortal } from "react-dom";
import ReactFlow, { Background, Node, Edge, Position, ReactFlowProvider } from "reactflow";
import styled from "styled-components";

import global from "@stem/editor-oss/global";
import {findObjectByUuidDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import { NEW_EDITOR_LAYER_Z_INDEX } from "../../../AnimationCombiner/ModelAnimationCombiner.style";
import {useEscapeDismiss} from "../../../common/hooks/useEscapeDismiss";
import closeIcon from "../../../icons/close-panel.svg";

import "reactflow/dist/style.css";

interface TriggerFlowModalProps {
    behaviorAttributes: any;
    onClose: () => void;
}

const CONDITION_LABELS: Record<string, string> = {
    on_enter: "On Enter Trigger Volume",
    on_exit: "On Exit Trigger Volume",
    while_inside: "While Inside Trigger Volume",
    player_touches: "Player Touches",
    object_touches: "Object Touches",
    pressE: "Press E Key",
    pressF: "Press F Key",
    key_button_pressed: "Key/Button Pressed",
    timer_elapsed: "Timer Elapsed",
    distance_compare: "Distance Compare",
    has_tag_team_faction: "Has Tag/Team/Faction",
    variable_compare: "Variable Compare",
    behavior_state: "Behavior State",
    animation_event_reached: "Animation Event Reached",
    line_of_sight: "Line Of Sight",
    random_chance: "Random Chance %",
    cooldown_ready: "Cooldown Ready",
    on_interact: "On Interact",
    object_state_compare: "Object State Compare",
    time_window: "Time Window",
    multiplayer_role: "Multiplayer Role",
    physics_collision_event: "Physics Collision Event",
    ai_proximity: "AI Proximity",
};

const getObjectName = (uuid: string): string => {
    const scene = global.app?.editor?.scene;
    if (!scene || !uuid) return "Unknown";
    const obj = findObjectByUuidDepthFirst(scene, uuid);
    return obj?.name || "Unknown";
};

const buildFlowData = (attributes: any): { nodes: Node[]; edges: Edge[] } => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const conditions: any[] = attributes.if_condition || [];
    const thenSteps: any[] = attributes.then_steps || [];
    const ifOperator = attributes.if_operator === "or" ? "or" : "and";
    const ifTitle = ifOperator === "or"
        ? "IF (Any Condition Met)"
        : "IF (All Conditions Met)";

    // --- Condition nodes ---
    const conditionNodeId = "conditions";
    const conditionLines = conditions.map((c: any, i: number) => {
        let label = CONDITION_LABELS[c.conditionType] || c.conditionType;
        if (c.conditionType === "object_touches" && c.objectUUID) {
            label += `: ${getObjectName(c.objectUUID)}`;
        }
        if (c.conditionType === "pressE" && c.interactionText) {
            label += ` ("${c.interactionText}")`;
        }
        if (c.conditionType === "key_button_pressed") {
            label += `: ${String(c.inputKey || "e").toUpperCase()}`;
        }
        if (c.conditionType === "timer_elapsed") {
            label += `: ${c.timerSeconds ?? 0}s`;
        }
        if (c.conditionType === "distance_compare") {
            const op = c.distanceOperator === "gt" ? ">" : "<";
            label += `: ${getObjectName(c.distanceObjectUUID)} ${op} ${c.distanceValue ?? 0}`;
        }
        if (c.conditionType === "has_tag_team_faction") {
            label += `: ${c.metadataKey || "tag"} = ${c.metadataValue || ""}`;
        }
        if (c.conditionType === "variable_compare") {
            label += `: ${c.variablePath || "(path)"} ${c.variableOperator || "eq"} ${c.variableValue ?? ""}`;
        }
        if (c.conditionType === "behavior_state") {
            label += `: ${getObjectName(c.behaviorObjectUUID)} ${c.behaviorIdentifier || "(behavior)"} ${c.behaviorState || "enabled"}`;
        }
        if (c.conditionType === "animation_event_reached") {
            label += `: ${c.animationEventName || "(event)"}`;
        }
        if (c.conditionType === "line_of_sight") {
            label += `: ${getObjectName(c.lineOfSightObjectUUID)}`;
        }
        if (c.conditionType === "random_chance") {
            label += `: ${c.chancePercent ?? 0}%`;
        }
        if (c.conditionType === "cooldown_ready") {
            label += `: ${c.cooldownSeconds ?? 0}s`;
        }
        if (c.conditionType === "on_interact") {
            label += `: ${getObjectName(c.interactTargetUUID) || "Self"} (${String(c.interactInputKey || "e").toUpperCase()})`;
        }
        if (c.conditionType === "object_state_compare") {
            label += `: ${getObjectName(c.stateObjectUUID)} ${c.stateKey || "visible"} ${c.stateOperator || "eq"} ${c.stateValue ?? ""}`;
        }
        if (c.conditionType === "time_window") {
            label += `: ${c.timeStartHour ?? 0}h - ${c.timeEndHour ?? 24}h`;
        }
        if (c.conditionType === "multiplayer_role") {
            label += `: ${c.multiplayerRole || "host"}${c.multiplayerRole === "team" ? `=${c.multiplayerTeamValue || ""}` : ""}`;
        }
        if (c.conditionType === "physics_collision_event") {
            label += `: ${c.physicsEventType || "enter"} ${getObjectName(c.physicsObjectUUID)}`;
        }
        if (c.conditionType === "ai_proximity") {
            label += `: ${c.aiTargetScope || "player"} r=${c.aiRange ?? 0} fov=${c.aiFovDegrees ?? 360}`;
        }
        return `${i + 1}. ${label}`;
    });

    nodes.push({
        id: conditionNodeId,
        position: { x: 250, y: 0 },
        data: {
            label: 
                <NodeContent>
                    <NodeTitle $color="#4FC3F7">{ifTitle}</NodeTitle>
                    {conditionLines.length > 0 ? 
                        conditionLines.map((line: string, i: number) => 
                            <NodeLine key={i}>{line}</NodeLine>,
                        )
                     : 
                        <NodeLine>No conditions defined</NodeLine>
                    }
                </NodeContent>
            ,
        },
        type: "default",
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        style: nodeStyle("#1a237e", "#4FC3F7"),
    });

    // --- Then branch ---
    const thenBranchId = "then-branch";
    nodes.push({
        id: thenBranchId,
        position: { x: 250, y: 160 },
        data: {
            label: 
                <NodeContent>
                    <NodeTitle $color="#66BB6A">THEN</NodeTitle>
                </NodeContent>
            ,
        },
        type: "default",
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        style: nodeStyle("#1b5e20", "#66BB6A"),
    });

    edges.push({
        id: "cond-then",
        source: conditionNodeId,
        target: thenBranchId,
        label: "TRUE",
        labelStyle: { fill: "#66BB6A", fontWeight: 600, fontSize: 11 },
        labelBgStyle: { fill: "#1a1a1a", fillOpacity: 0.9 },
        labelBgPadding: [6, 3] as [number, number],
        style: { stroke: "#66BB6A", strokeWidth: 2 },
        animated: true,
    });

    thenSteps.forEach((step: any, i: number) => {
        const stepId = `then-step-${i}`;
        const actionLabel = step.thenType === "activate"
            ? "Activate"
            : step.thenType === "deactivate"
              ? "Deactivate"
              : step.thenType === "apply_lambda"
                ? "Apply Lambda"
              : step.thenType === "apply_behavior"
                ? "Apply Behavior"
              : step.thenType === "set_attribute"
                ? "Set Attribute"
                : step.thenType === "send_event"
                  ? "Send Event"
                  : step.thenType;
        const isBehaviorTarget = step.thenType === "apply_behavior";
        const targetSelection = isBehaviorTarget ? step.then_behavior : step.then_lambda;
        const objectName = targetSelection?.object
            ? getObjectName(targetSelection.object)
            : "Self";
        const selectionCount = targetSelection?.behaviors?.length || 0;
        const delayText = step.delay ? ` (delay: ${step.delay}s)` : "";
        const detailLine = step.thenType === "set_attribute"
            ? `${step.attributeKey || "(key)"} = ${step.attributeValue ?? ""}`
            : step.thenType === "send_event"
              ? `${step.eventName || "(event)"}`
              : null;

        nodes.push({
            id: stepId,
            position: { x: 250, y: 240 + i * 100 },
            data: {
                label: 
                    <NodeContent>
                        <NodeTitle $color="#66BB6A">Statement {i + 1}</NodeTitle>
                        <NodeLine>
                            {isBehaviorTarget ? "Behavior" : "Lambda"}: {actionLabel} {selectionCount} {isBehaviorTarget
                                ? `behavior${selectionCount !== 1 ? "s" : ""}`
                                : `lambda${selectionCount !== 1 ? "s" : ""}`}
                        </NodeLine>
                        {detailLine && <NodeLine>data: {detailLine}</NodeLine>}
                        <NodeLine>on: {objectName}{delayText}</NodeLine>
                    </NodeContent>
                ,
            },
            type: "default",
            sourcePosition: Position.Bottom,
            targetPosition: Position.Top,
            style: nodeStyle("#1b5e20", "#388E3C"),
        });

        edges.push({
            id: `then-to-step-${i}`,
            source: i === 0 ? thenBranchId : `then-step-${i - 1}`,
            target: stepId,
            style: { stroke: "#388E3C", strokeWidth: 1.5 },
        });
    });

    return { nodes, edges };
};

const nodeStyle = (bg: string, border: string) => ({
    background: bg,
    border: `1.5px solid ${border}`,
    borderRadius: 8,
    color: "#fff",
    padding: 0,
    fontSize: 12,
    minWidth: 180,
});

export const TriggerFlowModal: React.FC<TriggerFlowModalProps> = ({ behaviorAttributes, onClose }) => {
    const { nodes, edges } = useMemo(() => buildFlowData(behaviorAttributes), [behaviorAttributes]);
    useEscapeDismiss({onEscape: onClose});

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return createPortal(
        <ModalOverlay onClick={handleOverlayClick}>
            <ModalContent onClick={e => e.stopPropagation()}>
                <ModalHeader>
                    <ModalTitle>Trigger Flow Diagram</ModalTitle>
                    <CloseButton onClick={onClose}
                        className="reset-css"
                    >
                        <img src={closeIcon}
                            alt="close"
                        />
                    </CloseButton>
                </ModalHeader>
                <FlowWrapper>
                    <ReactFlowProvider>
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            fitView
                            nodesDraggable={false}
                            nodesConnectable={false}
                            elementsSelectable={false}
                            panOnDrag
                            zoomOnScroll
                            proOptions={{ hideAttribution: true }}
                        >
                            <Background color="#2a2a2a"
                                gap={20}
                            />
                        </ReactFlow>
                    </ReactFlowProvider>
                </FlowWrapper>
            </ModalContent>
        </ModalOverlay>,
        document.body,
    );
};

const ModalOverlay = styled.div`
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: ${NEW_EDITOR_LAYER_Z_INDEX + 1};
`;

const ModalContent = styled.div`
    background: var(--theme-dialog-bg, #1a1a1a);
    border: none;
    border-radius: var(--theme-dialog-border-radius, 12px);
    padding: 0;
    box-shadow: var(--theme-dialog-shadow, 0 8px 32px rgba(0, 0, 0, 0.5));
    width: 700px;
    height: 500px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
`;

const ModalHeader = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--theme-container-divider, #333);
`;

const ModalTitle = styled.h3`
    margin: 0;
    color: var(--theme-font-main-selected-color, #fff);
    font-size: 16px;
    font-weight: var(--theme-font-medium-plus, 600);
`;

const CloseButton = styled.button`
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s ease;

    &:hover {
        background: var(--theme-container-secondary-dark, #333);
    }

    img {
        width: 13px;
        height: auto;
    }
`;

const FlowWrapper = styled.div`
    flex: 1;
    width: 100%;
    background: var(--theme-dialog-bg, #1a1a1a);

    .react-flow__node {
        cursor: default !important;
    }
`;

const NodeContent = styled.div`
    padding: 8px 12px;
    text-align: left;
`;

const NodeTitle = styled.div<{ $color: string }>`
    font-weight: 700;
    font-size: 12px;
    color: ${({ $color }) => $color};
    margin-bottom: 4px;
`;

const NodeLine = styled.div`
    font-size: 11px;
    color: #ccc;
    line-height: 1.4;
`;

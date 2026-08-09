import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import * as THREE from "three";

import {
  getPlanCadSceneData,
  commitPlanCadSceneData,
  deletePlanCadNodeData,
  updatePlanCadNodeData,
} from "./planCadEditorBridge";
import type { PlanCadSceneData } from "./planCadEditorBridge";
import type {
  PlanItemNode,
  PlanNode,
  PlanSlabNode,
  PlanWallOpening,
  PlanWallNode,
} from "./planCadCore";
import global from "@stem/editor-oss/global";
import { UNIT_LABELS, UNITS } from "@stem/editor-oss/units/constants";
import { TextInput } from "../common/TextInput";
import { DangerButton } from "../RightPanel/common/DangerButton";
import { NumericInputRow } from "../RightPanel/common/NumericInputRow";
import { PanelChipButton } from "../RightPanel/common/PanelChipButton";
import { PanelTextLine } from "../RightPanel/common/PanelTextLine";
import { Separator } from "../RightPanel/common/Separator";
import { getUnitsSettings } from "../RightPanel/panels/ProjectSettings/constants";
import type { UnitsSettings } from "../RightPanel/panels/ProjectSettings/UnitsSection";

interface PlanCadPropertiesSectionProps {
  selectedObject?: THREE.Object3D | null;
}

function getSelectedPlanNodeId(selectedObject?: THREE.Object3D | null) {
  let current: THREE.Object3D | null | undefined = selectedObject;
  let selectedNodeId: string | null = null;
  let selectedNodeType: string | null = null;
  let activeNodeId: string | null = null;
  while (current) {
    const nodeId = current.userData?.planNodeId;
    if (!selectedNodeId && typeof nodeId === "string") {
      selectedNodeId = nodeId;
      selectedNodeType =
        typeof current.userData?.planNodeType === "string"
          ? current.userData.planNodeType
          : null;
    }
    const ownerNodeId = current.userData?.planCadOwnerNodeId;
    if (!selectedNodeId && typeof ownerNodeId === "string") {
      selectedNodeId = ownerNodeId;
      selectedNodeType =
        typeof current.userData?.planCadOwnerNodeType === "string"
          ? current.userData.planCadOwnerNodeType
          : null;
    }
    const rootSelectedNodeId = current.userData?.planCad?.selectedNodeId;
    if (!activeNodeId && typeof rootSelectedNodeId === "string") {
      activeNodeId = rootSelectedNodeId;
    }
    current = current.parent;
  }

  if (selectedNodeId) {
    const isContainerSelection =
      !selectedNodeType ||
      selectedNodeType === "site" ||
      selectedNodeType === "building" ||
      selectedNodeType === "level";
    return activeNodeId && isContainerSelection ? activeNodeId : selectedNodeId;
  }

  const descendantNodeId = getSingleDescendantPlanNodeId(selectedObject);
  if (descendantNodeId) return descendantNodeId;

  return activeNodeId;
}

function getSingleDescendantPlanNodeId(
  selectedObject?: THREE.Object3D | null,
) {
  if (!selectedObject) return null;
  let descendantNodeId: string | null = null;
  const stack = [...selectedObject.children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const nodeId = current.userData?.planNodeId;
    if (typeof nodeId === "string") {
      if (descendantNodeId && descendantNodeId !== nodeId) return null;
      descendantNodeId = nodeId;
    }
    for (let i = 0; i < current.children.length; i++) {
      stack.push(current.children[i]!);
    }
  }
  return descendantNodeId;
}

function getNode(
  data: PlanCadSceneData | null,
  nodeId: string | null,
): PlanNode | null {
  if (!data || !nodeId) return null;
  return data.nodes[nodeId] ?? null;
}

function countDescendantNodes(data: PlanCadSceneData, node: PlanNode): number {
  return node.children.reduce((count, childId) => {
    const child = data.nodes[childId];
    return child ? count + 1 + countDescendantNodes(data, child) : count;
  }, 0);
}

function getDeleteSummary(data: PlanCadSceneData, node: PlanNode) {
  const descendantCount = countDescendantNodes(data, node);
  const openingCount = node.type === "wall" ? node.openings.length : 0;
  const details: string[] = [];
  if (descendantCount > 0)
    details.push(
      `${descendantCount} child ${descendantCount === 1 ? "node" : "nodes"}`,
    );
  if (openingCount > 0)
    details.push(
      `${openingCount} ${openingCount === 1 ? "opening" : "openings"}`,
    );
  return `Delete ${node.type}${details.length ? ` and ${details.join(", ")}` : ""}?`;
}

function formatNodeTitle(node: PlanNode) {
  return node.type[0]!.toUpperCase() + node.type.slice(1);
}

function formatNodeLabel(node: PlanNode) {
  return node.name?.trim() || formatNodeTitle(node);
}

function formatPlanItemSource(item: PlanItemNode) {
  if (item.source?.type === "model") {
    if (item.source.provider === "pascal") {
      const label = item.source.providerAssetId?.replace(/-/g, " ");
      return label ? `Pascal model: ${label}` : "Pascal model";
    }
    return "External model";
  }
  return item.source?.modelKind
    ? `Procedural model: ${item.source.modelKind.replace(/_/g, " ")}`
    : "Procedural model";
}

function formatNodeBreadcrumb(data: PlanCadSceneData, node: PlanNode) {
  const labels: string[] = [];
  const seen = new Set<string>();
  let current: PlanNode | undefined = node;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    labels.push(formatNodeLabel(current));
    current = current.parentId ? data.nodes[current.parentId] : undefined;
  }
  return labels.reverse().join(" > ");
}

export const PlanCadPropertiesSection = ({
  selectedObject,
}: PlanCadPropertiesSectionProps) => {
  const app = global.app;
  const editor = app?.editor;
  const nodeId = getSelectedPlanNodeId(selectedObject);
  const [data, setData] = useState<PlanCadSceneData | null>(() =>
    getPlanCadSceneData(editor?.scene),
  );
  const [unitsSettings, setUnitsSettings] = useState<UnitsSettings>(() =>
    getUnitsSettings(editor?.scene),
  );
  const [confirmDeleteNodeId, setConfirmDeleteNodeId] = useState<string | null>(
    null,
  );
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(
    null,
  );
  const pendingCommitRef = useRef<number | null>(null);
  const pendingDataRef = useRef<PlanCadSceneData | null>(null);
  const node = useMemo(() => getNode(data, nodeId), [data, nodeId]);

  const refresh = useCallback(() => {
    setData(getPlanCadSceneData(editor?.scene));
  }, [editor?.scene]);

  const flushPendingCommit = useCallback(() => {
    if (pendingCommitRef.current !== null) {
      window.clearTimeout(pendingCommitRef.current);
      pendingCommitRef.current = null;
    }
    const pending = pendingDataRef.current;
    if (!pending || !editor) return;
    pendingDataRef.current = null;
    void commitPlanCadSceneData(editor, pending);
  }, [editor]);

  useEffect(() => {
    refresh();
    app?.on("objectChanged.PlanCadPropertiesSection", refresh);
    app?.on("planCadChanged.PlanCadPropertiesSection", refresh);
    app?.on("objectSelected.PlanCadPropertiesSection", refresh);
    app?.on(
      "unitsSettingsChanged.PlanCadPropertiesSection",
      (_editor: unknown, settings?: UnitsSettings) => {
        setUnitsSettings(
          settings
            ? { ...getUnitsSettings(editor?.scene), ...settings }
            : getUnitsSettings(editor?.scene),
        );
      },
    );
    return () => {
      app?.on("objectChanged.PlanCadPropertiesSection", null);
      app?.on("planCadChanged.PlanCadPropertiesSection", null);
      app?.on("objectSelected.PlanCadPropertiesSection", null);
      app?.on("unitsSettingsChanged.PlanCadPropertiesSection", null);
    };
  }, [app, editor?.scene, nodeId, refresh]);

  useEffect(() => {
    setConfirmDeleteNodeId(null);
    setSelectedOpeningId(null);
    setUnitsSettings(getUnitsSettings(editor?.scene));
  }, [editor?.scene, nodeId]);

  useEffect(
    () => () => {
      flushPendingCommit();
    },
    [flushPendingCommit, nodeId],
  );

  if (!editor?.scene || !data || !node) return null;

  const commitData = (
    next: PlanCadSceneData,
    options: { defer?: boolean } = {},
  ) => {
    setData(next);
    pendingDataRef.current = next;
    if (pendingCommitRef.current !== null) {
      window.clearTimeout(pendingCommitRef.current);
      pendingCommitRef.current = null;
    }
    if (options.defer) {
      pendingCommitRef.current = window.setTimeout(() => {
        pendingCommitRef.current = null;
        flushPendingCommit();
      }, 220);
      return;
    }
    flushPendingCommit();
  };

  const commit = (
    updates: Partial<PlanNode>,
    options: { defer?: boolean } = {},
  ) => {
    const base = pendingDataRef.current ?? data;
    commitData(updatePlanCadNodeData(base, node.id, updates), options);
  };

  const deleteNode = () => {
    if (confirmDeleteNodeId !== node.id) {
      setConfirmDeleteNodeId(node.id);
      return;
    }
    commitData(deletePlanCadNodeData(data, node.id));
  };

  const setName = (value: string) =>
    commit({ name: value } as Partial<PlanNode>);

  const wall = node.type === "wall" ? (node as PlanWallNode) : null;
  const slab = node.type === "slab" ? (node as PlanSlabNode) : null;
  const item = node.type === "item" ? (node as PlanItemNode) : null;
  const canDeleteNode =
    node.type !== "site" && node.type !== "building" && node.type !== "level";
  const unitFactor = unitsSettings.enabled
    ? UNITS[unitsSettings.currentUnit]
    : 1;
  const unitLabel = unitsSettings.enabled
    ? UNIT_LABELS[unitsSettings.currentUnit]
    : "m";
  const displayLength = (valueInMeters: number) => valueInMeters / unitFactor;
  const metersFromDisplay = (value: number) => value * unitFactor;
  const displayStep = (meters: number) => meters / unitFactor;
  const isConfirmingDelete = confirmDeleteNodeId === node.id;
  const deleteSummary = getDeleteSummary(data, node);
  const breadcrumb = formatNodeBreadcrumb(data, node);
  const selectedOpening =
    wall?.openings.find((opening) => opening.id === selectedOpeningId) ??
    wall?.openings[0] ??
    null;
  const updateWallOpening = (
    openingId: string,
    updates: Partial<PlanWallOpening>,
  ) => {
    if (!wall) return;
    const base = pendingDataRef.current ?? data;
    const baseWall = base.nodes[node.id] as PlanWallNode | undefined;
    const openings = baseWall?.type === "wall" ? baseWall.openings : wall.openings;
    commit(
      {
        openings: openings.map((opening) =>
          opening.id === openingId ? { ...opening, ...updates } : opening,
        ),
      } as Partial<PlanWallNode>,
      { defer: true },
    );
  };

  return (
    <div data-testid="plan-cad-properties" style={{ paddingBottom: "12px" }}>
      <div className="Section">
        <div className="title">{formatNodeTitle(node)}</div>
        <div className="box extended column">
          <BreadcrumbLine data-testid="plan-cad-breadcrumb">
            {breadcrumb}
          </BreadcrumbLine>
          <TextInput
            value={node.name || ""}
            setValue={setName}
            placeholder={`${node.type} name`}
            height="32px"
          />
          <Separator margin="12px 0" />
          {wall && (
            <>
              <NumericInputRow
                label="Height"
                value={displayLength(wall.height)}
                setValue={(height) =>
                  commit(
                    {
                      height: metersFromDisplay(height),
                    } as Partial<PlanWallNode>,
                    { defer: true },
                  )
                }
                min={displayLength(0.1)}
                dragStep={displayStep(0.1)}
                decimalPlaces={3}
                unit={unitLabel}
              />
              <NumericInputRow
                label="Thickness"
                value={displayLength(wall.thickness)}
                setValue={(thickness) =>
                  commit(
                    {
                      thickness: metersFromDisplay(thickness),
                    } as Partial<PlanWallNode>,
                    { defer: true },
                  )
                }
                min={displayLength(0.01)}
                dragStep={displayStep(0.025)}
                decimalPlaces={3}
                unit={unitLabel}
              />
              <NumericInputRow
                label="Elevation"
                value={displayLength(wall.elevation)}
                setValue={(elevation) =>
                  commit(
                    {
                      elevation: metersFromDisplay(elevation),
                    } as Partial<PlanWallNode>,
                    { defer: true },
                  )
                }
                dragStep={displayStep(0.1)}
                decimalPlaces={3}
                unit={unitLabel}
              />
              {wall.openings.length > 0 ? (
                <OpeningEditor>
                  <PanelTextLine>{wall.openings.length} openings</PanelTextLine>
                  <OpeningList aria-label="Wall openings">
                    {wall.openings.map((opening, index) => {
                      const selected = selectedOpening?.id === opening.id;
                      return (
                        <PanelChipButton
                          key={opening.id}
                          type="button"
                          aria-pressed={selected}
                          $selected={selected}
                          onClick={() => setSelectedOpeningId(opening.id)}
                        >
                          {opening.kind} {index + 1}
                        </PanelChipButton>
                      );
                    })}
                  </OpeningList>
                  {selectedOpening && (
                    <>
                      <NumericInputRow
                        label="Opening width"
                        value={displayLength(selectedOpening.width)}
                        setValue={(width) =>
                          updateWallOpening(selectedOpening.id, {
                            width: metersFromDisplay(width),
                          })
                        }
                        min={displayLength(0.1)}
                        dragStep={displayStep(0.05)}
                        decimalPlaces={3}
                        unit={unitLabel}
                      />
                      <NumericInputRow
                        label="Opening height"
                        value={displayLength(selectedOpening.height)}
                        setValue={(height) =>
                          updateWallOpening(selectedOpening.id, {
                            height: metersFromDisplay(height),
                          })
                        }
                        min={displayLength(0.1)}
                        dragStep={displayStep(0.05)}
                        decimalPlaces={3}
                        unit={unitLabel}
                      />
                      <NumericInputRow
                        label="Sill height"
                        value={displayLength(selectedOpening.sillHeight)}
                        setValue={(sillHeight) =>
                          updateWallOpening(selectedOpening.id, {
                            sillHeight: metersFromDisplay(sillHeight),
                          })
                        }
                        min={displayLength(0)}
                        dragStep={displayStep(0.05)}
                        decimalPlaces={3}
                        unit={unitLabel}
                      />
                    </>
                  )}
                </OpeningEditor>
              ) : (
                <PanelTextLine>0 openings</PanelTextLine>
              )}
            </>
          )}
          {slab && (
            <>
              <NumericInputRow
                label="Thickness"
                value={displayLength(slab.thickness)}
                setValue={(thickness) =>
                  commit(
                    {
                      thickness: metersFromDisplay(thickness),
                    } as Partial<PlanSlabNode>,
                    { defer: true },
                  )
                }
                min={displayLength(0.01)}
                dragStep={displayStep(0.025)}
                decimalPlaces={3}
                unit={unitLabel}
              />
              <NumericInputRow
                label="Elevation"
                value={displayLength(slab.elevation)}
                setValue={(elevation) =>
                  commit(
                    {
                      elevation: metersFromDisplay(elevation),
                    } as Partial<PlanSlabNode>,
                    { defer: true },
                  )
                }
                dragStep={displayStep(0.1)}
                decimalPlaces={3}
                unit={unitLabel}
              />
              <PanelTextLine>
                {slab.points.length} polygon points
              </PanelTextLine>
            </>
          )}
          {item && (
            <>
              <PanelTextLine>
                {formatPlanItemSource(item)}
              </PanelTextLine>
              <NumericInputRow
                label="Width"
                value={displayLength(item.dimensions.x)}
                setValue={(x) =>
                  commit(
                    {
                      dimensions: {
                        ...item.dimensions,
                        x: metersFromDisplay(x),
                      },
                    } as Partial<PlanItemNode>,
                    { defer: true },
                  )
                }
                min={displayLength(0.01)}
                dragStep={displayStep(0.05)}
                decimalPlaces={3}
                unit={unitLabel}
              />
              <NumericInputRow
                label="Height"
                value={displayLength(item.dimensions.y)}
                setValue={(y) =>
                  commit(
                    {
                      dimensions: {
                        ...item.dimensions,
                        y: metersFromDisplay(y),
                      },
                    } as Partial<PlanItemNode>,
                    { defer: true },
                  )
                }
                min={displayLength(0.01)}
                dragStep={displayStep(0.05)}
                decimalPlaces={3}
                unit={unitLabel}
              />
              <NumericInputRow
                label="Depth"
                value={displayLength(item.dimensions.z)}
                setValue={(z) =>
                  commit(
                    {
                      dimensions: {
                        ...item.dimensions,
                        z: metersFromDisplay(z),
                      },
                    } as Partial<PlanItemNode>,
                    { defer: true },
                  )
                }
                min={displayLength(0.01)}
                dragStep={displayStep(0.05)}
                decimalPlaces={3}
                unit={unitLabel}
              />
            </>
          )}
          {!wall && !slab && !item && (
            <PanelTextLine>{node.type}</PanelTextLine>
          )}
          {canDeleteNode && (
            <>
              <Separator margin="12px 0" />
              <DangerButton
                type="button"
                data-testid="plan-cad-delete-node"
                aria-pressed={isConfirmingDelete}
                onClick={deleteNode}
                $confirm={isConfirmingDelete}
              >
                {isConfirmingDelete ? deleteSummary : "Delete"}
              </DangerButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const BreadcrumbLine = ({
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    {...props}
    style={{
      fontSize: "var(--theme-font-size-extra-small)",
      color: "var(--theme-font-unselected-color)",
      padding: "0 0 8px",
      lineHeight: 1.4,
    }}
  >
    {children}
  </div>
);

const OpeningEditor = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
    {children}
  </div>
);

const OpeningList = ({
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    {...props}
    style={{
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
    }}
  >
    {children}
  </div>
);

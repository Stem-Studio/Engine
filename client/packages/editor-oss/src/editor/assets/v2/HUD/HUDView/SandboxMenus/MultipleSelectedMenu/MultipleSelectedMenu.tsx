import { useState } from "react";
import * as THREE from "three";

import {CSGCommand, CSGOperation, RemoveObjectCommand} from "@stem/editor-oss/command/Commands";
import global from "@stem/editor-oss/global";
import { CSGOrderDialog } from "../../../../common/CSGOrderDialog";
import {deleteManagedPlanCadObject} from "../../../../PlanMode/planCadEditorBridge";
import {MENU_LABELS} from "../../../../ContextMenu/ContextMenu";
import {EditMenu} from "../../../../ContextMenu/EditMenu/EditMenu";
import copyIcon from "../../../../ContextMenu/icons/v2/copy.svg";
import trashIcon from "../../../../ContextMenu/icons/v2/trash.svg";
import {Wrapper} from "../style";

export interface MultipleSelectedMenuProps {
    selectedObjects: THREE.Object3D[];
}

// Check if all objects are valid meshes for CSG operations
const areAllValidMeshes = (objects: THREE.Object3D[]): boolean => {
    if (!objects || objects.length < 2) return false;

    return objects.every(obj => {
        if (!(obj instanceof THREE.Mesh)) return false;
        const geometry = obj.geometry;
        // Ensure geometry has position attribute (valid BufferGeometry)
        return geometry && geometry.attributes && geometry.attributes.position && geometry.attributes.position.count > 0;
    });
};

export const MultipleSelectedMenu = ({selectedObjects}: MultipleSelectedMenuProps) => {
    const app = global.app;
    const showCSGOptions = areAllValidMeshes(selectedObjects);
    const [csgDialogOperation, setCsgDialogOperation] = useState<CSGOperation | null>(null);

    console.log("MultipleSelectedMenu render - csgDialogOperation:", csgDialogOperation);
    console.log("MultipleSelectedMenu render - selectedObjects count:", selectedObjects.length);

    const handleCSGOperation = (operation: CSGOperation) => {
        // Show dialog for user to choose order
        console.log("handleCSGOperation called with:", operation);
        console.log("Before setState - csgDialogOperation:", csgDialogOperation);
        setCsgDialogOperation(operation);
        console.log("After setState - this should trigger re-render");
    };

    const handleCSGConfirm = async (orderedObjects: THREE.Object3D[]) => {
        if (!app?.editor || !csgDialogOperation) return;

        try {
            const command = new CSGCommand(orderedObjects, csgDialogOperation);
            await app.editor.execute(command);
        } catch (error) {
            console.error(`CSG ${csgDialogOperation} operation failed:`, error);
        } finally {
            setCsgDialogOperation(null);
        }
    };

    const handleCSGCancel = () => {
        setCsgDialogOperation(null);
    };

    const handleDelete = async () => {
        if (!app?.editor) return;

        for (const obj of selectedObjects) {
            if (await deleteManagedPlanCadObject(app.editor, obj)) continue;
            await app.editor.execute(new RemoveObjectCommand(obj));
        }
    };

    const MENU = [
        {
            label: MENU_LABELS.COPY,
            icon: copyIcon,
            onClick: () => app?.editor?.copy(),
        },
        ...showCSGOptions ? [
            {
                label: "Union",
                icon: copyIcon,
                onClick: () => handleCSGOperation(CSGOperation.UNION),
            },
            {
                label: "Intersection",
                icon: copyIcon,
                onClick: () => handleCSGOperation(CSGOperation.INTERSECTION),
            },
            {
                label: "Difference",
                icon: copyIcon,
                onClick: () => handleCSGOperation(CSGOperation.DIFFERENCE),
            },
        ] : [],
        {
            label: MENU_LABELS.DELETE,
            icon: trashIcon,
            onClick: handleDelete,
        },
    ];

    console.log("About to render - will render dialog?", !!csgDialogOperation);

    return (
        <>
            <Wrapper
                $right
                title="Right-click to access CSG and batch actions"
                onMouseDown={() => {
                    // Prevent camera control interference
                }}
            >
                <div style={{
                    padding: "8px",
                    background: "rgba(0, 0, 0, 0.7)",
                    borderRadius: "8px",
                    color: "white",
                    fontSize: "12px",
                    marginBottom: "8px",
                }}
                >
                    {selectedObjects.length} objects selected
                    {showCSGOptions && <div style={{fontSize: "10px", opacity: 0.7}}>CSG operations available</div>}
                </div>
                <EditMenu fixedPosition
                    items={MENU}
                />
            </Wrapper>

            {(() => {
                console.log("Evaluating dialog conditional - csgDialogOperation:", csgDialogOperation);
                if (csgDialogOperation) {
                    console.log("RENDERING CSGOrderDialog NOW");
                    return (
                        <CSGOrderDialog
                            objects={selectedObjects}
                            operation={csgDialogOperation}
                            onConfirm={handleCSGConfirm}
                            onCancel={handleCSGCancel}
                        />
                    );
                } else {
                    console.log("NOT rendering dialog - csgDialogOperation is null/undefined");
                    return null;
                }
            })()}
        </>
    );
};

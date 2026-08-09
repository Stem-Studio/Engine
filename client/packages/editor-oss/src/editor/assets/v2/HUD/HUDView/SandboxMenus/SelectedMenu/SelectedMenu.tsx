import {useEffect, useState} from "react";
import * as THREE from "three";

import {ObjectPreview} from "./ObjectPreview";
import {ObjectSettings} from "./ObjectSettings/ObjectSettings";
import {RemoveObjectCommand} from "@stem/editor-oss/command/Commands";
import global from "@stem/editor-oss/global";
import {deleteManagedPlanCadObject} from "../../../../PlanMode/planCadEditorBridge";
import {MENU_LABELS} from "../../../../ContextMenu/ContextMenu";
import {EditMenu} from "../../../../ContextMenu/EditMenu/EditMenu";
import copyIcon from "../../../../ContextMenu/icons/v2/copy.svg";
import gizmoIcon from "../../../../ContextMenu/icons/v2/gizmo.svg";
import settingsIcon from "../../../../ContextMenu/icons/v2/settings.svg";
import trashIcon from "../../../../ContextMenu/icons/v2/trash.svg";
import {Wrapper} from "../style";

export interface SelectedMenuProps {
    selectedObj: THREE.Object3D<THREE.Object3DEventMap>;
}

export const SelectedMenu = ({selectedObj}: SelectedMenuProps) => {
    const app = global.app;
    const [areSettingsOpen, setAreSettingsOpen] = useState(false);

    const MENU = [
        {
            label: MENU_LABELS.SETTINGS,
            icon: settingsIcon,
            onClick: () => setAreSettingsOpen(true),
        },
        {
            label: MENU_LABELS.GIZMO,
            icon: gizmoIcon,
            onClick: () => {},
            disabled: true,
        },
        {
            label: MENU_LABELS.COPY,
            icon: copyIcon,
            onClick: () => app?.editor?.copy(),
        },
        {
            label: MENU_LABELS.DELETE,
            icon: trashIcon,
            onClick: async () => {
                if (!app?.editor) return;
                if (await deleteManagedPlanCadObject(app.editor, selectedObj)) return;
                await app.editor.execute(new RemoveObjectCommand(selectedObj));
            },
        },
    ];

    useEffect(() => {
        app?.on("toggleUI", () => setAreSettingsOpen(false));

        return () => {
            app?.on("toggleUI", null);
        };
    }, [app]);

    return (
        <Wrapper
            $right
            onMouseDown={() => {
                // const event = new PointerEvent("pointerup", {bubbles: true});
                // (app!.game!.cameraControl as any).pointerUpHandler(event);
            }}
        >
            {areSettingsOpen ? 
                <ObjectSettings selectedObj={selectedObj}
                    closeSettings={() => setAreSettingsOpen(false)}
                />
             : 
                <>
                    <ObjectPreview selectedObj={selectedObj} />
                    <EditMenu fixedPosition
                        items={MENU}
                    />
                </>
            }
        </Wrapper>
    );
};

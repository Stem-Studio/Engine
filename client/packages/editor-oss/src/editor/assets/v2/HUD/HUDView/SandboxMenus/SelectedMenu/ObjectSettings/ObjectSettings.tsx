import {useEffect, useState} from "react";

import {Bottom, OptionButton, Section, Top} from "./ObjectSettings.style";
import global from "@stem/editor-oss/global";
import {PhysicsUtil} from "../../../../../../../../physics/PhysicsUtil";
import backIcon from "../../../../../ContextMenu/icons/v2/back.svg";
import {CollisionType, PhysicsConfig} from "../../../../../types/physics";
import {SelectedMenuProps} from "../SelectedMenu";
import {ObjectName} from "../style";

interface Props extends SelectedMenuProps {
    closeSettings: () => void;
}

enum SHAPE_LABEL {
    NONE = "None",
    BOX = "Box",
    CONVEX = "Convex",
}

const SETTINGS = [
    {
        title: "Physics",
        key: "ctype",
        options: [
            {label: CollisionType.Dynamic, value: CollisionType.Dynamic},
            {label: CollisionType.Static, value: CollisionType.Static},
        ],
    },
    {
        title: "Collision",
        key: "shape",
        options: [
            {label: SHAPE_LABEL.NONE, value: SHAPE_LABEL.NONE},
            {label: SHAPE_LABEL.BOX, value: "btBoxShape"},
            {label: SHAPE_LABEL.CONVEX, value: "btConvexHullShape"},
        ],
    },
    {
        title: "Continuous collision",
        key: "ccd",
        options: [
            {label: "Off", value: false},
            {label: "On", value: true},
        ],
    },
];

export const ObjectSettings = ({selectedObj, closeSettings}: Props) => {
    const app = global.app;
    const [physicsEnabledState, setPhysicsEnabledState] = useState(selectedObj.userData?.physics?.enabled ?? true);
    const [shape, setShape] = useState(selectedObj.userData?.physics?.shape);
    const [physicsType, setPhysicsType] = useState(selectedObj.userData?.physics?.ctype);
    const [ccd, setCcd] = useState(selectedObj.userData?.physics?.ccd === true);

    const handlePhysicsChange = (value: number | string | boolean, name: keyof PhysicsConfig) => {
        const sceneSelectedObj = app?.editor?.objectByUuid(selectedObj.uuid);

        if (!sceneSelectedObj) return;

        if (value === SHAPE_LABEL.NONE) {
            selectedObj.userData.physics = {
                ...selectedObj.userData.physics,
                ctype: CollisionType.Dynamic,
                mass: 1,
            };
            setPhysicsEnabledState(false);
            setShape(SHAPE_LABEL.NONE);
            setPhysicsType(CollisionType.Dynamic);
            return;
        } else {
            setPhysicsEnabledState(true);
        }

        if (name === "ctype" && value !== CollisionType.Dynamic && selectedObj.userData.physics.mass > 0) {
            selectedObj.userData.physics = {
                ...selectedObj.userData.physics,
                [name]: value,
                mass: 0,
            };
            sceneSelectedObj.userData.physics = selectedObj.userData.physics;
            app?.call(`objectChanged`, sceneSelectedObj, sceneSelectedObj); // use sceneSelectedObj to update because it contains actual object state
            return;
        }
        if (selectedObj.userData.physics) {
            if (name === "ctype" && value === CollisionType.Dynamic) {
                selectedObj.userData.physics = {
                    ...selectedObj.userData.physics,
                    [name]: value,
                    mass: 1,
                };
            } else {
                selectedObj.userData.physics = {
                    ...selectedObj.userData.physics,
                    [name]: value,
                };
            }
        }

        if (name === "ctype") {
            setPhysicsType(value);
        }
        if (name === "ccd") {
            setCcd(value === true);
        }
        sceneSelectedObj.userData.physics = selectedObj.userData.physics;

        app?.call(`objectChanged`, sceneSelectedObj, sceneSelectedObj); // use sceneSelectedObj to update because it contains actual object state

        if (name === "shape" && PhysicsUtil.isPhysicsEnabled(selectedObj)) {
            PhysicsUtil.updateShapeOffsetAndScale(selectedObj);
            setShape(value);
        }
    };

    useEffect(() => {
        if (physicsEnabledState !== undefined) {
            const sceneSelectedObj = app?.editor?.objectByUuid(selectedObj.uuid);

            if (!sceneSelectedObj) return;
            if (selectedObj.userData) {
                if (!selectedObj?.userData.physics) {
                    selectedObj.userData.physics = {};
                }
                selectedObj.userData.physics.enabled = physicsEnabledState;
                sceneSelectedObj.userData.physics = selectedObj.userData.physics;
                app?.call(`objectChanged`, sceneSelectedObj, sceneSelectedObj); // use sceneSelectedObj to update because it contains actual object state
            }
        }
    }, [physicsEnabledState]);

    return (
        <>
            <Top>
                <button className="reset-css"
                    onClick={closeSettings}
                    title="Click to return to object actions"
                >
                    <img src={backIcon}
                        alt="back"
                    />
                </button>
                <ObjectName>{selectedObj.name}</ObjectName>
            </Top>
            <Bottom>
                {SETTINGS.map(({title, options, key}) => 
                    <Section key={title}>
                        <div className="title">{title}</div>
                        {options.map(option => 
                            <OptionButton
                                $selected={option.value === shape || option.value === physicsType || (key === "ccd" && option.value === ccd)}
                                className="reset-css"
                                key={option.label}
                                onClick={() => handlePhysicsChange(option.value, key as keyof PhysicsConfig)}
                            >
                                {option.label}
                            </OptionButton>,
                        )}
                    </Section>,
                )}
            </Bottom>
        </>
    );
};

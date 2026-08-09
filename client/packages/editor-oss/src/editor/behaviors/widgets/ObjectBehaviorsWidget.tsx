import React, {useState, useEffect} from "react";
import styled from "styled-components";

import {ObjectBehaviorsAttribute} from "../BehaviorAttributes";
import BaseAttributeWidget from "./BaseAttributeWidget";
import global from "@stem/editor-oss/global";
import {LambdaComponentData} from "../../../lambdas/Lambda";
import {MultiselectWithCheckboxes} from "../../assets/v2/RightPanel/common/MultiselectWithCheckboxes";
import {PanelCheckbox} from "../../assets/v2/RightPanel/common/PanelCheckbox";
import {SelectRow} from "../../assets/v2/RightPanel/common/SelectRow";
import {findObjectByUuidDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

const BehaviorsContainer = styled.div`
    margin: 8px 0;
`;

const NoBehaviorsMessage = styled.div`
    color: #888;
    font-size: 12px;
    margin: 8px 0;
`;

const BehaviorItem = styled.div`
    margin-bottom: 8px;
`;

interface ObjectBehaviorsWidgetComponentProps {
    label: string;
    attribute: ObjectBehaviorsAttribute;
    getCurrentValue: () => any;
    updateBehaviorField: (value: any) => void;
    currentBehaviorUUID?: string; // UUID of the behavior that owns this widget
}

const ObjectBehaviorsWidgetComponent: React.FC<ObjectBehaviorsWidgetComponentProps> = ({
    label,
    attribute,
    getCurrentValue,
    updateBehaviorField,
    currentBehaviorUUID,
}) => {
    const [value, setValue] = useState<{object: string; behaviors: string[]}>(
        getCurrentValue() || {object: "", behaviors: []},
    );
    const [availableBehaviors, setAvailableBehaviors] = useState<{name: string; uuid: string; description?: string}[]>(
        [],
    );
    const [shouldSelectAll, setShouldSelectAll] = useState(false);
    const isLambdaTarget = attribute.targetEntity === "lambda";

    const objectOptions = React.useMemo(() => {
        const dedupedByUuid = new Map<string, {key: string; value: string; id: string}>();

        for (const obj of attribute.object) {
            if (!dedupedByUuid.has(obj.uuid)) {
                dedupedByUuid.set(obj.uuid, {
                    key: obj.uuid || "none",
                    value: obj.name,
                    id: obj.uuid,
                });
            }
        }

        if (!dedupedByUuid.has("")) {
            dedupedByUuid.set("", {key: "none", value: "none", id: ""});
        }

        return Array.from(dedupedByUuid.values()).sort((a, b) => {
            if (a.id === "") return -1;
            if (b.id === "") return 1;
            return a.value.localeCompare(b.value);
        });
    }, [attribute.object]);

    const selectedObject = objectOptions.find(item => item.id === value.object) || objectOptions[0];

    useEffect(() => {
        const currentValue = getCurrentValue() || {object: "", behaviors: []};
        setValue(currentValue);
    }, [getCurrentValue]);

    useEffect(() => {
        if (!value.object || value.object === "") {
            setAvailableBehaviors([]);
            return;
        }

        const app = (global as any).app;
        const editor = app.editor;
        const object = findObjectByUuidDepthFirst(editor.scene, value.object);

        if (!object || !object.userData) {
            setAvailableBehaviors([]);
            return;
        }

        const behaviorsList: {name: string; uuid: string; description?: string}[] = [];

        const doesMatchFilter = (componentData: Record<string, any>): boolean => {
            const filterByAttributes = attribute.filterByAttributes;
            if (!filterByAttributes) {
                return true;
            }

            let isMatch = true;
            Object.entries(filterByAttributes).forEach(([key, value]) => {
                if (componentData[key] !== value) {
                    isMatch = false;
                }
            });

            return isMatch;
        };

        if (isLambdaTarget) {
            const lambdaComponents = Array.isArray(object.userData.lambdaComponents)
                ? (object.userData.lambdaComponents as LambdaComponentData[])
                : [];
            const seen = new Set<string>();

            for (const component of lambdaComponents) {
                if (!doesMatchFilter(component.componentData || {})) {
                    continue;
                }
                const token = `component:${component.uuid}`;
                if (seen.has(token)) continue;
                seen.add(token);

                const configName =
                    editor.lambdaConfigRegistry?.getConfig(component.lambdaId)?.name || component.lambdaId;
                const configDescription = editor.lambdaConfigRegistry?.getConfig(component.lambdaId)?.description || "";
                behaviorsList.push({
                    name: configName,
                    uuid: token,
                    description: configDescription,
                });
            }

            behaviorsList.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            const behaviors = Array.isArray(object.userData.behaviors) ? object.userData.behaviors : [];

            for (const behavior of behaviors) {
                let name = behavior.id;

                try {
                    const config = editor.behaviorConfigRegistry.getConfig(behavior.id);
                    if (config && config.name) {
                        name = config.name;
                    }
                } catch (e) {
                    console.warn(`Failed to get name for behavior ${behavior.id}`, e);
                    return;
                }

                if (!doesMatchFilter(behavior.attributesData || {})) {
                    continue;
                }

                behaviorsList.push({
                    name: name,
                    uuid: behavior.uuid,
                });
            }
        }

        setAvailableBehaviors(behaviorsList);

        // Check if we should select all behaviors by default
        // This happens when selectAllByDefault is true and we have a new object selection
        if (attribute.selectAllByDefault && behaviorsList.length > 0) {
            // Only auto-select if current behaviors list is empty or doesn't match
            if (value.behaviors.length === 0 || value.object !== object.uuid) {
                setShouldSelectAll(true);
            }
        }
    }, [value.object, currentBehaviorUUID, isLambdaTarget]);

    const handleObjectChange = (item: any) => {
        const allBehaviorUUIDs = attribute.selectAllByDefault ? availableBehaviors.map(b => b.uuid) : [];

        const newValue = {
            object: item.id,
            behaviors: allBehaviorUUIDs,
        };
        setValue(newValue);
        updateBehaviorField(newValue);
    };

    // Handle select all when available behaviors change
    useEffect(() => {
        if (shouldSelectAll && availableBehaviors.length > 0) {
            const allBehaviorUUIDs = availableBehaviors.map(b => b.uuid);
            const newValue = {
                object: value.object,
                behaviors: allBehaviorUUIDs,
            };
            setValue(newValue);
            updateBehaviorField(newValue);
            setShouldSelectAll(false);
        }
    }, [shouldSelectAll, availableBehaviors]);

    const handleBehaviorToggle = (behaviorUuid: string, isChecked: boolean) => {
        let newBehaviors = [...value.behaviors];
        const legacyId = behaviorUuid.startsWith("lambda:") ? behaviorUuid.slice("lambda:".length) : null;

        if (isChecked) {
            if (!newBehaviors.includes(behaviorUuid)) {
                newBehaviors.push(behaviorUuid);
            }
        } else {
            newBehaviors = newBehaviors.filter(id => id !== behaviorUuid && id !== legacyId);
        }

        const newValue = {
            object: value.object,
            behaviors: newBehaviors,
        };

        setValue(newValue);
        updateBehaviorField(newValue);
    };

    const isLambdaItemSelected = (id: string): boolean => {
        if (value.behaviors.includes(id)) {
            return true;
        }

        if (id.startsWith("lambda:")) {
            const legacyId = id.slice("lambda:".length);
            return value.behaviors.includes(legacyId);
        }

        return false;
    };

    const lambdaDropdownData = availableBehaviors.map(item => ({
        value: item.uuid,
        label: item.name,
        description: item.description,
    }));

    const selectedLambdaItems = lambdaDropdownData.filter(item => isLambdaItemSelected(item.value));

    return (
        <div>
            <SelectRow
                label={label}
                value={selectedObject}
                data={objectOptions}
                onChange={handleObjectChange}
                $margin="0"
            />

            {value.object && value.object !== "" && (
                <>
                    {isLambdaTarget ? (
                        <>
                            {availableBehaviors.length > 0 ? (
                                <MultiselectWithCheckboxes
                                    data={lambdaDropdownData}
                                    selectedItems={selectedLambdaItems}
                                    onChange={item =>
                                        handleBehaviorToggle(item.value, !isLambdaItemSelected(item.value))
                                    }
                                    placeholder="Select lambdas"
                                    searchable
                                />
                            ) : (
                                <NoBehaviorsMessage>No lambdas</NoBehaviorsMessage>
                            )}
                        </>
                    ) : (
                        <BehaviorsContainer>
                            {availableBehaviors.length > 0 ? (
                                availableBehaviors.map(behavior => (
                                    <BehaviorItem key={behavior.uuid}>
                                        <PanelCheckbox
                                            text={behavior.name}
                                            checked={value.behaviors.includes(behavior.uuid)}
                                            onChange={e => handleBehaviorToggle(behavior.uuid, e.target.checked)}
                                            isLocked={false}
                                            v2
                                            isGray
                                            regular
                                        />
                                    </BehaviorItem>
                                ))
                            ) : (
                                <NoBehaviorsMessage>No behaviors</NoBehaviorsMessage>
                            )}
                        </BehaviorsContainer>
                    )}
                </>
            )}
        </div>
    );
};

class ObjectBehaviorsWidget extends BaseAttributeWidget {
    protected getContainerPrefix(): string {
        return "widget-object-behaviors";
    }

    protected createComponent(
        id: string,
        name: string,
        attribute: ObjectBehaviorsAttribute,
        getCurrentValue: () => any,
        updateBehaviorField: (value: any) => void,
    ): React.ReactElement {
        return (
            <ObjectBehaviorsWidgetComponent
                label={name}
                attribute={attribute}
                getCurrentValue={getCurrentValue}
                updateBehaviorField={updateBehaviorField}
                currentBehaviorUUID={id}
            />
        );
    }
}

export default ObjectBehaviorsWidget;

import React, {useEffect, useState} from "react";

import {AttributesGrid, DeleteButton, DragIconButton} from "./AttributesSection.style";
import {GroupAttributeEditor} from "./GroupAttributeEditor";
import BehaviorAttributeType from "../../../../../../editor/behaviors/BehaviorAttributeType";
import {Item} from "../../../../../../v2/common/Select/Select";
import {BasicCombobox} from "../../../common/BasicCombobox/BasicCombobox";
import {NumericInput} from "../../../common/NumericInput";
import {PanelCheckbox} from "../../../RightPanel/common/PanelCheckbox";
import {SelectRow} from "../../../RightPanel/common/SelectRow";
import {Input, Label, Property} from "../BehaviorCreator.style";
import dragIcon from "../icons/drag.svg";
import trashIcon from "../icons/trash.svg";
import {IAttribute} from "../types";

type ResourceAttributeType = "resource";
type AttributeTypeOptionKey = BehaviorAttributeType | ResourceAttributeType;

const RESOURCE_ATTRIBUTE_TYPE: ResourceAttributeType = "resource";

const allTypeOptions: Item[] = [
    {key: BehaviorAttributeType.Boolean, value: "Boolean"},
    {key: BehaviorAttributeType.Number, value: "Number"},
    {key: BehaviorAttributeType.Slider, value: "Slider"},
    {key: BehaviorAttributeType.String, value: "String"},
    {key: BehaviorAttributeType.Vector2, value: "Vector 2"},
    {key: BehaviorAttributeType.Vector3, value: "Vector 3"},
    {key: BehaviorAttributeType.Enum, value: "Enum"},
    {key: BehaviorAttributeType.Object, value: "Object"},
    {key: BehaviorAttributeType.Children, value: "Children"},
    {key: BehaviorAttributeType.Group, value: "Group"},
    {key: BehaviorAttributeType.Prefab, value: "Stem"},
    {key: BehaviorAttributeType.ModelAsset, value: "Model"},
    {key: BehaviorAttributeType.ImageAsset, value: "Image"},
    {key: BehaviorAttributeType.AudioAsset, value: "Audio"},
    {key: BehaviorAttributeType.VideoAsset, value: "Video"},
];

const booleanOptions: Item[] = [
    {key: "true", value: "true"},
    {key: "false", value: "false"},
];

const resourcesAutoFillOptions: Item[] = [
    {key: "resources.sounds", value: "Sounds"},
    {key: "resources.models", value: "Models"},
    {key: "resources.videos", value: "Videos"},
    {key: "resources.images", value: "Images"},
    {key: "object.animations", value: "Animations"},
    {key: "resources.npcs", value: "NPCs"},
];

type VectorAxis = "x" | "y" | "z";
type NumberField = "default" | "min" | "max";

const MAX_NESTING_LEVEL = 2;

export const SingleAttribute = ({
    attributes,
    attribute,
    setAttributes,
    attributeIndex,
    dragHandleProps,
    style,
    nestingLevel = 0,
    hideNameField,
}: {
    attributes: IAttribute[];
    attribute: IAttribute;
    attributeIndex: number;
    setAttributes: (attributes: IAttribute[]) => void;
    dragHandleProps?: any;
    style?: React.CSSProperties;
    nestingLevel?: number;
    hideNameField?: boolean;
}) => {
    const [title, setTitle] = useState(attribute.key || "");
    const isVecAttr =
        attribute.type === BehaviorAttributeType.Vector2 || attribute.type === BehaviorAttributeType.Vector3;

    // Filter out Group type if max nesting level is reached
    const initialTypeOptions =
        nestingLevel >= MAX_NESTING_LEVEL
            ? allTypeOptions.filter(option => option.key !== BehaviorAttributeType.Group)
            : allTypeOptions;

    useEffect(() => {
        setTitle(attribute.key);
    }, [attribute]);

    const getDisplayType = (attribute: IAttribute): AttributeTypeOptionKey => {
        if (attribute.type === BehaviorAttributeType.Enum && attribute.autoFill) {
            return RESOURCE_ATTRIBUTE_TYPE;
        }
        return attribute.type as BehaviorAttributeType;
    };

    const deleteAttribute = () => {
        setAttributes(attributes.filter(attr => attr.key !== attribute.key));
    };

    const handleTypeChange = (item: Item) => {
        const newAttributes = [...attributes];

        // delete old attribute
        newAttributes.splice(attributeIndex, 1);

        const newAttribute: IAttribute = {
            ...attributes[attributeIndex]!,
            key: title,
            type: item.key,
            array: false,
            invisible: false,
            order: attributeIndex,
        };

        switch (item.key) {
            case BehaviorAttributeType.Boolean:
                newAttribute.default = true;
                break;
            case RESOURCE_ATTRIBUTE_TYPE:
                newAttribute.type = BehaviorAttributeType.Enum;
                newAttribute.default = "none";
                newAttribute.autoFill = "resources.sounds"; // значение по умолчанию
                newAttribute.options = undefined;
                break;
            case BehaviorAttributeType.Enum:
                newAttribute.default = "";
                newAttribute.autoFill = undefined;
                newAttribute.options = undefined;
                break;
            case BehaviorAttributeType.Number:
                newAttribute.default = 0;
                break;
            case BehaviorAttributeType.Slider:
                newAttribute.default = 0;
                newAttribute.min = 0;
                newAttribute.max = 100;
                newAttribute.step = 1;
                break;
            case BehaviorAttributeType.Vector2:
                newAttribute.default = {x: 0, y: 0};
                newAttribute.min = {x: 0, y: 0};
                newAttribute.max = {x: 100, y: 100};
                break;
            case BehaviorAttributeType.Vector3:
                newAttribute.default = {x: 0, y: 0, z: 0};
                newAttribute.min = {x: 0, y: 0, z: 0};
                newAttribute.max = {x: 100, y: 100, z: 100};
                break;
            case BehaviorAttributeType.Group:
                newAttribute.default = {};
                newAttribute.attributes = {};
                break;
            default:
                newAttribute.default = "";
        }

        // add new attribute
        newAttributes.splice(attributeIndex, 0, newAttribute);

        setAttributes(newAttributes);
    };

    const handleSelectChange = (item: Item) => {
        const newAttributes = [...attributes];
        newAttributes[attributeIndex] = {
            ...attributes[attributeIndex]!,
            key: title,
            default: item.value,
        };
        setAttributes(newAttributes);
    };

    const handleBooleanSelectChange = (item: Item) => {
        const newAttributes = [...attributes];
        newAttributes[attributeIndex] = {
            ...attributes[attributeIndex]!,
            key: title,
            default: item.value === "true",
        };

        setAttributes(newAttributes);
    };

    const handleNumberChange = (field: "default" | "min" | "max", value: number) => {
        const newAttributes = [...attributes];
        newAttributes[attributeIndex] = {
            ...attributes[attributeIndex]!,
            key: title,
            [field]: value,
        };
        setAttributes(newAttributes);
    };

    const handleVectorChange = (field: NumberField, axis: VectorAxis, value: number) => {
        const newAttributes = [...attributes];

        const attr = newAttributes[attributeIndex]!;

        const currentVector = attr[field] || {};

        newAttributes[attributeIndex] = {
            ...attr,
            key: title,
            [field]: {
                ...currentVector,
                [axis]: value,
            },
        };

        setAttributes(newAttributes);
    };

    const handleStringChange = (field: "default" | "name", value: string) => {
        const newAttributes = [...attributes];
        newAttributes[attributeIndex] = {
            ...attributes[attributeIndex]!,
            key: title,
            [field]: value,
        };
        setAttributes(newAttributes);
    };

    const handleCheckboxChange = (field: "array" | "userVisible", value: boolean) => {
        const newAttributes = [...attributes];
        newAttributes[attributeIndex] = {
            ...attributes[attributeIndex]!,
            key: title,
            [field]: value,
        };
        setAttributes(newAttributes);
    };

    const handleIsColumnMultilineChange = (value: boolean) => {
        const newAttributes = [...attributes];
        newAttributes[attributeIndex] = {
            ...attributes[attributeIndex]!,
            key: title,
            isColumnMultiline: value,
        };
        setAttributes(newAttributes);
    };

    const handleAutoFillChange = (item: Item) => {
        const newAttributes = [...attributes];
        const autoFillValue = item.key === "none" ? undefined : item.key;
        newAttributes[attributeIndex] = {
            ...attributes[attributeIndex]!,
            key: title,
            autoFill: autoFillValue,
            // if autoFill is set, we clear options
            options: autoFillValue ? undefined : attributes[attributeIndex]?.options,
        };
        setAttributes(newAttributes);
    };

    const handleOptionsChange = (optionsText: string) => {
        // Split by , or | and strip optional surrounding quotes (' or ")
        const options = optionsText
            .split(/[,|]/)
            .map(s => s.trim())
            .filter(Boolean)
            .map(s => s.replace(/^['"]|['"]$/g, ""))
            .filter(Boolean)
            .map(s => ({label: s, value: s}));
        const newAttributes = [...attributes];
        const currentAttr = attributes[attributeIndex];
        newAttributes[attributeIndex] = {
            ...currentAttr,
            key: title,
            options: options.length > 0 ? options : undefined,
            default:
                options.length > 0
                    ? options.some(o => o.value === currentAttr?.default)
                        ? currentAttr?.default
                        : options[0]?.value
                    : "",
        } as IAttribute;
        setAttributes(newAttributes);
    };

    const handleTitleChange = () => {
        // no spaces allowed
        const valueWithoutSpaces = title.replace(/\s+/g, "");
        setTitle(valueWithoutSpaces);

        const newAttributes = [...attributes];
        newAttributes[attributeIndex] = {
            ...attributes[attributeIndex]!,
            key: valueWithoutSpaces,
            ...(hideNameField ? {name: valueWithoutSpaces} : {}),
        };
        setAttributes(newAttributes);
    };
    console.log("attribute", attribute);
    return (
        <AttributesGrid style={{...style}}>
            <DragIconButton
                className="reset-css"
                {...dragHandleProps}
            >
                <img
                    src={dragIcon}
                    alt="drag and drop"
                />
            </DragIconButton>

            {!hideNameField && (
                <Property>
                    <Label style={{fontSize: "11px"}}>Name</Label>
                    <Input
                        value={attribute.name || ""}
                        setValue={value => handleStringChange("name", value)}
                        placeholder="Name"
                    />
                </Property>
            )}
            <Property>
                <Label style={{fontSize: "11px"}}>Key</Label>
                <Input
                    value={title}
                    setValue={setTitle}
                    placeholder="Key"
                    onBlur={handleTitleChange}
                />
            </Property>
            <Property>
                <Label style={{fontSize: "11px"}}>Type</Label>
                <SelectRow
                    label=""
                    width="100%"
                    $margin="0"
                    data={initialTypeOptions}
                    value={initialTypeOptions.find(el => el.key === getDisplayType(attribute))}
                    onChange={handleTypeChange}
                    disableTyping
                />
            </Property>
            {getDisplayType(attribute) === RESOURCE_ATTRIBUTE_TYPE && (
                <Property>
                    <Label style={{fontSize: "11px"}}>Resource Type</Label>
                    <SelectRow
                        label=""
                        width="78px"
                        $margin="0"
                        data={resourcesAutoFillOptions}
                        value={resourcesAutoFillOptions.find(
                            el => el.key === (attribute.autoFill || "resources.sounds"),
                        )}
                        onChange={handleAutoFillChange}
                        disableTyping
                    />
                </Property>
            )}
            {attribute.type === BehaviorAttributeType.Enum && !attribute.autoFill && (
                <Property>
                    <Label style={{fontSize: "11px"}}>Options (comma-separated)</Label>
                    <Input
                        value={attribute.options?.map((o: {value: string}) => o.value).join(", ") || ""}
                        setValue={handleOptionsChange}
                        placeholder="opt1, opt2 | opt3 | 'has spaces'"
                    />
                </Property>
            )}
            {attribute.type === BehaviorAttributeType.Enum && attribute.options && (
                <Property>
                    <Label style={{fontSize: "11px"}}>Default</Label>
                    <BasicCombobox
                        disableTyping
                        data={attribute?.options.map((option: {label: string; value: string}) => ({
                            key: option.value,
                            value: option.label,
                        }))}
                        value={attribute?.options
                            .map((o: {label: string; value: string}) => ({key: o.value, value: o.label}))
                            .find((item: Item) => item.key === attribute.default)}
                        onChange={handleSelectChange}
                    />
                </Property>
            )}

            {attribute.type === BehaviorAttributeType.Boolean && (
                <Property>
                    <Label style={{fontSize: "11px"}}>Default</Label>
                    <BasicCombobox
                        data={booleanOptions}
                        value={booleanOptions.find(el => el.value === String(attribute.default))}
                        onChange={handleBooleanSelectChange}
                        disableTyping
                    />
                </Property>
            )}

            {(attribute.type === BehaviorAttributeType.Number || attribute.type === BehaviorAttributeType.Slider) && (
                <>
                    <Property>
                        <Label style={{fontSize: "11px"}}>Default</Label>
                        <NumericInput
                            value={attribute.default}
                            setValue={value => handleNumberChange("default", value)}
                            min={attribute?.min}
                            max={attribute?.max}
                            width="100%"
                        />
                    </Property>
                    <Property>
                        <Label style={{fontSize: "11px"}}>Min</Label>
                        <NumericInput
                            width="100%"
                            value={attribute?.min || 0}
                            setValue={value => handleNumberChange("min", value)}
                        />
                    </Property>
                    <Property>
                        <Label style={{fontSize: "11px"}}>Max</Label>
                        <NumericInput
                            width="100%"
                            value={attribute?.max}
                            setValue={value => handleNumberChange("max", value)}
                        />
                    </Property>
                </>
            )}

            {isVecAttr && (
                <>
                    <Property $isSwitch>
                        <Label style={{fontSize: "11px"}}>Is array?</Label>
                        <PanelCheckbox
                            text=""
                            checked={!!attribute.array}
                            onChange={e => handleCheckboxChange("array", !!e.target.checked)}
                            v2
                            isGray
                            regular
                        />
                    </Property>

                    <Property>
                        <Label style={{fontSize: "11px"}}>Default</Label>
                        <NumericInput
                            width="100%"
                            value={attribute.default?.x ?? 0}
                            setValue={v => handleVectorChange("default", "x", v)}
                            unit="x"
                            className="VecInput"
                        />
                        <NumericInput
                            width="100%"
                            value={attribute.default?.y ?? 0}
                            setValue={v => handleVectorChange("default", "y", v)}
                            unit="y"
                            className="VecInput"
                        />
                        {attribute.type === BehaviorAttributeType.Vector3 && (
                            <NumericInput
                                width="100%"
                                value={attribute.default?.z ?? 0}
                                setValue={v => handleVectorChange("default", "z", v)}
                                unit="z"
                                className="VecInput"
                            />
                        )}
                    </Property>

                    {/* MIN */}
                    <Property>
                        <Label style={{fontSize: "11px"}}>Min</Label>
                        <NumericInput
                            width="100%"
                            value={attribute.min?.x ?? 0}
                            setValue={v => handleVectorChange("min", "x", v)}
                            unit="x"
                            className="VecInput"
                        />

                        <NumericInput
                            width="100%"
                            value={attribute.min?.y ?? 0}
                            setValue={v => handleVectorChange("min", "y", v)}
                            unit="y"
                            className="VecInput"
                        />

                        {attribute.type === BehaviorAttributeType.Vector3 && (
                            <NumericInput
                                width="100%"
                                value={attribute.min?.z ?? 0}
                                setValue={v => handleVectorChange("min", "z", v)}
                                unit="z"
                                className="VecInput"
                            />
                        )}
                    </Property>

                    {/* MAX */}
                    <Property>
                        <Label style={{fontSize: "11px"}}>Max</Label>
                        <NumericInput
                            width="100%"
                            value={attribute.max?.x ?? 0}
                            setValue={v => handleVectorChange("max", "x", v)}
                            unit="x"
                            className="VecInput"
                        />

                        <NumericInput
                            width="100%"
                            value={attribute.max?.y ?? 0}
                            setValue={v => handleVectorChange("max", "y", v)}
                            unit="y"
                            className="VecInput"
                        />

                        {attribute.type === BehaviorAttributeType.Vector3 && (
                            <NumericInput
                                width="100%"
                                value={attribute.max?.z ?? 0}
                                setValue={v => handleVectorChange("max", "z", v)}
                                unit="z"
                                className="VecInput"
                            />
                        )}
                    </Property>
                </>
            )}

            {attribute.type === BehaviorAttributeType.String && (
                <Property>
                    <Label style={{fontSize: "11px"}}>Default</Label>
                    <Input
                        value={attribute.default}
                        setValue={value => handleStringChange("default", value)}
                        placeholder="Default"
                    />
                </Property>
            )}

            {attribute.type === BehaviorAttributeType.String && (
                <Property $isSwitch>
                    <Label style={{fontSize: "11px"}}>Multi-line?</Label>
                    <PanelCheckbox
                        text=""
                        checked={!!attribute.isColumnMultiline}
                        onChange={e => handleIsColumnMultilineChange(!!e.target.checked)}
                        v2
                        isGray
                        regular
                    />
                </Property>
            )}

            {attribute.type === BehaviorAttributeType.Group && (
                <GroupAttributeEditor
                    attribute={attribute}
                    attributeIndex={attributeIndex}
                    attributes={attributes}
                    setAttributes={setAttributes}
                    nestingLevel={nestingLevel}
                />
            )}

            {!isVecAttr && (
                <Property $isSwitch>
                    <Label style={{fontSize: "11px"}}>Is array?</Label>
                    <PanelCheckbox
                        text=""
                        checked={!!attribute.array}
                        onChange={e => handleCheckboxChange("array", !!e.target.checked)}
                        v2
                        isGray
                        regular
                    />
                </Property>
            )}
            <Property $isSwitch>
                <Label style={{fontSize: "11px"}}>User Visible</Label>
                <PanelCheckbox
                    text=""
                    checked={attribute.userVisible !== false}
                    onChange={e => handleCheckboxChange("userVisible", !!e.target.checked)}
                    v2
                    isGray
                    regular
                />
            </Property>
            <DeleteButton
                className="reset-css"
                onClick={deleteAttribute}
            >
                <img
                    src={trashIcon}
                    alt={`delete attribute ${title}`}
                />
            </DeleteButton>
        </AttributesGrid>
    );
};

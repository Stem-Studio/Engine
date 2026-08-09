import { useEffect, useState } from "react";
import styled from "styled-components";
import { FontLoader } from "three/addons/loaders/FontLoader.js";

import global from "@stem/editor-oss/global";
import {DEFAULT_FONT, DEFAULT_WEIGHT, FONT_MAP, resolveFontPath} from "../../../../../object/geometry/fontMap";
import Text3D from "../../../../../object/geometry/Text3D";
import { Separator } from "../common/Separator";

const SectionTitle = styled.div`
    font-size: 12px;
    font-weight: 600;
    color: var(--theme-font-main-selected-color);
    padding: 8px 0 4px 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
`;

const InputGroup = styled.div`
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
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
    font-family: inherit;
    outline: none;

    &:focus {
        border-color: var(--theme-primary-color);
    }

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
`;


const SliderRow = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
`;

const Slider = styled.input`
    flex: 1;
    height: 4px;
    background: var(--theme-grey-bg);
    border-radius: 2px;
    outline: none;
    -webkit-appearance: none;

    &::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        background: var(--theme-primary-color);
        border-radius: 50%;
        cursor: pointer;
    }

    &::-moz-range-thumb {
        width: 14px;
        height: 14px;
        background: var(--theme-primary-color);
        border-radius: 50%;
        cursor: pointer;
        border: none;
    }

    &:disabled {
        opacity: 0.5;
    }
`;

const SliderValue = styled.div`
    min-width: 42px;
    padding: 4px 8px;
    background: var(--theme-grey-bg);
    border: 1px solid var(--theme-container-divider);
    border-radius: 4px;
    color: var(--theme-font-main-selected-color);
    font-size: 11px;
    text-align: center;
`;

const AlignmentGroup = styled.div`
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
`;

const AlignmentButton = styled.button<{ $active?: boolean }>`
    flex: 1;
    padding: 6px;
    background: ${props => props.$active ? "var(--theme-primary-color)" : "var(--theme-grey-bg)"};
    border: 1px solid var(--theme-container-divider);
    border-radius: 4px;
    color: ${props => props.$active ? "white" : "var(--theme-font-main-selected-color)"};
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;

    &:hover {
        background: ${props => props.$active ? "var(--theme-primary-color)" : "var(--theme-container-divider)"};
    }

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
`;

interface Props {
    isLocked?: boolean;
}

// Cache fonts by font name and weight to avoid reloading
const fontCache = new Map<string, any>();

export const TextPropertiesSection = ({ isLocked }: Props) => {
    const app = global.app;

    const [isTextObject, setIsTextObject] = useState(false);
    const defaultConfig = {
        text: "Text",
        fontSize: 1,
        lineHeight: 1.2,
        spacing: 0,
        fontName: DEFAULT_FONT,
        weight: DEFAULT_WEIGHT,
        horizontalAlign: "center",
        verticalAlign: "middle",
        case: "normal",
        extrusion: 0.2,
        bevel: 0,
        bevelSides: 1,
    };

    const [config, setConfig] = useState<any>(defaultConfig);

    const syncFromSelection = () => {
        const current = app?.editor?.selected as any;
        if (!current || Array.isArray(current) || !(current instanceof Text3D)) {
            setIsTextObject(false);
            return;
        }

        setIsTextObject(true);
        const tc = current.userData?.textConfig;
        if (!tc) {
            setConfig({...defaultConfig});
            return;
        }

        // Reset to default if fontName is not in FONT_MAP
        const fontName = FONT_MAP[tc.fontName] ? tc.fontName : DEFAULT_FONT;
        const weight = tc.weight === "bold" ? "bold" : DEFAULT_WEIGHT;
        setConfig({...tc, fontName, weight});
    };

    useEffect(() => {
        syncFromSelection();

        app?.on("objectSelected.TextPropertiesSection", syncFromSelection);
        app?.on("objectChanged.TextPropertiesSection", syncFromSelection);

        return () => {
            app?.on("objectSelected.TextPropertiesSection", null);
            app?.on("objectChanged.TextPropertiesSection", null);
        };
    }, []);

    const updateTextObject = async (newConfig: any) => {
        const current = app?.editor?.selected as any;
        if (!current || !(current instanceof Text3D)) return;

        const fontName = newConfig.fontName || DEFAULT_FONT;
        const weight = newConfig.weight || DEFAULT_WEIGHT;
        const fontPath = resolveFontPath(fontName, weight);
        const cacheKey = `${fontName}_${weight}`;

        let font = fontCache.get(cacheKey);
        if (!font) {
            const fontLoader = new FontLoader();
            try {
                font = await new Promise((resolve, reject) => {
                    fontLoader.load(fontPath, resolve, undefined, reject);
                });
                fontCache.set(cacheKey, font);
            } catch (error) {
                console.error(`Failed to load font ${fontPath}:`, error);
                return;
            }
        }

        current.updateText(newConfig.text, font, newConfig);
        app?.call("objectChanged", current, current);
    };

    const handleChange = (key: string, value: any) => {
        const newConfig = { ...config, [key]: value };
        setConfig(newConfig);
        updateTextObject(newConfig);
    };

    if (!isTextObject) return null;

    return (
        <>
            <Separator invisible
                margin="8px 0"
            />
            <SectionTitle>Text Properties</SectionTitle>

            {/* Content */}
            <InputGroup>
                <Label htmlFor="text-content">Content</Label>
                <Input
                    id="text-content"
                    value={config.text}
                    onChange={(e) => handleChange("text", e.target.value)}
                    disabled={isLocked}
                />
            </InputGroup>

            {/* Font Size */}
            <InputGroup>
                <Label>Font Size</Label>
                <SliderRow>
                    <Slider
                        type="range"
                        min={0.1}
                        max={10}
                        step={0.1}
                        value={config.fontSize}
                        onChange={(e) => handleChange("fontSize", parseFloat(e.target.value))}
                        disabled={isLocked}
                    />
                    <SliderValue>{config.fontSize.toFixed(1)}</SliderValue>
                </SliderRow>
            </InputGroup>

            {/* Line Height */}
            <InputGroup>
                <Label>Line Height</Label>
                <SliderRow>
                    <Slider
                        type="range"
                        min={0.5}
                        max={3}
                        step={0.1}
                        value={config.lineHeight}
                        onChange={(e) => handleChange("lineHeight", parseFloat(e.target.value))}
                        disabled={isLocked}
                    />
                    <SliderValue>{config.lineHeight.toFixed(2)}</SliderValue>
                </SliderRow>
            </InputGroup>

            {/* Spacing */}
            <InputGroup>
                <Label>Spacing</Label>
                <SliderRow>
                    <Slider
                        type="range"
                        min={-10}
                        max={10}
                        step={0.5}
                        value={config.spacing}
                        onChange={(e) => handleChange("spacing", parseFloat(e.target.value))}
                        disabled={isLocked}
                    />
                    <SliderValue>{config.spacing}</SliderValue>
                </SliderRow>
            </InputGroup>

            {/* Font */}
            <InputGroup>
                <Label htmlFor="font-select">Font</Label>
                <Select
                    id="font-select"
                    value={config.fontName}
                    onChange={(e) => handleChange("fontName", e.target.value)}
                    disabled={isLocked}
                >
                    {Object.entries(FONT_MAP).map(([id, {displayName}]) => (
                        <option key={id} value={id}>{displayName}</option>
                    ))}
                </Select>
            </InputGroup>

            {/* Weight */}
            <InputGroup>
                <Label htmlFor="weight-select">Weight</Label>
                <Select
                    id="weight-select"
                    value={config.weight}
                    onChange={(e) => handleChange("weight", e.target.value)}
                    disabled={isLocked}
                >
                    <option value="regular">Regular</option>
                    <option value="bold">Bold</option>
                </Select>
            </InputGroup>

            {/* Horizontal Alignment */}
            <InputGroup>
                <Label>Horizontal Align</Label>
                <AlignmentGroup>
                    <AlignmentButton
                        type="button"
                        $active={config.horizontalAlign === "left"}
                        onClick={() => handleChange("horizontalAlign", "left")}
                        disabled={isLocked}
                    >
                        ≡
                    </AlignmentButton>
                    <AlignmentButton
                        type="button"
                        $active={config.horizontalAlign === "center"}
                        onClick={() => handleChange("horizontalAlign", "center")}
                        disabled={isLocked}
                    >
                        ≡
                    </AlignmentButton>
                    <AlignmentButton
                        type="button"
                        $active={config.horizontalAlign === "justify"}
                        onClick={() => handleChange("horizontalAlign", "justify")}
                        disabled={isLocked}
                    >
                        ≡
                    </AlignmentButton>
                    <AlignmentButton
                        type="button"
                        $active={config.horizontalAlign === "right"}
                        onClick={() => handleChange("horizontalAlign", "right")}
                        disabled={isLocked}
                    >
                        ≡
                    </AlignmentButton>
                </AlignmentGroup>
            </InputGroup>

            {/* Vertical Alignment */}
            <InputGroup>
                <Label>Vertical Align</Label>
                <AlignmentGroup>
                    <AlignmentButton
                        type="button"
                        $active={config.verticalAlign === "top"}
                        onClick={() => handleChange("verticalAlign", "top")}
                        disabled={isLocked}
                    >
                        ↑
                    </AlignmentButton>
                    <AlignmentButton
                        type="button"
                        $active={config.verticalAlign === "middle"}
                        onClick={() => handleChange("verticalAlign", "middle")}
                        disabled={isLocked}
                    >
                        ↕
                    </AlignmentButton>
                    <AlignmentButton
                        type="button"
                        $active={config.verticalAlign === "bottom"}
                        onClick={() => handleChange("verticalAlign", "bottom")}
                        disabled={isLocked}
                    >
                        ↓
                    </AlignmentButton>
                </AlignmentGroup>
            </InputGroup>

            {/* Case */}
            <InputGroup>
                <Label>Case</Label>
                <AlignmentGroup>
                    <AlignmentButton
                        type="button"
                        $active={config.case === "normal"}
                        onClick={() => handleChange("case", "normal")}
                        disabled={isLocked}
                    >
                        Aa
                    </AlignmentButton>
                    <AlignmentButton
                        type="button"
                        $active={config.case === "uppercase"}
                        onClick={() => handleChange("case", "uppercase")}
                        disabled={isLocked}
                    >
                        AA
                    </AlignmentButton>
                    <AlignmentButton
                        type="button"
                        $active={config.case === "lowercase"}
                        onClick={() => handleChange("case", "lowercase")}
                        disabled={isLocked}
                    >
                        aa
                    </AlignmentButton>
                </AlignmentGroup>
            </InputGroup>

            {/* Extrusion */}
            <InputGroup>
                <Label>Extrusion (3D Depth)</Label>
                <SliderRow>
                    <Slider
                        type="range"
                        min={0}
                        max={5}
                        step={0.1}
                        value={config.extrusion}
                        onChange={(e) => handleChange("extrusion", parseFloat(e.target.value))}
                        disabled={isLocked}
                    />
                    <SliderValue>{config.extrusion.toFixed(1)}</SliderValue>
                </SliderRow>
            </InputGroup>

            {/* Bevel */}
            <InputGroup>
                <Label>Bevel (Rounded Edges)</Label>
                <SliderRow>
                    <Slider
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={config.bevel}
                        onChange={(e) => handleChange("bevel", parseFloat(e.target.value))}
                        disabled={isLocked}
                    />
                    <SliderValue>{config.bevel.toFixed(2)}</SliderValue>
                </SliderRow>
            </InputGroup>

            {/* Bevel Sides */}
            <InputGroup>
                <Label>Bevel Segments</Label>
                <SliderRow>
                    <Slider
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={config.bevelSides}
                        onChange={(e) => handleChange("bevelSides", parseInt(e.target.value))}
                        disabled={isLocked}
                    />
                    <SliderValue>{config.bevelSides}</SliderValue>
                </SliderRow>
            </InputGroup>
        </>
    );
};

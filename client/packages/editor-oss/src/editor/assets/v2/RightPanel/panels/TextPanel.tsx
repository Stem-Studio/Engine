import {useState, useEffect} from "react";
import styled from "styled-components";
import { FontLoader } from "three/addons/loaders/FontLoader.js";

import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import {FONT_MAP} from "../../../../../object/geometry/fontMap";
import Text3D from "../../../../../object/geometry/Text3D";
import { StyledRange } from "../../common/StyledRange";
import { Separator } from "../common/Separator";

const Container = styled.div`
    display: flex;
    flex-direction: column;
    gap: 12px;
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


const TextArea = styled.textarea`
    width: 100%;
    min-height: 80px;
    padding: 8px 10px;
    background: var(--theme-grey-bg);
    border: 1px solid var(--theme-container-divider);
    border-radius: 4px;
    color: var(--theme-font-main-selected-color);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    resize: vertical;

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


// Font loader with cache for multiple fonts
const fontLoader = new FontLoader();
const fontCache = new Map<string, any>();

// Generate font list from FONT_MAP — each font gets regular + bold variants
const AVAILABLE_FONTS = Object.entries(FONT_MAP).flatMap(([id, {path, displayName}]) => [
    {name: displayName, file: `${path}_regular.typeface.json`, fontId: id, weight: "regular"},
    {name: `${displayName} Bold`, file: `${path}_bold.typeface.json`, fontId: id, weight: "bold"},
]);

const loadFont = async (fontFile: string) => {
    if (fontCache.has(fontFile)) {
        return fontCache.get(fontFile);
    }

    return new Promise((resolve, reject) => {
        fontLoader.load(
            `/assets/fonts/${fontFile}`,
            (font) => {
                fontCache.set(fontFile, font);
                resolve(font);
            },
            undefined,
            reject,
        );
    });
};

export const TextPanel = () => {
    const app = (global.app as EngineRuntime) || null;

    const [text, setText] = useState("Text");
    const [fontSize, setFontSize] = useState(1);
    const [extrusion, setExtrusion] = useState(0.2);
    const [bevel, setBevel] = useState(0.05);
    const [fontFile, setFontFile] = useState("helvetiker_regular.typeface.json");
    const [horizontalAlign, setHorizontalAlign] = useState("left");
    const [isInitialized, setIsInitialized] = useState(false);

    // Load text properties from selected object
    useEffect(() => {
        const selected = app?.editor?.selected;
        if (selected && !Array.isArray(selected) && selected instanceof Text3D) {
            const userData = selected.userData;
            setText(userData.text || "Text");
            setFontSize(userData.fontSize || 1);
            setExtrusion(userData.extrusion || 0.2);
            setBevel(userData.bevel || 0.05);
            setFontFile(userData.fontFile || "helvetiker_regular.typeface.json");
            setHorizontalAlign(userData.horizontalAlign || "left");
            setIsInitialized(true);
        }
    }, [app?.editor?.selected]);

    // Auto-update text when properties change (real-time)
    useEffect(() => {
        // Don't update until we've loaded initial values from the selected object
        if (!isInitialized) return;

        const selected = app?.editor?.selected;
        if (!selected || Array.isArray(selected) || !(selected instanceof Text3D)) return;

        const updateText = async () => {
            try {
                const loadedFont = await loadFont(fontFile);
                const fontEntry = AVAILABLE_FONTS.find(f => f.file === fontFile);

                // Update Text3D with new properties
                selected.updateText(text, loadedFont, {
                    fontSize,
                    extrusion,
                    bevel,
                    bevelSides: 3,
                    fontName: fontEntry?.fontId || "helvetiker",
                    weight: fontEntry?.weight || "regular",
                    horizontalAlign,
                    verticalAlign: "top",
                    case: "normal",
                    lineHeight: 1.2,
                    spacing: 0,
                });

                // Update userData
                selected.userData.text = text;
                selected.userData.fontSize = fontSize;
                selected.userData.extrusion = extrusion;
                selected.userData.bevel = bevel;
                selected.userData.fontFile = fontFile;
                selected.userData.fontName = fontEntry?.fontId || "helvetiker";
                selected.userData.horizontalAlign = horizontalAlign;

                // Trigger object update for collaborative sync
                console.log('[TextPanel] Calling objectChanged for:', selected.name, selected.uuid);
                console.log('[TextPanel] Updated userData:', { text, fontSize, extrusion, bevel });
                app?.call("objectChanged", selected, selected);
                console.log('[TextPanel] objectChanged called');
            } catch (error) {
                console.error("Failed to update text:", error);
            }
        };

        updateText();
    }, [text, fontSize, extrusion, bevel, fontFile, horizontalAlign, isInitialized, app?.editor?.selected]);

    return (
        <>
            <span className="common-text white-bold">Text Editor</span>
            <Separator invisible />
            <Container>
                <InputGroup>
                    <Label>Text Content</Label>
                    <TextArea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Enter text..."
                    />
                </InputGroup>

                <TwoColumnInputs>
                    <InputGroup>
                        <Label>Font</Label>
                        <Select value={fontFile}
                            onChange={(e) => setFontFile(e.target.value)}
                        >
                            {AVAILABLE_FONTS.map(font => 
                                <option key={font.file}
                                    value={font.file}
                                >
                                    {font.name}
                                </option>,
                            )}
                        </Select>
                    </InputGroup>

                    <InputGroup>
                        <Label>Alignment</Label>
                        <Select value={horizontalAlign}
                            onChange={(e) => setHorizontalAlign(e.target.value)}
                        >
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                        </Select>
                    </InputGroup>
                </TwoColumnInputs>

                <InputGroup>
                    <Label>Font Size</Label>
                    <SliderRow>
                        <StyledRange
                            value={fontSize}
                            setValue={setFontSize}
                            min={0.1}
                            max={5}
                            step={0.1}
                        />
                        <SliderValue>{fontSize.toFixed(1)}</SliderValue>
                    </SliderRow>
                </InputGroup>

                <InputGroup>
                    <Label>Extrusion (3D Depth)</Label>
                    <SliderRow>
                        <StyledRange
                            value={extrusion}
                            setValue={setExtrusion}
                            min={0}
                            max={2}
                            step={0.05}
                        />
                        <SliderValue>{extrusion.toFixed(2)}</SliderValue>
                    </SliderRow>
                </InputGroup>

                <InputGroup>
                    <Label>Bevel (Edge Rounding)</Label>
                    <SliderRow>
                        <StyledRange
                            value={bevel}
                            setValue={setBevel}
                            min={0}
                            max={0.5}
                            step={0.01}
                        />
                        <SliderValue>{bevel.toFixed(2)}</SliderValue>
                    </SliderRow>
                </InputGroup>
            </Container>
        </>
    );
};

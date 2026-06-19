import {useRef} from "react";

import {useAuthorizationContext} from "@stem/editor-oss/context";
import {MODEL_VERSION, TEXTURE_QUALITY} from "../../../../../controls/AiWorldController/AiWorldController.types";
import CheckBox from "../../../../../ui/form/v2/CheckBox";
import {GENERATOR_TYPES, getGeneratorCapability} from "@stem/editor-oss/utils/ModelGeneratorProvider";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {BasicCombobox} from "../../common/BasicCombobox/BasicCombobox";
import {CreditsBar} from "../../CreditsBar/CreditsBar";
import trashIcon from "../../icons/trash.svg";
import uploadIcon from "../../icons/upload-icon.svg";
import {
    AnotherPromptMessage,
    ImagePreview,
    ImageRemoveButton,
    ImageUploadCard,
    ImageUploadIcon,
    ImageUploadText,
    Prompt,
    SubmitButton,
} from "../ContextMenu.styles";

type Props = {
    isOpen: boolean;
    prompt: string;
    setPrompt: (prompt: string) => void;
    isRequesting: boolean;
    loading: boolean;
    modelVersion: MODEL_VERSION;
    setModelVersion: (modelVersion: MODEL_VERSION) => void;
    quality: TEXTURE_QUALITY;
    setQuality: (quality: TEXTURE_QUALITY) => void;
    generator: GENERATOR_TYPES;
    setGenerator: (generator: GENERATOR_TYPES) => void;
    autoRig: boolean;
    setAutoRig: (autoRig: boolean) => void;
    refine: boolean;
    setRefine: (refine: boolean) => void;
    imageFile: File | null;
    setImageFile: (file: File | null) => void;
    handleSubmit: () => void;
};

export const PromptStep = ({
    isOpen,
    prompt,
    setPrompt,
    isRequesting,
    loading,
    modelVersion,
    setModelVersion,
    quality,
    setQuality,
    handleSubmit,
    generator,
    setGenerator,
    autoRig,
    setAutoRig,
    refine,
    setRefine,
    imageFile,
    setImageFile,
}: Props) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setImageFile(file);
        }
    };

    const handleRemoveImage = (e: React.MouseEvent) => {
        e.stopPropagation();
        setImageFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };
    const {aiCredits, isAdmin} = useAuthorizationContext();

    const qualityOptions = Object.values(TEXTURE_QUALITY).map(value => ({key: value, value}));
    const modelVersionOptions = Object.values(MODEL_VERSION).map(value => ({key: value, value}));
    const capability = getGeneratorCapability(generator);
    // The playground has no Go server, so only providers that can run fully
    // browser-direct (Meshy, Rodin) are offered there; desktop shows all.
    const generatorOptions = Object.values(GENERATOR_TYPES)
        .filter(value => !isPlaygroundMode() || getGeneratorCapability(value).supportsBrowserDirectPlayground)
        .map(value => ({
            key: value,
            value: getGeneratorCapability(value).label,
        }));

    if (!isOpen) return null;

    const noCredits = aiCredits !== null && aiCredits <= 0;

    return (
        <>
            <Prompt
                placeholder="What would you like to Create?"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
            />
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{display: "none"}}
                onChange={handleFileChange}
            />
            <ImageUploadCard $hasImage={!!imageFile}
                onClick={() => !imageFile && fileInputRef.current?.click()}
            >
                {!imageFile ? 
                    <>
                        <ImageUploadIcon src={uploadIcon}
                            alt="upload"
                        />
                        <ImageUploadText>Click to upload image (optional)</ImageUploadText>
                    </>
                 : 
                    <>
                        <ImagePreview src={URL.createObjectURL(imageFile)}
                            alt="preview"
                        />
                        <ImageRemoveButton onClick={handleRemoveImage}>
                            <img src={trashIcon}
                                alt="remove"
                            />
                        </ImageRemoveButton>
                    </>
                }
            </ImageUploadCard>
            {capability.supportsAutoRig &&
                <label
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "12px",
                        color: "var(--theme-font-main-selected-color)",
                        cursor: "pointer",
                    }}
                >
                    <CheckBox name="autoRig"
                        checked={autoRig}
                        onChange={checked => setAutoRig(checked)}
                    />
                    Auto-rig (humanoid models only)
                </label>
            }
            {capability.supportsRefine &&
                <label
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "12px",
                        color: "var(--theme-font-main-selected-color)",
                        cursor: "pointer",
                    }}
                >
                    <CheckBox name="refine"
                        checked={refine}
                        onChange={checked => setRefine(checked)}
                    />
                    Texture model (higher quality, uses additional quota)
                </label>
            }
            {isAdmin && 
                <>
                    <AnotherPromptMessage>Admin only settings</AnotherPromptMessage>
                    {generator === GENERATOR_TYPES.TRIPO &&
                        <>
                            <BasicCombobox
                                data={modelVersionOptions}
                                value={modelVersionOptions.find(v => v.value === modelVersion)}
                                onChange={v => setModelVersion(v.value as MODEL_VERSION)}
                            />
                            <BasicCombobox
                                data={qualityOptions}
                                value={qualityOptions.find(v => v.value === quality)}
                                onChange={v => setQuality(v.value as TEXTURE_QUALITY)}
                            />
                        </>
                    }

                    <BasicCombobox
                        data={generatorOptions}
                        value={generatorOptions.find(v => v.key === generator)}
                        onChange={v => setGenerator(v.key as GENERATOR_TYPES)}
                    />
                </>
            }
            {isRequesting && <AnotherPromptMessage>Creating another task...</AnotherPromptMessage>}
            <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
                <CreditsBar />
                <SubmitButton
                    style={{flex: 1}}
                    disabled={!prompt && !imageFile || noCredits || isRequesting || loading}
                    onClick={handleSubmit}
                >
                    Create
                </SubmitButton>
            </div>
        </>
    );
};

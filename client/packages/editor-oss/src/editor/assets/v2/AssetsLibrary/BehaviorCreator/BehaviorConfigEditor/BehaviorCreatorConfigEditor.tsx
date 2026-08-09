import {useMemo, useState} from "react";

import {buildBehaviorCreatorRevisionActions} from "./buildBehaviorCreatorRevisionActions";
import {BehaviorConfig} from "../../../../../../editor/behaviors/BehaviorConfig";
import {StyledTextarea} from "../../../common/StyledTextarea";
import {AssetTagsInput} from "../../../common/Tags/AssetTagsInput";
import {PanelCheckbox} from "../../../RightPanel/common/PanelCheckbox";
import arrowDown from "../../images/arrow-down.svg";
import {RevisionSection} from "../../RevisionSection/RevisionSection";
import {AttributesSection} from "../AttributesSection/AttributesSection";
import {Property, Input, Label, ExpandButton, SectionTitle, DetailsData} from "../BehaviorCreator.style";
import {ResizableSettingsPanel} from "../ResizableSettingsPanel/ResizableSettingsPanel";
import {IAttribute} from "../types";

export type BehaviorCreatorConfigEditorProps = {
    behaviorId?: string;
    revisionId?: string;
    /**
     * The revision the scene is actually running, when distinct from
     * `revisionId` (the editor view). Forwarded to RevisionSection so the
     * matching row can be marked `(Scene)`.
     */
    sceneRevisionId?: string;
    name?: string;
    tags?: string[];
    description?: string;
    documentation?: string;
    config?: BehaviorConfig;
    code?: string;
    disabled?: boolean;
    isAiPromptDisabled?: boolean;
    onNameChange: (behaviorId: string, revisionId: string, name: string) => void;
    onTagsChange: (args: {behaviorId: string; revisionId: string; tagsToAdd?: string[]; tagToRemove?: string}) => void;
    onDescriptionChange: (behaviorId: string, revisionId: string, description: string) => void;
    onDocumentationChange: (documentation: string) => void;
    onCodeChange: (behaviorId: string, revisionId: string, code: string) => void;
    onConfigChange: (behaviorId: string, revisionId: string, config: BehaviorConfig) => void;
    /** Apply a revision to the scene (destructive — replaces the running version). */
    onApplyRevisionToScene?: (event: React.MouseEvent, revisionId: string) => void;
    /** Load a revision into the editor only (non-destructive — scene unaffected). */
    onOpenRevisionInEditor?: (revisionId: string) => void;
};

export const BehaviorCreatorConfigEditor = ({
    behaviorId,
    revisionId,
    sceneRevisionId,
    name,
    tags,
    description,
    documentation,
    config,
    disabled = false,
    onNameChange,
    onDescriptionChange,
    onDocumentationChange,
    onTagsChange,
    onConfigChange,
    onApplyRevisionToScene,
    onOpenRevisionInEditor,
}: BehaviorCreatorConfigEditorProps) => {
    const [detailsExpanded, setDetailsExpanded] = useState(true);
    const [attributesExpanded, setAttributesExpanded] = useState(true);

    const attributes = useMemo(
        () => (config ? Object.entries(config.attributes).map(([key, value]) => ({...value, key})) : []),
        [config?.attributes],
    );

    const handleAttributeChange = (updatedAttributes: IAttribute[]) => {
        if (!config || !behaviorId || !revisionId) {
            return;
        }

        const attributes = updatedAttributes.reduce(
            (acc, attr, index) => {
                acc[attr.key] = {
                    ...attr,
                    order: attr.order !== undefined ? attr.order : index,
                };
                return acc;
            },
            {} as Record<string, any>,
        );

        onConfigChange(behaviorId, revisionId, {
            ...config,
            attributes,
        });
    };

    return (
        <ResizableSettingsPanel className="hidden-scroll">
            <div style={{width: "100%", ...(disabled && {pointerEvents: "none", opacity: 0.5})}}>
                <SectionTitle onClick={() => setDetailsExpanded(prev => !prev)}>
                    <span className="title">Behavior Details</span>
                    <ExpandButton
                        className="reset-css"
                        $expanded={detailsExpanded}
                    >
                        <img
                            src={arrowDown}
                            alt="show more"
                        />
                    </ExpandButton>
                </SectionTitle>
                {detailsExpanded && (
                    <DetailsData>
                        <Property $fullWidth>
                            <Label>Name</Label>
                            <Input
                                value={name || ""}
                                setValue={value =>
                                    behaviorId && revisionId && onNameChange(behaviorId, revisionId, value)
                                }
                                placeholder="Enter behavior name"
                            />
                        </Property>
                        <Property $fullWidth>
                            <Label>Description</Label>
                            <StyledTextarea
                                value={description || ""}
                                setValue={value =>
                                    behaviorId && revisionId && onDescriptionChange(behaviorId, revisionId, value)
                                }
                                placeholder="Write a description..."
                            />
                        </Property>
                        <Property $fullWidth>
                            <Label>Documentation</Label>
                            <StyledTextarea
                                value={documentation || ""}
                                setValue={value => onDocumentationChange(value)}
                                placeholder="Write documentation (Markdown supported)..."
                                height="120px"
                            />
                        </Property>
                        <AssetTagsInput
                            tags={tags}
                            onTagsAdded={tags =>
                                behaviorId && revisionId && onTagsChange({behaviorId, revisionId, tagsToAdd: tags})
                            }
                            onTagDeleted={tag =>
                                behaviorId && revisionId && onTagsChange({behaviorId, revisionId, tagToRemove: tag})
                            }
                        />
                        <Property $fullWidth>
                            <Label>Allow Multiple Instances Per Object</Label>
                            <PanelCheckbox
                                text=""
                                checked={!!config?.allowMultiple}
                                onChange={e =>
                                    config &&
                                    behaviorId &&
                                    revisionId &&
                                    onConfigChange(behaviorId, revisionId, {
                                        ...config,
                                        allowMultiple: !!e.target.checked,
                                    })
                                }
                                v2
                                isGray
                                regular
                            />
                        </Property>
                    </DetailsData>
                )}
                <SectionTitle onClick={() => setAttributesExpanded(prev => !prev)}>
                    <span className="title">Attributes</span>
                    <ExpandButton
                        className="reset-css"
                        $expanded={attributesExpanded}
                    >
                        <img
                            src={arrowDown}
                            alt="show more"
                        />
                    </ExpandButton>
                </SectionTitle>
                {attributesExpanded && (
                    <AttributesSection
                        attributes={attributes}
                        setAttributes={handleAttributeChange}
                    />
                )}
                {behaviorId && (
                    <RevisionSection
                        assetId={behaviorId}
                        currentRevisionId={revisionId}
                        sceneRevisionId={sceneRevisionId}
                        getLoadActions={ctx =>
                            buildBehaviorCreatorRevisionActions(ctx, {
                                sceneRevisionId,
                                onOpenRevisionInEditor,
                                onApplyRevisionToScene,
                            })
                        }
                        showDiffOption
                    />
                )}
            </div>
        </ResizableSettingsPanel>
    );
};

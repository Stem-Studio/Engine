/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import {debounce} from "lodash";
import React, {useEffect} from "react";
import ReactDOM from "react-dom/client";
import styled from "styled-components";

import AttributeUtil from "./AttributeUtil";
import BehaviorAttributeConverter from "./BehaviorAttributeConverter";
import {BehaviorAttribute} from "./BehaviorAttributes";
import BehaviorAttributeType from "./BehaviorAttributeType";
import {BehaviorConfig} from "./BehaviorConfig";
import {BehaviorContext} from "./BehaviorContextProvider";
import BehaviorPluginManager from "./BehaviorPluginManager";
import global from "@stem/editor-oss/global";
import AttributeWidget from "./widgets/AttributeWidget";
import BehaviorWidget from "./widgets/BehaviorWidget";
import WidgetFactory from "./widgets/WidgetFactory";
import BehaviorData from "../../behaviors/BehaviorData";
import i18n from "@stem/editor-oss/i18n/config";
import {showToast} from "@stem/editor-oss/showToast";
import {BEHAVIOR_UI_CONTAINER_ID} from "@stem/editor-oss/types/editor";
import {findObjectByUuidDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

const BehaviorWidgetsContainer = styled.div`
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    row-gap: 16px;
    padding-bottom: 16px;
    & > * {
        margin-bottom: 0;
    }
`;

const AttributeWidgetComponent = ({
    widget,
    id,
    name,
    attribute,
    getCurrentValue,
    updateBehaviorField,
}: {
    widget: AttributeWidget;
    id: string;
    name: string;
    attribute: BehaviorAttribute;
    getCurrentValue: () => any;
    updateBehaviorField: (value: any) => void;
}) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const widgetRootRef = React.useRef<ReactDOM.Root | null>(null);

    useEffect(() => {
        let mounted = true;

        if (containerRef.current && !widgetRootRef.current) {
            try {
                widgetRootRef.current = ReactDOM.createRoot(containerRef.current);
                if (mounted) {
                    widget.build(id, name, attribute, getCurrentValue, updateBehaviorField, widgetRootRef.current);
                }
            } catch (e) {
                console.warn("Error creating widget root:", e);
            }
        }

        return () => {
            mounted = false;
            if (widgetRootRef.current) {
                const root = widgetRootRef.current;
                widgetRootRef.current = null;
                void Promise.resolve().then(() => {
                    try {
                        root.render(null);
                        setTimeout(() => {
                            try {
                                root.unmount();
                            } catch (e) {
                                console.warn("Error unmounting widget root:", e);
                            }
                        }, 0);
                    } catch (e) {
                        console.warn("Error cleaning up widget root:", e);
                    }
                });
            }
        };
    }, []);

    useEffect(() => {
        if (widgetRootRef.current) {
            widget.build(id, name, attribute, getCurrentValue, updateBehaviorField, widgetRootRef.current);
        }
    }, [widget, id, name, attribute, getCurrentValue, updateBehaviorField]);

    return (
        <div
            ref={containerRef}
            className="widget-container"
        />
    );
};

const BehaviorUIContainer = ({
    behaviorData,
    children,
}: {
    behaviorData: BehaviorData;
    children?: React.ReactNode | React.ReactNode[];
}) => {
    useEffect(() => {
        return () => {
            global.app?.game?.updateBehaviorAttributes(behaviorData.uuid, behaviorData.attributesData ?? {});
        };
    }, [behaviorData, behaviorData.attributesData]);

    return <BehaviorWidgetsContainer className="behavior-ui-widget-container">{children}</BehaviorWidgetsContainer>;
};

// TODO: separate ReactJS code from the main class
class BehaviorUIManager {
    private widgets: Map<BehaviorAttributeType, AttributeWidget> = new Map();
    private behaviorWidget: BehaviorWidget | null = null;
    private activeWidgets: AttributeWidget[] = [];
    private root: ReactDOM.Root | null = null;
    private behaviorAttributeConverter: BehaviorAttributeConverter;
    private behaviorPluginManager: BehaviorPluginManager;
    private widgetFactory: WidgetFactory;
    private currentBehaviorData: BehaviorData | null = null;
    private currentBehaviorConfig: BehaviorConfig | null = null;
    private currentBehaviorContext: BehaviorContext | null = null;
    private originalBehaviorData: BehaviorData | null = null;

    constructor(behaviorAttributeConverter: BehaviorAttributeConverter, behaviorPluginManager: BehaviorPluginManager) {
        this.behaviorAttributeConverter = behaviorAttributeConverter;
        this.behaviorPluginManager = behaviorPluginManager;
        this.widgets = new Map();
        this.widgetFactory = new WidgetFactory(this.widgets);
    }

    init() {
        global.app?.on("sceneAssetChanged.BehaviorUIManager", () => {
            this.debouncedRefreshAssets();
        });
    }

    async refresh() {
        if (this.currentBehaviorConfig && this.currentBehaviorData) {
            const editor = global.app?.editor;
            if (!editor) return;

            const selected = editor.selected;
            const object = Array.isArray(selected) ? (selected[0] ?? null) : selected;
            const scene = editor.scene;
            const sceneId = editor.sceneID;

            // Use async getBehaviorContext
            const newContext = await editor.behaviorContextProvider.getBehaviorContext(
                object,
                scene,
                sceneId,
                editor.assetSource ?? null,
            );

            void this.showBehaviorUI(this.currentBehaviorConfig, this.currentBehaviorData, newContext);
        }
    }

    async showBehaviorUI(
        behaviorConfig: BehaviorConfig,
        behaviorData: BehaviorData,
        behaviorContext: BehaviorContext,
        initializing?: boolean,
    ): Promise<void> {
        // Store current state for field updates
        this.currentBehaviorData = behaviorData;
        this.currentBehaviorConfig = behaviorConfig;
        this.currentBehaviorContext = behaviorContext;

        if (initializing) {
            this.originalBehaviorData = {
                ...behaviorData,
                attributesData: structuredClone(behaviorData.attributesData),
            };
        }

        // Save scroll position before clearing widgets
        const scrollPosition = this.saveScrollPosition();

        await new Promise<void>(resolve => {
            this.clearPreviousWidgets(false);
            setTimeout(resolve, 0);
        });

        const attributesData = behaviorConfig.attributes;

        if (!attributesData) {
            console.error(`Attributes not found for behavior "${behaviorConfig.name}"`);
            return;
        }

        const attributes = this.behaviorAttributeConverter.convert(
            attributesData,
            behaviorContext,
            behaviorConfig.attributeTemplates,
        );

        this.behaviorWidget?.build(behaviorConfig.name, behaviorData);

        // Container for rendering widgets
        const container = document.getElementById(BEHAVIOR_UI_CONTAINER_ID);

        if (!container) {
            console.error("Container not found");
            return;
        }

        if (!this.root) {
            try {
                this.root = ReactDOM.createRoot(container);
                (container as any)._reactRoot = this.root;
            } catch (e) {
                console.error("Failed to create root:", e);
                return;
            }
        }

        if (!container.isConnected) {
            console.error("Root container is unmounted.");
            return;
        }

        if (!this.root) {
            console.error("Failed to create or retrieve root");
            return;
        }

        const widgetsToRender: React.ReactNode[] = [];

        // collect only attributes that are in visibleIf conditions
        const trackedAttributes: Record<string, any> = AttributeUtil.collectVisibleIfAttributes(
            attributes,
            behaviorData.attributesData ?? {},
        );

        this.behaviorPluginManager.getPlugin(behaviorData.uuid)?.onEditorPanelShown?.();
        const sortedAttributes = Object.entries(attributes)
            .filter(([, attr]) => {
                const a = attr;
                if (a.invisible) return false;
                if (a.userVisible === false) return false;
                if (a.visibleIf && !AttributeUtil.isAttributeWithConditionVisible(a.visibleIf, trackedAttributes))
                    return false;
                return true;
            })
            .sort(([, a], [, b]) => {
                const orderA = a.order ?? 0;
                const orderB = b.order ?? 0;
                return orderA - orderB;
            });

        for (const [fieldName, attribute] of sortedAttributes) {
            const attr = attribute;

            if (attr.invisible) {
                continue;
            }

            if (attr.visibleIf && !AttributeUtil.isAttributeWithConditionVisible(attr.visibleIf, trackedAttributes)) {
                continue;
            }

            const attributeTypes = Object.values(BehaviorAttributeType) as string[];
            if (!attributeTypes.includes(attr.type)) {
                console.error(
                    `Invalid attribute type "${attr.type}" for field "${fieldName}" in behavior "${behaviorConfig.name}"`,
                );
                continue;
            }

            const widget = this.widgetFactory.createWidget(attr);

            if (!widget) {
                console.error(`Widget not found for attribute type "${attr.type}"`);
                continue;
            }

            widgetsToRender.push(
                <AttributeWidgetComponent
                    key={`${fieldName}-${behaviorConfig.id}-${behaviorData.uuid}`}
                    id={fieldName}
                    widget={widget}
                    name={attr.name ?? fieldName}
                    attribute={attr}
                    getCurrentValue={() => {
                        const currentValue = AttributeUtil.getNestedProperty(behaviorData.attributesData, fieldName);
                        return AttributeUtil.getAttributeValue(currentValue, attr.default);
                    }}
                    updateBehaviorField={(value: any) => {
                        // Handle button actions - call onEditorButtonClicked instead of setting a field
                        if (value && typeof value === "object" && value.action) {
                            // Handle resetToDefaults action directly by resetting attributes to defaults from config
                            if (value.action === "resetToDefaults" && behaviorConfig.attributes) {
                                for (const [attrName, attrConfig] of Object.entries(behaviorConfig.attributes)) {
                                    if (attrConfig && attrConfig.type !== "button" && "default" in attrConfig) {
                                        if (behaviorData.attributesData) {
                                            behaviorData.attributesData[attrName] = attrConfig.default;
                                        }
                                    }
                                }
                            }

                            // Try to call onEditorButtonClicked on the behavior plugin if available
                            const plugin = this.behaviorPluginManager.getPlugin(behaviorData.uuid);
                            if (plugin) {
                                plugin.onEditorButtonClicked?.(value.action);
                                // Sync attributes from behavior back to behaviorData after the action
                                Object.assign(behaviorData.attributesData ?? {}, plugin.attributes);
                                this.behaviorPluginManager.refreshEditorPreviewInstancingBudget?.();
                            }

                            // Update the runtime behavior through GameManager
                            // This is needed because BehaviorPluginManager may not have the plugin registered
                            // (e.g., for hidden behaviors or in certain editor modes)
                            global.app?.game?.updateBehaviorAttributes(behaviorData.uuid, behaviorData.attributesData ?? {});

                            // Force complete UI rebuild by unmounting first
                            if (this.root) {
                                this.root.unmount();
                                this.root = null;
                            }
                            // Refresh the UI to reflect any attribute changes made by the action
                            void this.showBehaviorUI(behaviorConfig, behaviorData, behaviorContext);
                            this.debouncedNotifyBehaviorUpdated();
                            return;
                        }

                        AttributeUtil.setNestedProperty(behaviorData.attributesData, fieldName, value);

                        const plugin = this.behaviorPluginManager.getPlugin(behaviorData.uuid);
                        if (plugin) {
                            // Handle exclusive attributes
                            this.handleExclusiveAttribute(fieldName, value, behaviorData, behaviorConfig);
                            (plugin as any).attributes = behaviorData.attributesData;
                            // Note: NumberWidget debounces calls to updateBehaviorField, so this is safe
                            plugin.onEditorAttributesUpdated?.();
                            this.behaviorPluginManager.refreshEditorPreviewInstancingBudget?.();
                        }

                        // Check if this field affects visibility of other attributes
                        const needsUIRefresh = trackedAttributes[fieldName] !== undefined;

                        if (trackedAttributes[fieldName] !== undefined) {
                            trackedAttributes[fieldName] = value;
                        }

                        // If this field affects visibility, immediately refresh UI
                        if (needsUIRefresh) {
                            void this.showBehaviorUI(behaviorConfig, behaviorData, behaviorContext);
                        }

                        this.debouncedNotifyBehaviorUpdated();
                    }}
                />,
            );
            this.activeWidgets.push(widget);
        }

        this.root.render(<BehaviorUIContainer behaviorData={behaviorData}>{widgetsToRender}</BehaviorUIContainer>);

        // Restore scroll position after render
        if (scrollPosition !== null) {
            requestAnimationFrame(() => {
                this.restoreScrollPosition(scrollPosition);
            });
        }
    }

    hideBehaviorUI(): void {
        this.clearPreviousWidgets(true);
    }

    setBehaviorWidget(behaviorWidget: BehaviorWidget): void {
        this.behaviorWidget = behaviorWidget;
        // console.log(`Behavior widget set: ${behaviorWidget.constructor.name}`);
    }

    registerAttributeWidget(type: BehaviorAttributeType, widget: AttributeWidget): void {
        if (this.widgets.has(type)) {
            console.error(`AttributeWidget of type "${type}" already exists.`);
            return;
        }
        this.widgets.set(type, widget);
        console.log(`Registered AttributeWidget: "${type}"`);
    }

    public async cancelUIChanges(): Promise<void> {
        if (!this.originalBehaviorData || !this.currentBehaviorConfig || !this.currentBehaviorContext) {
            return;
        }
        const original = this.originalBehaviorData.attributesData;
        const current = this.currentBehaviorData?.attributesData;

        if (!current) return;

        for (const key of Object.keys(current)) {
            const originalValue = AttributeUtil.getNestedProperty(original, key);
            await this.updateBehaviorField(key, originalValue);
        }
    }

    async updateBehaviorField(fieldName: string, value: any): Promise<void> {
        if (!this.currentBehaviorData || !this.currentBehaviorConfig || !this.currentBehaviorContext) {
            console.warn("Cannot update behavior field: no current behavior data");
            return;
        }

        // Update the behavior data using dot notation support
        AttributeUtil.setNestedProperty(this.currentBehaviorData.attributesData, fieldName, value);

        // Handle exclusive attributes
        this.handleExclusiveAttribute(fieldName, value, this.currentBehaviorData, this.currentBehaviorConfig);

        // Update behavior plugin attributes
        const plugin = this.behaviorPluginManager.getPlugin(this.currentBehaviorData.uuid);
        if (plugin) {
            (plugin as any).attributes = this.currentBehaviorData.attributesData;
            plugin.onEditorAttributesUpdated?.();
            this.behaviorPluginManager.refreshEditorPreviewInstancingBudget?.();
        }

        this.validateTriggerConfigurationAndDisableIfInvalid();

        // Re-render the UI with updated data
        await this.showBehaviorUI(this.currentBehaviorConfig, this.currentBehaviorData, this.currentBehaviorContext);
    }

    private validateTriggerConfigurationAndDisableIfInvalid(): void {
        if (!this.currentBehaviorData || this.currentBehaviorData.id !== "trigger") {
            return;
        }

        const reason = this.getTriggerValidationError(this.currentBehaviorData.attributesData);
        if (!reason || this.currentBehaviorData.enabled === false) {
            return;
        }

        this.currentBehaviorData.enabled = false;
        showToast({
            type: "warning",
            title: i18n.t("Trigger behavior disabled"),
            body: reason,
        });
    }

    private getTriggerValidationError(attributes: any): string | null {
        const conditions = Array.isArray(attributes?.if_condition) ? attributes.if_condition : [];
        const steps = Array.isArray(attributes?.then_steps) ? attributes.then_steps : [];
        const selfUUID = this.currentBehaviorContext?.object?.uuid || "";
        const scene = global.app?.editor?.scene;

        const isGlobalBehaviorHost = (uuid?: string): boolean => {
            if (!uuid || !scene) return false;
            const object = findObjectByUuidDepthFirst(scene, uuid);
            return object?.name === "GlobalBehaviorHost";
        };

        for (const condition of conditions) {
            if (!condition?.conditionType) {
                return "An IF statement is missing its condition type.";
            }

            if (condition.conditionType === "object_touches") {
                if (!condition.objectUUID) {
                    return "Object Touches requires selecting a target object.";
                }
                if (condition.objectUUID === selfUUID) {
                    return "Object Touches cannot target the same object as the trigger.";
                }
                if (isGlobalBehaviorHost(condition.objectUUID)) {
                    return "Object Touches cannot target GlobalBehaviorHost.";
                }
            }

            if (condition.conditionType === "distance_compare" && !condition.distanceObjectUUID) {
                return "Distance Compare requires selecting an object.";
            }

            if (
                condition.conditionType === "on_interact" &&
                condition.interactTargetUUID &&
                isGlobalBehaviorHost(condition.interactTargetUUID)
            ) {
                return "On Interact cannot target GlobalBehaviorHost.";
            }

            if (
                condition.conditionType === "object_state_compare" &&
                condition.stateObjectUUID &&
                isGlobalBehaviorHost(condition.stateObjectUUID)
            ) {
                return "Object State Compare cannot target GlobalBehaviorHost.";
            }

            if (condition.conditionType === "physics_collision_event" && !condition.physicsObjectUUID) {
                return "Physics Collision Event requires selecting a collision object.";
            }

            if (condition.conditionType === "physics_collision_event" && condition.physicsObjectUUID === selfUUID) {
                return "Physics Collision Event cannot target the same object as the trigger.";
            }

            if (
                condition.conditionType === "ai_proximity" &&
                condition.aiTargetScope === "object" &&
                !condition.aiObjectUUID
            ) {
                return "AI Proximity requires selecting a target object when scope is Object.";
            }

            if (condition.conditionType === "variable_compare" && !String(condition.variablePath || "").trim()) {
                return "Variable Compare requires a variable path.";
            }

            if (condition.conditionType === "behavior_state") {
                if (!String(condition.behaviorIdentifier || "").trim()) {
                    return "Behavior State requires a behavior ID or UUID.";
                }
            }

            if (
                condition.conditionType === "animation_event_reached" &&
                !String(condition.animationEventName || "").trim()
            ) {
                return "Animation Event Reached requires an event name.";
            }
        }

        if (steps.length === 0) {
            return "At least one THEN statement is required.";
        }

        for (const step of steps) {
            if (!step?.thenType) {
                return "A THEN statement is missing an action.";
            }

            if (step.thenType === "apply_lambda") {
                const selected = Array.isArray(step?.then_lambda?.behaviors) ? step.then_lambda.behaviors : [];
                if (selected.length === 0) {
                    return "Apply Lambda requires selecting at least one lambda target.";
                }
            }

            if (step.thenType === "apply_behavior") {
                const selected = Array.isArray(step?.then_behavior?.behaviors) ? step.then_behavior.behaviors : [];
                if (selected.length === 0) {
                    return "Apply Behavior requires selecting at least one behavior target.";
                }
            }

            if (step.thenType === "set_attribute" && !String(step.attributeKey || "").trim()) {
                return "Set Attribute requires an attribute key.";
            }

            if (step.thenType === "send_event" && !String(step.eventName || "").trim()) {
                return "Send Event requires an event name.";
            }
        }

        return null;
    }

    private debouncedRefreshAssets = debounce(() => {
        void this.refresh();
    }, 500);

    private debouncedNotifyBehaviorUpdated = debounce(() => {
        global.app?.call(
            "behaviorAutoUpdate",
            this.currentBehaviorData?.uuid,
            this.currentBehaviorData?.attributesData,
        );
    }, 300);

    private clearPreviousWidgets(fullCleanup: boolean = true): void {
        if (this.currentBehaviorData) {
            this.behaviorPluginManager.getPlugin(this.currentBehaviorData.uuid)?.onEditorPanelHidden?.();
        }

        this.activeWidgets.forEach(widget => {
            widget.clear();
        });
        this.activeWidgets = [];

        if (fullCleanup) {
            // Clear current state
            this.currentBehaviorData = null;
            this.currentBehaviorConfig = null;
            this.currentBehaviorContext = null;
        }

        if (this.root && fullCleanup) {
            try {
                this.root.render(null);
                const container = document.getElementById(BEHAVIOR_UI_CONTAINER_ID);
                if (container) {
                    delete (container as any)._reactRoot;
                }
                const rootToUnmount = this.root;
                this.root = null;

                setTimeout(() => {
                    try {
                        rootToUnmount.unmount();
                    } catch (e) {
                        console.warn("Error during root unmount:", e);
                    }
                }, 0);
            } catch (e) {
                console.warn("Error during root cleanup:", e);
                this.root = null;
            }
        }
    }

    /**
     * Handles exclusive boolean attributes when they are set to true
     * @param fieldName
     * @param value
     * @param behaviorData
     * @param behaviorConfig
     */
    private handleExclusiveAttribute(
        fieldName: string,
        value: any,
        behaviorData: BehaviorData,
        behaviorConfig: BehaviorConfig,
    ): void {
        // Handle exclusive attributes if this is a boolean field being set to true
        if (value === true && behaviorConfig.attributes && behaviorConfig.attributes[fieldName]) {
            const attributeConfig = behaviorConfig.attributes[fieldName];
            if (attributeConfig.type === "boolean" && (attributeConfig as any).isExclusive) {
                // Get editor from global to handle exclusive attributes
                const editor = global.app?.editor;
                if (editor?.behaviorDataManager && editor?.scene) {
                    editor.behaviorDataManager.handleExclusiveAttributeUpdate(
                        editor.scene,
                        behaviorData.uuid,
                        fieldName,
                        value,
                    );
                }
            }
        }
    }

    /**
     * Find the scrollable parent of the behavior UI container and save its scroll position
     */
    private saveScrollPosition(): number | null {
        const container = document.getElementById(BEHAVIOR_UI_CONTAINER_ID);
        if (!container) return null;

        // Find the scrollable parent (look for overflow-y: auto/scroll)
        let parent: HTMLElement | null = container.parentElement;
        while (parent) {
            const style = window.getComputedStyle(parent);
            if (style.overflowY === "auto" || style.overflowY === "scroll") {
                return parent.scrollTop;
            }
            parent = parent.parentElement;
        }

        // Fallback to container itself
        return container.scrollTop;
    }

    /**
     * Restore scroll position to the scrollable parent
     * @param position
     */
    private restoreScrollPosition(position: number): void {
        const container = document.getElementById(BEHAVIOR_UI_CONTAINER_ID);
        if (!container) return;

        // Find the scrollable parent
        let parent: HTMLElement | null = container.parentElement;
        while (parent) {
            const style = window.getComputedStyle(parent);
            if (style.overflowY === "auto" || style.overflowY === "scroll") {
                parent.scrollTop = position;
                return;
            }
            parent = parent.parentElement;
        }

        // Fallback to container itself
        container.scrollTop = position;
    }
}

export default BehaviorUIManager;

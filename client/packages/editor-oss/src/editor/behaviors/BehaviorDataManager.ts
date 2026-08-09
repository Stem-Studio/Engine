import { Scene, Object3D, MathUtils } from "three";

import BehaviorAttributeConverter from "./BehaviorAttributeConverter";
import BehaviorAttributeType from "./BehaviorAttributeType";
import BehaviorConfigRegistry from "./BehaviorConfigRegistry";
import {BehaviorContext} from "./BehaviorContextProvider";
import BehaviorDataFactory from "./BehaviorDataFactory";
import BehaviorData, {BEHAVIOR_DATA_SCHEMA_VERSION} from "../../behaviors/BehaviorData";
import { getPrefabRoot, isPrefabUnlocked } from '@stem/editor-oss/prefab/util';
import { showToast } from "@stem/editor-oss/showToast";
import {cloneJsonCompatible} from "@stem/editor-oss/utils/cloneJsonCompatible";
import {findObjectDepthFirst, traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

class BehaviorDataManager {
    private behaviorConfigRegistry: BehaviorConfigRegistry;
    private behaviorAttributeConverter: BehaviorAttributeConverter;

    constructor(
        behaviorConfigRegistry: BehaviorConfigRegistry,
        behaviorAttributeConverter: BehaviorAttributeConverter,
    ) {
        this.behaviorConfigRegistry = behaviorConfigRegistry;
        this.behaviorAttributeConverter = behaviorAttributeConverter;
    }

    createBehaviorData(id: string, behaviorContext: BehaviorContext, customUUID?: string): BehaviorData | null {
        const config = this.behaviorConfigRegistry.getConfig(id);

        if (!config) {
            console.error(`Failed to create behavior data using "${id}" id - config not found`);
            return null;
        }

        const attributes = this.behaviorAttributeConverter.convert(config.attributes, behaviorContext, config.attributeTemplates);
        return BehaviorDataFactory.createData(config.id, attributes, config.priority, config.throttleConfig, customUUID);
    }

    cloneBehaviorData(data: BehaviorData): BehaviorData {
        return {
            schemaVersion: data.schemaVersion ?? BEHAVIOR_DATA_SCHEMA_VERSION,
            id: data.id,
            uuid: MathUtils.generateUUID(),
            enabled: data.enabled,
            priority: data.priority,
            attributesData: cloneJsonCompatible(data.attributesData),
            throttleConfig: data.throttleConfig
                ? cloneJsonCompatible(data.throttleConfig)
                : undefined,
            target: data.target,
        };
    }

    getBehaviorDataByUUID(object: Object3D, uuid: string): BehaviorData | null {
        return object.userData?.behaviors?.find((behavior: BehaviorData) => behavior.uuid === uuid);
    }

    getBehaviorDataById(object: Object3D, id: string): BehaviorData | null {
        return object.userData?.behaviors?.find((behavior: BehaviorData) => behavior.id === id);
    }

    addBehaviorDataToObject(object: Object3D, data: BehaviorData, index: number = -1): boolean {
        if (!this.canAddBehaviorsToObject(object)) {
            console.error(`Failed to add behavior data using "${data.uuid}" uuid - cannot add`);
            return false;
        }

        if (!object.userData?.behaviors) {
            object.userData.behaviors = [];
        }

        let insertIndex = index;
        if (insertIndex < 0) {
            insertIndex = object.userData.behaviors.length;
        } else if (insertIndex > object.userData.behaviors.length) {
            console.warn(`BehaviorDataManager: index ${index} is out of bounds. Using default index.`);
            insertIndex = object.userData.behaviors.length;
        }

        // If there is an active behavior of the same type - disable it. Only new one will be enabled.
        const config = this.behaviorConfigRegistry.getConfig(data.id);
        if (!config?.allowMultiple) {
            object.userData.behaviors.forEach((el: BehaviorData) => {
                if (el.enabled && el.id === data.id && el.uuid !== data.uuid) {
                    el.enabled = false;
                }
            });
        }

        object.userData.behaviors.splice(insertIndex, 0, data);

        return true;
    }

    removeBehaviorDataFromObjectByUUID(object: Object3D, uuid: string): boolean {
        if (!object.userData?.behaviors) {
            return false;
        }

        if (!this.canRemoveBehaviorFromObject(object, uuid)) {
            console.error(`Failed to remove behavior data using "${uuid}" uuid - cannot remove`);
            return false;
        }

        const behaviors = object.userData.behaviors as BehaviorData[];
        const index = behaviors.findIndex((item) => item.uuid === uuid);

        if (index < 0) {
            console.error(`Failed to remove behavior data using "${uuid}" uuid - not found`);
            return false;
        }

        behaviors.splice(index, 1);
        return true;
    }

    /**
     * Handles exclusive boolean attributes when adding a behavior to an object
     * If there's already a behavior with exclusive attribute set to true,
     * the new behavior's exclusive attribute will be set to false
     * @param object
     * @param data
     * @param scene
     */
    handleExclusiveAttributesOnAdd(object: Object3D, data: BehaviorData, scene: Scene): void {
        const config = this.behaviorConfigRegistry.getConfig(data.id);
        if (!config || !config.attributes) {
            return;
        }

        // Check each attribute in the behavior config for isExclusive flag
        Object.entries(config.attributes).forEach(([attributeName, attributeConfig]) => {
            if (attributeConfig.type === BehaviorAttributeType.Boolean && attributeConfig.isExclusive) {
                // Check if there's already a behavior with this exclusive attribute set to true
                // Exclude the current behavior being added
                const existingBehaviorWithTrue = this.findBehaviorWithExclusiveAttribute(
                    scene,
                    attributeName,
                    true,
                    data.uuid,
                );

                if (existingBehaviorWithTrue) {
                    // Set the new behavior's attribute to false since another one already has true
                    if (data.attributesData) {
                        data.attributesData[attributeName] = false;
                    }
                    console.log(
                        `Set exclusive attribute "${attributeName}" to false for new behavior ${data.id} because another behavior already has it enabled`,
                    );
                } else {
                    // This is the first behavior with this exclusive attribute, keep it true if it was set to true
                    if (data.attributesData && data.attributesData[attributeName] === true) {
                        console.log(
                            `Keeping exclusive attribute "${attributeName}" as true for first behavior ${data.id}`,
                        );
                    }
                }
            }
        });
    }

    /**
     * Handles exclusive boolean attributes when updating a behavior attribute
     * If an exclusive attribute is being set to true, it disables the same attribute
     * in all other behaviors in the scene
     * @param scene
     * @param behaviorUuid
     * @param attributeName
     * @param newValue
     */
    handleExclusiveAttributeUpdate(scene: Scene, behaviorUuid: string, attributeName: string, newValue: any): void {
        if (newValue !== true) {
            return; // Only handle when setting to true
        }

        // Find the behavior being updated
        const behaviorData = this.findBehaviorInScene(scene, behaviorUuid);
        if (!behaviorData) {
            return;
        }

        // Get the config for this behavior to check if the attribute is exclusive
        const config = this.behaviorConfigRegistry.getConfig(behaviorData.id);
        if (!config || !config.attributes || !config.attributes[attributeName]) {
            return;
        }

        const attributeConfig = config.attributes[attributeName];
        if (attributeConfig.type === "boolean" && attributeConfig.isExclusive) {
            // Find and disable this attribute in all other behaviors in the scene
            const disabledInfo = this.disableExclusiveAttributeInScene(scene, attributeName, behaviorUuid);

            // Show toast notification about attribute change
            if (disabledInfo.disabledBehaviors.length > 0) {
                const behaviorName = config.name || behaviorData.id;
                const attributeDisplayName = attributeConfig.name || attributeName;

                // Create list of affected objects
                const affectedObjects = disabledInfo.disabledBehaviors
                    .map(info => info.objectName || "Unnamed Object")
                    .join(", ");

                showToast({
                    type: "info",
                    title: "Exclusive Attribute Updated",
                    body: `"${behaviorName}" behavior attribute: "${attributeDisplayName}" is disabled for: "${affectedObjects}".`,
                });
            }
        }
    }

    /**
     * Indicates whether new behaviors can be added to the object.
     * 
     * @remarks
     * Behaviors cannot be added if:
     * - The object is a prefab and the prefab is locked
     * 
     * @param object - The object to check
     * @returns true if new behaviors can be added, false otherwise.
     */
    canAddBehaviorsToObject(object: Object3D): boolean {
        const prefabRoot = getPrefabRoot(object);
        if (prefabRoot) {
            return isPrefabUnlocked(prefabRoot);
        }
        return true;
    }

    /**
     * Indicates whether the given behavior can be removed from the object.
     * 
     * @remarks
     * The behavior cannot be removed if:
     * - It belongs to a prefab and the prefab is locked
     * 
     * @param object - The object to check
     * @param behaviorUuid - The UUID of the behavior
     * @returns true if the behavior can be removed, false otherwise.
     */
    canRemoveBehaviorFromObject(object: Object3D, behaviorUuid: string): boolean {
        if (!object.userData?.behaviors) {
            return false;
        }

        const behaviors = object.userData.behaviors as BehaviorData[];
        const behavior = behaviors.find((b) => b.uuid === behaviorUuid);
        if (!behavior) {
            return false;
        }
        
        // If this behavior belongs to a prefab, it can only be removed if the
        // prefab is unlocked.
        if (behavior.prefabBehaviorUuid) {
            const prefabRoot = getPrefabRoot(object);
            if (prefabRoot) {
                return isPrefabUnlocked(prefabRoot);
            }
        }

        return true;
    }

    /**
     * Indicates whether the given behavior on the object can be toggled.
     * 
     * @remarks
     * The behavior cannot be toggled if:
     * - It belongs to a prefab and the prefab is locked
     * 
     * @param object - The object to check
     * @param behaviorUuid - The UUID of the behavior
     * @returns true if the behavior can be toggled, false otherwise.
     */
    canToggleBehaviorOnObject(object: Object3D, behaviorUuid: string): boolean {
        // Currently the same as canRemoveBehavior
        return this.canRemoveBehaviorFromObject(object, behaviorUuid);
    }

    /**
     * Disables an exclusive attribute in all behaviors in the scene except the excluded one
     * Returns detailed info about disabled behaviors for notification purposes
     * @param scene
     * @param attributeName
     * @param excludeBehaviorUuid
     */
    private disableExclusiveAttributeInScene(
        scene: Scene,
        attributeName: string,
        excludeBehaviorUuid: string,
    ): {
        disabledBehaviors: Array<{behavior: BehaviorData; objectName: string}>;
    } {
        const disabledBehaviors: Array<{behavior: BehaviorData; objectName: string}> = [];

        traverseObjectDepthFirst(scene, (object: Object3D) => {
            if (object.userData?.behaviors) {
                object.userData.behaviors.forEach((behavior: BehaviorData) => {
                    // Skip the behavior we're updating
                    if (behavior.uuid === excludeBehaviorUuid) {
                        return;
                    }

                    // Check if this behavior has the same exclusive attribute
                    const config = this.behaviorConfigRegistry.getConfig(behavior.id);
                    if (
                        config &&
                        config.attributes &&
                        config.attributes[attributeName] &&
                        config.attributes[attributeName].type === "boolean" &&
                        config.attributes[attributeName].isExclusive
                    ) {
                        // Only disable if it was actually true
                        if (behavior.attributesData && behavior.attributesData[attributeName] === true) {
                            behavior.attributesData[attributeName] = false;
                            disabledBehaviors.push({
                                behavior: behavior,
                                objectName: object.name || "Unnamed Object",
                            });
                            console.log(
                                `Disabled exclusive attribute "${attributeName}" in behavior ${behavior.id} (${behavior.uuid}) on object ${object.name}`,
                            );
                        }
                    }
                });
            }
        });

        // Trigger UI update to show changes immediately
        const global = globalThis as any;
        if (global.app?.editor) {
            global.app.call(`objectChanged`, global.app.editor, global.app.editor.selected);
        }

        return {disabledBehaviors};
    }

    /**
     * Finds a behavior by UUID in the scene
     * @param scene
     * @param behaviorUuid
     */
    private findBehaviorInScene(scene: Scene, behaviorUuid: string): BehaviorData | null {
        let foundBehavior: BehaviorData | null = null;

        findObjectDepthFirst(scene, (object: Object3D) => {
            const behavior = object.userData?.behaviors?.find((b: BehaviorData) => b.uuid === behaviorUuid);
            if (behavior) {
                foundBehavior = behavior;
                return true;
            }
            return false;
        });

        return foundBehavior;
    }

    /**
     * Finds a behavior with specific exclusive attribute value in the scene
     * @param scene
     * @param attributeName
     * @param attributeValue
     * @param excludeBehaviorUuid - UUID of behavior to exclude from search
     */
    private findBehaviorWithExclusiveAttribute(
        scene: Scene,
        attributeName: string,
        attributeValue: any,
        excludeBehaviorUuid?: string,
    ): BehaviorData | null {
        let foundBehavior: BehaviorData | null = null;

        findObjectDepthFirst(scene, (object: Object3D) => {
            const behaviors = object.userData?.behaviors as BehaviorData[] | undefined;
            if (!behaviors) {
                return false;
            }

            for (const behavior of behaviors) {
                // Skip the excluded behavior if specified
                if (excludeBehaviorUuid && behavior.uuid === excludeBehaviorUuid) {
                    continue;
                }

                const config = this.behaviorConfigRegistry.getConfig(behavior.id);
                if (
                    config &&
                    config.attributes &&
                    config.attributes[attributeName] &&
                    config.attributes[attributeName].type === "boolean" &&
                    config.attributes[attributeName].isExclusive &&
                    behavior.attributesData != null &&
                    behavior.attributesData[attributeName] === attributeValue
                ) {
                    foundBehavior = behavior;
                    return true;
                }
            }

            return false;
        });

        return foundBehavior;
    }
}

export default BehaviorDataManager;

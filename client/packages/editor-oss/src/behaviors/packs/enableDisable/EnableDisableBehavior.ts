import * as THREE from "three";

import GameManager from "src/behaviors/game/GameManager";

import {BehaviorBase} from "../../Behavior";

enum ACTION_TYPE {
    ENABLE = "enable",
    DISABLE = "disable",
    TOGGLE = "toggle",
}

enum TARGET_TYPE {
    GAME_OBJECT = "gameObject",
    BEHAVIOR = "behavior",
}

interface TargetObjectBehaviors {
    object: string; // object uuid
    behaviors: string[]; // behavior uuids
}

class EnableDisableBehavior extends BehaviorBase {
    protected game: GameManager | null = null;

    init(gameManager: GameManager): void {
        this.game = gameManager;
    }

    onAdded(): void {
        // Nothing to do on added
    }

    onRemoved(): void {
        // Nothing to do on removed
    }

    update(): void {
        // This behavior doesn't need continuous updates
    }

    onReset(): void {
        // Nothing to do on reset
    }

    // This behavior is triggered by other behaviors (like Trigger)
    onEvent(msg: string, data: unknown): void {
        if (msg === "trigger") {
            const actionType = (data as {actionType?: string}).actionType;
            if (actionType === "activate") {
                this.executeAction();
            }
        }
    }

    private executeAction(): void {
        const action = (this.attributes.action as ACTION_TYPE) || ACTION_TYPE.TOGGLE;
        const targetType = (this.attributes.targetType as TARGET_TYPE) || TARGET_TYPE.GAME_OBJECT;

        let targetObjectUUID: string;
        let targetBehaviors: string[] = [];

        if (targetType === TARGET_TYPE.GAME_OBJECT) {
            // For gameObject type, targetObject is a simple UUID string
            targetObjectUUID = this.attributes.targetObject as string;
        } else {
            // For behavior type, targetObjectBehaviors is an object with object and behaviors
            const targetObjectData = this.attributes.targetObjectBehaviors as TargetObjectBehaviors;
            if (!targetObjectData || !targetObjectData.object) {
                console.warn("EnableDisableBehavior: No target object specified");
                return;
            }
            targetObjectUUID = targetObjectData.object;
            targetBehaviors = targetObjectData.behaviors || [];
        }

        if (!targetObjectUUID) {
            console.warn("EnableDisableBehavior: No target object specified");
            return;
        }

        // Get the target object
        const targetObject = this.getObjectByUUID(targetObjectUUID);
        if (!targetObject) {
            console.warn(`EnableDisableBehavior: Target object with UUID ${targetObjectUUID} not found`);
            return;
        }

        if (targetType === TARGET_TYPE.GAME_OBJECT) {
            // Enable/Disable the entire game object
            this.toggleGameObject(targetObject, action);
        } else if (targetType === TARGET_TYPE.BEHAVIOR) {
            // Enable/Disable specific behaviors
            this.toggleBehaviors(targetObject, targetBehaviors, action);
        }
    }

    private toggleGameObject(object: THREE.Object3D, action: ACTION_TYPE): void {
        const currentlyEnabled = this.isObjectEnabled(object);
        let shouldEnable: boolean;

        switch (action) {
            case ACTION_TYPE.ENABLE:
                shouldEnable = true;
                break;
            case ACTION_TYPE.DISABLE:
                shouldEnable = false;
                break;
            case ACTION_TYPE.TOGGLE:
                shouldEnable = !currentlyEnabled;
                break;
            default:
                console.warn(`EnableDisableBehavior: Unknown action type ${String(action)}`);
                return;
        }

        if (shouldEnable) {
            this.enableObject(object);
        } else {
            this.disableObject(object);
        }
    }

    private toggleBehaviors(object: THREE.Object3D, behaviorUUIDs: string[], action: ACTION_TYPE): void {
        if (!behaviorUUIDs || behaviorUUIDs.length === 0) {
            console.warn("EnableDisableBehavior: No target behaviors specified");
            return;
        }

        const behaviorManager = this.game?.behaviorManager;
        if (!behaviorManager) {
            console.warn("EnableDisableBehavior: BehaviorManager not found");
            return;
        }

        behaviorUUIDs.forEach(behaviorUUID => {
            const behavior = behaviorManager.getBehaviorByUUID(behaviorUUID);
            if (!behavior) {
                console.warn(`EnableDisableBehavior: Behavior with UUID ${behaviorUUID} not found`);
                return;
            }

            const currentlyEnabled = !behavior.isPaused;
            let shouldEnable: boolean;

            switch (action) {
                case ACTION_TYPE.ENABLE:
                    shouldEnable = true;
                    break;
                case ACTION_TYPE.DISABLE:
                    shouldEnable = false;
                    break;
                case ACTION_TYPE.TOGGLE:
                    shouldEnable = !currentlyEnabled;
                    break;
                default:
                    console.warn(`EnableDisableBehavior: Unknown action type ${String(action)}`);
                    return;
            }

            if (shouldEnable) {
                behaviorManager.resumeBehavior(behavior);
            } else {
                behaviorManager.pauseBehavior(behavior);
            }
        });
    }

    private isObjectEnabled(object: THREE.Object3D): boolean {
        // Check if object is enabled based on its visibility and userData
        return !object.userData.paused;
    }

    private enableObject(object: THREE.Object3D): void {
        if (this.game) {
            this.game.resumeObject(object, true); // true = resume children as well
        }
    }

    private disableObject(object: THREE.Object3D): void {
        if (this.game) {
            this.game.pauseObject(object, true); // true = pause children as well
        }
    }

    private getObjectByUUID(uuid: string): THREE.Object3D | null {
        const object = this.game?.getObjectByUUID(uuid);
        if (!object) {
            return null;
        }
        return object;
    }
}

export default EnableDisableBehavior;

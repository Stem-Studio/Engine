import * as THREE from "three";
import {Object3D} from "three";

import GameManager from "src/behaviors/game/GameManager";

import type { LambdaComponentData, LambdaInstanceData } from "../../../lambdas/Lambda";
import { TRIGGER_ACTIVATION_TYPES } from "@stem/editor-oss/types/editor";
import { setManagedTimeout, clearManagedTimeout } from "@stem/editor-oss/utils/ModeExitCleaner";
import { BehaviorBase } from "../../Behavior";
import RangeDetector from "../../range/RangeDetector";

const isPromiseLike = <T = unknown>(value: unknown): value is PromiseLike<T> =>
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as {then?: unknown}).then === "function";

interface IfCondition {
    conditionType: TRIGGER_ACTIVATION_TYPES;
    objectUUID?: string; // only set when object_touches is selected
    inputKey?: string;
    timerSeconds?: number;
    distanceObjectUUID?: string;
    distanceOperator?: "lt" | "gt";
    distanceValue?: number;
    metadataScope?: "self" | "player" | "object";
    metadataObjectUUID?: string;
    metadataKey?: "tag" | "team" | "faction";
    metadataValue?: string;
    variableScope?: "store";
    variablePath?: string;
    variableOperator?: "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
    variableValue?: any;
    behaviorObjectUUID?: string;
    behaviorIdentifier?: string;
    behaviorState?: "enabled" | "disabled" | "running";
    animationEventScope?: "self" | "player" | "object";
    animationEventObjectUUID?: string;
    animationEventName?: string;
    lineOfSightObjectUUID?: string;
    lineOfSightMaxDistance?: number;
    chancePercent?: number;
    cooldownSeconds?: number;
    interactTargetUUID?: string;
    interactInputKey?: string;
    interactMaxDistance?: number;
    stateObjectUUID?: string;
    stateKey?: "visible" | "active" | "destroyed" | "custom_state";
    stateOperator?: "eq" | "neq";
    stateValue?: any;
    timeSource?: "scene" | "system";
    timeStartHour?: number;
    timeEndHour?: number;
    multiplayerRole?: "host" | "local_player" | "team";
    multiplayerTeamValue?: string;
    physicsObjectUUID?: string;
    physicsEventType?: "enter" | "exit";
    physicsMinImpact?: number;
    aiTargetScope?: "player" | "object";
    aiObjectUUID?: string;
    aiRange?: number;
    aiFovDegrees?: number;
}

enum ACTION_TYPE {
    ACTIVATE = "activate",
    DEACTIVATE = "deactivate",
    APPLY_LAMBDA = "apply_lambda",
    APPLY_BEHAVIOR = "apply_behavior",
    SET_ATTRIBUTE = "set_attribute",
    SEND_EVENT = "send_event",
}

enum CONDITIONS_RESULT {
    ALL = "all",
    NONE = "none"
}

interface ObjectBehaviors {
    object: string; // object uuid to which the behaviors are attached
    behaviors: string[]; // uuids of activated behaviors
}

interface ThenStep {
    thenType: ACTION_TYPE;
    then_lambda?: ObjectBehaviors;
    then_behavior?: ObjectBehaviors;
    attributeKey?: string;
    attributeValue?: any;
    eventName?: string;
    eventData?: any;
    delay?: number;
}

class TriggerBehavior extends BehaviorBase {
    protected game: GameManager | null = null;
    rangeDetector: RangeDetector | null = null;
    private collisionDetector: any = null;
    private triggers: any[] = []; // Store all triggers defined for this behavior
    private activatedTriggers: Set<string> = new Set(); // Track which triggers have been activated

    private boundsAuxA: THREE.Box3 = new THREE.Box3();
    private boundsAuxB: THREE.Box3 = new THREE.Box3();

    private timeouts: ReturnType<typeof setTimeout>[] = [];
    private previousCondResult: CONDITIONS_RESULT = CONDITIONS_RESULT.NONE;
    private elapsedTimeSec: number = 0;
    private currentPlayerInside: boolean = false;
    private previousPlayerInside: boolean = false;
    private hasInteractRangeDetector: boolean = false;
    private lastTriggeredAtMs: number = 0;
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private raycastHits: THREE.Intersection[] = [];
    private scratchPositionA: THREE.Vector3 = new THREE.Vector3();
    private scratchPositionB: THREE.Vector3 = new THREE.Vector3();
    private scratchDirection: THREE.Vector3 = new THREE.Vector3();
    private scratchForward: THREE.Vector3 = new THREE.Vector3();
    private collisionStateByObject: Map<string, boolean> = new Map();

    init(gameManager: GameManager): void {
        this.game = gameManager;
        this.rangeDetector = new RangeDetector(gameManager);
        this.migrateLegacyAttributes();
    }

    private migrateLegacyAttributes(): void {
        if (this.attributes.if_operator !== "or") {
            this.attributes.if_operator = "and";
        }

        if (!this.attributes.then_steps || !Array.isArray(this.attributes.then_steps)) {
            if (this.attributes.thenType || this.attributes.then_lambda || this.attributes.then_behavior) {
                this.attributes.then_steps = [{
                    thenType: this.attributes.thenType || ACTION_TYPE.ACTIVATE,
                    then_lambda: this.attributes.then_lambda,
                    then_behavior: this.attributes.then_behavior,
                    delay: this.attributes.delay || 0,
                }];
            } else {
                this.attributes.then_steps = [];
            }
        }
        // ELSE branch support has been removed.
        delete this.attributes.else_steps;
        delete this.attributes.else_condition;
        delete this.attributes.else_activate;
        delete this.attributes.elseType;
        delete this.attributes.else_object;
        delete this.attributes.else_behaviors_on_trigger;
        // Legacy target mapping fields are no longer used by trigger steps.
        delete this.attributes.then_object;
        delete this.attributes.targetType;
    }

    onAdded(): void {
        this.addRangeDetector();
    }

    onRemoved(): void {
    }

    update(delta: number): void {
        // Guard: don't run if game/scene is not ready yet
        if (!this.game?.scene) {
            return;
        }

        if (this.hasInteractRangeDetector) {
            this.rangeDetector!.update();
        }
        this.elapsedTimeSec += delta;
        this.currentPlayerInside = this.isPlayerTouching();
        const conditionsMet = this.checkConditions(this.attributes.if_condition);

        if (conditionsMet === this.previousCondResult) {
            this.previousPlayerInside = this.currentPlayerInside;
            return;
        }

        this.previousCondResult = conditionsMet;

        if (conditionsMet === CONDITIONS_RESULT.ALL) {
            this.triggerAction();
        }

        this.previousPlayerInside = this.currentPlayerInside;
    }

    onReset(): void {
        this.previousCondResult = CONDITIONS_RESULT.NONE;
        this.elapsedTimeSec = 0;
        this.currentPlayerInside = false;
        this.previousPlayerInside = false;
        this.collisionStateByObject.clear();
        this.timeouts.forEach(timeout => clearManagedTimeout(timeout as any));
        this.timeouts = [];
    }

    // can be triggered by other triggers
    onEvent(msg: string): void {
        if (msg === "trigger") {
            this.triggerAction();
        }
    }

    private addRangeDetector() {
        const conditions = this.attributes.if_condition;
        let found = false;
        let interactionText;
        for (const condition of conditions) {
            if (condition.conditionType === TRIGGER_ACTIVATION_TYPES.PRESS_E) {
                interactionText = condition.interactionText || 'To Interact';
                found = true;
                break;
            }
        }

        if (!found) {
            this.hasInteractRangeDetector = false;
            return;
        }

        this.rangeDetector?.setPlayer(this.game!.player!);
        this.rangeDetector?.setTarget(this.target);
        this.rangeDetector?.setKeyText('E');
        this.rangeDetector?.setText(interactionText);
        this.hasInteractRangeDetector = true;
    }

    private checkConditions(conditions: IfCondition[]): CONDITIONS_RESULT {
        if (!Array.isArray(conditions) || conditions.length === 0) {
            return CONDITIONS_RESULT.ALL;
        }

        const ifOperator = this.attributes.if_operator === "or" ? "or" : "and";
        let conditionsMet = 0;
        for (let index = 0; index < conditions.length; index++) {
            const conditionMet = this.isConditionMet(conditions[index]!);
            if (conditionMet) {
                conditionsMet++;
                if (ifOperator === "or") {
                    this.evaluateRemainingStatefulConditions(conditions, index + 1);
                    return CONDITIONS_RESULT.ALL;
                }
            } else if (ifOperator === "and") {
                this.evaluateRemainingStatefulConditions(conditions, index + 1);
                return CONDITIONS_RESULT.NONE;
            }
        }

        return ifOperator === "and" && conditionsMet === conditions.length
            ? CONDITIONS_RESULT.ALL
            : CONDITIONS_RESULT.NONE;
    }

    private evaluateRemainingStatefulConditions(conditions: IfCondition[], startIndex: number): void {
        for (let index = startIndex; index < conditions.length; index++) {
            const condition = conditions[index]!;
            if (this.isStatefulCondition(condition)) {
                this.isConditionMet(condition);
            }
        }
    }

    private isStatefulCondition(condition: IfCondition): boolean {
        return (
            condition.conditionType === TRIGGER_ACTIVATION_TYPES.PHYSICS_COLLISION_EVENT ||
            condition.conditionType === TRIGGER_ACTIVATION_TYPES.RANDOM_CHANCE
        );
    }

    private isConditionMet(condition: IfCondition): boolean {
        switch (condition.conditionType) {
            case TRIGGER_ACTIVATION_TYPES.PLAYER_TOUCHES:
            case TRIGGER_ACTIVATION_TYPES.WHILE_INSIDE:
                return this.currentPlayerInside;
            case TRIGGER_ACTIVATION_TYPES.OBJECT_TOUCHES: {
                const object = this.getObjectByUUID(condition.objectUUID!);
                return !!object && this.isCollide(object);
            }
            case TRIGGER_ACTIVATION_TYPES.PRESS_E:
                return this.currentPlayerInside && this.isEPressed();
            case TRIGGER_ACTIVATION_TYPES.PRESS_F:
                return this.currentPlayerInside && this.isFPressed();
            case TRIGGER_ACTIVATION_TYPES.ON_ENTER:
                return !this.previousPlayerInside && this.currentPlayerInside;
            case TRIGGER_ACTIVATION_TYPES.ON_EXIT:
                return this.previousPlayerInside && !this.currentPlayerInside;
            case TRIGGER_ACTIVATION_TYPES.KEY_BUTTON_PRESSED:
                return this.currentPlayerInside && this.isInputPressed(condition.inputKey);
            case TRIGGER_ACTIVATION_TYPES.TIMER_ELAPSED:
                return this.elapsedTimeSec >= Math.max(0, Number(condition.timerSeconds) || 0);
            case TRIGGER_ACTIVATION_TYPES.DISTANCE_COMPARE:
                return this.isDistanceConditionMet(condition);
            case TRIGGER_ACTIVATION_TYPES.HAS_TAG_TEAM_FACTION:
                return this.isMetadataConditionMet(condition);
            case TRIGGER_ACTIVATION_TYPES.VARIABLE_COMPARE:
                return this.isVariableCompareConditionMet(condition);
            case TRIGGER_ACTIVATION_TYPES.BEHAVIOR_STATE:
                return this.isBehaviorStateConditionMet(condition);
            case TRIGGER_ACTIVATION_TYPES.ANIMATION_EVENT_REACHED:
                return this.isAnimationEventConditionMet(condition);
            case TRIGGER_ACTIVATION_TYPES.LINE_OF_SIGHT:
                return this.hasLineOfSight(condition);
            case TRIGGER_ACTIVATION_TYPES.RANDOM_CHANCE:
                return this.isRandomChanceMet(condition.chancePercent);
            case TRIGGER_ACTIVATION_TYPES.COOLDOWN_READY:
                return this.isCooldownReady(condition.cooldownSeconds);
            case TRIGGER_ACTIVATION_TYPES.ON_INTERACT:
                return this.isOnInteractConditionMet(condition);
            case TRIGGER_ACTIVATION_TYPES.OBJECT_STATE_COMPARE:
                return this.isObjectStateCompareMet(condition);
            case TRIGGER_ACTIVATION_TYPES.TIME_WINDOW:
                return this.isTimeWindowConditionMet(condition);
            case TRIGGER_ACTIVATION_TYPES.MULTIPLAYER_ROLE:
                return this.isMultiplayerRoleConditionMet(condition);
            case TRIGGER_ACTIVATION_TYPES.PHYSICS_COLLISION_EVENT:
                return this.isPhysicsCollisionEventMet(condition);
            case TRIGGER_ACTIVATION_TYPES.AI_PROXIMITY:
                return this.isAiProximityConditionMet(condition);
            default:
                return false;
        }
    }

    private triggerAction(): void {
        const steps: ThenStep[] = this.attributes.then_steps;
        if (!steps || !Array.isArray(steps)) return;

        for (const step of steps) {
            const delay = step.delay || 0;
            if (!step.thenType) continue;

            if (step.thenType === ACTION_TYPE.APPLY_BEHAVIOR) {
                const behaviorTarget = step.then_behavior || this.getImplicitBehaviorTarget();
                if (!behaviorTarget) continue;

                if (delay > 0) {
                    const timeoutId = setManagedTimeout(() => {
                        this.applyActionToBehaviors(behaviorTarget, ACTION_TYPE.ACTIVATE);
                        this.timeouts = this.timeouts.filter(t => t !== timeoutId);
                    }, delay * 1000);
                    this.timeouts.push(timeoutId);
                } else {
                    this.applyActionToBehaviors(behaviorTarget, ACTION_TYPE.ACTIVATE);
                }
                continue;
            }

            const lambdaTarget = step.then_lambda || this.getImplicitLambdaTarget();
            if (!lambdaTarget) continue;

            if (delay > 0) {
                const timeoutId = setManagedTimeout(() => {
                    this.applyActionToLambdas(lambdaTarget, step);
                    this.timeouts = this.timeouts.filter(t => t !== timeoutId);
                }, delay * 1000);
                this.timeouts.push(timeoutId);
            } else {
                this.applyActionToLambdas(lambdaTarget, step);
            }
        }
        this.lastTriggeredAtMs = Date.now();
    }

    private getImplicitLambdaTarget(): ObjectBehaviors | null {
        const components = Array.isArray(this.target.userData?.lambdaComponents)
            ? (this.target.userData.lambdaComponents as LambdaComponentData[])
            : [];

        if (components.length === 0) {
            return null;
        }

        return {
            object: this.target.uuid,
            behaviors: components.map(component => `component:${component.uuid}`),
        };
    }

    private getImplicitBehaviorTarget(): ObjectBehaviors | null {
        const behaviors = Array.isArray(this.target.userData?.behaviors)
            ? this.target.userData.behaviors
            : [];

        const selected = behaviors
            .filter((behavior: any) => behavior?.attributesData?.startOnTrigger === true)
            .map((behavior: any) => behavior.uuid)
            .filter(Boolean);

        if (selected.length === 0) {
            return null;
        }

        return {
            object: this.target.uuid,
            behaviors: selected,
        };
    }

    private getBehaviorsForSelection(targetObject: Object3D, behaviorTargets: ObjectBehaviors): BehaviorBase[] {
        const behaviorManager = this.game?.behaviorManager;
        if (!behaviorManager) {
            return [];
        }

        const selected = new Set(Array.isArray(behaviorTargets.behaviors) ? behaviorTargets.behaviors : []);
        const objectBehaviors = Array.isArray(targetObject.userData?.behaviors) ? targetObject.userData.behaviors : [];
        const resolved: BehaviorBase[] = [];
        const seen = new Set<string>();

        const pushByUUID = (uuid: string) => {
            const runtimeBehavior = behaviorManager.getBehaviorByUUID(uuid) as BehaviorBase | null;
            if (!runtimeBehavior || seen.has(runtimeBehavior.uuid)) return;
            seen.add(runtimeBehavior.uuid);
            resolved.push(runtimeBehavior);
        };

        for (const entry of selected) {
            if (!entry || typeof entry !== "string") continue;

            if (entry.startsWith("behavior:")) {
                const uuid = entry.slice("behavior:".length);
                if (uuid) pushByUUID(uuid);
                continue;
            }

            const byUUID = objectBehaviors.find((behavior: any) => behavior?.uuid === entry);
            if (byUUID?.uuid) {
                pushByUUID(byUUID.uuid);
                continue;
            }

            // Backward compatibility: allow selecting by behavior id.
            const byId = objectBehaviors.find((behavior: any) => behavior?.id === entry);
            if (byId?.uuid) {
                pushByUUID(byId.uuid);
            }
        }

        return resolved;
    }

    private applyActionToBehaviors(behaviorTargets: ObjectBehaviors, actionType: ACTION_TYPE): void {
        if (!this.game) {
            return;
        }

        const targetObject = behaviorTargets.object
            ? this.game.getObjectByUUID(behaviorTargets.object)
            : this.target;
        if (!targetObject) {
            return;
        }

        const runtimeBehaviors = this.getBehaviorsForSelection(targetObject, behaviorTargets);
        if (runtimeBehaviors.length === 0) {
            return;
        }

        for (const behavior of runtimeBehaviors) {
            if (behavior.attributes?.startOnTrigger !== true) {
                continue;
            }
            const result: any = behavior.onEvent("trigger", {
                object: this.target,
                actionType,
                trigger: this,
            });
            if (isPromiseLike(result)) {
                void Promise.resolve(result).catch(error => {
                    console.error(`[TriggerBehavior] Error during behavior onEvent for "${behavior.id}":`, error);
                });
            }
        }
    }

    private parseLooseValue(value: any): any {
        if (typeof value !== "string") {
            return value;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return "";
        }

        if (trimmed === "true") return true;
        if (trimmed === "false") return false;
        if (trimmed === "null") return null;
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            return Number(trimmed);
        }

        try {
            return JSON.parse(trimmed);
        } catch {
            return value;
        }
    }

    private getOrCreateLambdaDefaults(lambdaId: string): Record<string, any> {
        const defaults: Record<string, any> = {};
        const schema = this.game?.lambdaManager?.getConfig(lambdaId)?.componentSchema;
        if (!schema) {
            return defaults;
        }

        for (const [key, field] of Object.entries(schema)) {
            if (field && typeof field === "object" && "default" in field) {
                defaults[key] = (field as any).default;
            }
        }

        return defaults;
    }

    private getDefaultsForInstance(instanceId: string): Record<string, any> {
        const lambdaManager = this.game?.lambdaManager;
        if (!lambdaManager) {
            return {};
        }
        const instance = lambdaManager.getInstance(instanceId);
        if (!instance) {
            return {};
        }
        return this.getOrCreateLambdaDefaults(instance.id);
    }

    private getSceneLambdaInstances(): LambdaInstanceData[] {
        const scene = this.game?.scene;
        if (!scene || !Array.isArray(scene.userData?.lambdaInstances)) {
            return [];
        }
        return scene.userData.lambdaInstances as LambdaInstanceData[];
    }

    private getInstancesForSelection(
        targetObject: Object3D,
        lambdaTargets: ObjectBehaviors,
    ): { components: LambdaComponentData[]; instanceIds: string[]; lambdaIds: string[] } {
        const selected = new Set(lambdaTargets.behaviors || []);
        const targetComponents = Array.isArray(targetObject.userData?.lambdaComponents)
            ? (targetObject.userData.lambdaComponents as LambdaComponentData[])
            : [];
        const sceneInstances = this.getSceneLambdaInstances();

        const selectedComponents: LambdaComponentData[] = [];
        const selectedComponentUUIDs = new Set<string>();
        const selectedInstanceIds = new Set<string>();
        const selectedLambdaIds = new Set<string>();

        for (const entry of selected) {
            if (entry.startsWith("component:")) {
                const componentUUID = entry.slice("component:".length);
                const component = targetComponents.find(el => el.uuid === componentUUID);
                if (component) {
                    if (!selectedComponentUUIDs.has(component.uuid)) {
                        selectedComponents.push(component);
                        selectedComponentUUIDs.add(component.uuid);
                    }
                    selectedInstanceIds.add(component.instanceId);
                }
                continue;
            }

            if (entry.startsWith("instance:")) {
                const instanceId = entry.slice("instance:".length);
                if (instanceId) {
                    selectedInstanceIds.add(instanceId);
                }
                continue;
            }

            if (entry.startsWith("lambda:")) {
                const lambdaId = entry.slice("lambda:".length);
                if (lambdaId) {
                    selectedLambdaIds.add(lambdaId);
                }
                continue;
            }

            // Backward compatibility for old saved data:
            // plain component UUID, instance ID, or lambda ID.
            const component = targetComponents.find(el => el.uuid === entry || el.lambdaId === entry);
            if (component) {
                if (!selectedComponentUUIDs.has(component.uuid)) {
                    selectedComponents.push(component);
                    selectedComponentUUIDs.add(component.uuid);
                }
                selectedInstanceIds.add(component.instanceId);
                continue;
            }

            const sceneInstance = sceneInstances.find(el => el.instanceId === entry || el.lambdaId === entry);
            if (sceneInstance) {
                selectedInstanceIds.add(sceneInstance.instanceId);
                continue;
            }

            if (entry) {
                selectedLambdaIds.add(entry);
            }
        }

        return {
            components: selectedComponents,
            instanceIds: Array.from(selectedInstanceIds),
            lambdaIds: Array.from(selectedLambdaIds),
        };
    }

    private ensureLambdaInstance(lambdaId: string, onReady: (instanceId: string) => void): void {
        const lambdaManager = this.game?.lambdaManager;
        if (!lambdaManager) {
            return;
        }

        const existing = lambdaManager.getInstancesByType(lambdaId)[0];
        if (existing) {
            onReady(existing.uuid);
            return;
        }

        void lambdaManager.createInstance(lambdaId).then(instance => {
            if (!instance) {
                return;
            }
            onReady(instance.uuid);
        });
    }

    private emitEventToLambdaInstances(
        instanceIds: string[],
        eventName: string,
        payload: Record<string, any>,
    ): void {
        const lambdaManager = this.game?.lambdaManager;
        if (!lambdaManager) {
            return;
        }

        for (const instanceId of instanceIds) {
            const instance = lambdaManager.getInstance(instanceId);
            if (!instance) {
                continue;
            }
            const result: any = instance.onEvent(eventName, payload);
            if (isPromiseLike(result)) {
                void Promise.resolve(result).catch(error => {
                    console.error(`[TriggerBehavior] Error during lambda onEvent for "${instanceId}":`, error);
                });
            }
        }
    }

    private applyActionToLambdas(lambdaTargets: ObjectBehaviors, step: ThenStep): void {
        const lambdaManager = this.game?.lambdaManager;
        if (!this.game || !lambdaManager) {
            return;
        }

        const targetObject = lambdaTargets.object
            ? this.game.getObjectByUUID(lambdaTargets.object)
            : this.target;

        if (!targetObject) {
            return;
        }

        const {
            components: targetComponents,
            instanceIds: selectedInstanceIds,
            lambdaIds: selectedLambdaIds,
        } = this.getInstancesForSelection(
            targetObject,
            lambdaTargets,
        );
        if (targetComponents.length === 0 && selectedLambdaIds.length === 0 && selectedInstanceIds.length === 0) {
            return;
        }

        const actionType = step.thenType;

        if (actionType === ACTION_TYPE.APPLY_LAMBDA) {
            const instanceIdsToApply = new Set<string>();

            for (const component of targetComponents) {
                const instance = lambdaManager.getInstance(component.instanceId);
                if (!instance) {
                    continue;
                }
                if (!component.enabled) {
                    component.enabled = true;
                }
                lambdaManager.registerObject(component.instanceId, targetObject, component.componentData);
                instanceIdsToApply.add(component.instanceId);
            }

            for (const instanceId of selectedInstanceIds) {
                lambdaManager.registerObject(instanceId, targetObject, this.getDefaultsForInstance(instanceId));
                instanceIdsToApply.add(instanceId);
            }

            for (const lambdaId of selectedLambdaIds) {
                this.ensureLambdaInstance(lambdaId, instanceId => {
                    const defaults = this.getOrCreateLambdaDefaults(lambdaId);
                    lambdaManager.registerObject(instanceId, targetObject, defaults);
                    const instance = lambdaManager.getInstance(instanceId);
                    instance?.apply(0.016);
                });
            }

            for (const instanceId of instanceIdsToApply) {
                const instance = lambdaManager.getInstance(instanceId);
                instance?.apply(0.016);
            }
            return;
        }

        if (actionType === ACTION_TYPE.SET_ATTRIBUTE) {
            const key = (step.attributeKey || "").trim();
            if (!key) {
                return;
            }
            const parsedValue = this.parseLooseValue(step.attributeValue);
            for (const component of targetComponents) {
                component.componentData[key] = parsedValue;
                lambdaManager.setObjectComponentData(component.instanceId, targetObject, key, parsedValue);
            }
            for (const instanceId of selectedInstanceIds) {
                lambdaManager.registerObject(instanceId, targetObject, this.getDefaultsForInstance(instanceId));
                lambdaManager.setObjectComponentData(instanceId, targetObject, key, parsedValue);
            }
            for (const lambdaId of selectedLambdaIds) {
                this.ensureLambdaInstance(lambdaId, instanceId => {
                    const defaults = this.getOrCreateLambdaDefaults(lambdaId);
                    defaults[key] = parsedValue;
                    lambdaManager.registerObject(instanceId, targetObject, defaults);
                    lambdaManager.setObjectComponentData(instanceId, targetObject, key, parsedValue);
                });
            }
            return;
        }

        if (actionType === ACTION_TYPE.SEND_EVENT) {
            const eventName = (step.eventName || "").trim();
            if (!eventName) {
                return;
            }
            const parsedPayload = this.parseLooseValue(step.eventData);
            const allInstanceIds = new Set<string>(selectedInstanceIds);
            for (const component of targetComponents) {
                allInstanceIds.add(component.instanceId);
            }
            for (const lambdaId of selectedLambdaIds) {
                for (const instance of lambdaManager.getInstancesByType(lambdaId)) {
                    allInstanceIds.add(instance.uuid);
                }
            }
            this.emitEventToLambdaInstances(Array.from(allInstanceIds), eventName, {
                object: this.target,
                eventData: parsedPayload,
                trigger: this,
            });
            return;
        }

        for (const component of targetComponents) {
            if (actionType === ACTION_TYPE.ACTIVATE) {
                if (!component.enabled) {
                    component.enabled = true;
                    lambdaManager.registerObject(component.instanceId, targetObject, component.componentData);
                }
            } else {
                if (component.enabled) {
                    component.enabled = false;
                    lambdaManager.deregisterObject(component.instanceId, targetObject);
                }
            }
        }

        for (const lambdaId of selectedLambdaIds) {
            this.ensureLambdaInstance(lambdaId, instanceId => {
                if (actionType === ACTION_TYPE.ACTIVATE) {
                    lambdaManager.registerObject(instanceId, targetObject, this.getOrCreateLambdaDefaults(lambdaId));
                } else if (actionType === ACTION_TYPE.DEACTIVATE) {
                    lambdaManager.deregisterObject(instanceId, targetObject);
                }
            });
        }

        const triggerInstanceIds = new Set<string>(selectedInstanceIds);
        for (const component of targetComponents) {
            triggerInstanceIds.add(component.instanceId);
        }
        this.emitEventToLambdaInstances(Array.from(triggerInstanceIds), "trigger", {
            object: this.target,
            actionType,
            trigger: this,
        });
    }

    private isPlayerTouching(): boolean {
        const player = this.game?.player;
        if (!player) {
            console.warn("Player not found");
            return false;
        }

        return this.isCollide(player);
    }

    private getObjectByUUID(uuid: string): Object3D | null {
        if (!uuid) {
            return null;
        }
        const object = this.game?.getObjectByUUID(uuid);
        if (!object) {
            console.warn(`Object with UUID ${uuid} not found`);
            return null;
        }
        return object;
    }

    private isSameOrDescendantOf(object: Object3D | null | undefined, ancestor: Object3D | null | undefined): boolean {
        if (!object || !ancestor) {
            return false;
        }

        let current: Object3D | null = object;
        while (current) {
            if (current === ancestor) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    private isObjectInScene(object: Object3D): boolean {
        return this.isSameOrDescendantOf(object, this.game?.scene);
    }

    private isCollide(object: Object3D): boolean {
        this.boundsAuxA.setFromObject(this.target);
        this.boundsAuxB.setFromObject(object);
        return this.boundsAuxA.intersectsBox(this.boundsAuxB);
    }

    private isEPressed(): boolean {
        // Scene is guaranteed to exist due to guard in update()
        return this.game!.scene.userData.pressE === true || this.game?.player?.userData?.pressE === true;
    }

    private isFPressed(): boolean {
        return this.game!.scene.userData.pressF === true || this.game?.player?.userData?.pressF === true;
    }

    private isInputPressed(inputKey?: string): boolean {
        const key = String(inputKey || "e").toLowerCase();
        if (key === "e") return this.isEPressed();
        if (key === "f") return this.isFPressed();

        const sceneUserData = this.game?.scene?.userData || {};
        if (key === "mouse_left") {
            return sceneUserData.mouseLeftClick === true || sceneUserData.mouseClick === true;
        }
        if (key === "controller_a") {
            return sceneUserData.controllerA === true;
        }
        return false;
    }

    private isDistanceConditionMet(condition: IfCondition): boolean {
        const object = this.getObjectByUUID(condition.distanceObjectUUID || "");
        if (!object) {
            return false;
        }

        const targetPos = this.target.getWorldPosition(this.scratchPositionA);
        const objectPos = object.getWorldPosition(this.scratchPositionB);
        const threshold = Number(condition.distanceValue) || 0;
        if (threshold < 0) {
            return condition.distanceOperator === "gt";
        }

        const distanceSq = targetPos.distanceToSquared(objectPos);
        const thresholdSq = threshold * threshold;

        return condition.distanceOperator === "gt"
            ? distanceSq > thresholdSq
            : distanceSq < thresholdSq;
    }

    private getObjectByScope(scope: "self" | "player" | "object" | undefined, objectUUID?: string): Object3D | null {
        if (scope === "player") {
            return this.game?.player || null;
        }
        if (scope === "object") {
            return this.getObjectByUUID(objectUUID || "");
        }
        return this.target;
    }

    private isMetadataConditionMet(condition: IfCondition): boolean {
        const object = this.getObjectByScope(condition.metadataScope, condition.metadataObjectUUID);
        if (!object) {
            return false;
        }

        const key = condition.metadataKey || "tag";
        const expected = String(condition.metadataValue || "").trim();
        const userData = object.userData || {};

        if (key === "tag") {
            return this.hasTagValue(userData.tags, expected);
        }

        return String(userData[key] || "") === expected;
    }

    private hasTagValue(tags: unknown, expected: string): boolean {
        if (Array.isArray(tags)) {
            for (const tag of tags) {
                if (String(tag) === expected) {
                    return true;
                }
            }
            return false;
        }

        if (typeof tags !== "string") {
            return false;
        }

        let tokenStart = 0;
        for (let index = 0; index <= tags.length; index++) {
            if (index !== tags.length && tags.charCodeAt(index) !== 44) {
                continue;
            }
            if (tags.slice(tokenStart, index).trim() === expected) {
                return true;
            }
            tokenStart = index + 1;
        }
        return false;
    }

    private getStoreVariableValue(path?: string): any {
        const key = String(path || "").trim();
        return key ? this.erth.store.get(key) : undefined;
    }

    private compareValues(left: any, operator: string, right: any): boolean {
        switch (operator) {
            case "eq":
                return left === right;
            case "neq":
                return left !== right;
            case "lt":
                return Number(left) < Number(right);
            case "lte":
                return Number(left) <= Number(right);
            case "gt":
                return Number(left) > Number(right);
            case "gte":
                return Number(left) >= Number(right);
            default:
                return false;
        }
    }

    private isVariableCompareConditionMet(condition: IfCondition): boolean {
        const currentValue = this.getStoreVariableValue(condition.variablePath);
        const expected = this.parseLooseValue(condition.variableValue);
        const operator = condition.variableOperator || "eq";
        return this.compareValues(currentValue, operator, expected);
    }

    private isBehaviorStateConditionMet(condition: IfCondition): boolean {
        const object = this.getObjectByUUID(condition.behaviorObjectUUID || "") || this.target;
        const behaviorIdentifier = String(condition.behaviorIdentifier || "").trim();
        if (!object || !behaviorIdentifier) {
            return false;
        }
        const behaviors = Array.isArray(object.userData?.behaviors) ? object.userData.behaviors : [];
        const behavior = behaviors.find((item: any) => item.uuid === behaviorIdentifier || item.id === behaviorIdentifier);
        if (!behavior) {
            return false;
        }
        const state = condition.behaviorState || "enabled";
        if (state === "disabled") {
            return behavior.enabled === false;
        }
        return behavior.enabled === true;
    }

    private isAnimationEventConditionMet(condition: IfCondition): boolean {
        const object = this.getObjectByScope(condition.animationEventScope, condition.animationEventObjectUUID);
        const expected = String(condition.animationEventName || "").trim();
        if (!object || !expected) {
            return false;
        }
        return String(object.userData?.lastAnimationEvent || "") === expected;
    }

    private hasLineOfSight(condition: IfCondition): boolean {
        const object = this.getObjectByUUID(condition.lineOfSightObjectUUID || "");
        if (!object || !this.game?.scene) {
            return false;
        }

        const source = this.target.getWorldPosition(this.scratchPositionA);
        const destination = object.getWorldPosition(this.scratchPositionB);
        const direction = this.scratchDirection.subVectors(destination, source);
        const distance = direction.length();
        if (distance <= 0) {
            return true;
        }

        const maxDistance = Number(condition.lineOfSightMaxDistance);
        if (Number.isFinite(maxDistance) && maxDistance > 0 && distance > maxDistance) {
            return false;
        }

        this.raycaster.set(source, direction.normalize());
        this.raycaster.far = distance;
        const hits = this.raycastHits;
        hits.length = 0;
        this.raycaster.intersectObjects(this.game.scene.children, true, hits);
        let firstHit: THREE.Intersection | undefined;
        for (const hit of hits) {
            if (!this.isSameOrDescendantOf(hit.object, this.target)) {
                firstHit = hit;
                break;
            }
        }

        if (!firstHit) {
            hits.length = 0;
            return true;
        }

        const hasSight = this.isSameOrDescendantOf(firstHit.object, object);
        hits.length = 0;
        return hasSight;
    }

    private isRandomChanceMet(chancePercent?: number): boolean {
        const clamped = Math.max(0, Math.min(100, Number(chancePercent) || 0));
        if (clamped === 0) {
            return false;
        }
        return Math.random() * 100 <= clamped;
    }

    private isCooldownReady(cooldownSeconds?: number): boolean {
        const cooldown = Math.max(0, Number(cooldownSeconds) || 0);
        if (cooldown === 0) {
            return true;
        }
        if (this.lastTriggeredAtMs === 0) {
            return true;
        }
        return Date.now() - this.lastTriggeredAtMs >= cooldown * 1000;
    }

    private isOnInteractConditionMet(condition: IfCondition): boolean {
        if (!this.isInputPressed(condition.interactInputKey || "e")) {
            return false;
        }

        const targetObject = condition.interactTargetUUID
            ? this.getObjectByUUID(condition.interactTargetUUID)
            : this.target;
        if (!targetObject || !this.game?.scene) {
            return false;
        }

        const origin = this.scratchPositionA;
        if (this.game.camera) {
            this.game.camera.getWorldPosition(origin);
        } else if (this.game.player) {
            this.game.player.getWorldPosition(origin);
        } else {
            this.target.getWorldPosition(origin);
        }
        const direction = this.game.camera
            ? this.game.camera.getWorldDirection(this.scratchDirection)
            : this.target.getWorldDirection(this.scratchDirection);

        const maxDistance = Math.max(0.1, Number(condition.interactMaxDistance) || 5);
        this.raycaster.set(origin, direction.normalize());
        this.raycaster.far = maxDistance;

        const hits = this.raycastHits;
        hits.length = 0;
        this.raycaster.intersectObjects(this.game.scene.children, true, hits);
        const firstHit = hits[0];
        if (!firstHit) {
            hits.length = 0;
            return false;
        }
        const interacted = this.isSameOrDescendantOf(firstHit.object, targetObject);
        hits.length = 0;
        return interacted;
    }

    private isObjectStateCompareMet(condition: IfCondition): boolean {
        const object = condition.stateObjectUUID
            ? this.getObjectByUUID(condition.stateObjectUUID)
            : this.target;
        if (!object) {
            return false;
        }

        const key = condition.stateKey || "visible";
        const operator = condition.stateOperator || "eq";
        const parsedValue = this.parseLooseValue(condition.stateValue);
        let actualValue: any;

        if (key === "visible") {
            actualValue = object.visible;
        } else if (key === "active") {
            actualValue = this.isObjectInScene(object);
        } else if (key === "destroyed") {
            actualValue = object.userData?.destroyed === true || !this.isObjectInScene(object);
        } else {
            actualValue = object.userData?.state;
        }

        return operator === "neq"
            ? actualValue !== parsedValue
            : actualValue === parsedValue;
    }

    private getCurrentGameHour(condition: IfCondition): number {
        if (condition.timeSource === "system") {
            const now = new Date();
            return now.getHours() + now.getMinutes() / 60;
        }

        const sceneTime = this.game?.scene?.userData?.gameTimeHours;
        const altSceneTime = this.game?.scene?.userData?.timeOfDay;
        const value = Number(sceneTime ?? altSceneTime);
        if (Number.isFinite(value)) {
            return value;
        }

        const now = new Date();
        return now.getHours() + now.getMinutes() / 60;
    }

    private isTimeWindowConditionMet(condition: IfCondition): boolean {
        const currentHour = this.getCurrentGameHour(condition);
        const start = Math.max(0, Math.min(24, Number(condition.timeStartHour) || 0));
        const end = Math.max(0, Math.min(24, Number(condition.timeEndHour) || 24));

        if (start <= end) {
            return currentHour >= start && currentHour <= end;
        }
        // Wrapped overnight window (e.g. 22 -> 6)
        return currentHour >= start || currentHour <= end;
    }

    private isMultiplayerRoleConditionMet(condition: IfCondition): boolean {
        const role = condition.multiplayerRole || "host";
        const sceneData = this.game?.scene?.userData || {};
        const playerData = this.game?.player?.userData || {};

        if (role === "host") {
            return sceneData?.multiplayer?.isHost === true || sceneData?.isHost === true;
        }
        if (role === "local_player") {
            return playerData?.isLocalPlayer === true || playerData?.isLocal === true;
        }
        return String(playerData?.team ?? "") === String(condition.multiplayerTeamValue ?? "");
    }

    private getObjectVelocityMagnitude(object: Object3D | null): number {
        if (!object) {
            return 0;
        }
        const raw = object.userData?.velocity || object.userData?.physics?.velocity;
        if (!raw) {
            return 0;
        }
        if (raw.isVector3 && typeof raw.length === "function") {
            return raw.length();
        }
        if (typeof raw === "object") {
            const x = Number(raw.x) || 0;
            const y = Number(raw.y) || 0;
            const z = Number(raw.z) || 0;
            return Math.sqrt(x * x + y * y + z * z);
        }
        return 0;
    }

    private isPhysicsCollisionEventMet(condition: IfCondition): boolean {
        const other = this.getObjectByUUID(condition.physicsObjectUUID || "");
        if (!other) {
            return false;
        }

        const key = other.uuid;
        const previous = this.collisionStateByObject.get(key) === true;
        const current = this.isCollide(other);
        this.collisionStateByObject.set(key, current);

        const impact = Math.abs(this.getObjectVelocityMagnitude(this.target) - this.getObjectVelocityMagnitude(other));
        const minImpact = Math.max(0, Number(condition.physicsMinImpact) || 0);
        if (impact < minImpact) {
            return false;
        }

        const eventType = condition.physicsEventType || "enter";
        if (eventType === "exit") {
            return previous && !current;
        }
        return !previous && current;
    }

    private isAiProximityConditionMet(condition: IfCondition): boolean {
        const target = condition.aiTargetScope === "object"
            ? this.getObjectByUUID(condition.aiObjectUUID || "")
            : this.game?.player || null;
        if (!target) {
            return false;
        }

        const sourcePos = this.target.getWorldPosition(this.scratchPositionA);
        const targetPos = target.getWorldPosition(this.scratchPositionB);
        const toTarget = this.scratchDirection.subVectors(targetPos, sourcePos);
        const range = Math.max(0, Number(condition.aiRange) || 0);
        const distanceSq = toTarget.lengthSq();
        if (distanceSq > range * range) {
            return false;
        }

        const fov = Math.max(0, Math.min(360, Number(condition.aiFovDegrees) || 360));
        if (fov >= 359.9 || distanceSq <= 0.00000001) {
            return true;
        }

        const forward = this.target.getWorldDirection(this.scratchForward).normalize();
        const angle = THREE.MathUtils.radToDeg(forward.angleTo(toTarget.normalize()));
        return angle <= fov / 2;
    }

}

export default TriggerBehavior;

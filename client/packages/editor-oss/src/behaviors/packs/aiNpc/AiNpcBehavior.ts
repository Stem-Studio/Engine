import {Object3D, Vector3, Quaternion, Box3} from "three";

import AiAgent from "./AiAgent";
import AIConversationManager from "./AiConversationManager";
import {AVAILABLE_ACTIONS, EVENTS_TO_LISTEN} from "./const";
import {applyHumanoidAnimations} from "../../../assets/js/animations/applyHumanoidAnimations";
import {loadHumanoidAnimations} from "../../../assets/js/animations/loadHumanoidAnimations";
import {
    NPCBackendData,
    getNPC,
    GameContext,
    GameObject,
    GameEvent,
    SelectedAction,
    CurrentAction,
} from "@stem/network/api/npc";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {IPhysics} from "../../../physics/common/types";
import AiConversationView from "@web-shared/player/component/AiConversationView";
import {AiNPCBehaviorInterface, GAME_STATE} from "@stem/editor-oss/types/editor";
import VoiceRecorder from "@stem/editor-oss/utils/VoiceRecorder";
import {BehaviorBase} from "../../Behavior";
import EventBus, {IN_GAME_EVENTS} from "../../event/EventBus";
import GameManager from "../../game/GameManager";

const defaultPhysicsConfig = {
    enabled: true,
    mass: 70,
    shape: "btBoxShape",
    ctype: "Dynamic",
    userShapeScale: {x: 0.3, y: 1, z: 0.4},
    friction: 1,
    rollingFriction: 0,
    spinningFriction: 100,
    contactStiffness: 100,
    contactDamping: 100,
    rotationLock: {
        x: true,
        y: false,
        z: true,
    },
};
const MAX_RECENT_EVENTS = 20;

enum NPCActionState {
    IDLE = "idle",
    MOVING = "moving",
    PERFORMING_ACTION = "performing_action",
}

enum NPCIdleState {
    STANDING = "standing",
    WANDERING = "wandering",
    RETURNING_HOME = "returning_home",
}

class AiNpcBehavior extends BehaviorBase {
    enabled: boolean = true;
    agent: AiAgent | null = null;
    distanceFromPlayer: number = 0;
    npcProfileData: NPCBackendData | null = null;
    gameContext: GameContext = {
        availableActions: AVAILABLE_ACTIONS,
        surroundedObjects: [],
        environment: "",
        groups: [],
        recentEvents: [],
        npcPosition: undefined,
        currentActions: [],
        playerInfo: undefined,
    };
    private gameManager: GameManager | null = null;
    private aiConversationManager: AIConversationManager | null = null;
    private voiceRecorder: VoiceRecorder | null = null;
    private buttonView: AiConversationView | null = null;
    private engine?: EngineRuntime;
    private sceneId: string = "";
    private eventTokens: string[] = []; // Store event subscription tokens
    private lastGameContextUpdate: number = 0; // Timestamp of last context update
    private lastPlayerRangeCheck: number = 0; // Timestamp of last player range check
    private readonly GAME_CONTEXT_UPDATE_INTERVAL: number = 2000; // 2 seconds in milliseconds
    private readonly PLAYER_RANGE_CHECK_INTERVAL: number = 200; // 200 milliseconds

    // Action execution state
    private actionQueue: SelectedAction[] = [];
    private currentActionIndex: number = -1;
    private actionState: NPCActionState = NPCActionState.IDLE;
    private readonly targetPosition: Vector3 = new Vector3();
    private hasTargetPosition: boolean = false;
    private moveDirection: Vector3 = new Vector3();
    private physics: IPhysics | null = null;
    private currentRotation: Quaternion = new Quaternion();
    private readonly POSITION_THRESHOLD: number = 0.5; // Distance to consider "reached"
    private readonly POSITION_THRESHOLD_SQ: number = this.POSITION_THRESHOLD * this.POSITION_THRESHOLD;
    private readonly ROTATION_SPEED: number = 5; // Rotation speed
    private actionStartTime: number = 0;

    // Idle behavior state
    private idleState: NPCIdleState = NPCIdleState.STANDING;
    private idleStateTimer: number = 0;
    private standingDuration: number = 0;
    private wanderingDuration: number = 0;
    private originalPosition: Vector3 = new Vector3();
    private wanderDirection: Vector3 = new Vector3();
    private wanderTimer: number = 0;
    private isNpcStopped: boolean = false; // Manual stop flag
    private currentAnimation: string = "";

    // Object holding state
    private heldObject: Object3D | null = null; // Reference to currently held object
    private heldObjectUuid: string | null = null; // UUID of held object for joint management
    private holdJointActive: boolean = false; // Flag to track if joint is active
    private readonly yAxis: Vector3 = new Vector3(0, 1, 0);
    private readonly zeroVelocity: Vector3 = new Vector3();
    private readonly forwardDirection: Vector3 = new Vector3();
    private readonly scratchDirection: Vector3 = new Vector3();
    private readonly scratchPosition: Vector3 = new Vector3();
    private readonly scratchPosition2: Vector3 = new Vector3();
    private readonly scratchBox: Box3 = new Box3();
    private readonly scratchBox2: Box3 = new Box3();
    private readonly scratchSize: Vector3 = new Vector3();
    private readonly surroundedObjectsScratch: GameObject[] = [];
    private readonly surroundingObjectTraversalStack: Object3D[] = [];

    init(game: GameManager): void {
        this.gameManager = game;
        this.engine = game.engine;
        this.sceneId = this.engine.editor?.sceneID || "";
        this.aiConversationManager = this.gameManager.aiConversationManager;
        this.voiceRecorder = this.aiConversationManager?.voiceRecorder || null;
        this.buttonView = this.aiConversationManager?.buttonView || null;
        this.physics = this.gameManager.physics || null;
    }

    private async initAgent(): Promise<void> {
        if (!this.target || !this.engine) return;
        try {
            await this.loadNPCData();
            this.agent = new AiAgent(this.target, this, this.sceneId, this.engine.authManager.getUserName() || "");
        } catch (error) {
            console.error("Error loading NPC data:", error);
        }
    }

    async onAdded(): Promise<void> {
        // Safety net for humanoid NPCs: ModelLoader fires the humanoid
        // clip apply async, so by the time onAdded runs the injection
        // may still be in flight. Await the cached load and merge before
        // any playAnimation call.
        if (this.target?.userData?.isHumanoid === true) {
            try {
                const clips = await loadHumanoidAnimations();
                if (clips.length) applyHumanoidAnimations(this.target, clips);
            } catch (err) {
                console.warn("[AiNpcBehavior] Failed to apply humanoid animations", err);
            }
        }

        if (this.target && this.enabled) {
            await this.initAgent();
        }

        // Register with GameManager
        if (this.agent) {
            this.aiConversationManager?.registerAiAgent(this.agent);
            this.agent.playAnimation(this.attributes.idleAnimation);
        }

        // Subscribe to game events
        this.subscribeToEvents();

        // Store original position for wandering
        if (this.target) {
            this.originalPosition.copy(this.target.position);
        }

        // Initialize idle state
        this.initializeIdleState();
    }

    onEditorAdded(): void {
        console.log(this.target.userData.physics);
        if (!this.target.userData.defaultNpcPhysicsApplied) {
            this.target.userData.physics = {
                ...this.target.userData.physics,
                ...defaultPhysicsConfig,
            };
        }

        this.target.userData.defaultNpcPhysicsApplied = true;

        console.log(this.target.userData.physics);
    }

    onEditorAttributesUpdated(): void {
        console.log(this.attributes);
    }

    onRemoved(): void {
        this.cleanupEventSubscriptions();
        this.dispose();
    }

    onPaused(): void {
        this.cleanupEventSubscriptions();
    }

    onResumed(): void {
        this.subscribeToEvents();
    }

    onReset(): void {
        if (this.agent) {
            this.agent.reset();
        }
    }

    update(delta: number): void {
        if (!this.enabled || !this.agent || !this.gameManager || this.gameManager.state !== GAME_STATE.STARTED) {
            return;
        }

        const currentTime = Date.now();

        // Check if player is in range with debounce
        if (currentTime - this.lastPlayerRangeCheck >= this.PLAYER_RANGE_CHECK_INTERVAL) {
            this.checkPlayerRange();
            this.lastPlayerRangeCheck = currentTime;
        }

        // Update speech animation
        this.updateSpeechAnimation();

        // Update game context with debounce (updates environment, groups, and surrounded objects)
        if (currentTime - this.lastGameContextUpdate >= this.GAME_CONTEXT_UPDATE_INTERVAL) {
            this.updateGameContext();
            this.lastGameContextUpdate = currentTime;
        }

        // Process action queue
        this.processActionQueue(delta);

        // Process idle wandering behavior (only when not executing actions and not manually stopped)
        if (this.actionState === NPCActionState.IDLE && !this.isNpcStopped) {
            this.processIdleBehavior(delta);
        }

        // Update UI
        this.aiConversationManager?.updateRangeData({
            agentId: this.agent.id,
            isInRange: this.agent.isInRange,
            distanceFromPlayer: this.distanceFromPlayer,
        });
        this.aiConversationManager?.updateUI();
    }

    private checkPlayerRange(): void {
        if (!this.agent || !this.gameManager || !this.gameManager.player || !this.attributes.range) return;

        const playerPos = this.gameManager.player.position;
        const agentPos = this.agent.model.position;
        const distance = playerPos.distanceTo(agentPos);
        this.distanceFromPlayer = distance;

        this.agent.isInRange = distance <= this.attributes.range;

        if (this.agent.isInRange) {
            const gain = 1 - distance / this.attributes.range + 0.01;
            this.agent.setGainNodeValue(gain > 1 ? 1 : gain);
        } else {
            this.agent.setGainNodeValue(0);
        }
    }

    private updateSpeechAnimation(): void {
        if (!this.agent) return;

        if (this.agent.isPlaying) {
            if (!this.agent.currentAnimationName) {
                void this.agent.playSpeechAnimation();
            }
        } else {
            this.agent.stopSpeechAnimation();
        }
    }

    private updateUI(): void {
        if (!this.agent || !this.buttonView || !this.attributes.active_in_voice_chat) return;

        if (this.agent.isInRange && this.buttonView && this.isClosestAgent()) {
            this.buttonView.show(this.attributes.name || "NPC", this.agent.isBusy || this.agent.isPlaying);
        }
    }

    private async loadNPCData() {
        try {
            const npcId = this.attributes.npc_profile;
            console.log("[AI NPC] Loading NPC data for ID:", npcId);
            if (!npcId || npcId === "none") return;
            this.npcProfileData = await getNPC(npcId);
        } catch (error) {
            console.error("Error loading NPC data:", error);
        }
    }

    private updateRecentEvents(eventName: string, eventData?: Record<string, unknown>): void {
        const timestamp = new Date().toISOString();

        // Check if the last event is the same (avoid consecutive duplicates)
        const lastEvent = this.gameContext.recentEvents?.[this.gameContext.recentEvents.length - 1];
        if (lastEvent && lastEvent.type === eventName) {
            // Update timestamp but don't add duplicate
            lastEvent.timestamp = timestamp;
            if (eventData) {
                //lastEvent.data = eventData;
            }
            return;
        }

        // Add new event
        const newEvent: GameEvent = {
            type: eventName,
            description: `Event: ${eventName}`,
            timestamp,
            //data: eventData,
        };

        if (!this.gameContext.recentEvents) {
            this.gameContext.recentEvents = [];
        }

        this.gameContext.recentEvents.push(newEvent);

        // Keep only the last MAX_RECENT_EVENTS
        if (this.gameContext.recentEvents.length > MAX_RECENT_EVENTS) {
            this.gameContext.recentEvents.shift();
        }
    }

    private updateGameContext(): void {
        // Update environment from attributes
        this.gameContext.environment = (this.attributes.environment as string) || "";

        // Update groups from attributes
        this.gameContext.groups = (this.attributes.groups as string[]) || [];

        // Update NPC position
        if (this.target) {
            this.gameContext.npcPosition = {
                x: this.target.position.x,
                y: this.target.position.y,
                z: this.target.position.z,
            };
        }
        // Update player info
        if (this.gameManager?.player) {
            this.gameContext.playerInfo = {
                id: this.gameManager.player.uuid,
                position: {
                    x: this.gameManager.player.position.x,
                    y: this.gameManager.player.position.y,
                    z: this.gameManager.player.position.z,
                },
            };
        }

        // Update surrounded objects
        this.getSurroundedObjects();
    }

    private getSurroundedObjects(): void {
        const target = this.target;
        const scene = this.gameManager?.scene;
        const surroundedObjects = this.surroundedObjectsScratch;
        surroundedObjects.length = 0;

        if (!target || !scene) {
            this.gameContext.surroundedObjects = surroundedObjects;
            return;
        }

        const detectionRadius = (this.attributes.object_interaction_range as number) || 5;
        const detectionRadiusSq = detectionRadius * detectionRadius;
        const npcPosition = target.getWorldPosition(this.scratchPosition);
        const traversalStack = this.surroundingObjectTraversalStack;
        traversalStack.length = 0;
        traversalStack.push(scene);

        while (traversalStack.length > 0) {
            const object = traversalStack.pop();
            if (!object) {
                continue;
            }

            if (object === target) {
                continue;
            }

            for (let i = object.children.length - 1; i >= 0; i--) {
                traversalStack.push(object.children[i]!);
            }

            if (!object.name || !object.userData?.visibleByAI) {
                continue;
            }

            const objectPosition = object.getWorldPosition(this.scratchPosition2);
            const distanceSq = npcPosition.distanceToSquared(objectPosition);

            if (distanceSq <= detectionRadiusSq) {
                const distance = Math.sqrt(distanceSq);
                const boundingBox = this.scratchBox.setFromObject(object);
                const gameObject: GameObject = {
                    id: object.uuid,
                    name: object.name,
                    type: object.type,
                    distance: Math.round(distance * 100) / 100, // Round to 2 decimals
                    position: {
                        x: Math.round(objectPosition.x * 100) / 100,
                        y: Math.round(objectPosition.y * 100) / 100,
                        z: Math.round(objectPosition.z * 100) / 100,
                    },
                    size: {
                        x: Math.round((boundingBox.max.x - boundingBox.min.x) * 100) / 100,
                        y: Math.round((boundingBox.max.y - boundingBox.min.y) * 100) / 100,
                        z: Math.round((boundingBox.max.z - boundingBox.min.z) * 100) / 100,
                    },
                };

                surroundedObjects.push(gameObject);
            }
        }

        // Sort by distance (closest first)
        if (surroundedObjects.length > 1) {
            surroundedObjects.sort((a, b) => (a.distance || 0) - (b.distance || 0));
        }

        this.gameContext.surroundedObjects = surroundedObjects;
    }

    /**
     * Subscribe to game events similar to VisualEffectBehavior
     */
    private subscribeToEvents(): void {
        // Clean up existing subscriptions before creating new ones
        this.cleanupEventSubscriptions();

        EVENTS_TO_LISTEN.forEach(eventName => {
            const token = EventBus.instance.subscribe(eventName, (msg: string, data: Record<string, unknown>) => {
                this.updateRecentEvents(msg, data);
            });
            this.eventTokens.push(token);
        });
    }

    /**
     * Clean up all event subscriptions to prevent memory leaks
     */
    private cleanupEventSubscriptions(): void {
        this.eventTokens.forEach(token => {
            EventBus.instance.unsubscribe(token);
        });
        this.eventTokens = [];
    }

    // Handle voice recording
    startRecording(): void {
        if (!this.agent || !this.voiceRecorder) return;

        this.agent.isBusy = true;
        this.voiceRecorder.startRecording(blob => {
            const file = new File([blob], "audio.wav", {type: blob.type});
            void this.agent?.sendAudioFile(file);
        });
    }

    stopRecording(): void {
        if (this.voiceRecorder) {
            this.voiceRecorder.stopRecording();
        }
    }

    // Called when game is paused
    pause(): void {
        if (this.agent) {
            this.agent.setGainNodeValue(0);
        }

        if (this.buttonView) {
            this.buttonView.dispose();
        }
    }

    // Called when game is resumed
    resume(): void {
        // Nothing specific needed here, normal updates will handle it
    }

    // Clean up resources
    dispose(): void {
        this.cleanupEventSubscriptions();

        // Stop any ongoing actions
        this.stopMovement();
        this.actionQueue = [];
        this.currentActionIndex = -1;
        this.actionState = NPCActionState.IDLE;

        if (this.agent) {
            this.agent.reset();
            this.aiConversationManager?.unregisterAiAgent(this.agent);
        }

        this.agent = null;
    }

    getBehaviorConfig(): AiNPCBehaviorInterface {
        return this as unknown as AiNPCBehaviorInterface;
    }

    // Check if this is the closest agent to the player
    isClosestAgent(): boolean {
        if (!this.gameManager || !this.agent) return false;

        const closestAgent = this.aiConversationManager?.getClosestAiAgent();
        return closestAgent === this.agent;
    }

    // Check if agent is ready for interaction
    isReadyForInteraction(): boolean {
        if (!this.agent || !this.attributes.active_in_voice_chat) return false;

        return this.agent.isInRange && !this.agent.isBusy && !this.agent.isPlaying;
    }

    /**
     * Stop NPC from wandering (e.g., during conversation)
     */
    public stopNpc(): void {
        this.isNpcStopped = true;
        this.stopMovement();
        this.playAnimation(this.attributes.idleAnimation as string);
    }

    /**
     * Release NPC to resume wandering
     */
    public releaseNpc(): void {
        this.isNpcStopped = false;
        this.initializeIdleState();
    }

    /**
     * Initialize idle state with random duration
     */
    private initializeIdleState(): void {
        this.idleState = NPCIdleState.STANDING;
        this.idleStateTimer = 0;
        this.standingDuration = Math.random() * 5 + 3; // 3-8 seconds
        this.wanderingDuration = Math.random() * 8 + 5; // 5-13 seconds
    }

    /**
     * Process idle behavior - wandering and standing
     * @param delta - Time delta in seconds
     */
    private processIdleBehavior(delta: number): void {
        if (!this.target || !this.physics) return;

        this.idleStateTimer += delta;

        switch (this.idleState) {
            case NPCIdleState.STANDING:
                this.processStanding();
                break;
            case NPCIdleState.WANDERING:
                this.processWandering(delta);
                break;
            case NPCIdleState.RETURNING_HOME:
                this.processReturningHome(delta);
                break;
        }
    }

    private setPhysicsYaw(targetRotation: number): void {
        if (!this.target || !this.physics) return;
        this.currentRotation.setFromAxisAngle(this.yAxis, targetRotation);
        this.physics.setRotation(this.target.uuid, this.currentRotation);
    }

    private setForwardLinearVelocity(speed: number): void {
        if (!this.target || !this.physics) return;
        this.forwardDirection
            .set(0, 0, 1)
            .applyQuaternion(this.currentRotation)
            .normalize()
            .multiplyScalar(speed);
        this.forwardDirection.y -= speed / 2;
        this.physics.setLinearVelocity(this.target.uuid, this.forwardDirection);
    }

    /**
     * Process standing state
     */
    private processStanding(): void {
        // Stop movement completely
        if (this.physics && this.target) {
            this.physics.setLinearVelocity(this.target.uuid, this.zeroVelocity.set(0, 0, 0));
        }

        // Play idle animation
        this.playAnimation(this.attributes.idleAnimation as string);

        // Check if it's time to start wandering
        if (this.idleStateTimer >= this.standingDuration) {
            this.idleState = NPCIdleState.WANDERING;
            this.idleStateTimer = 0;
            this.wanderingDuration = Math.random() * 8 + 5;
            this.wanderTimer = 0;
        }
    }

    /**
     * Process wandering state
     * @param delta - Time delta in seconds
     */
    private processWandering(delta: number): void {
        if (!this.target || !this.physics) return;

        // Check distance from original position
        const maxRoamDistance = ((this.attributes.object_interaction_range as number) || 5) * 0.5; // Use half of interaction range
        const maxRoamDistanceSq = maxRoamDistance * maxRoamDistance;
        const isBeyondRoamDistance = this.target.position.distanceToSquared(this.originalPosition) > maxRoamDistanceSq;

        // Change direction periodically or if too far from origin
        if (this.wanderTimer <= 0 || isBeyondRoamDistance) {
            if (isBeyondRoamDistance) {
                // Return to origin
                this.wanderDirection.copy(this.originalPosition).sub(this.target.position).normalize();
            } else {
                // Random direction
                this.wanderDirection.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1).normalize();
            }
            this.wanderTimer = Math.random() * 3 + 2; // 2-5 seconds
        }

        this.wanderTimer -= delta;

        // Apply movement
        const targetRotation = Math.atan2(this.wanderDirection.x, this.wanderDirection.z);
        this.target.rotation.y = this.lerp(this.target.rotation.y, targetRotation, this.ROTATION_SPEED * delta);

        this.setPhysicsYaw(targetRotation);

        // Calculate velocity
        const speed = ((this.attributes.walkSpeed as number) || 2.5) * 0.5; // Half speed for wandering
        this.setForwardLinearVelocity(speed);

        // Play walk animation AFTER setting velocity
        this.playAnimation(this.attributes.walkAnimation as string);

        // Check if it's time to stop wandering
        if (this.idleStateTimer >= this.wanderingDuration) {
            this.idleState = NPCIdleState.STANDING;
            this.idleStateTimer = 0;
            this.standingDuration = Math.random() * 5 + 3;
            this.stopMovement();
        }
    }

    /**
     * Process returning home state - walk back to original position
     * @param delta - Time delta in seconds
     */
    private processReturningHome(delta: number): void {
        if (!this.target || !this.physics) return;

        // Check if reached home
        if (this.target.position.distanceToSquared(this.originalPosition) < this.POSITION_THRESHOLD_SQ) {
            this.idleState = NPCIdleState.STANDING;
            this.idleStateTimer = 0;
            this.standingDuration = Math.random() * 5 + 3;
            this.stopMovement();
            return;
        }

        // Calculate direction to home
        const directionToHome = this.scratchDirection.copy(this.originalPosition).sub(this.target.position).normalize();
        directionToHome.y = 0;

        // Apply rotation
        const targetRotation = Math.atan2(directionToHome.x, directionToHome.z);
        this.target.rotation.y = this.lerp(this.target.rotation.y, targetRotation, this.ROTATION_SPEED * delta);

        this.setPhysicsYaw(targetRotation);

        // Calculate velocity
        const speed = ((this.attributes.walkSpeed as number) || 2.5) * 0.5; // Half speed for returning
        this.setForwardLinearVelocity(speed);

        // Play walk animation
        this.playAnimation(this.attributes.walkAnimation as string);
    }

    /**
     * Handle actions selected by AI during conversation
     * @param actions - Array of actions selected by the AI
     */
    onActionsReceived = (actions: SelectedAction[]): void => {
        if (!actions || actions.length === 0) {
            return;
        }
        console.log(`[AI NPC] ${this.npcProfileData?.Name || "NPC"} selected actions:`, actions);

        // Add actions to queue
        this.actionQueue = actions;
        this.currentActionIndex = -1;

        // Convert actions to CurrentAction format and add to gameContext
        const currentActions: CurrentAction[] = actions.map(action => ({
            name: action.name,
            parameters: action.parameters,
            startedAt: new Date().toISOString(),
            status: "executing" as const,
        }));

        this.gameContext.currentActions = currentActions;

        // Start processing
        this.startNextAction();
    };

    /**
     * Process the action queue - called every frame
     * @param delta - Time delta in seconds
     */
    private processActionQueue(delta: number): void {
        if (this.actionState === NPCActionState.IDLE || !this.target) {
            return;
        }

        const currentAction = this.actionQueue[this.currentActionIndex];
        if (!currentAction) {
            return;
        }

        // Handle movement actions
        if (this.actionState === NPCActionState.MOVING && this.hasTargetPosition) {
            const reached = this.updateMovement(delta);
            if (reached) {
                this.completeCurrentAction();
            }
        }
    }

    /**
     * Start the next action in the queue
     */
    private startNextAction(): void {
        this.currentActionIndex++;

        if (this.currentActionIndex >= this.actionQueue.length) {
            // All actions completed
            this.actionState = NPCActionState.IDLE;
            this.actionQueue = [];
            this.currentActionIndex = -1;

            // Play idle animation
            this.playAnimation(this.attributes.idleAnimation as string);

            // Clear current actions after delay
            setTimeout(() => {
                this.gameContext.currentActions = [];
            }, 5000);

            // Resume idle behavior if not manually stopped
            if (!this.isNpcStopped) {
                // Just resume normal idle behavior (standing/wandering)
                this.initializeIdleState();
            }

            return;
        }

        const action = this.actionQueue[this.currentActionIndex];
        if (!action) {
            return;
        }

        // Update action status
        if (this.gameContext.currentActions?.[this.currentActionIndex]) {
            this.gameContext.currentActions[this.currentActionIndex]!.status = "executing";
        }

        this.actionStartTime = Date.now();

        // Execute action based on type
        void this.executeActionSync(action);
    }

    /**
     * Complete current action and move to next
     */
    private completeCurrentAction(): void {
        if (this.gameContext.currentActions?.[this.currentActionIndex]) {
            this.gameContext.currentActions[this.currentActionIndex]!.status = "completed";
        }

        console.log(`[AI NPC] Completed action: ${this.actionQueue[this.currentActionIndex]?.name}`);

        // Stop movement
        this.stopMovement();

        // Move to next action
        this.startNextAction();
    }

    /**
     * Fail current action and move to next
     * @param error - Error message
     */
    private failCurrentAction(error: string): void {
        if (this.gameContext.currentActions?.[this.currentActionIndex]) {
            this.gameContext.currentActions[this.currentActionIndex]!.status = "failed";
        }

        console.error(`[AI NPC] Failed action: ${this.actionQueue[this.currentActionIndex]?.name} - ${error}`);

        // Stop movement
        this.stopMovement();

        // Move to next action
        this.startNextAction();
    }

    /**
     * Execute action synchronously (sets up state, actual execution happens in update loop)
     * @param action - The action to execute
     */
    private async executeActionSync(action: SelectedAction): Promise<void> {
        try {
            switch (action.name) {
                case "rotate_to_face_object":
                    await this.performRotateToFaceObject(action.parameters);
                    break;

                case "go_to_object":
                    this.setupGoToObject(action.parameters);
                    break;

                case "go_to_position":
                    this.setupGoToPosition(action.parameters);
                    break;

                case "pick_up_object":
                    await this.performPickUpObject(action.parameters);
                    break;

                case "put_down_object":
                    await this.performPutDownObject();
                    break;

                case "wave_gesture":
                    await this.performWaveGesture(action.parameters);
                    break;

                case "point_at":
                    await this.performPointAt(action.parameters);
                    break;

                default:
                    throw new Error(`Unknown action: ${action.name}`);
            }
        } catch (error) {
            this.failCurrentAction(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Update NPC movement towards target position
     * @param delta - Time delta
     * @returns true if target reached
     */
    private updateMovement(delta: number): boolean {
        if (!this.target || !this.hasTargetPosition || !this.physics) {
            return true;
        }

        // Get NPC foot position for horizontal distance calculation
        const npcBoundingBox = this.scratchBox.setFromObject(this.target);
        const npcFootY = npcBoundingBox.min.y;
        const currentPos = this.scratchPosition.set(this.target.position.x, npcFootY, this.target.position.z);

        // Calculate horizontal distance (ignore Y)
        const horizontalTarget = this.scratchPosition2.set(this.targetPosition.x, npcFootY, this.targetPosition.z);

        // Check if reached
        if (currentPos.distanceToSquared(horizontalTarget) < this.POSITION_THRESHOLD_SQ) {
            return true;
        }

        // Calculate direction on horizontal plane
        this.moveDirection.copy(horizontalTarget).sub(currentPos).normalize();
        this.moveDirection.y = 0; // Keep on ground

        // Calculate rotation
        const targetRotation = Math.atan2(this.moveDirection.x, this.moveDirection.z);
        this.target.rotation.y = this.lerp(this.target.rotation.y, targetRotation, this.ROTATION_SPEED * delta);

        this.setPhysicsYaw(targetRotation);

        // Calculate velocity
        const speed = (this.attributes.walkSpeed as number) || 2.5;
        this.setForwardLinearVelocity(speed);

        return false;
    }

    /**
     * Stop NPC movement
     */
    private stopMovement(): void {
        if (this.physics && this.target) {
            this.physics.setLinearVelocity(this.target.uuid, this.zeroVelocity.set(0, 0, 0));
        }
        this.hasTargetPosition = false;
        this.actionState = NPCActionState.IDLE;
        this.playAnimation(this.attributes.idleAnimation as string);
    }

    /**
     * Linear interpolation helper
     * @param start - Start value
     * @param end - End value
     * @param factor - Interpolation factor (0-1)
     * @returns Interpolated value
     */
    private lerp(start: number, end: number, factor: number): number {
        return start + (end - start) * factor;
    }

    private getSceneObjectByUUID(uuid: string): Object3D | null {
        return this.gameManager?.getObjectByUUID(uuid) ?? null;
    }

    /**
     * Play animation
     * @param animationName - Name of the animation to play
     */
    private playAnimation(animationName: string | undefined): void {
        if (!animationName || animationName === "none" || !this.target || this.currentAnimation === animationName) {
            return;
        }

        if (this.engine?.animationControl && this.target) {
            this.engine.animationControl.playAnimation(this.target, animationName, 1, false);
            this.currentAnimation = animationName;
        }
    }

    /**
     * Setup go_to_object action - Navigate to a specific object
     * @param parameters - Action parameters including objectId
     */
    private setupGoToObject(parameters?: Record<string, unknown>): void {
        if (!parameters?.objectId) {
            throw new Error("go_to_object requires objectId parameter");
        }

        const objectId = parameters.objectId as string;
        console.log(`[AI NPC] Setting up navigation to object: ${objectId}`);

        // Find the target object in the scene
        const targetObject = this.getSceneObjectByUUID(objectId);

        if (!targetObject) {
            throw new Error(`Object not found: ${objectId}`);
        }

        // Calculate bounding box to stop in front of the object
        const boundingBox = this.scratchBox.setFromObject(targetObject);
        const objectSize = this.scratchSize;
        boundingBox.getSize(objectSize);

        // Calculate direction from NPC to object
        if (!this.target) {
            throw new Error("NPC target is not set");
        }

        // Get NPC bounding box to calculate foot position
        const npcBoundingBox = this.scratchBox2.setFromObject(this.target);
        const npcFootY = npcBoundingBox.min.y; // Bottom of NPC

        // Get object base position (bottom of object)
        const objectBaseY = boundingBox.min.y;

        // Use object base position for horizontal positioning
        const objectBasePosition = this.scratchPosition.set(targetObject.position.x, objectBaseY, targetObject.position.z);
        const npcBasePosition = this.scratchPosition2.set(this.target.position.x, npcFootY, this.target.position.z);

        // Calculate direction on horizontal plane from NPC base to object base
        const direction = this.scratchDirection.copy(objectBasePosition).sub(npcBasePosition).normalize();
        direction.y = 0; // Keep on horizontal plane

        // Calculate stopping distance (half of object's depth + small offset)
        const objectRadius = Math.max(objectSize.x, objectSize.z) / 2;
        const stoppingDistance = objectRadius + 0.5; // 0.5m offset in front of object

        // Set target position in front of the object at ground level
        this.targetPosition.copy(objectBasePosition).sub(direction.multiplyScalar(stoppingDistance));
        this.targetPosition.y = npcFootY; // Keep NPC at ground level
        this.hasTargetPosition = true;

        this.actionState = NPCActionState.MOVING;

        // Play walk animation
        this.playAnimation(this.attributes.walkAnimation as string);

        EventBus.instance.send(IN_GAME_EVENTS.NPC_ACTION_STARTED, {
            npcId: this.agent?.id,
            action: "go_to_object",
            objectId: objectId,
            objectName: targetObject.name,
        });
    }

    /**
     * Setup go_to_position action - Navigate to a specific 3D position
     * @param parameters - Action parameters including x, y, z coordinates
     */
    private setupGoToPosition(parameters?: Record<string, unknown>): void {
        if (parameters?.x === undefined || parameters?.y === undefined || parameters?.z === undefined) {
            throw new Error("go_to_position requires x, y, z parameters");
        }

        let x = parameters.x as number;
        let y = parameters.y as number;
        let z = parameters.z as number;

        console.log(`[AI NPC] Setting up navigation to position: (${x}, ${y}, ${z})`);

        // Check if target position is too close to player
        if (this.gameManager?.player) {
            const playerPos = this.gameManager.player.position;
            const targetPos = this.scratchPosition.set(x, y, z);

            const playerSafeDistance = 1; // Minimum distance from player
            const playerSafeDistanceSq = playerSafeDistance * playerSafeDistance;

            if (playerPos.distanceToSquared(targetPos) < playerSafeDistanceSq) {
                // Calculate direction from player to target position
                const directionFromPlayer = this.scratchDirection.copy(targetPos).sub(playerPos);

                // If direction is too small (target is almost exactly at player position),
                // use a default forward direction from player's perspective
                if (directionFromPlayer.lengthSq() < 0.0001) {
                    // Get player's forward direction
                    const playerForward = this.scratchPosition2.set(0, 0, 1);
                    playerForward.applyQuaternion(this.gameManager.player.quaternion);
                    directionFromPlayer.copy(playerForward);
                } else {
                    directionFromPlayer.normalize();
                }

                directionFromPlayer.y = 0; // Keep on horizontal plane
                directionFromPlayer.normalize();

                // Set new target position in front of player
                const adjustedPos = this.scratchPosition2
                    .copy(playerPos)
                    .add(directionFromPlayer.multiplyScalar(playerSafeDistance));

                x = adjustedPos.x;
                y = adjustedPos.y;
                z = adjustedPos.z;

                console.log(
                    `[AI NPC] Adjusted target position to avoid player collision: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`,
                );
            }
        }

        // Set target position
        this.targetPosition.set(x, y, z);
        this.hasTargetPosition = true;
        this.actionState = NPCActionState.MOVING;

        // Play walk animation
        this.playAnimation(this.attributes.walkAnimation as string);

        EventBus.instance.send(IN_GAME_EVENTS.NPC_ACTION_STARTED, {
            npcId: this.agent?.id,
            action: "go_to_position",
            targetPosition: {x, y, z},
        });
    }

    /**
     * Perform pick_up_object action
     * @param parameters - Action parameters including objectId
     */
    private async performPickUpObject(parameters?: Record<string, unknown>): Promise<void> {
        if (!parameters?.objectId) {
            throw new Error("pick_up_object requires objectId parameter");
        }

        const objectId = parameters.objectId as string;
        console.log(`[AI NPC] Picking up object: ${objectId}`);

        // Check if already holding an object
        if (this.heldObject) {
            throw new Error("NPC is already holding an object. Use put_down_object first.");
        }

        // Find the object in the scene
        const object = this.getSceneObjectByUUID(objectId);

        if (!object) {
            throw new Error(`Object not found: ${objectId}`);
        }

        if (!this.target) {
            throw new Error("NPC target not defined");
        }

        this.actionState = NPCActionState.PERFORMING_ACTION;

        // Play pick up animation
        this.playAnimation(this.attributes.pickUpAnimation as string);

        EventBus.instance.send(IN_GAME_EVENTS.NPC_ACTION_STARTED, {
            npcId: this.agent?.id,
            action: "pick_up_object",
            objectId: objectId,
            objectName: object.name,
        });

        // Wait for animation to play
        await new Promise(resolve => setTimeout(resolve, 500));

        // Create fixed joint to attach object to NPC
        if (this.physics && this.target) {
            try {
                // Calculate NPC height
                const npcBoundingBox = this.scratchBox.setFromObject(this.target);
                const npcHeight = npcBoundingBox.max.y - npcBoundingBox.min.y;

                // Position object at half NPC height and 0.5m in front
                const holdOffset = new Vector3(0, npcHeight / 2, 0.5);
                const npcQuaternion = new Quaternion();
                this.target.getWorldQuaternion(npcQuaternion);

                // Add fixed joint between NPC and object
                this.physics.addFixedJoint(
                    false, // collision disabled between NPC and held object
                    objectId,
                    this.target.uuid,
                    holdOffset,
                    npcQuaternion,
                );

                // Store reference to held object
                this.heldObject = object;
                this.heldObjectUuid = objectId;
                this.holdJointActive = true;

                console.log(
                    `[AI NPC] Successfully picked up object: ${object.name} at offset ${holdOffset.y}m height, ${holdOffset.z}m forward`,
                );

                EventBus.instance.send(IN_GAME_EVENTS.NPC_ACTION_ENDED, {
                    npcId: this.agent?.id,
                    action: "pick_up_object",
                    objectId: objectId,
                    objectName: object.name,
                });
            } catch (error) {
                console.error("[AI NPC] Failed to create joint for held object:", error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to pick up object: ${errorMessage}`);
            }
        } else {
            throw new Error("Physics engine not available");
        }

        // Wait a bit more for visual feedback
        await new Promise(resolve => setTimeout(resolve, 500));

        // Complete action
        this.completeCurrentAction();
    }

    /**
     * Perform put_down_object action
     * Releases the held object and removes the physics joint
     */
    private async performPutDownObject(): Promise<void> {
        console.log("[AI NPC] Putting down object");

        // Check if holding an object
        if (!this.heldObject || !this.heldObjectUuid) {
            throw new Error("NPC is not holding any object");
        }

        if (!this.target) {
            throw new Error("NPC target not defined");
        }

        this.actionState = NPCActionState.PERFORMING_ACTION;

        // Play put down animation
        this.playAnimation(this.attributes.putDownAnimation as string);

        EventBus.instance.send(IN_GAME_EVENTS.NPC_ACTION_STARTED, {
            npcId: this.agent?.id,
            action: "put_down_object",
            objectId: this.heldObjectUuid,
            objectName: this.heldObject.name,
        });

        // Wait for animation to start
        await new Promise(resolve => setTimeout(resolve, 300));

        // Remove the physics joint
        if (this.physics && this.holdJointActive && this.target) {
            try {
                // Remove the joint between NPC and held object
                this.physics.removeJoint(this.target.uuid, this.heldObjectUuid);

                this.holdJointActive = false;

                console.log(`[AI NPC] Successfully put down object: ${this.heldObject.name}`);

                EventBus.instance.send(IN_GAME_EVENTS.NPC_ACTION_ENDED, {
                    npcId: this.agent?.id,
                    action: "put_down_object",
                    objectId: this.heldObjectUuid,
                    objectName: this.heldObject.name,
                });
            } catch (error) {
                console.error("[AI NPC] Failed to remove joint for held object:", error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to put down object: ${errorMessage}`);
            }
        }

        // Clear held object reference
        this.heldObject = null;
        this.heldObjectUuid = null;

        // Wait for animation to complete
        await new Promise(resolve => setTimeout(resolve, 500));

        // Complete action
        this.completeCurrentAction();
    }

    /**
     * Perform rotate_to_face_object action
     * @param parameters - Action parameters including objectId
     */
    private async performRotateToFaceObject(parameters?: Record<string, unknown>): Promise<void> {
        if (!parameters?.objectId) {
            throw new Error("rotate_to_face_object requires objectId parameter");
        }

        const objectId = parameters.objectId as string;
        console.log(`[AI NPC] Rotating to face object: ${objectId}`);

        // Find the target object
        const targetObject = this.getSceneObjectByUUID(objectId);

        if (!targetObject) {
            throw new Error(`Object not found: ${objectId}`);
        }

        if (!this.target) {
            throw new Error("NPC target is not set");
        }

        this.actionState = NPCActionState.PERFORMING_ACTION;

        // Calculate direction to target
        const direction = this.scratchDirection.copy(targetObject.position).sub(this.target.position);
        direction.y = 0; // Keep on horizontal plane
        direction.normalize();

        // Calculate target rotation
        const targetRotation = Math.atan2(direction.x, direction.z);

        // Apply rotation
        this.target.rotation.y = targetRotation;

        // Update physics rotation
        if (this.physics) {
            this.setPhysicsYaw(targetRotation);
        }

        EventBus.instance.send(IN_GAME_EVENTS.NPC_ACTION_STARTED, {
            npcId: this.agent?.id,
            action: "rotate_to_face_object",
            objectId: objectId,
            objectName: targetObject.name,
        });

        // Brief delay to make rotation visible
        await new Promise(resolve => setTimeout(resolve, 300));

        // Complete action
        this.completeCurrentAction();
    }

    /**
     * Perform wave gesture action
     * @param parameters - Optional action parameters including objectId to wave at
     */
    private async performWaveGesture(parameters?: Record<string, unknown>): Promise<void> {
        console.log("[AI NPC] Performing wave gesture");

        this.actionState = NPCActionState.PERFORMING_ACTION;

        // If objectId is provided, rotate to face the object first
        if (parameters?.objectId) {
            const objectId = parameters.objectId as string;
            console.log(`[AI NPC] Rotating to face object before waving: ${objectId}`);

            const targetObject = this.getSceneObjectByUUID(objectId);

            if (targetObject && this.target) {
                // Calculate direction to target
                const direction = this.scratchDirection.copy(targetObject.position).sub(this.target.position);
                direction.y = 0; // Keep on horizontal plane
                direction.normalize();

                // Calculate and apply rotation
                const targetRotation = Math.atan2(direction.x, direction.z);
                this.target.rotation.y = targetRotation;

                // Update physics rotation
                if (this.physics) {
                    this.setPhysicsYaw(targetRotation);
                }
            }
        }

        // Play wave animation
        this.playAnimation(this.attributes.waveAnimation as string);

        EventBus.instance.send(IN_GAME_EVENTS.NPC_ACTION_STARTED, {
            npcId: this.agent?.id,
            action: "wave_gesture",
            objectId: parameters?.objectId,
        });

        // Simulate gesture duration
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Complete action
        this.completeCurrentAction();
    }

    /**
     * Perform point_at action
     * @param parameters - Action parameters including targetId
     */
    private async performPointAt(parameters?: Record<string, unknown>): Promise<void> {
        if (!parameters?.targetId) {
            throw new Error("point_at requires targetId parameter");
        }

        const targetId = parameters.targetId as string;
        console.log(`[AI NPC] Pointing at: ${targetId}`);

        // Find the target object
        const target = this.getSceneObjectByUUID(targetId);

        if (!target) {
            throw new Error(`Target not found: ${targetId}`);
        }

        this.actionState = NPCActionState.PERFORMING_ACTION;

        // Play point animation
        this.playAnimation(this.attributes.pointAnimation as string);

        // Rotate to face target
        if (this.target) {
            const direction = this.scratchDirection.copy(target.position).sub(this.target.position);
            direction.y = 0;
            direction.normalize();

            const targetRotation = Math.atan2(direction.x, direction.z);
            this.target.rotation.y = targetRotation;

            if (this.physics) {
                this.setPhysicsYaw(targetRotation);
            }
        }

        EventBus.instance.send(IN_GAME_EVENTS.NPC_ACTION_STARTED, {
            npcId: this.agent?.id,
            action: "point_at",
            targetId: targetId,
            targetName: target.name,
        });

        // Simulate gesture duration
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Complete action
        this.completeCurrentAction();
    }
}

export default AiNpcBehavior;

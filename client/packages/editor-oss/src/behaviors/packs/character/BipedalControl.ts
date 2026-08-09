import {Object3D, Quaternion, Scene, Vector3} from "three";

import {AnimationStateManager} from "./AnimationStateManager";
import {ClimbingHelper} from "./ClimbingHelper";
import {AnimationPriority, AnimationTriggerOptions, IPlayerAnimationController} from "./IPlayerAnimationController";
import CollisionDetector from "../../../behaviors/collisions/CollisionDetector";
import {AnimationController, BlendedAnimationParams} from "../../../controls/AnimationController";
import {CameraControl, ICameraControl} from "../../../controls/CameraControl";
import {PlayerActions} from "../../../controls/input/ActionTypes";
import {InputProvider} from "../../../controls/input/InputProvider";
import global from "@stem/editor-oss/global";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {IPhysics, ObjectMotionState} from "../../../physics/common/types";
import MotionStateHelper from "../../../physics/MotionStateHelper";
import {PhysicsUtil} from "../../../physics/PhysicsUtil";
import {CAMERA_TYPES, CharacterOptionsInterface} from "@stem/editor-oss/types/editor";
import EventBus, {IN_GAME_EVENTS} from "../../event/EventBus";

/* 
events
- motion:
    - character.motion.walk
    - character.motion.run
    - character.motion.none
- action:
    - character.action.jump
    - character.action.fall
    - character.action.land
    - character.action.climb_start
    - character.action.climb_end
    - character.action.interact
*/

export enum MOVEMENT_STATES {
    FORWARD = "forward",
    BACKWARD = "backward",
    RIGHT = "right",
    LEFT = "left",
    JUMP = "jump",
    CROUCH = "crouch",
    RUN = "run",
    WALK = "walk",
    IDLE = "idle",
    CLIMB = "climb",
    FALL = "fall",
    TAKE_OFF = "take_off",
    LAND = "land",
    INTERACT = "interact",
    NONE = "none",
}

type DirectionalForwardState = MOVEMENT_STATES.NONE | MOVEMENT_STATES.FORWARD | MOVEMENT_STATES.BACKWARD;

type DirectionalLateralState = MOVEMENT_STATES.NONE | MOVEMENT_STATES.LEFT | MOVEMENT_STATES.RIGHT;

type LocomotionMode = MOVEMENT_STATES.NONE | MOVEMENT_STATES.WALK | MOVEMENT_STATES.RUN;

type MovementAction =
    | MOVEMENT_STATES.NONE
    | MOVEMENT_STATES.CROUCH
    | MOVEMENT_STATES.CLIMB
    | MOVEMENT_STATES.FALL
    | MOVEMENT_STATES.JUMP;

const MOVEMENT_STOP_EPSILON_SQ = 0.0001 * 0.0001;

interface CharacterMovementState {
    forward: DirectionalForwardState;
    lateral: DirectionalLateralState;
    mode: LocomotionMode;
    action: MovementAction;
}

interface CharacterInputState {
    lateral: number;
    forward: number;
    run: boolean;
    jump: boolean;
    use: boolean;
    drop: boolean;
    pull: boolean;
    primary: boolean;
}

export default class BipedalControl implements IPlayerAnimationController {
    private inputProvider: InputProvider<PlayerActions>;
    private physics: IPhysics;
    private scene: Scene;
    character: Object3D = null as unknown as Object3D;
    private characterOptions: CharacterOptionsInterface = null as unknown as CharacterOptionsInterface;
    private animationController: AnimationController;
    private renderer: any;

    public velocity = new Vector3();
    private moveAngle = 0;
    private bodyAngle = 0;
    private rotateAngle = new Vector3(0, 1, 0);
    private rotateQuarternion = new Quaternion();
    private inputMoveDirection = new Vector3();
    private cameraDirection = new Vector3();
    private movePlayerVelocity = new Vector3();
    private groundAccelerationInput = Number.NaN;
    private groundAccelerationCoefficient = 0;
    private groundDecelerationInput = Number.NaN;
    private groundDecelerationCoefficient = 1;
    private airAccelerationInput = Number.NaN;
    private airAccelerationCoefficient = 0;
    private airDecelerationInput = Number.NaN;
    private airDecelerationCoefficient = 1;

    private gamePaused = true;
    private cameraControl: ICameraControl;

    private currentAnimationName: string | null = null;
    private isJumping: boolean = false;

    // Animation state management for IPlayerAnimationController
    private animationStateManager: AnimationStateManager = new AnimationStateManager();

    private climbingHelper: ClimbingHelper | null = null;

    private collisionDetector: CollisionDetector;

    private isGrounded: boolean = false;
    private wasGrounded: boolean = false;
    private currentMotionState: ObjectMotionState | undefined;
    private onEmitEvent?: (eventName: string, data?: any) => void;

    // For now we will not use forward, backward, left, right because
    // the character will always run towards the movement direction
    // so there will be no side steps or backward movement
    private movementState: CharacterMovementState = {
        forward: MOVEMENT_STATES.NONE,
        lateral: MOVEMENT_STATES.NONE,
        mode: MOVEMENT_STATES.NONE,
        action: MOVEMENT_STATES.NONE,
    };

    // Previous movement state to detect changes
    private previousMovementState: CharacterMovementState = {
        forward: MOVEMENT_STATES.NONE,
        lateral: MOVEMENT_STATES.NONE,
        mode: MOVEMENT_STATES.NONE,
        action: MOVEMENT_STATES.NONE,
    };

    private isKicking: boolean = false;
    private kickCooldownTimer: number = 0;

    private inputState: CharacterInputState = {
        lateral: 0,
        forward: 0,
        run: false,
        jump: false,
        use: false,
        drop: false,
        pull: false,
        primary: false,
    };

    private characterData = {
        target: {},
    };

    constructor(
        characterOptions: CharacterOptionsInterface,
        inputProvider: InputProvider<PlayerActions>,
        physics: IPhysics,
        scene: Scene,
        cameraControl: ICameraControl,
        renderer: any,
        collisionDetector: CollisionDetector,
        animationController: AnimationController,
        onEmitEvent?: (eventName: string, data?: any) => void,
    ) {
        this.inputProvider = inputProvider;
        this.physics = physics;
        this.scene = scene;
        this.cameraControl = cameraControl;
        this.renderer = renderer;
        this.characterOptions = characterOptions;
        this.collisionDetector = collisionDetector;
        this.animationController = animationController;
        this.onEmitEvent = onEmitEvent;

        //TODO: move out
        global.app!.on("gameStarted.3PC", this.handleGameStarted);
        global.app!.on("pauseGame.3PC", this.handleGamePaused);
        global.app!.on("gameEnded.3PC", this.handleGameEnded);
        global.app!.on("gameResumed.3PC", this.handleGameResumed);
        global.app!.on("unlockEvent.3PC", this.handleControlUnlock);
    }

    async create(characterObject: Object3D): Promise<Object3D> {
        if (this.character === characterObject) {
            return this.character;
        }

        this.character = characterObject;
        //add player to physics
        const newPlayerObject = await this.physics?.addPlayerObject(characterObject.uuid, true, {
            playerGravity: this.characterOptions.playerGravity,
            jumpHeight: this.characterOptions.jumpHeight,
            stepHeight: this.characterOptions.stepHeight,
            pushObjects: this.characterOptions.pushObjects,
            pushImpulse: this.characterOptions.pushImpulse,
            pushVerticalScale: this.characterOptions.pushVerticalScale,
            maxSlope: this.characterOptions.maxSlope,
        });
        await this.physics.ping(); // wait for the add player to complete
        this.character = newPlayerObject ? newPlayerObject : this.character;

        //hide player object in case of FPS
        const cameraOptions = CameraControl.getCameraOptions(this.cameraControl.camera);
        if (cameraOptions?.cameraType === CAMERA_TYPES.FIRST_PERSON) {
            this.character.visible = false;
        }

        if (this.characterOptions.canClimb !== false && this.characterOptions.climbSpeed > 0) {
            this.setupClimbingHelper();
        } else {
            this.climbingHelper?.dispose();
            this.climbingHelper = null;
        }

        // Initialize animation state manager with the character
        this.animationStateManager.initialize(this.character);

        this.playMovementAnimation(this.characterOptions.idleAnimation);

        this.movePlayerToRandomSpawnPoint();
        this.bodyAngle = this.character.rotation.y;
        this.rotateTowardsBodyAngle();
        this.characterData.target = this.character;
        return this.character;
    }

    setPosition(position: Vector3): void {
        this.character.position.copy(position);

        const positionAux = new Vector3();
        const quaternionAux = new Quaternion();
        const scaleAux = new Vector3();
        PhysicsUtil.calculatePhysicsPositionFromObject(this.character, positionAux, quaternionAux, scaleAux);

        this.physics.setPlayerPosition(this.character.uuid, positionAux);
    }

    getAngle(): number {
        return this.bodyAngle;
    }

    setAngle(angle: number): void {
        this.bodyAngle = angle;
        this.rotateTowardsBodyAngle();
    }

    update = (dt: number) => {
        if (!this.character) return;

        // Update input state once per frame
        this.updateInputState();
        this.updateGroundedState();
        this.updatePreviousMovementState();
        this.updateMovementState();
        this.sendMovementStateNotification();
        this.updateMoveAngle();
        this.rotateTowardsBodyAngle();

        //FIXME: ???
        this.handleUseAction();
        this.handleDropAction();
        this.handlePullAction();
        this.handleKickAction(dt);
        this.character.userData.currentCamera = this.cameraControl.camera;

        // TODO: REMOVE: character and other behaviors should be paused when the game menu is open
        if (!this.scene.userData.isGameMenuOpen) {
            this.movePlayer(dt);
        } else {
            this.velocity.set(0, 0, 0);
        }

        if (this.hasMovementStateChanged()) {
            this.playAnimationFromCurrentState();
        }
    };

    setCharacterOptions(characterOptions: CharacterOptionsInterface) {
        this.characterOptions = characterOptions;
        console.warn(
            `[Character][${this.character?.name || this.character?.uuid || "unbound"}] setCharacterOptions: canClimb=${this.characterOptions.canClimb} climbSpeed=${this.characterOptions.climbSpeed}`,
        );
        if (this.character) {
            this.character.userData.canClimb = this.characterOptions.canClimb !== false && this.characterOptions.climbSpeed > 0;
        }

        const canUseClimbing = this.characterOptions.canClimb !== false && this.characterOptions.climbSpeed > 0;
        if (!canUseClimbing) {
            this.climbingHelper?.stopClimbing();
            this.climbingHelper?.dispose();
            this.climbingHelper = null;
            return;
        }

        if (!this.climbingHelper && this.character) {
            this.setupClimbingHelper();
        }

        if (this.climbingHelper) {
            this.climbingHelper.climbingSpeed = this.characterOptions.climbSpeed;
            this.climbingHelper.playerGravity = this.characterOptions.playerGravity ?? this.physics.getGravity();
        }
    }

    stopMovement(): void {
        this.velocity.set(0, 0, 0);
        this.physics.movePlayerObject(
            this.character.uuid,
            {
                x: 0,
                y: 0,
                z: 0,
            } as Vector3,
            false,
        );
        this.playMovementAnimation(this.characterOptions.idleAnimation);
    }

    stopClimbing() {
        if (this.climbingHelper?.isClimbing) {
            this.climbingHelper.stopClimbing();
        }
    }

    private updateInputState(): void {
        if (this.isUIInputActive()) {
            this.inputState.lateral = 0;
            this.inputState.forward = 0;
            this.inputState.run = false;
            this.inputState.jump = false;
            this.inputState.use = false;
            this.inputState.drop = false;
            this.inputState.pull = false;
            this.inputState.primary = false;
            return;
        }

        this.inputState.lateral = this.inputProvider.getMotion("lateral");
        this.inputState.forward = this.inputProvider.getMotion("forward");
        this.inputState.run = this.inputProvider.getAction("run");
        this.inputState.jump = this.inputProvider.getAction("jump");
        this.inputState.use = this.inputProvider.getAction("use");
        this.inputState.drop = this.inputProvider.getAction("drop");
        this.inputState.pull = this.inputProvider.getAction("pull");
        this.inputState.primary = this.inputProvider.getAction("primary");
    }

    private updateGroundedState() {
        const motionState = MotionStateHelper.getMotionState(this.character);
        this.currentMotionState = motionState;
        if (motionState) {
            this.isGrounded = motionState.onGround;
        } else {
            this.isGrounded = false;
        }

        // Check if the grounded state has changed
        if (this.isGrounded && !this.wasGrounded) {
            this.onLanded();
        }

        if (!this.isGrounded && this.wasGrounded) {
            this.onTakeOff();
        }

        this.wasGrounded = this.isGrounded;
    }

    private updateMovementState() {
        const currentAction = this.movementState.action;
        this.resetMovementState();

        const movementDirection = this.directionOffset();
        const isMoving = this.isMovementActive();
        const isRunning = isMoving && this.inputState.run;

        // Only update movement states if there's significant input
        if (isMoving) {
            // Define angle thresholds for movement detection
            const forwardThreshold = Math.PI / 8; // 22.5 degrees
            const lateralThreshold = Math.PI / 8; // 22.5 degrees

            // Forward/backward detection
            if (Math.abs(movementDirection) < forwardThreshold) {
                this.movementState.forward = MOVEMENT_STATES.FORWARD;
            } else if (Math.abs(movementDirection) > Math.PI - forwardThreshold) {
                this.movementState.forward = MOVEMENT_STATES.BACKWARD;
            }

            // Lateral detection
            if (movementDirection > lateralThreshold && movementDirection < Math.PI - lateralThreshold) {
                this.movementState.lateral = MOVEMENT_STATES.RIGHT;
            } else if (movementDirection < -lateralThreshold && movementDirection > -Math.PI + lateralThreshold) {
                this.movementState.lateral = MOVEMENT_STATES.LEFT;
            }

            this.movementState.mode = isRunning ? MOVEMENT_STATES.RUN : MOVEMENT_STATES.WALK;
        }

        // Handle actions based on movement state
        if (this.inputState.jump && this.canJump()) {
            this.climbingHelper?.stopClimbing();
            this.movementState.action = MOVEMENT_STATES.JUMP;
            this.isJumping = true;
        } else if (this.climbingHelper?.isClimbing) {
            this.movementState.action = MOVEMENT_STATES.CLIMB;
        } else if (!this.isGrounded) {
            if (this.isPlayerFalling()) {
                this.movementState.action = MOVEMENT_STATES.FALL;
            } else if (this.isPlayerJumping()) {
                this.movementState.action = MOVEMENT_STATES.JUMP;
            } else {
                this.movementState.action = currentAction;
            }
        }
    }

    private resetMovementState() {
        this.movementState.forward = MOVEMENT_STATES.NONE;
        this.movementState.lateral = MOVEMENT_STATES.NONE;
        this.movementState.mode = MOVEMENT_STATES.NONE;
        this.movementState.action = MOVEMENT_STATES.NONE;
    }

    private isMovementActive(): boolean {
        return Math.abs(this.inputState.lateral) > 0.01 || Math.abs(this.inputState.forward) > 0.01;
    }

    /**
     * Called by ClimbingHelper when the player collides with a climbable
     * object.
     *
     * @param climbable - The climbable object that the player has collided with
     */
    private onClimbableCollision(climbable: Object3D) {
        if (
            this.characterOptions.canClimb === false ||
            this.characterOptions.climbSpeed <= 0 ||
            this.character.userData.canClimb === false
        ) {
            return;
        }

        if (!this.climbingHelper || this.movementState.action !== MOVEMENT_STATES.NONE || !this.isMovementActive()) {
            return;
        }

        // If the body isn't oriented in the same direction as the move angle,
        // don't start climbing
        const deltaAngle = Math.abs(this.shortestAngle(this.bodyAngle, this.moveAngle));
        if (deltaAngle > Math.PI / 10) {
            return;
        }

        // Use the helper to determine if the player should start climbing.
        const inputMoveDirection = this.inputMoveDirection
            .set(Math.sin(this.moveAngle), 0, Math.cos(this.moveAngle))
            .normalize();

        const shouldStartClimbing = this.climbingHelper.shouldStartClimbing(inputMoveDirection, climbable);

        if (!shouldStartClimbing) {
            return;
        }

        // Start climbing.
        this.climbingHelper.startClimbing(climbable);
    }

    //TODO: move out
    private movePlayerToRandomSpawnPoint() {
        const spawnPoints = this.getSpawnPointObjects();

        if (spawnPoints.length > 0) {
            // select random spawn points
            const spawnPoint = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

            this.character.position.copy(spawnPoint!.position);
            this.character.quaternion.copy(spawnPoint!.quaternion);

            this.setPosition(spawnPoint!.position);
        }
    }

    private getSpawnPointObjects(): Object3D[] {
        const spawnPoints: Object3D[] = [];

        traverseObjectDepthFirst(this.scene, child => {
            if (child.userData.isSpawnPoint) {
                spawnPoints.push(child);
            }
        });

        return spawnPoints;
    }

    private handleControlUnlock = () => {
        if (!this.gamePaused) {
            global.app!.call("pauseGame");
        }
    };

    private handleGamePaused = (): void => {
        this.gamePaused = true;
        EventBus.instance.send("game.pause");
    };

    private handleGameEnded = (): void => {
        this.cameraControl?.unlockPointerLock();
        this.gamePaused = true;
    };

    private handleGameStarted = (): void => {
        void this.cameraControl?.requestPointerLock();
        this.gamePaused = false;
    };

    private handleGameResumed = (): void => {
        this.gamePaused = false;
    };

    private handleUseAction(): void {
        const wasPressed = this.character.userData.pressE === true;
        this.character.userData.pressE = this.inputState.use;
        this.scene.userData.pressE = this.inputState.use;
        if (this.inputState.use && !wasPressed) {
            EventBus.instance.send(IN_GAME_EVENTS.CHARACTER_ACTION_INTERACT, this.characterData);
        }
    }

    private handleDropAction(): void {
        this.character.userData.pressF = this.inputState.drop;
        this.scene.userData.pressF = this.inputState.drop;
    }

    private handlePullAction(): void {
        this.character.userData.pressP = this.inputState.pull;
        this.scene.userData.pressP = this.inputState.pull;
    }

    private handleKickAction(dt: number): void {
        if (this.kickCooldownTimer > 0) {
            this.kickCooldownTimer -= dt;
            return;
        }

        if (!this.characterOptions.kickObjects) return;
        if (!this.inputState.primary) return;

        this.isKicking = true;

        const kickAnim = this.characterOptions.kickAnimation;
        if (kickAnim && kickAnim !== "none") {
            this.triggerAnimation(kickAnim, { loop: false, priority: AnimationPriority.HIGH });
        }

        this.physics.kickNearbyObjects(this.character.uuid, this.characterOptions.kickImpulse);
        this.kickCooldownTimer = 0.5;
        this.isKicking = false;
    }

    private playAnimationFromCurrentState(): void {
        // Skip if a manual animation is active and blocking movement animations
        if (this.animationStateManager.shouldBlockMovementAnimations()) {
            return;
        }

        switch (this.movementState.action) {
            case MOVEMENT_STATES.CLIMB:
                this.playMovementAnimation(this.characterOptions.climbAnimation);
                break;
            case MOVEMENT_STATES.JUMP:
                this.playMovementAnimation(this.characterOptions.jumpAnimation, false);
                break;
            case MOVEMENT_STATES.FALL:
                this.playMovementAnimation(this.characterOptions.fallAnimation);
                break;
            default:
                switch (this.movementState.mode) {
                    case MOVEMENT_STATES.RUN:
                        this.playMovementAnimation(this.characterOptions.runAnimation);
                        break;
                    case MOVEMENT_STATES.WALK:
                        this.playMovementAnimation(this.characterOptions.walkAnimation);
                        break;
                    default:
                        this.playMovementAnimation(this.characterOptions.idleAnimation);
                        break;
                }
                break;
        }
    }

    private emitEvent(eventName: string, data?: any): void {
        this.onEmitEvent?.(eventName, data);
    }

    private updatePreviousMovementState() {
        this.previousMovementState.forward = this.movementState.forward;
        this.previousMovementState.lateral = this.movementState.lateral;
        this.previousMovementState.mode = this.movementState.mode;
        this.previousMovementState.action = this.movementState.action;
    }

    private hasMovementStateChanged(): boolean {
        return (
            this.movementState.forward !== this.previousMovementState.forward ||
            this.movementState.lateral !== this.previousMovementState.lateral ||
            this.movementState.mode !== this.previousMovementState.mode ||
            this.movementState.action !== this.previousMovementState.action
        );
    }

    private isIdleMode(mode: MOVEMENT_STATES): boolean {
        return mode === MOVEMENT_STATES.IDLE || mode === MOVEMENT_STATES.NONE;
    }

    private sendMovementStateNotification() {
        const current = this.movementState;
        const previous = this.previousMovementState;
        const isIdle = this.isIdleMode(current.mode);
        const wasIdle = this.isIdleMode(previous.mode);

        // Idle state
        if (isIdle) {
            EventBus.instance.send(IN_GAME_EVENTS.CHARACTER_IDLE, this.characterData);
        }

        // motion transitions (moving/walking/running)
        if (!wasIdle && isIdle) {
            EventBus.instance.send(IN_GAME_EVENTS.CHARACTER_MOTION_END, this.characterData);
        } else if (wasIdle && !isIdle) {
            EventBus.instance.send(IN_GAME_EVENTS.CHARACTER_MOTION_START, this.characterData);
        } else if (!isIdle) {
            EventBus.instance.send(IN_GAME_EVENTS.CHARACTER_MOTION, this.characterData);
        }

        this.sendStateTransitionEvents(
            current.mode,
            previous.mode,
            MOVEMENT_STATES.WALK,
            IN_GAME_EVENTS.CHARACTER_MOTION_WALK_START,
            IN_GAME_EVENTS.CHARACTER_MOTION_WALK,
            IN_GAME_EVENTS.CHARACTER_MOTION_WALK_END,
        );

        this.sendStateTransitionEvents(
            current.mode,
            previous.mode,
            MOVEMENT_STATES.RUN,
            IN_GAME_EVENTS.CHARACTER_MOTION_RUN_START,
            IN_GAME_EVENTS.CHARACTER_MOTION_RUN,
            IN_GAME_EVENTS.CHARACTER_MOTION_RUN_END,
        );

        // Action transitions
        this.sendStateTransitionEvents(
            current.action,
            previous.action,
            MOVEMENT_STATES.JUMP,
            IN_GAME_EVENTS.CHARACTER_ACTION_JUMP_START,
            IN_GAME_EVENTS.CHARACTER_ACTION_JUMP,
            IN_GAME_EVENTS.CHARACTER_ACTION_LAND,
        );

        this.sendStateTransitionEvents(
            current.action,
            previous.action,
            MOVEMENT_STATES.CLIMB,
            IN_GAME_EVENTS.CHARACTER_ACTION_CLIMB_START,
            IN_GAME_EVENTS.CHARACTER_ACTION_CLIMB,
            IN_GAME_EVENTS.CHARACTER_ACTION_CLIMB_END,
        );

        this.sendStateTransitionEvents(
            current.action,
            previous.action,
            MOVEMENT_STATES.CROUCH,
            IN_GAME_EVENTS.CHARACTER_ACTION_CROUCH_START,
            IN_GAME_EVENTS.CHARACTER_ACTION_CROUCH,
            IN_GAME_EVENTS.CHARACTER_ACTION_CROUCH_END,
        );

        this.sendStateTransitionEvents(
            current.action,
            previous.action,
            MOVEMENT_STATES.FALL,
            IN_GAME_EVENTS.CHARACTER_ACTION_FALL_START,
            IN_GAME_EVENTS.CHARACTER_ACTION_FALL,
            IN_GAME_EVENTS.CHARACTER_ACTION_FALL_END,
        );
    }

    private sendStateTransitionEvents(
        currentState: MOVEMENT_STATES,
        previousState: MOVEMENT_STATES,
        targetState: MOVEMENT_STATES,
        startEvent: string,
        continuousEvent: string,
        stopEvent: string,
    ) {
        if (currentState === targetState) {
            if (previousState !== targetState) {
                EventBus.instance.send(startEvent, this.characterData);
            }
            EventBus.instance.send(continuousEvent, this.characterData);
        }
        if (previousState === targetState && currentState !== targetState) {
            EventBus.instance.send(stopEvent, this.characterData);
        }
    }

    /**
     * Internal method for playing movement animations (idle, walk, run, jump, etc.).
     * Respects the manual animation priority system.
     * @param animationName
     * @param loop
     */
    private playMovementAnimation(animationName: string, loop: boolean = true): void {
        if (!animationName || animationName === "none") {
            this.animationController.stopAnimation(this.character);
            this.currentAnimationName = animationName;
            return;
        }

        if (this.currentAnimationName === animationName) {
            // TODO: check if non loop animation is already playing
            return;
        }

        this.currentAnimationName = animationName;

        // Use AnimationController to play the animation
        this.animationController.playAnimation(
            this.character,
            animationName,
            1, // speed
            !loop,
            0.25, // fadeDuration
        );

        this.physics.setCurrentAnimation(this.character.uuid, animationName);
    }

    // ==========================================
    // IPlayerAnimationController Implementation
    // ==========================================

    /**
     * Trigger an animation by name with optional configuration.
     * @implements IPlayerAnimationController.triggerAnimation
     */
    triggerAnimation(animationName: string, options?: AnimationTriggerOptions): boolean {
        if (!this.character) {
            return false;
        }

        // Validate animation exists
        if (!this.animationStateManager.validateAnimationName(animationName)) {
            console.warn(`[BipedalControl] Animation "${animationName}" not found on character`);
            return false;
        }

        const priority = options?.priority ?? AnimationPriority.NORMAL;
        const loop = options?.loop ?? true;
        const speed = options?.speed ?? 1.0;
        const fadeDuration = options?.fadeDuration ?? 0.25;

        // Check if we can interrupt the current manual animation
        if (!this.animationStateManager.canInterrupt(priority)) {
            return false;
        }

        // Set up completion callback
        const onComplete = () => {
            this.animationStateManager.clearManualAnimation();
            options?.onComplete?.();
            // Resume movement animations
            this.playAnimationFromCurrentState();
        };

        // Set the manual animation state
        this.animationStateManager.setManualAnimation(animationName, priority, loop);
        this.currentAnimationName = animationName;

        // Play the animation
        this.animationController.playAnimation(
            this.character,
            animationName,
            speed,
            !loop,
            fadeDuration,
            loop ? undefined : onComplete,
        );

        this.physics.setCurrentAnimation(this.character.uuid, animationName);
        return true;
    }

    /**
     * Stop the current manually triggered animation and resume movement animations.
     * @implements IPlayerAnimationController.stopAnimation
     */
    stopAnimation(): void {
        if (!this.animationStateManager.isManualAnimationActive()) {
            return;
        }

        this.animationStateManager.clearManualAnimation();
        this.playAnimationFromCurrentState();
    }

    /**
     * Play multiple animations simultaneously with blend weights.
     * @implements IPlayerAnimationController.playBlendedAnimations
     */
    playBlendedAnimations(blends: BlendedAnimationParams[]): void {
        if (!this.character || blends.length === 0) {
            return;
        }

        // Filter to valid animations only
        const validBlends = blends.filter(b => {
            const name = typeof b.name === "string" ? b.name : b.name?.name;
            return name && this.animationStateManager.validateAnimationName(name);
        });

        if (validBlends.length === 0) {
            console.warn("[BipedalControl] No valid animations in blend request");
            return;
        }

        this.animationController.playBlendedAnimations(this.character, validBlends);

        // Update current animation name to the first blend
        const firstName = validBlends[0]!.name;
        this.currentAnimationName = typeof firstName === "string" ? firstName : firstName?.name ?? null;
    }

    /**
     * Update the weights of currently blended animations.
     * @implements IPlayerAnimationController.updateBlendWeights
     */
    updateBlendWeights(weights: Record<string, number>): void {
        if (!this.character) {
            return;
        }
        this.animationController.updateBlendedAnimationWeights(this.character, weights);
    }

    /**
     * Get the name of the currently playing animation.
     * @implements IPlayerAnimationController.getCurrentAnimationName
     */
    getCurrentAnimationName(): string | null {
        return this.currentAnimationName;
    }

    /**
     * Check if an animation is currently playing.
     * @implements IPlayerAnimationController.isAnimationPlaying
     */
    isAnimationPlaying(animationName?: string): boolean {
        if (!this.currentAnimationName) {
            return false;
        }
        if (animationName) {
            return this.currentAnimationName === animationName;
        }
        return true;
    }

    /**
     * Get a list of all available animation names on the character.
     * @implements IPlayerAnimationController.getAvailableAnimations
     */
    getAvailableAnimations(): string[] {
        return this.animationStateManager.getAvailableAnimations();
    }

    private isPlayerFalling(): boolean {
        const motionState = this.currentMotionState;
        if (motionState) {
            return motionState.linearVelocity.y < 0;
        }
        return false;
    }

    private isPlayerJumping(): boolean {
        const motionState = this.currentMotionState;
        if (motionState) {
            return motionState.linearVelocity.y > 0;
        }
        return false;
    }

    private movePlayer(dt: number) {
        if (this.movementState.action === MOVEMENT_STATES.CLIMB) {
            this.updateClimbing(dt);
        } else {
            let doJump = false;
            switch (this.movementState.action) {
                case MOVEMENT_STATES.JUMP:
                    if (this.isJumping) {
                        doJump = true;
                        this.isJumping = false;
                    }

                    break;
                case MOVEMENT_STATES.FALL:
                    break;
                default:
                    this.isJumping = false;
                    break;
            }
            this.updateMotion(doJump);
        }

        this.updateCamera(dt);
    }

    private canJump(): boolean {
        const isInJumpableState = this.isGrounded || Boolean(this.climbingHelper?.isClimbing);
        return this.characterOptions.jumpHeight > 0 && isInJumpableState;
    }

    private updateClimbing(dt: number) {
        if (
            this.characterOptions.canClimb === false ||
            this.characterOptions.climbSpeed <= 0 ||
            this.character.userData.canClimb === false
        ) {
            this.climbingHelper?.stopClimbing();
            return;
        }

        const isMoving = this.inputState.forward !== 0;
        const climbDirection = isMoving ? this.inputState.forward > 0 ? 1 : -1 : 0;

        this.climbingHelper?.move(climbDirection * this.characterOptions.climbSpeed, dt);
        this.animationController.setAnimationPaused(this.character, !isMoving);
    }

    private updateMotion(doJump: boolean): void {
        this.updateMotionTuningCache();

        const speedMultiplier = 1 / 60;
        let inputSpeed = 0;
        switch (this.movementState.mode) {
            case MOVEMENT_STATES.RUN:
                inputSpeed = this.characterOptions.runSpeed * speedMultiplier;
                break;
            case MOVEMENT_STATES.WALK:
                inputSpeed = this.characterOptions.walkSpeed * speedMultiplier;
                break;
        }

        const inputMoveDirection = this.inputMoveDirection;
        if (inputSpeed > 0) {
            inputMoveDirection
                .set(Math.sin(this.moveAngle), 0, Math.cos(this.moveAngle))
                .normalize();
        }

        if (this.isGrounded) {
            this.handleGroundMovement(inputSpeed, inputMoveDirection);
        } else {
            this.handleAirMovement(inputSpeed, inputMoveDirection);
        }

        this.movePlayerVelocity.set(this.velocity.x, 0, this.velocity.z);
        this.physics.movePlayerObject(this.character.uuid, this.movePlayerVelocity, doJump);
    }

    private handleGroundMovement(inputSpeed: number, inputMoveDirection: Vector3): void {
        if (inputSpeed > 0) {
            // Accelerate towards the target speed.
            const targetVelocity = inputMoveDirection.multiplyScalar(inputSpeed);
            this.velocity.lerp(targetVelocity, this.groundAccelerationCoefficient);
        } else {
            // Apply friction when there is no input.
            this.velocity.multiplyScalar(this.groundDecelerationCoefficient);
            if (this.velocity.lengthSq() < MOVEMENT_STOP_EPSILON_SQ) {
                this.velocity.set(0, 0, 0);
            }
        }
    }

    private handleAirMovement(inputSpeed: number, inputMoveDirection: Vector3): void {
        // In the air, preserve momentum. Air control should not reduce speed.
        if (inputSpeed > 0) {
            const speed = this.velocity.length();
            const airControlTargetSpeed = Math.max(inputSpeed, speed);
            // Apply air control if there is input.
            const targetVelocity = inputMoveDirection.multiplyScalar(airControlTargetSpeed);
            this.velocity.lerp(targetVelocity, this.airAccelerationCoefficient);
        }

        // Always apply air friction.
        this.velocity.multiplyScalar(this.airDecelerationCoefficient);
        if (this.velocity.lengthSq() < MOVEMENT_STOP_EPSILON_SQ) {
            this.velocity.set(0, 0, 0);
        }
    }

    private updateCamera(dt: number): void {
        this.cameraControl?.update(dt);
    }

    private updateMotionTuningCache(): void {
        const options = this.characterOptions;

        if (options.groundAcceleration !== this.groundAccelerationInput) {
            this.groundAccelerationInput = options.groundAcceleration;
            this.groundAccelerationCoefficient = this.linearToExp(options.groundAcceleration);
        }
        if (options.groundDeceleration !== this.groundDecelerationInput) {
            this.groundDecelerationInput = options.groundDeceleration;
            this.groundDecelerationCoefficient = 1 - this.linearToExp(options.groundDeceleration);
        }
        if (options.airAcceleration !== this.airAccelerationInput) {
            this.airAccelerationInput = options.airAcceleration;
            this.airAccelerationCoefficient = this.linearToExp(options.airAcceleration);
        }
        if (options.airDeceleration !== this.airDecelerationInput) {
            this.airDecelerationInput = options.airDeceleration;
            this.airDecelerationCoefficient = 1 - this.linearToExp(options.airDeceleration);
        }
    }

    private linearToExp(value: number): number {
        return value * value;
    }

    private onTakeOff(): void {
        // this.emitEvent(`character.state.${MOVEMENT_STATES.TAKE_OFF}`);
    }

    private onLanded(): void {
        EventBus.instance.send(IN_GAME_EVENTS.CHARACTER_ACTION_LAND, this.characterData);
    }

    private updateMoveAngle() {
        // Don't rotate the character when not moving or when climbing
        if (this.movementState.mode === MOVEMENT_STATES.NONE || this.movementState.action === MOVEMENT_STATES.CLIMB) {
            return;
        }

        const cameraAngle = this.getCameraDirectionAngle();
        const currentMoveAngle = cameraAngle;
        const targetAngle = this.normalizeAngle(currentMoveAngle + this.directionOffset());

        const shortestAngle = this.shortestAngle(this.bodyAngle, targetAngle);

        this.bodyAngle += shortestAngle * this.characterOptions.lookSpeed;
        this.moveAngle = targetAngle;
    }

    private rotateTowardsBodyAngle(): void {
        let currentBodyAngle = this.bodyAngle;
        if (this.characterOptions.invertForwardDirection) {
            currentBodyAngle += Math.PI;
        }

        this.rotateQuarternion.setFromAxisAngle(this.rotateAngle, currentBodyAngle);
        this.physics.setRotation(this.character.uuid, this.rotateQuarternion);
    }

    private getCameraDirectionAngle(): number {
        const cameraDirection = this.cameraDirection;
        this.cameraControl.camera.getWorldDirection(cameraDirection);
        cameraDirection.y = 0; // Ignore vertical direction
        cameraDirection.normalize();
        return Math.atan2(cameraDirection.x, cameraDirection.z);
    }

    private shortestAngle(from: number, to: number): number {
        const a = this.normalizeAngle(from);
        const b = this.normalizeAngle(to);
        let delta = b - a;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        return delta;
    }

    private normalizeAngle(angle: number): number {
        return (angle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    }

    private directionOffset() {
        // Use centralized input state with deadzone for smoother control
        const deadzone = 0.1;
        const lateral = Math.abs(this.inputState.lateral) > deadzone ? this.inputState.lateral : 0;
        const forward = Math.abs(this.inputState.forward) > deadzone ? this.inputState.forward : 0;

        // No movement
        if (Math.abs(lateral) <= deadzone && Math.abs(forward) <= deadzone) {
            return 0;
        }

        // Calculate smooth direction offset using atan2
        // atan2(lateral, forward) gives us the angle from forward direction
        // lateral is X-axis (left/right), forward is Y-axis (forward/backward)
        const directionOffset = Math.atan2(-lateral, forward);

        return directionOffset;
    }

    private isUIInputActive() {
        const activeElement = document.activeElement;

        return (
            activeElement &&
            (activeElement.tagName === "TEXTAREA" ||
                activeElement.tagName === "INPUT" && activeElement.getAttribute("type") !== "checkbox" ||
                activeElement.role === "textbox")
        );
    }

    private setupClimbingHelper() {
        this.climbingHelper?.dispose();
        this.climbingHelper = new ClimbingHelper(
            this.scene,
            this.character,
            this.physics,
            this.cameraControl,
            this.collisionDetector,
            this.onClimbableCollision.bind(this),
        );
        this.climbingHelper.climbingSpeed = this.characterOptions.climbSpeed;
        this.climbingHelper.playerGravity = this.characterOptions.playerGravity ?? this.physics.getGravity();
        this.climbingHelper.addLisiteners();
    }

    public dispose() {
        if (global.app) {
            global.app.on("gameStarted.3PC", null);
            global.app.on("pauseGame.3PC", null);
            global.app.on("gameEnded.3PC", null);
            global.app.on("gameResumed.3PC", null);
            global.app.on("unlockEvent.3PC", null);
        }

        // Stop current animation using AnimationController
        if (this.character) {
            this.animationController.stopAnimation(this.character);
        }

        if (this.cameraControl) {
            this.cameraControl.dispose();
        }

        this.climbingHelper?.dispose();
        this.climbingHelper = null;

        // Clean up animation state manager
        this.animationStateManager.dispose();
    }
}

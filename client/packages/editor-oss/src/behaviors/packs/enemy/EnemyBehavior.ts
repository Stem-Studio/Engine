import * as THREE from "three";

import {IMultiplayerState} from "../../../behaviors/state/IMultiplayerState";
import {IPhysics} from "../../../physics/common/types";
import {COLLISION_TYPE, GAME_STATE} from "@stem/editor-oss/types/editor";
import CameraUtils from "@stem/editor-oss/utils/CameraUtils";
import {setManagedTimeout} from "@stem/editor-oss/utils/ModeExitCleaner";
import {parseTransformVectorState, serializeTransformVectorState} from "@stem/editor-oss/utils/transformStateSerialization";
import {BehaviorBase} from "../../Behavior";
import EventBus, {IN_GAME_EVENTS} from "../../event/EventBus";
import GameManager from "../../game/GameManager";

enum EnemyState {
    STANDING = "standing",
    APPROACHING = "approaching",
    RETREATING = "retreating",
    ATTACKING = "attacking",
}

const DEFAULT_ENGAGE_DISTANCE = 10;
const DEFAULT_STRIKE_DISTANCE = 3;
const DEFAULT_IDLE_RETREAT_DELAY = 5;
const DEFAULT_RETREAT_DURATION = 2;

class EnemyBehavior extends BehaviorBase {
    // attributes
    startOnTrigger: boolean = false;

    private engine: any | null = null;
    private physics: IPhysics | null = null;
    private multiplayerState?: IMultiplayerState | null = null;
    private enemyEnabled: boolean = true;
    private originalPosition: THREE.Vector3 = new THREE.Vector3();
    private roamObject: THREE.Mesh | null = null;
    private playerCollisionListenerId: string | undefined;
    private bulletCollisionListenerId: string | undefined;
    private lives: number = 3;
    private moveDirection: THREE.Vector3 = new THREE.Vector3();
    private moveTimer: number = 0;
    private deltaTime: number = 0;
    private removed: boolean = false;
    private playerPosition: THREE.Vector3 = new THREE.Vector3();
    private prevPlayerPosition: THREE.Vector3 = new THREE.Vector3();
    private lastPlayerMoveTime: number = 0;
    private distanceToPlayerSq: number = 0;
    private distanceToOriginalPositionSq: number = 0;
    private stateTimer: number = 0;
    private state: EnemyState = EnemyState.STANDING;
    private deathAnimationStarted: boolean = false;
    private currentRotation = new THREE.Quaternion();
    private standingDuration: number = Math.random() * 3 + 2;
    private smoothingFactor: number = 0.05;
    private playerDetected: boolean = false;
    private readonly yAxis = new THREE.Vector3(0, 1, 0);
    private readonly forwardDirection = new THREE.Vector3();
    private readonly targetDirection = new THREE.Vector3();
    private readonly statePosition = new THREE.Vector3();
    private readonly stateEuler = new THREE.Euler();
    private readonly stateQuaternion = new THREE.Quaternion();
    private readonly roamBounds = new THREE.Box3();
    private readonly roamCenter = new THREE.Vector3();

    init(gameManager: GameManager) {
        this.game = gameManager;
        this.engine = gameManager.engine;
        this.physics = this.game.physics!;
        this.multiplayerState = this.game.multiplayerState;
    }

    onAdded(): void {
        this.addCollisionListeners(true, true);
        this.initEnemies();
        CameraUtils.disableCameraCollision(this.target);
        this.lastPlayerMoveTime = Date.now();

        // Send enemy spawned event
        EventBus.instance.send(IN_GAME_EVENTS.ENEMY_SPAWNED, {
            target: this.target,
            position: this.target.position.clone(),
            lives: this.lives,
        });
    }

    onRemoved(): void {}

    onReset() {}

    private isDead() {
        return this.lives <= 0;
    }

    private changeState(newState: EnemyState) {
        if (this.state !== newState) {
            const previousState = this.state;
            this.state = newState;

            // Send state change event
            EventBus.instance.send(IN_GAME_EVENTS.ENEMY_STATE_CHANGED, {
                target: this.target,
                previousState,
                newState,
                position: this.target.position.clone(),
            });
        }
    }

    private getNumberAttribute(key: string, fallback: number): number {
        const value = Number(this.attributes[key]);
        return Number.isFinite(value) && value >= 0 ? value : fallback;
    }

    private getEngageDistance(): number {
        return this.getNumberAttribute("engageDistance", DEFAULT_ENGAGE_DISTANCE);
    }

    private getStrikeDistance(): number {
        return this.getNumberAttribute("strikeDistance", DEFAULT_STRIKE_DISTANCE);
    }

    private getIdleRetreatDelay(): number {
        return this.getNumberAttribute("idleRetreatDelay", DEFAULT_IDLE_RETREAT_DELAY);
    }

    private getRetreatDuration(): number {
        return this.getNumberAttribute("retreatDuration", DEFAULT_RETREAT_DURATION);
    }

    private isDistanceLessThan(distanceSq: number, threshold: unknown): boolean {
        const value = Number(threshold);
        if (!Number.isFinite(value) || value < 0) return false;
        return distanceSq < value * value;
    }

    private isDistanceGreaterThan(distanceSq: number, threshold: unknown): boolean {
        const value = Number(threshold);
        if (!Number.isFinite(value)) return false;
        if (value < 0) return true;
        return distanceSq > value * value;
    }

    private getDistanceToPlayer(): number {
        return Math.sqrt(this.distanceToPlayerSq);
    }

    private initEnemies() {
        if (!this.game || !this.game.player || !this.game.scene) return;
        const sceneHelpers = this.game.engine.sceneHelpers;
        const circleMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
        });

        if (this.target) {
            this.originalPosition.copy(this.target.position);

            if (!!this.enemyEnabled && !!this.attributes.showRoamArea) {
                this.roamBounds.setFromObject(this.target);
                const center = this.roamCenter;
                this.roamBounds.getCenter(center);
                const geometry = new THREE.CircleGeometry(this.attributes.roamDistance, 32);
                const circle = new THREE.Mesh(geometry, circleMaterial);
                circle.position.set(center.x, center.y, center.z);
                circle.rotation.x = -Math.PI / 2;
                sceneHelpers.add(circle);
                this.roamObject = circle;
            }
            // }
            this.physics?.removeCollidableObject(this.target.uuid);
        }
    }

    private addCollisionListeners(withPlayer: boolean, withBullet: boolean) {
        if (withPlayer) {
            this.playerCollisionListenerId = this.game?.collisionDetector?.addListener(
                this.target,
                {
                    type: COLLISION_TYPE.WITH_PLAYER,
                    callback: this.onCollisionWithPlayer.bind(this),
                    useBoundingBoxes: false,
                    distanceThreshold: 2.0,
                },
                this.target.userData.physics && this.target.userData.physics.enabled,
            );
        }
        if (withBullet) {
            this.bulletCollisionListenerId = this.game?.collisionDetector?.addListener(
                this.target,
                {
                    type: COLLISION_TYPE.WITH_COLLIDABLE_OBJECTS,
                    callback: this.onCollisionWithThrowable.bind(this),
                    useBoundingBoxes: false,
                    distanceThreshold: 2.0,
                },
                this.target.userData.physics && this.target.userData.physics.enabled,
            );
        }
    }

    private onCollisionWithThrowable() {
        if (this.lives > 0) {
            this.lives--;

            // Send enemy hit event
            EventBus.instance.send(IN_GAME_EVENTS.ENEMY_GOT_HIT, {
                target: this.target,
                remainingLives: this.lives,
                position: this.target.position.clone(),
            });

            if (this.isDead()) {
                // Send enemy died event
                EventBus.instance.send(IN_GAME_EVENTS.ENEMY_DIED, {
                    target: this.target,
                    position: this.target.position.clone(),
                });
                this.game!.collisionDetector!.deleteListener(this.target);
            } else {
                this.game!.collisionDetector!.deleteListener(this.target, this.bulletCollisionListenerId);
                setManagedTimeout(() => {
                    this.addCollisionListeners(false, true);
                }, 500);
            }
        }
    }

    private onCollisionWithPlayer() {
        if (this.enemyEnabled) {
            EventBus.instance.send(IN_GAME_EVENTS.CHARACTER_ACTION_FALL_BACK);
            EventBus.instance.send(IN_GAME_EVENTS.GAME_HEALTH_DEC, this.attributes.attackDamage);
            EventBus.instance.send(IN_GAME_EVENTS.ENEMY_ATTACK, {
                target: this.target,
                targetDistance: this.getDistanceToPlayer(),
                position: this.target.position.clone(),
            });
            this.game!.collisionDetector!.deleteListener(this.target, this.playerCollisionListenerId);
            setManagedTimeout(() => {
                this.addCollisionListeners(true, false);
            }, 5000);
        }
    }

    private playAnimation(
        enemy: THREE.Object3D,
        animationName?: string,
        forceRestart = false,
        finishCallback: (() => void) | null = null,
    ) {
        if (animationName && (enemy.userData.currentAnimation !== animationName || forceRestart)) {
            let playOnce = this.isDead();
            this.engine?.animationControl.playAnimation(enemy, animationName, 1, playOnce, 0.5, finishCallback);
            enemy.userData.currentAnimation = animationName;
        }
    }

    private stopAnimation = () => {
        this.engine?.animationControl.stopAnimation(this.target);
    };

    private moveInRandomDirection = (directionDuration: number) => {
        if (this.moveTimer <= 0) {
            this.moveTimer = Math.random() * directionDuration + directionDuration;
            this.moveDirection.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1).normalize();
        }
        this.moveTimer -= this.deltaTime;
    };

    update(delta: number): void {
        if (
            !this.game ||
            !this.game.player ||
            !this.game.scene ||
            this.removed ||
            this.game.state === GAME_STATE.PAUSED
        ) {
            this.stopAnimation();
            return;
        }

        // Non-host clients only update animations and sync state
        if (this.multiplayerState && !this.multiplayerState.isHost()) {
            return;
        }

        const player = this.game.player;
        player.getWorldPosition(this.playerPosition);
        //avoiding excessive copying
        const playerMoved = this.playerPosition.distanceToSquared(this.prevPlayerPosition) > 0.01;

        if (playerMoved) {
            this.prevPlayerPosition.copy(this.playerPosition);
            this.lastPlayerMoveTime = Date.now();
        }
        const distanceToPlayerSq = this.target.position.distanceToSquared(this.playerPosition);

        this.deltaTime = delta; // ?

        if (this.target && !this.isDead() && this.enemyEnabled) {
            this.distanceToPlayerSq = distanceToPlayerSq;
            this.distanceToOriginalPositionSq = this.target.position.distanceToSquared(this.originalPosition);

            // Handle player detection
            const playerInRange = this.isDistanceLessThan(this.distanceToPlayerSq, this.attributes.roamDistance); // Detection range
            if (playerInRange && !this.playerDetected) {
                this.playerDetected = true;
                EventBus.instance.send(IN_GAME_EVENTS.ENEMY_PLAYER_DETECTED, {
                    target: this.target,
                    playerDistance: this.getDistanceToPlayer(),
                    position: this.target.position.clone(),
                });
            } else if (!playerInRange && this.playerDetected) {
                this.playerDetected = false;
                EventBus.instance.send(IN_GAME_EVENTS.ENEMY_PLAYER_LOST, {
                    target: this.target,
                    playerDistance: this.getDistanceToPlayer(),
                    position: this.target.position.clone(),
                });
            }

            this.stateTimer += this.deltaTime;

            const engageDistance = this.getEngageDistance();
            const strikeDistance = this.getStrikeDistance();
            const idleRetreatDelay = this.getIdleRetreatDelay();
            const retreatDuration = this.getRetreatDuration();

            switch (this.state) {
                case EnemyState.STANDING:
                    this.enemyStand();
                    if (this.isDistanceLessThan(distanceToPlayerSq, engageDistance)) {
                        this.changeState(EnemyState.APPROACHING);
                        this.stateTimer = 0;
                    } else if (this.stateTimer > idleRetreatDelay) {
                        this.changeState(EnemyState.RETREATING);
                        this.stateTimer = 0;
                    }
                    break;
                case EnemyState.APPROACHING:
                    this.enemyApproach();
                    if (this.isDistanceLessThan(distanceToPlayerSq, strikeDistance)) {
                        this.changeState(EnemyState.ATTACKING);
                        this.stateTimer = 0;
                    } else if (this.isDistanceGreaterThan(distanceToPlayerSq, engageDistance)) {
                        this.changeState(EnemyState.RETREATING);
                        this.stateTimer = 0;
                    }
                    break;
                case EnemyState.RETREATING:
                    this.enemyRetreat();
                    if (this.isDistanceLessThan(distanceToPlayerSq, engageDistance)) {
                        this.changeState(EnemyState.APPROACHING);
                        this.stateTimer = 0;
                    } else if (this.stateTimer > retreatDuration) {
                        this.changeState(EnemyState.STANDING);
                        this.stateTimer = 0;
                    }
                    break;
                case EnemyState.ATTACKING:
                    this.enemyAttack();
                    if (this.isDistanceGreaterThan(distanceToPlayerSq, strikeDistance)) {
                        this.changeState(EnemyState.APPROACHING);
                        this.stateTimer = 0;
                    }
                    break;
            }
        }

        if (this.isDead() && !this.deathAnimationStarted) {
            this.playAnimation(this.target, this.attributes.dieAnimation, true, () => {
                if (this.target instanceof THREE.Object3D && this.target.parent !== null) {
                    this.game!.physics?.removeObject(this.target.uuid);
                    this.removed = true;

                    // Send final enemy removal event
                    EventBus.instance.send(IN_GAME_EVENTS.ENEMY_DIED, {
                        target: this.target,
                        position: this.target.position.clone(),
                        finalEvent: true,
                    });
                }
            });
            this.deathAnimationStarted = true;
        }

        this.roamObject?.position.set(this.target.position.x, this.roamObject.position.y, this.target.position.z);

        const targetRotation = Math.atan2(this.moveDirection.x, this.moveDirection.z);

        if (this.target.userData.currentAnimation === this.attributes.idleAnimation) {
            this.target.rotation.y = THREE.MathUtils.lerp(
                this.target.rotation.y,
                targetRotation,
                this.attributes.rotationSpeed * this.deltaTime,
            );
        }

        this.currentRotation.setFromAxisAngle(this.yAxis, targetRotation);

        if (this.isDistanceGreaterThan(this.distanceToPlayerSq, this.attributes.fightDistance)) {
            this.physics!.setRotation(this.target.uuid, this.currentRotation);

            const forwardDirection = this.forwardDirection
                .set(0, 0, 1)
                .applyQuaternion(this.currentRotation)
                .normalize();

            let speed = this.attributes.movementSpeed;
            if (this.state === EnemyState.STANDING) {
                speed = 0;
            }

            forwardDirection.multiplyScalar(speed);
            forwardDirection.y -= this.attributes.movementSpeed / 2;

            this.physics!.setLinearVelocity(this.target.uuid, forwardDirection);
        }

        // Sync multiplayer state (host only)
        this.syncMultiplayerState();
    }

    private enemyStand() {
        this.playAnimation(this.target, this.attributes.idleAnimation);
    }

    private enemyApproach() {
        this.playAnimation(this.target, this.attributes.runAnimation);

        if (this.isDistanceGreaterThan(this.distanceToOriginalPositionSq, this.attributes.roamDistance)) {
            this.moveDirection.copy(this.originalPosition).sub(this.target.position).normalize();
        } else {
            this.moveInRandomDirection(this.attributes.directionDuration);
        }
    }

    private enemyRetreat() {
        this.playAnimation(this.target, this.attributes.walkAnimation);

        this.moveDirection.set(
            this.target.position.x - this.playerPosition.x,
            0,
            this.target.position.z - this.playerPosition.z,
        ).normalize();

        this.smoothDirectionChange(this.moveDirection);
    }

    private enemyAttack() {
        // Send attack started event if not already attacking
        if (this.state !== EnemyState.ATTACKING) {
            EventBus.instance.send(IN_GAME_EVENTS.ENEMY_ATTACK_STARTED, {
                target: this.target,
                targetDistance: this.getDistanceToPlayer(),
                position: this.target.position.clone(),
            });
        }

        this.playAnimation(this.target, this.attributes.attackAnimation);

        const targetDirection = this.targetDirection.set(
            this.playerPosition.x - this.target.position.x,
            0,
            this.playerPosition.z - this.target.position.z,
        ).normalize();

        this.smoothDirectionChange(targetDirection);

        if (this.isDistanceGreaterThan(this.distanceToPlayerSq, this.attributes.attackDistance)) {
            // Send attack ended event
            EventBus.instance.send(IN_GAME_EVENTS.ENEMY_ATTACK_ENDED, {
                target: this.target,
                reason: "target_out_of_range",
                position: this.target.position.clone(),
            });

            this.changeState(EnemyState.STANDING);
            this.stateTimer = 0;
            this.standingDuration = Math.random() * 3 + 2;
        }
    }

    private smoothDirectionChange(targetDirection: THREE.Vector3) {
        const smoothingFactor = this.smoothingFactor;
        this.moveDirection.lerp(targetDirection, smoothingFactor);

        const targetRotation = Math.atan2(this.moveDirection.x, this.moveDirection.z);
        this.target.rotation.y = THREE.MathUtils.lerp(this.target.rotation.y, targetRotation, smoothingFactor);
    }

    onStateUpdated(key: string, value: string | undefined): void {
        if (this.multiplayerState?.isHost()) {
            return;
        }

        switch (key) {
            case "position":
                if (value && this.physics) {
                    const pos = parseTransformVectorState(value);
                    const targetPos = this.statePosition.set(pos.x, pos.y, pos.z);

                    // Update physics engine - this will automatically sync the visual position
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    if (this.target.userData.physics?.enabled) {
                        this.physics.setOrigin(this.target.uuid, targetPos);
                    } else {
                        // If physics is disabled, update position directly
                        this.target.position.copy(targetPos);
                    }
                }
                break;
            case "rotation":
                if (value && this.physics) {
                    const rot = parseTransformVectorState(value);

                    const euler = this.stateEuler.set(rot.x, rot.y, rot.z);
                    const quaternion = this.stateQuaternion.setFromEuler(euler);

                    // Update physics engine - this will automatically sync the visual rotation
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    if (this.target.userData.physics?.enabled) {
                        this.physics.setRotation(this.target.uuid, quaternion);
                    } else {
                        // If physics is disabled, update rotation directly
                        this.target.rotation.copy(euler);
                    }
                }
                break;
            case "state":
                if (value) {
                    this.state = value as EnemyState;
                }
                break;
            case "lives":
                if (value) {
                    this.lives = parseInt(value, 10);
                }
                break;
            default:
                break;
        }
    }

    syncMultiplayerState(): void {
        if (this.multiplayerState?.isHost()) {
            this.multiplayerState.setBehaviorData(
                this.target,
                this.id,
                "position",
                serializeTransformVectorState(this.target.position),
            );
            this.multiplayerState.setBehaviorData(
                this.target,
                this.id,
                "rotation",
                serializeTransformVectorState(this.target.rotation),
            );
            this.multiplayerState.setBehaviorData(this.target, this.id, "state", this.state);
            this.multiplayerState.setBehaviorData(this.target, this.id, "lives", this.lives.toString());
        }
    }

    dispose(): void {
        this.stopAnimation();
    }
}

export default EnemyBehavior;

import * as THREE from "three";

import EventBus, {IN_GAME_EVENTS} from "../../../behaviors/event/EventBus";
import MathUtils from "../../../physics/common/math";
import {IPhysics} from "../../../physics/common/types";
import MotionStateHelper from "../../../physics/MotionStateHelper";
import {COLLISION_TYPE} from "@stem/editor-oss/types/editor";
import {BehaviorBase} from "../../Behavior";
import CollisionDetector, {type CollisionContext} from "../../collisions/CollisionDetector";
import GameManager from "../../game/GameManager";

export enum CalculationMode {
    FIXED = "fixed",
    RANDOM = "random",
    MOVEMENT = "movement",
}

class JumppadBehavior extends BehaviorBase {
    game: GameManager | null = null;
    private collisionDetector?: CollisionDetector;
    private physics?: IPhysics;
    private listenerId?: string;
    private lastActivationTime: number = 0;
    private readonly COOLDOWN_MS: number = 500;
    private readonly impulse = new THREE.Vector3();
    private readonly angleAxis = new THREE.Vector3(0, 0, 1);
    private readonly movementDirection = new THREE.Vector3();
    private readonly padForward = new THREE.Vector3();
    private readonly crossDirection = new THREE.Vector3();

    init(game: GameManager) {
        this.game = game;
        this.collisionDetector = game.collisionDetector;
        this.physics = game.collisionDetector?.physics;
    }

    update(deltaTime: number) {} // eslint-disable-line @typescript-eslint/no-unused-vars

    onStart(): void {
        this.addCollisionListener();
    }

    onStop(): void {
        this.removeCollisionListener();
    }

    onReset() {}

    onCollision(context?: CollisionContext) {
        if (this.attributes.strength <= 0 || !this.target || this.isPaused) {
            return;
        }

        // Cooldown check to prevent infinite jump
        const now = Date.now();
        if (now - this.lastActivationTime < this.COOLDOWN_MS) {
            return;
        }

        const object = context?.other ?? this.game?.player;

        if (!object || !object.userData.physics?.enabled) {
            return;
        }

        this.lastActivationTime = now;

        const angle = this.attributes.enableAngle ? this.calculateAngle(object) : 0;
        const strength = this.calculateStrength(object);

        if (strength <= 0) {
            return;
        }

        const radians = angle * Math.PI / 180;
        const impulse = this.impulse.set(0, 1, 0);
        impulse.applyAxisAngle(this.angleAxis, radians);
        impulse.multiplyScalar(strength);

        // rotate impulse to match object rotation
        impulse.applyQuaternion(this.target.quaternion);

        // Apply impulse to the object that actually triggered this collision.
        this.physics?.applyImpulseToPlayer(object.uuid, impulse);
        EventBus.instance.send(IN_GAME_EVENTS.JUMPPAD_ACTIVATED, {
            target: this.target,
        });
    }

    private calculateStrength(player: THREE.Object3D): number {
        const mode = (this.attributes.strengthMode as CalculationMode) || CalculationMode.FIXED;
        const strength = this.attributes.strength;
        const maxStrength = this.attributes.maxStrength ?? strength;

        switch (mode) {
            case CalculationMode.RANDOM:
                // Random between strength (min) and maxStrength
                return strength + Math.random() * (maxStrength - strength);

            case CalculationMode.MOVEMENT: {
                const motionState = MotionStateHelper.getMotionState(player);
                if (motionState) {
                    const velocity = motionState.linearVelocity;
                    const horizontalSpeed = Math.sqrt(velocity.x ** 2 + velocity.z ** 2);
                    // Scale strength based on horizontal movement (0 to maxStrength)
                    const movementFactor = Math.min(horizontalSpeed / 10, 1);
                    return strength + (maxStrength - strength) * movementFactor;
                }
                return strength;
            }

            case CalculationMode.FIXED:
            default:
                return strength;
        }
    }

    private calculateAngle(player: THREE.Object3D): number {
        const mode = (this.attributes.angleMode as CalculationMode) || CalculationMode.FIXED;
        const angle = this.attributes.angle;
        const minAngle = this.attributes.minAngle ?? -90;
        const maxAngle = this.attributes.maxAngle ?? 90;

        switch (mode) {
            case CalculationMode.RANDOM:
                return minAngle + Math.random() * (maxAngle - minAngle);

            case CalculationMode.MOVEMENT: {
                const motionState = MotionStateHelper.getMotionState(player);
                if (motionState && this.target) {
                    const velocity = motionState.linearVelocity;
                    // Calculate movement direction in world space
                    const moveDir = this.movementDirection.set(velocity.x, 0, velocity.z);
                    if (moveDir.lengthSq() > 0.01) {
                        moveDir.normalize();
                        // Get jump pad's forward direction
                        const padForward = this.padForward.set(0, 0, 1);
                        padForward.applyQuaternion(this.target.quaternion);
                        padForward.y = 0;
                        padForward.normalize();
                        // Calculate angle between movement and pad forward
                        const dot = moveDir.dot(padForward);
                        const cross = this.crossDirection.copy(moveDir).cross(padForward);
                        const signedAngle = Math.atan2(cross.y, dot) * (180 / Math.PI);
                        // Clamp to allowed range
                        return MathUtils.clamp(signedAngle, minAngle, maxAngle);
                    }
                }
                return angle;
            }

            case CalculationMode.FIXED:
            default:
                return angle;
        }
    }

    addCollisionListener() {
        if (!this.collisionDetector || !this.target) {
            return;
        }

        this.listenerId = this.collisionDetector.addListener(
            this.target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                callback: this.onCollision.bind(this),
                useBoundingBoxes: true,
            },
            true,
        );
    }

    removeCollisionListener() {
        if (!this.collisionDetector || !this.target || !this.listenerId) {
            return;
        }
        this.collisionDetector.deleteListener(this.target, this.listenerId);
        this.listenerId = undefined;
    }
}

export default JumppadBehavior;

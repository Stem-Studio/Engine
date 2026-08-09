import {Tween, Group} from "@tweenjs/tween.js";
import * as THREE from "three";
import {Vector3} from "three";

import EventBus, {IN_GAME_EVENTS} from "../../../behaviors/event/EventBus";
import {IMultiplayerState} from "../../../behaviors/state/IMultiplayerState";
import MotionStateHelper from "../../../physics/MotionStateHelper";
import BoundingBoxUtil from "@stem/editor-oss/utils/BoundingBoxUtil";
import {parseTransformVectorState, serializeTransformVectorState} from "@stem/editor-oss/utils/transformStateSerialization";
import {BehaviorBase} from "../../Behavior";
import GameManager from "../../game/GameManager";

enum ANIMATION_TYPES {
    REPEAT = "Repeat",
    LOOP = "Loop",
    PLAY_ONCE = "Play Once",
}

class PlatformBehavior extends BehaviorBase {
    game: GameManager | null = null;
    private multiplayerState?: IMultiplayerState | null = null;
    private shape?: THREE.Box3;
    private prevTargetPos = new Vector3();
    private playerSpeedAdjustment = new Vector3();
    private targetSpeedAdjustment = new Vector3();
    private zeroSpeed = new Vector3();
    private currentWorldPos = new Vector3();
    private playerLocalPos = new Vector3();
    private needToResetSpeedAdjustment = false;
    private isStarted: boolean = false;

    private tweenGroup: Group = new Group();
    private currentTween: Tween | null = null;
    private backwardTween: Tween | null = null;
    private platformData = {
        target: {} as THREE.Object3D,
    };

    init(game: GameManager): void {
        this.game = game;
        this.multiplayerState = this.game.multiplayerState;
    }

    onAdded() {
        this.platformData.target = this.target!;
        if (!this.attributes.startOnTrigger) {
            this.startMovement();
        }
    }

    onRemoved(): void {
        this.stopMovement();
    }

    update(deltaTime: number): void {
        if (this.isStarted && (!this.multiplayerState || this.multiplayerState?.isHost())) {
            this.tweenGroup.update();
        }

        const currentWorldPos = this.currentWorldPos;
        this.target.getWorldPosition(currentWorldPos);

        const player = this.game?.player;
        const motionState = player ? MotionStateHelper.getMotionState(player) : undefined;

        //check if player is above the platform
        if (this.isStarted && player && motionState) {
            const playerPos = this.playerLocalPos.copy(player.position);
            this.target.worldToLocal(playerPos);

            if (
                motionState.onGround &&
                this.shape &&
                playerPos.x >= this.shape.min.x &&
                playerPos.x <= this.shape.max.x &&
                playerPos.z >= this.shape.min.z &&
                playerPos.z <= this.shape.max.z &&
                playerPos.y >= this.shape.max.y - 0.5 &&
                playerPos.y <= this.shape.max.y + 2
            ) {
                this.targetSpeedAdjustment
                    .copy(currentWorldPos)
                    .sub(this.prevTargetPos)
                    .divideScalar(deltaTime * 60);

                this.playerSpeedAdjustment.lerp(this.targetSpeedAdjustment, 0.9);

                this.game?.physics?.setPlayerSpeedAdjustment(player.uuid, this.playerSpeedAdjustment);
                this.needToResetSpeedAdjustment = true;
            } else {
                if (this.needToResetSpeedAdjustment) {
                    this.game?.physics?.setPlayerSpeedAdjustment(player.uuid, this.zeroSpeed);
                    this.playerSpeedAdjustment.set(0, 0, 0);
                    this.needToResetSpeedAdjustment = false;
                }
            }
        }

        this.prevTargetPos.copy(currentWorldPos);
        this.syncMultiplayerState();
    }

    onStateUpdated(key: string, value: string | undefined): void {
        if (this.multiplayerState?.isHost()) {
            return;
        }

        switch (key) {
            case "position":
                if (key === "position" && value) {
                    const pos = parseTransformVectorState(value);
                    if (this.target) {
                        this.target.position.set(pos.x, pos.y, pos.z);
                    }
                }
                break;
            case "rotation":
                if (key === "rotation" && value) {
                    const rot = parseTransformVectorState(value);
                    if (this.target) {
                        this.target.rotation.set(rot.x, rot.y, rot.z);
                    }
                }
                break;
            case "scale":
                if (key === "scale" && value) {
                    const scale = parseTransformVectorState(value);
                    if (this.target) {
                        this.target.scale.set(scale.x, scale.y, scale.z);
                    }
                }
                break;
            default:
                break;
        }
        EventBus.instance.send(IN_GAME_EVENTS.PLATFORM_MOVING, this.platformData);
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
            this.multiplayerState.setBehaviorData(
                this.target,
                this.id,
                "scale",
                serializeTransformVectorState(this.target.scale),
            );
        }
    }

    onReset(): void {}

    onAttributesUpdated(): void {
        super.onAttributesUpdated();
        this.stopMovement();
        this.startMovement();
    }

    onEvent(msg: string, data: any): void {
        if (msg === "trigger") {
            if (data.actionType === "activate" && !this.isStarted) {
                this.startMovement();
            } else if (data.actionType === "deactivate" && this.isStarted) {
                this.stopMovement();
            }
        }
    }

    private startMovement() {
        if (this.isStarted || !this.target) {
            return;
        }
        EventBus.instance.send(IN_GAME_EVENTS.PLATFORM_ACTIVATED, this.platformData);

        if (this.multiplayerState && !this.multiplayerState?.isHost()) {
            return;
        }

        this.isStarted = true;

        this.target.getWorldPosition(this.prevTargetPos);

        this.shape = BoundingBoxUtil.getBoxWithoutTransform(this.target);

        const target = this.target;

        const startPos = target.position.clone();

        // displacement vector is based on object rotation
        const displacement = new THREE.Vector3(this.attributes.move.x, this.attributes.move.y, this.attributes.move.z);
        displacement.applyQuaternion(target.quaternion);

        // Calculate end position
        const endPos = startPos.clone().add(displacement);
        const hasMovement = displacement.length() > 0;

        const duration = 10000 / this.attributes.speed;

        const updateTarget = (progress: number) => {
            if (!hasMovement) {
                return;
            }
            EventBus.instance.send(IN_GAME_EVENTS.PLATFORM_MOVING, this.platformData);
            target.position.lerpVectors(startPos, endPos, progress);
        };

        const forwardTween = new Tween({progress: 0})
            .to({progress: 1}, duration)
            .onUpdate(obj => updateTarget(obj.progress));

        if (this.attributes.loopMode === ANIMATION_TYPES.LOOP) {
            // TweenJS has a bug with yoyo loops, so we create a backward tween manually
            const backwardTween = new Tween({progress: 1})
                .to({progress: 0}, duration)
                .onUpdate(obj => updateTarget(obj.progress))
                .onComplete(() => {
                    if (this.isStarted) forwardTween.start();
                });

            forwardTween.onComplete(() => {
                if (this.isStarted) backwardTween.start();
            });

            this.currentTween = forwardTween;
            this.backwardTween = backwardTween;
            this.tweenGroup.add(forwardTween);
            this.tweenGroup.add(backwardTween);
        } else if (this.attributes.loopMode === ANIMATION_TYPES.REPEAT) {
            forwardTween.repeat(Infinity);
            this.currentTween = forwardTween;
            this.tweenGroup.add(forwardTween);
        } else {
            this.currentTween = forwardTween;
            this.tweenGroup.add(forwardTween);
        }

        this.currentTween.start();
    }

    private stopMovement() {
        if (!this.isStarted) {
            return;
        }

        EventBus.instance.send(IN_GAME_EVENTS.PLATFORM_DEACTIVATED, this.platformData);

        this.isStarted = false;

        this.currentTween?.stop();
        this.backwardTween?.stop();
        this.tweenGroup.removeAll();

        this.currentTween = null;
        this.backwardTween = null;

        if (this.game?.player) {
            this.game.physics?.setPlayerSpeedAdjustment(this.game.player.uuid, this.zeroSpeed);
        }
    }
}

export default PlatformBehavior;

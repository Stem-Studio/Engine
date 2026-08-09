import {Object3D} from "three";
import {toast} from "toastywave";

import EventBus, {IN_GAME_EVENTS} from "../../../behaviors/event/EventBus";
import {PhysicsUtil} from "../../../physics/PhysicsUtil";
import {CollisionType, type PhysicsConfig} from "../../../physics/common/physicsConfig";
import {getPhysics} from "../../../physics/common/getPhysics";
import {showToast} from "@stem/editor-oss/showToast";
import {COLLISION_TYPE} from "@stem/editor-oss/types/editor";
import {BehaviorBase} from "../../Behavior";
import GameManager from "../../game/GameManager";


export enum VOLUME_TYPES {
    BLOCKING = "Blocking",
    KILL_VOLUME = "Kill Volume",
    DIALOGUE_VOLUME = "Dialogue Volume",
    LOSE_VOLUME = "Lose Volume",
    WIN_VOLUME = "Win Volume",
    CUSTOM = "Custom",
    TRIGGER_VOLUME = "Trigger Volume",
}

class VolumeBehavior extends BehaviorBase {

    protected game: GameManager | null = null;
    private removed = false;
    private physicsEnabled = false;
    private toastId: string | number = "";
    private collisionPauseTime: number = 1500;
    private physicsRemoved: boolean = false;
    private lastCollisionTime: number = 0;
    private autoAppliedBlockingPhysics = false;
    private originalPhysicsConfig?: PhysicsConfig;
    private volumeData = {
        target: {} as Object3D,
    };

    init(game: GameManager) {
        this.game = game;
    }

    update() {}

    onStart(): void {
        this.volumeData.target = this.target;
        this.physicsEnabled = PhysicsUtil.isPhysicsEnabled(this.target);

        if (this.getVolumeType() === VOLUME_TYPES.BLOCKING) {
            this.ensureBlockingPhysics();
            return;
        }

        this.addCollisionListener();
    }

    onStop(): void {
        this.removeCollisionListener();
        this.restoreAutoBlockingPhysics();
    }

    private getVolumeType(): VOLUME_TYPES {
        return this.attributes.volumeOptions?.volumeType ?? VOLUME_TYPES.BLOCKING;
    }

    private ensureBlockingPhysics(): void {
        if (this.physicsEnabled) {
            return;
        }

        this.originalPhysicsConfig = PhysicsUtil.getPhysicsConfig(this.target);
        const physicsConfig = getPhysics(this.originalPhysicsConfig || null, this.target);
        physicsConfig.enabled = true;
        physicsConfig.ctype = CollisionType.Kinematic;
        physicsConfig.mass = 0;

        PhysicsUtil.setPhysicsConfig(this.target, physicsConfig);
        PhysicsUtil.updateShapeOffsetAndScale(this.target);
        this.game?.engine.addPhysicsObject(this.target);
        this.physicsEnabled = true;
        this.physicsRemoved = false;
        this.autoAppliedBlockingPhysics = true;
    }

    private restoreAutoBlockingPhysics(): void {
        if (!this.autoAppliedBlockingPhysics) {
            return;
        }

        this.removePhysicsObject();

        if (this.originalPhysicsConfig) {
            PhysicsUtil.setPhysicsConfig(this.target, this.originalPhysicsConfig);
        } else {
            delete this.target.userData.physics;
        }

        this.physicsEnabled = PhysicsUtil.isPhysicsEnabled(this.target);
        this.physicsRemoved = false;
        this.autoAppliedBlockingPhysics = false;
        this.originalPhysicsConfig = undefined;
    }

    onReset() {
        if (this.removed) {
            this.addPhysicsObject();
            if (this.getVolumeType() !== VOLUME_TYPES.BLOCKING) {
                this.addCollisionListener();
            }
            this.removed = false;
        }
    }

    toast(message: string, type: "info" | "success" | "error" | "warning") {
        showToast({type, body: message});
    }

    private onCollision() {
        if (!this.game || !this.game.player || !this.game.scene || this.isPaused) return;

        const volumeType = this.getVolumeType();

        const now = performance.now();
        if (now - this.lastCollisionTime < this.collisionPauseTime) return;
        this.lastCollisionTime = now;

        if (volumeType === VOLUME_TYPES.KILL_VOLUME) {
            if (!this.game.initialLives) {
                this.toast("Lives are not set", "warning");
            }
            EventBus.instance.send(IN_GAME_EVENTS.GAME_LIVES_DEC, Number(this.game.initialLives));
            this.removeCollisionAndPhysics();
        }

        if (volumeType === VOLUME_TYPES.DIALOGUE_VOLUME) {
            this.removed = true;
            if (this.toastId === "") {
                this.toastId = toast.info("Hello!");
                this.toastId = "";
            }
        }

        if (volumeType === VOLUME_TYPES.WIN_VOLUME) {
            if (!this.game.maxScore) {
                this.toast("Max score is not set", "warning");
            }
            EventBus.instance.send(IN_GAME_EVENTS.GAME_SCORE_INC, this.game.maxScore);
            this.removeCollisionAndPhysics();
        }

        if (volumeType === VOLUME_TYPES.LOSE_VOLUME) {
            if (!this.game.initialLives) {
                this.toast("Lives are not set", "warning");
            }
            EventBus.instance.send(IN_GAME_EVENTS.GAME_LIVES_DEC, this.game.initialLives);
            this.removeCollisionAndPhysics();
        }

        if (volumeType === VOLUME_TYPES.CUSTOM) {
            if (!this.game.initialLives) {
                this.toast("Lives are not set", "warning");
            }

            EventBus.instance.send(IN_GAME_EVENTS.GAME_LIVES_DEC, this.attributes.volumeOptions.damageAmount);
            EventBus.instance.send(IN_GAME_EVENTS.GAME_SCORE_DEC, this.attributes.volumeOptions.losePoints);
            EventBus.instance.send(IN_GAME_EVENTS.GAME_TIME_DEC, this.attributes.volumeOptions.loseTime);
        }
        EventBus.instance.send(IN_GAME_EVENTS.VOLUME_ACTIVATED, this.volumeData);
    }

    private addPhysicsObject() {
        if (this.physicsEnabled && this.physicsRemoved && this.target && this.game) {
            this.game.engine.addPhysicsObject(this.target);
            this.physicsRemoved = false;
        }
    }

    private addCollisionListener() {
        if (!this.target || !this.game?.collisionDetector) return;

        this.game.collisionDetector.addListener(
            this.target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                callback: this.onCollision.bind(this),
                useBoundingBoxes: true,
            },
            true,
        );
    }

    private removeCollisionAndPhysics() {
        this.removePhysicsObject();
        this.removeCollisionListener();
        this.removed = true;
    }

    private removePhysicsObject() {
        if (this.physicsEnabled && !this.physicsRemoved && this.target && this.game) {
            this.game.engine.removePhysicsObject(this.target);
            this.physicsRemoved = true;
        }
    }

    private removeCollisionListener() {
        if (!this.target || !this.game?.collisionDetector) return;

        this.game.collisionDetector.deleteListener(this.target);
    }
}

export default VolumeBehavior;

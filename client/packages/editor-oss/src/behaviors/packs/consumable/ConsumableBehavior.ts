import { COLLISION_TYPE, CONSUMABLE_TYPES } from "@stem/editor-oss/types/editor";
import CameraUtils from "@stem/editor-oss/utils/CameraUtils";
import { BehaviorBase } from "../../Behavior";
import EventBus, { IN_GAME_EVENTS } from "../../event/EventBus";
import GameManager from "../../game/GameManager";
import RangeDetector from "../../range/RangeDetector";

class ConsumableBehavior extends BehaviorBase {
    game: GameManager | null = null;
    private rangeDetector: RangeDetector | null = null;
    private rangeDetectorLoaded?: boolean = false;
    private collectedObject?: boolean = false;
    private consumableData = {
        target: {},
        type: CONSUMABLE_TYPES.INSTANT,
        inventoryType: "default",
    };

    init(gameManager: GameManager) {
        this.game = gameManager;
        this.rangeDetector = new RangeDetector(gameManager);
        this.consumableData = {
            target: this.target,
            type: this.attributes.consumableType || CONSUMABLE_TYPES.INSTANT,
            inventoryType: this.attributes.inventoryType || "default",
        };
    }

    onAdded(): void {
        this.addCollisionListener();
        CameraUtils.disableCameraCollision(this.target);
    }

    addCollisionListener() {
        let collisionType = this.getCollisionType();
        if (collisionType !== COLLISION_TYPE.UNKNOWN) {
            this.game?.collisionDetector?.addListener(
                this.target,
                {
                    type: collisionType,
                    callback: this.onCollision.bind(this),
                    useBoundingBoxes: true,
                },
                true,
            );
        } else {
            console.warn("Collision type is not specified for " + this.target.name);
        }
    }

    getCollisionType(): COLLISION_TYPE {
        if (!this.attributes.collisionType) return COLLISION_TYPE.UNKNOWN;
        return this.attributes.collisionType === "WITH_PLAYER"
            ? COLLISION_TYPE.WITH_PLAYER
            : this.attributes.collisionType === "WITH_COLLIDABLE_OBJECTS"
                ? COLLISION_TYPE.WITH_COLLIDABLE_OBJECTS
                : this.attributes.collisionType === "WITH_ENEMY"
                    ? COLLISION_TYPE.WITH_ENEMY
                    : COLLISION_TYPE.UNKNOWN;
    }


    onCollision() {
        if (!this.target) return {};

        EventBus.instance.send(IN_GAME_EVENTS.CONSUMABLE_COLLIDED, this.consumableData);
        switch (this.attributes.consumableType) {
            case CONSUMABLE_TYPES.PRESS_E:
                if (this.isUseActionPressed()) {
                    this.collectObject();
                }
                break;
            case CONSUMABLE_TYPES.INSTANT:
                this.collectObject();
                break;
            default:
                console.warn("Unknown consumable type:", this.attributes.consumableType);
                break;
        }

    }

    private isUseActionPressed(): boolean {
        return (
            this.game?.inputManager?.getAction("use") === true ||
            this.game?.scene?.userData?.pressE === true ||
            this.game?.player?.userData?.pressE === true
        );
    }

    collectObject() {
        if (this.collectedObject) return {};
        EventBus.instance.send(IN_GAME_EVENTS.GAME_HEALTH_INC, this.attributes.healthAmount);
        EventBus.instance.send(IN_GAME_EVENTS.CONSUMABLE_COLLECTED, this.consumableData);
        this.attributes.healthAmount = 0; //only allow health once
        this.game!.engine.physics!.removePhysicsObjectBody(this.target);
        this.target.visible = false;
        this.collectedObject = true;
        this.rangeDetector?.dispose(); 
    }

    bindRangeDetector() {
        this.rangeDetector?.setPlayer(this.game!.player!);
        this.rangeDetector?.setTarget(this.target);
    }

    addRangeDetector() {
        switch (this.attributes.consumableType) {
            case CONSUMABLE_TYPES.PRESS_E:
                this.bindRangeDetector();
                this.rangeDetector?.setText(CONSUMABLE_TYPES.PRESS_E);
                break;
            case CONSUMABLE_TYPES.INSTANT:
                break;
        }


    }

    removeCollectableFromInventory() { }

    update(deltaTime: number) {
        void deltaTime;

        if (!this.target || !this.game || !this.game.player) return {};


        if (this.game.player && this.target && !this.rangeDetectorLoaded) {
            this.addRangeDetector();
            this.rangeDetectorLoaded = true;
        }

        this.rangeDetector?.update();
        
        EventBus.instance.send(this.rangeDetector?.isTargetInRange ? IN_GAME_EVENTS.CONSUMABLE_IN_RANGE : IN_GAME_EVENTS.CONSUMABLE_NOT_IN_RANGE, this.consumableData);
    }

    onReset() { }

    onRemoved(): void { }

}

export default ConsumableBehavior;

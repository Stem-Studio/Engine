import {Object3D, Quaternion, Vector3, Euler} from "three";

import EventBus, { IN_GAME_EVENTS } from "../../../behaviors/event/EventBus";
import {COLLISION_TYPE} from "@stem/editor-oss/types/editor";
import { BehaviorBase } from "../../Behavior";
import CollisionDetector, {type CollisionContext} from "../../collisions/CollisionDetector";
import GameManager from "../../game/GameManager";
import CharacterBehavior from "../character/CharacterBehavior";

class TeleportBehavior extends BehaviorBase {

    game: GameManager | null = null;
    private collisionDetector?: CollisionDetector;
    private listenerId?: string;
    private teleportData = {
        target: {} as Object3D,
    };
    private readonly teleportPosition = new Vector3();
    private readonly teleportQuaternion = new Quaternion();
    private readonly teleportEuler = new Euler();

    init(game: GameManager) {
        this.game = game;
        this.collisionDetector = game.collisionDetector;
    }

    onAdded(): void {
        this.teleportData.target = this.target!;
        this.addCollisionListener();
    }

    onRemoved(): void {
        this.removeCollisionListener();
    }

    onReset() {}

    onCollision(context?: CollisionContext) {
        if (!this.attributes.teleportTargetUuid || this.isPaused) {
            return;
        }

        const teleportTarget = this.game?.getObjectByUUID(this.attributes.teleportTargetUuid);
        const object = context?.other ?? this.game?.player;

        if (!teleportTarget || !object) {
            return;
        }

        const characterBehaviors = this.game?.behaviorManager!.getTargetBehaviorsById(object, "character") as CharacterBehavior[];
        const characterBehavior = characterBehaviors[0]; // We know for sure that there is character behavior on the player
        if (!characterBehavior) {
            return;
        }
        this.game?.cameraControl?.resetCamera();

        const position = teleportTarget.getWorldPosition(this.teleportPosition);
        const quaternion = teleportTarget.getWorldQuaternion(this.teleportQuaternion);
        const rotationEuler = this.teleportEuler;
        rotationEuler.setFromQuaternion(quaternion);

        characterBehavior.setPosition(position);
        characterBehavior.setAngle(rotationEuler.y);

        EventBus.instance.send(IN_GAME_EVENTS.TELEPORT_ACTIVATED, this.teleportData);
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

    onAttributesUpdated(): void {
        this.removeCollisionListener();
        this.addCollisionListener();
    }


}

export default TeleportBehavior;

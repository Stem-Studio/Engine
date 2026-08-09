import * as THREE from "three";

import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {AnimationController} from "../../../controls/AnimationController";
import {IPhysics} from "../../../physics/common/types";
import {PhysicsUtil} from "../../../physics/PhysicsUtil";
import {COLLISION_TYPE} from "@stem/editor-oss/types/editor";
import CameraUtils from "@stem/editor-oss/utils/CameraUtils";
import {BehaviorBase} from "../../Behavior";
import GameManager from "../../game/GameManager";

enum MOVEMENT_TYPES {
    STANDING = "standing",
    ROAM = "roam",
}

enum NPC_STATE {
    //TODO move this to types
    STANDING = "standing",
    APPROACHING = "approaching",
    RETREATING = "retreating",
    ENGAGING = "engaging",
}
// TODO: refactor to use BipedalController from CharacterBehavior
class NPCBehavior extends BehaviorBase {
    //config
    npcEnabled: boolean = true;
    game: GameManager | null = null;
    private engine: EngineRuntime | null = null;
    physics: IPhysics | null = null;
    player: THREE.Object3D | null = null;
    //other stuff
    moveTimer: number = 0;
    standingDuration: number = Math.random() * 3 + 2;
    rotationSpeed: number = 0.005;
    directionDuration: number = 5;
    originalPosition: THREE.Vector3 = new THREE.Vector3();
    distanceToPlayer: number = 0;
    distanceToOriginalPosition: number = 0;
    deltaTime: number = 0;
    currentRotation = new THREE.Quaternion();
    animations?: [];
    smoothingFactor: number = 0.05;
    speed: number = 0;
    //current state
    moveDirection: THREE.Vector3 = new THREE.Vector3();
    state: NPC_STATE = NPC_STATE.APPROACHING;
    lives: number = 3;
    stateTimer: number = 0;
    //tracking player
    playerPosition: THREE.Vector3 = new THREE.Vector3();
    prevPlayerPosition: THREE.Vector3 = new THREE.Vector3();
    lastPlayerMoveTime: number = Date.now();
    //animation
    currentAnimationName: string = "";
    animationController: AnimationController | null = null;
    private readonly yAxis = new THREE.Vector3(0, 1, 0);
    private readonly forwardDirection = new THREE.Vector3();
    private readonly targetDirection = new THREE.Vector3();

    init(game: GameManager) {
        this.game = game;
        this.engine = game.engine;
        this.physics = this.game.physics!;
        this.animationController = this.game.animationController!;
    }

    onAdded(): void {
        this.addCollisionListener();
        CameraUtils.disableCameraCollision(this.target);
        this.originalPosition.copy(this.target.position);

        this.resolvePlayer();
    }

    onRemoved(): void {
        this.player = null;
    }

    onReset() {}

    private resolvePlayer(): boolean {
        const player = this.game?.player;
        if (!player) {
            return this.player !== null;
        }

        if (this.player !== player) {
            this.player = player;
            this.onPlayerSet();
        }

        return true;
    }

    update(deltaTime: number) {
        if (!this.resolvePlayer() || !this.player) {
            return;
        }

        this.player.getWorldPosition(this.playerPosition);

        const playerMoved = this.playerPosition.distanceToSquared(this.prevPlayerPosition) > 0;
        if (playerMoved) {
            this.prevPlayerPosition.copy(this.playerPosition);
            this.lastPlayerMoveTime = Date.now();
        }

        if (!this.isDead() && this.npcEnabled) {
            if (this.attributes.movementType === MOVEMENT_TYPES.STANDING) {
                this.state = NPC_STATE.STANDING;
            }

            this.distanceToPlayer = this.target.position.distanceTo(this.playerPosition);
            this.distanceToOriginalPosition = this.target.position.distanceTo(this.originalPosition);

            this.stateTimer += deltaTime;

            if (this.distanceToPlayer <= this.attributes.engageDistance) {
                this.state = NPC_STATE.STANDING; //ENGAGING will follow player
                
                this.moveDirection.subVectors(this.player.position, this.target.position);
                this.moveDirection.y = 0;
                if (this.moveDirection.lengthSq() > 0.0001) {
                    this.moveDirection.normalize();
                }

                this.npcStand();
            }

            switch (this.state) {
                case NPC_STATE.STANDING:
                    if (
                        this.attributes.movementType !== MOVEMENT_TYPES.STANDING &&
                        this.stateTimer >= this.standingDuration
                    ) {
                        this.state = NPC_STATE.APPROACHING;
                        this.stateTimer = 0;
                    }
                    this.speed = 0;
                    this.npcStand();
                    break;

                case NPC_STATE.APPROACHING:
                    if (this.stateTimer >= 4) {
                        this.state = NPC_STATE.RETREATING;
                        this.stateTimer = 0;
                    }
                    this.speed = this.attributes.movementSpeed;
                    this.npcApproach(deltaTime);
                    break;

                case NPC_STATE.RETREATING:
                    if (this.stateTimer >= 2) {
                        this.state = NPC_STATE.STANDING;
                        this.stateTimer = 0;
                        this.standingDuration = Math.random() * 3 + 2;
                    }
                    this.speed = this.attributes.movementSpeed;
                    this.npcRetreat();
                    break;

                case NPC_STATE.ENGAGING:
                    this.speed = this.attributes.movementSpeed;
                    this.npcEngage();
                    break;

                default:
                    this.speed = 0;
                    this.npcStand();
                    break;
            }
        }

        const targetRotation = Math.atan2(this.moveDirection.x, this.moveDirection.z);

        //FIXME
        if (this.target.userData.currentAnimation === this.attributes.idleAnimation) {
            this.target.rotation.y = THREE.MathUtils.lerp(
                this.target.rotation.y,
                targetRotation,
                this.rotationSpeed * deltaTime,
            );
        }

        this.currentRotation.setFromAxisAngle(this.yAxis, targetRotation);

        // Apply physics movement
        this.physics!.setRotation(this.target.uuid, this.currentRotation);

        const forwardDirection = this.forwardDirection
            .set(0, 0, 1)
            .applyQuaternion(this.currentRotation)
            .normalize()
            .multiplyScalar(this.speed);
        forwardDirection.y -= this.speed / 2;

        this.physics!.setLinearVelocity(this.target.uuid, forwardDirection);
    }

    private onPlayerSet() {
        this.player!.getWorldPosition(this.prevPlayerPosition);
    }

    private isDead() {
        return this.lives <= 0;
    }

    private addCollisionListener() {
        this.game?.collisionDetector?.addListener(
            this.target,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                callback: this.onCollisionWithPlayer.bind(this),
                useBoundingBoxes: true,
            },
            PhysicsUtil.isPhysicsEnabled(this.target),
        );
    }

    private onCollisionWithPlayer() {}

    playAnimation(animationName: string, loop: boolean = true): void {
        if (!animationName || animationName === "none") {
            this.animationController!.stopAnimation(this.target);
            this.currentAnimationName = animationName;
            return;
        }

        if (this.currentAnimationName === animationName) {
            // TODO: check if non loop animation is already playing
            return;
        }

        this.currentAnimationName = animationName;

        // Use AnimationController to play the animation
        this.animationController!.playAnimation(
            this.target,
            animationName,
            1, // speed
            !loop,
            0.25, // fadeDuration
        );
    }

    private moveInRandomDirection = (directionDuration: number, deltaTime: number) => {
        if (this.moveTimer <= 0) {
            this.moveTimer = Math.random() * directionDuration + directionDuration;
            this.moveDirection.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1).normalize();
        }
        this.moveTimer -= deltaTime;
    };

    npcStand() {
        this.playAnimation(this.attributes.idleAnimation);
    }

    npcApproach(deltaTime: number) {
        this.playAnimation(this.attributes.walkAnimation);

        if (this.distanceToOriginalPosition > this.attributes.roamDistance) {
            this.moveDirection.copy(this.originalPosition).sub(this.target.position).normalize();
        } else {
            this.moveInRandomDirection(this.directionDuration, deltaTime);
        }
    }

    npcRetreat() {
        this.playAnimation(this.attributes.walkAnimation);

        this.moveDirection.set(
            this.target.position.x - this.playerPosition.x,
            0,
            this.target.position.z - this.playerPosition.z,
        ).normalize();

        this.smoothDirectionChange(this.moveDirection);
    }

    npcEngage() {
        this.playAnimation(this.attributes.attackingAnimation);

        const targetDirection = this.targetDirection.set(
            this.playerPosition.x - this.target.position.x,
            0,
            this.playerPosition.z - this.target.position.z,
        ).normalize();

        this.smoothDirectionChange(targetDirection);

        if (this.distanceToPlayer > this.attributes.engageDistance) {
            this.state = NPC_STATE.STANDING;
            this.stateTimer = 0;
            this.standingDuration = Math.random() * 3 + 2;
        }
    }

    smoothDirectionChange(targetDirection: THREE.Vector3) {
        const smoothingFactor = this.smoothingFactor;
        this.moveDirection.lerp(targetDirection, smoothingFactor);

        const targetRotation = Math.atan2(this.moveDirection.x, this.moveDirection.z);
        this.target.rotation.y = THREE.MathUtils.lerp(this.target.rotation.y, targetRotation, smoothingFactor);
    }

    dispose = () => {
        this.player = null;
    };
}

export default NPCBehavior;

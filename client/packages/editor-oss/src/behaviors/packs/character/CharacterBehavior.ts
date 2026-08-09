import * as THREE from "three";

import {CameraControl} from "src/controls/CameraControl";

import BipedalControl from "./BipedalControl";
import {CharacterSwap} from "./CharacterSwap";
import {IPlayerAnimationController} from "./IPlayerAnimationController";
import {markLocalPlayerAvatar} from "../../../core/budget/AvatarBudgetPolicy";
import {PhysicsUtil} from "../../../physics/PhysicsUtil";
import {CAMERA_TYPES, CharacterOptionsInterface} from "@stem/editor-oss/types/editor";
import LoadSceneUIImages from "@stem/editor-oss/utils/LoadSceneUIImages";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import TagUtil from "@stem/editor-oss/utils/TagUtil";
import {BehaviorBase} from "../../Behavior";
import GameManager from "../../game/GameManager";


const vec3Tmp = new THREE.Vector3();

class CharacterBehavior extends BehaviorBase {
    // fields from CharacterBehaviorUpdater
    isDebug: boolean = false;
    controlType: CAMERA_TYPES = CAMERA_TYPES.THIRD_PERSON;

    private game?: GameManager;
    private camera?: THREE.Camera;
    private characterControl?: BipedalControl;
    private directionalLights: THREE.DirectionalLight[] = [];
    isActive: boolean = false;
    private characterSwap?: CharacterSwap;

    init(game: GameManager) {
        this.game = game;
        this.camera = game.camera;
        this.isDebug = (game.engine as any)?.storage?.debug;
        new LoadSceneUIImages(this.game.scene);

        if (this.attributes.canSwap === true && !this.isRemotePlayer()) {
            this.characterSwap = new CharacterSwap(this.target, game);
        }
    }

    async onStart(): Promise<void> {
        //character control
        this.characterControl = new BipedalControl(
            this.getCharaterOptions(),
            this.game!.inputManager,
            this.game!.physics!,
            this.game!.scene,
            this.game!.cameraControl!,
            this.game!.renderer,
            this.game!.collisionDetector!,
            this.game!.animationController!,
            (eventName: string, data?: any) => this.emitEvent(eventName, data),
        );

        if (this.game!.useAvatar()) {
            await this.replaceTargetWithAvatar();
        } else {
            await this.onPlayerModelSet();
        }
    }

    private replaceTargetWithAvatar(): Promise<void> {
        const originalTarget = this.target;
        let originalWasRemoved = false;

        return new Promise<void>(resolve => {
            this.game!.getAvatar()
                .then(async model => {
                    if (model) {
                        try {
                            //remove existing player object
                            this.game!.scene.remove(originalTarget);
                            this.game!.physics!.remove(originalTarget.uuid);
                            this.game!.physics!.removePlayerObject(originalTarget.uuid);
                            originalWasRemoved = true;
                            //copy model attributes from the target object
                            model.position.copy(originalTarget.position);
                            model.rotation.copy(originalTarget.rotation);
                            model.scale.copy(originalTarget.scale);
                            markLocalPlayerAvatar(model, {
                                playerId: this.game?.getUserId() ?? undefined,
                                sourceObjectUuid: originalTarget.uuid,
                                usesProfileAvatar: true,
                                avatarSource: "profile-avatar",
                            });
                            this.game?.scene!.add(model);
                            //add model to physics
                            console.log("[AVATAR] Adding user's avatar to physics: " + model.uuid);
                            PhysicsUtil.copyPhysicsConfig(originalTarget, model);
                            PhysicsUtil.updateShapeOffsetAndScale(model);
                            await PhysicsUtil.addObjectShapeToPhysics(model, this.game!.physics!);
                            //set default animations
                            this.attributes.idleAnimation = "Idle";
                            this.attributes.walkAnimation = "Walk";
                            this.attributes.runAnimation = "Run";
                            this.attributes.jumpAnimation = "Jump";
                            this.attributes.crouchAnimation = "Idle";
                            this.attributes.fallAnimation = "Fall_Land";
                            this.attributes.dieAnimation = "Idle";
                            this.characterControl?.setCharacterOptions(this.getCharaterOptions());
                            //reset target object
                            this.setTarget(model);
                        } catch (error) {
                            console.warn("[AVATAR] Failed to install user's avatar model", error);
                            // If original was removed during failed avatar setup, restore it
                            if (originalWasRemoved) {
                                console.log("[AVATAR] Restoring original character after failed avatar setup.");
                                this.game?.scene!.add(originalTarget);
                                PhysicsUtil.addObjectShapeToPhysics(originalTarget, this.game!.physics!).catch(
                                    e => console.warn("[AVATAR] Failed to restore physics for original target", e),
                                );
                            }
                            this.setTarget(originalTarget);
                        }
                        this.onPlayerModelSet()
                            .then(() => resolve())
                            .catch(error => {
                                console.warn("[AVATAR] Failed to set player model", error);
                                resolve();
                            });
                    } else {
                        console.log("[AVATAR] No user avatars found. Using default model.");
                        this.onPlayerModelSet()
                            .then(() => resolve())
                            .catch(error => {
                                console.warn("[AVATAR] Failed to set player model", error);
                                resolve();
                            });
                    }
                })
                .catch(error => {
                    console.warn("[AVATAR] Failed to load user's avatar URLs", error);
                    this.onPlayerModelSet()
                        .then(() => resolve())
                        .catch(error => {
                            console.warn("[AVATAR] Failed to set player model", error);
                            resolve();
                        });
                });
        });
    }

    override setTarget(newTarget: THREE.Object3D) {
        super.setTarget(newTarget);
        this.characterSwap?.updateOwner(newTarget);
    }

    /**
     * Tag the current target as the "player" so systems that discover the
     * player by tag (GameManager, triggers with OBJECT_STATE_COMPARE, etc.)
     * can find it. Skips the add when the tag is already present — avoids
     * duplicate entries in userData.tags on re-activation or when an
     * imported scene already marked the object.
     */
    private ensurePlayerTag(): void {
        if (!this.target) return;
        if (TagUtil.hasTag(this.target, "player")) return;
        TagUtil.addTag(this.target, "player");
    }

    private async onPlayerModelSet(): Promise<void> {
        const newTarget = await this.characterControl!.create(this.target);
        newTarget.userData.isSelectable = false; //TODO: move to utils

        this.setTarget(newTarget);

        if (this.attributes.isDefault !== false) {
            markLocalPlayerAvatar(this.target, {
                playerId: this.game?.getUserId() ?? undefined,
                sourceObjectUuid: newTarget.uuid,
                usesProfileAvatar: this.game?.useAvatar() === true,
                avatarSource: this.game?.useAvatar() === true ? "profile-avatar" : "scene-character",
            });
            this.isActive = true;
            this.setPlayerControls(this.controlType);
            this.game?.cameraControl?.start(this.target);
            //set the local player object in the game manager
            this.game!.setPlayer(this.target, {controllerManaged: true});
            this.ensurePlayerTag();
        } else if (this.game?.isMultiplayer && this.isRemotePlayer()) {
            // In multiplayer, remote characters should never be active
            this.isActive = false;
        }

        // be aware that onAdded could be called multiple times
        this.controlType = this.getCameraType();

        this.directionalLights = this.collectDirectionalLights();
    }

    private collectDirectionalLights(): THREE.DirectionalLight[] {
        const directionalLights: THREE.DirectionalLight[] = [];
        const scene = this.game?.scene;
        if (!scene) {
            return directionalLights;
        }

        traverseObjectDepthFirst(scene, object => {
            const light = object as THREE.DirectionalLight & {isDirectionalLight?: boolean};
            if (light.isDirectionalLight === true) {
                directionalLights.push(light);
            }
        });

        return directionalLights;
    }

    update(delta: number) {
        this.characterSwap?.update(delta);

        if (!this.target) {
            console.warn("[CharacterBehavior]: target is not set", this.target);
            return;
        }

        if (!this.isActive) {
            return;
        }

        this.target.userData.isGameMenuOpen = this.game!.engine.isGameMenuOpen;

        //FIXME: why this code is in CharacterBehavior ?
        if (this.directionalLights && this.directionalLights.length > 0) {
            for (let i = 0; i < this.directionalLights.length; i += 1) {
                const light = this.directionalLights[i];
                if (!light) continue;

                const targetPosition = light.target.position;
                const characterPosition = vec3Tmp.copy(this.target.position);
                targetPosition.subVectors(characterPosition, targetPosition);
                light.position.add(targetPosition);
                light.target.position.copy(characterPosition);
                light.target.updateMatrixWorld();
            }
        }

        this.characterControl?.update(delta);
    }

    onAttributesUpdated(): void {
        this.characterControl?.setCharacterOptions(this.getCharaterOptions());
        if (this.isActive) {
            this.setPlayerControls(this.controlType);
        }
    }

    onStop(): void {
        if (this.isActive && this.target && this.characterControl) {
            const physicsPos = this.target.position.clone();
            const cameraControl = this.game?.cameraControl as CameraControl;
            const spherical = [
                cameraControl["spherical"].radius,
                cameraControl["spherical"].phi,
                cameraControl["spherical"].theta,
            ];
            const targetSpherical = [
                cameraControl["targetSpherical"].radius,
                cameraControl["targetSpherical"].phi,
                cameraControl["targetSpherical"].theta,
            ];

            const saveState = {
                playerPosition: physicsPos.toArray(),
                cameraPosition: cameraControl.camera.position.toArray(),
                cameraRotation: cameraControl.camera.rotation.toArray(),
                spherical,
                targetSpherical,
            };

            localStorage.setItem("lastPlayState", JSON.stringify(saveState));
        }

        this.setPlayerControls("OrbitControls");
        if (this.isActive) {
            this.game!.setPlayer(undefined);
            this.isActive = false;
        }
        this.characterControl?.dispose();
        this.characterControl = undefined;
        this.characterSwap?.dispose();
        this.characterSwap = undefined;
    }

    onReset() {}

    getPosition(): THREE.Vector3 {
        return this.target?.position || new THREE.Vector3();
    }

    setPosition(position: THREE.Vector3): void {
        this.characterControl?.setPosition(position);
    }

    getAngle(): number {
        return this.characterControl?.getAngle() || 0;
    }

    setAngle(angle: number): void {
        this.characterControl?.setAngle(angle);
    }

    /**
     * Get the player animation controller interface.
     * Allows external behaviors to trigger animations and control blending.
     * @returns The animation controller or null if not initialized
     */
    getAnimationController(): IPlayerAnimationController | null {
        return this.characterControl ?? null;
    }

    private getCharaterOptions(): CharacterOptionsInterface {
        const animationNames = this.getAnimationNames();
        const animationNamesObj: Record<string, string> = {};
        animationNames.forEach(name => {
            animationNamesObj[name] = name;
        });
        const cameraCharacterOptions = this.game?.camera?.userData?.cameraData?.characterOptions;
        const canClimbFallback = cameraCharacterOptions?.canClimb ?? true;

        return {
            useAutoForward: this.attributes.autoForward ?? false,
            // sceneModels: sceneModels || [],
            sceneModels: [],
            selectedModelUUID: this.target?.uuid || "",
            selectedModel: this.target?.name || "none",
            animationNames: animationNamesObj,
            walkAnimation: this.attributes.walkAnimation,
            runAnimation: this.attributes.runAnimation,
            jumpAnimation: this.attributes.jumpAnimation,
            idleAnimation: this.attributes.idleAnimation,
            fallAnimation: this.attributes.fallAnimation,
            crouchAnimation: this.attributes.crouchAnimation,
            dieAnimation: this.attributes.dieAnimation,
            climbAnimation: this.attributes.climbAnimation,
            invertForwardDirection: this.attributes.invertForwardDirection ?? false,
            groundAcceleration: this.attributes.groundAcceleration ?? 0.3,
            groundDeceleration: this.attributes.groundDeceleration ?? 0.4,
            airAcceleration: this.attributes.airAcceleration ?? 0.2,
            airDeceleration: this.attributes.airDeceleration ?? 0.1,
            walkSpeed: this.attributes.walkSpeed,
            runSpeed: this.attributes.runSpeed,
            jumpHeight: this.attributes.jumpHeight ?? this.attributes.jumpSpeed ?? 1, // TODO: remove jumpSpeed later, added for backward compatibility
            stepHeight: this.attributes.stepHeight ?? 0.1,
            pushObjects: this.attributes.pushObjects ?? true,
            pushImpulse: this.attributes.pushImpulse ?? 1,
            pushVerticalScale: this.attributes.pushVerticalScale ?? 0,
            kickObjects: this.attributes.kickObjects ?? false,
            kickImpulse: this.attributes.kickImpulse ?? 5,
            kickAnimation: this.attributes.kickAnimation ?? "none",
            climbSpeed: this.attributes.climbSpeed ?? 1,
            canClimb: this.attributes.canClimb ?? canClimbFallback,
            cameraDefaultDistance: 10,
            cameraMinDistance: 10,
            cameraMaxDistance: 10,
            cameraFov: 60,
            health: this.attributes.health,
            lookSpeed: Math.min(this.attributes.lookSpeed, 1),
            maxSlope: this.attributes.maxSlope ?? 40,
        } as CharacterOptionsInterface;
    }

    private emitEvent(eventName: string, data?: any): void {
        this.game?.behaviorManager?.sendEventToObjectBehaviors(this.target, eventName, data);
    }

    private getAnimationNames(): string[] {
        return [
            this.attributes.idleAnimation,
            this.attributes.walkAnimation,
            this.attributes.runAnimation,
            this.attributes.jumpAnimation,
            this.attributes.crouchAnimation,
            this.attributes.fallAnimation,
            this.attributes.dieAnimation,
        ];
    }

    // since there is no converters anymore, we need to manually set the player controls
    private setPlayerControls(cameraType: CAMERA_TYPES | string) {
        //FIXME: why do we need it in userData ????
        console.log("[CharacterBehavior]: Set player controls", cameraType);
        const cameraData = this.camera!.userData.cameraData;

        cameraData.characterOptions = this.getCharaterOptions();
    }

    private getCameraType(): CAMERA_TYPES {
        const cameraData = this.game?.camera?.userData?.cameraData;
        let cameraType = cameraData.cameraType || CAMERA_TYPES.THIRD_PERSON;

        return cameraType;
    }

    private isRemotePlayer(): boolean {
        return !!(
            this.game?.isMultiplayer &&
            (this.target?.name.includes("-mp-") || this.target?.name.includes("Remote"))
        );
    }

    onEvent(msg: string, data: any): void {
        // In multiplayer, do not allow activation of remote players
        if (this.isRemotePlayer() && msg === "character:activate") {
            console.warn("Attempt to activate remote character:", this.target?.name);
            return;
        }

        if (msg === "character.stopClimbing") {
            this.characterControl?.stopClimbing();
        }

        if (msg === "character:activate" && !this.isActive) {
            this.isActive = true;
            this.setPlayerControls(this.controlType);
            this.game?.cameraControl?.start(this.target);
            // CharacterBehavior owns movement/physics through its controller;
            // preserve that ownership when reactivating after a stop.
            this.game!.setPlayer(this.target, {controllerManaged: true});
            this.ensurePlayerTag();
            this.characterSwap?.reset();
        } else if (msg === "character:deactivate" && this.isActive) {
            this.characterControl?.stopMovement();
            this.game!.setPlayer(undefined);
            this.setPlayerControls("OrbitControls");
            this.isActive = false;
            this.characterSwap?.reset();
        }

        // Animation control events
        if (msg === "animation:trigger" && data?.name) {
            this.characterControl?.triggerAnimation(data.name, data.options);
        }
        if (msg === "animation:stop") {
            this.characterControl?.stopAnimation();
        }
        if (msg === "animation:blend" && data?.blends) {
            this.characterControl?.playBlendedAnimations(data.blends);
        }
        if (msg === "animation:weights" && data?.weights) {
            this.characterControl?.updateBlendWeights(data.weights);
        }
    }
}

export default CharacterBehavior;

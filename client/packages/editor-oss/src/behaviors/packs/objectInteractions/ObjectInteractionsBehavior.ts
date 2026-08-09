import {Object3D, Quaternion, Vector3} from "three";

import {dispatchCustomInventoryEvent, EVENTS} from "@stem/network/api/inventory/inventoryEvents";
import {CollisionType} from "../../../physics/common/physicsConfig";
import {PhysicsUtil} from "../../../physics/PhysicsUtil";
import {BehaviorBase} from "../../Behavior";
import EventBus, {IN_GAME_EVENTS} from "../../event/EventBus";
import GameManager from "../../game/GameManager";
import {BehaviorThrottlePriority} from "../../performance/interfaces/IThrottleStrategy";
import RangeDetector from "../../range/RangeDetector";

const UP = new Vector3(0, 1, 0);

class ObjectInteractionsBehavior extends BehaviorBase {
    game: GameManager | null = null;
    private physicsEnabled = false;
    private isHeld = false;
    private wasEPressed = false;
    private wasFPressed = false;
    private wasPPressed = false;
    private lastInteractionMs = 0;
    private placedInInventory = false;
    private rangeDetector: RangeDetector | null = null;
    private debugStatus = "ready";
    private didWarnNoActor = false;
    private didWarnPaused = false;

    private originalCtype: string | null = null;
    private originalMass: number | null = null;

    private readonly playerPos = new Vector3();
    private readonly targetPos = new Vector3();
    private readonly holdPos = new Vector3();
    private readonly forward = new Vector3();
    private readonly impulse = new Vector3();
    private readonly rightVec = new Vector3();
    private readonly targetQuat = new Quaternion();

    public throttleConfig = {
        throttlePriority: BehaviorThrottlePriority.HIGH,
        enableFrustumCulling: true,
        enableDistanceThrottling: false,
        requiresConsistentUpdates: true,
    };

    init(game: GameManager) {
        super.init(game);
        this.game = game;
        this.rangeDetector = new RangeDetector(game);
    }

    onStart(): void {
        if (!this.target) return;

        this.physicsEnabled = PhysicsUtil.isPhysicsEnabled(this.target);
        this.convertToDynamicIfNeeded();

        const interactionActor = this.getInteractionActor();
        if (interactionActor) {
            this.rangeDetector?.setPlayer(interactionActor);
        }

        this.rangeDetector?.setTarget(this.target);
        this.rangeDetector?.setKeyText("E/F");
        this.rangeDetector?.setText("Interact");
    }

    onStop(): void {
        this.dropIfHeld();
        this.restoreOriginalPhysics();
        this.rangeDetector?.dispose();
        this.rangeDetector = null;
    }

    onReset() {
        this.dropIfHeld();
        this.wasEPressed = false;
        this.wasFPressed = false;
        this.wasPPressed = false;
        this.lastInteractionMs = 0;
        this.placedInInventory = false;
    }

    update(deltaTime: number) {
        void deltaTime;
        if (!this.target) return;
        if (this.isPaused) {
            if (!this.didWarnPaused) {
                this.didWarnPaused = true;
                console.warn(`[ObjectInteractions][${this.target.name || this.target.uuid}] update: behavior is paused`);
            }
            return;
        }
        this.didWarnPaused = false;

        const interactionActor = this.getInteractionActor();
        if (!interactionActor) {
            if (!this.didWarnNoActor) {
                this.didWarnNoActor = true;
                console.warn(`[ObjectInteractions][${this.target.name || this.target.uuid}] update: no interaction actor`);
            }
            return;
        }
        this.didWarnNoActor = false;
        this.rangeDetector?.setPlayer(interactionActor);

        this.rangeDetector?.update();

        if (this.getBooleanAttr("debugOverlay", false)) {
            this.rangeDetector?.setText(`Interact (${this.debugStatus})`);
        } else {
            this.rangeDetector?.setText("Interact");
        }

        if (this.isHeld) {
            this.updateHeldObjectPose();
        } else if (this.physicsEnabled) {
            this.pushPullOnContact();
        }

        const ePressed = this.isEPressed();
        const fPressed = this.isFPressed();
        const pPressed = this.isPPressed();

        if (this.getBooleanAttr("debugLogs", false)) {
            if (ePressed && !this.wasEPressed) {
                console.warn(`[ObjectInteractions][${this.target.name || this.target.uuid}] input:E`);
            }
            if (fPressed && !this.wasFPressed) {
                console.warn(`[ObjectInteractions][${this.target.name || this.target.uuid}] input:F`);
            }
            if (pPressed && !this.wasPPressed) {
                console.warn(`[ObjectInteractions][${this.target.name || this.target.uuid}] input:P`);
            }
        }

        if (ePressed && !this.wasEPressed) {
            this.handleActivateAction();
        }
        if (fPressed && !this.wasFPressed) {
            this.handleDeactivateAction();
        }
        if (pPressed && !this.wasPPressed) {
            this.handlePullAction();
        }

        this.wasEPressed = ePressed;
        this.wasFPressed = fPressed;
        this.wasPPressed = pPressed;
    }

    private handleActivateAction(): void {
        if (!this.canInteractNow()) return;

        if (this.isHeld && this.attributes.placeInInventory) {
            this.setDebugStatus("action:placeInInventory");
            this.placeInInventory();
            return;
        }

        if (!this.isHeld) {
            if (this.attributes.pickUp !== false) {
                this.setDebugStatus("action:pickUp");
                this.pickUp();
                return;
            }

            if (this.attributes.push) {
                this.setDebugStatus("action:push");
                this.push();
                return;
            }
        }

        this.setDebugStatus("blocked:noActiveAction");
    }

    private handleDeactivateAction(): void {
        if (!this.canInteractNow()) return;

        if (this.isHeld) {
            this.setDebugStatus("action:drop");
            this.drop();
            return;
        }

        this.setDebugStatus("blocked:notHeld");
    }

    private handlePullAction(): void {
        if (this.attributes.pull === false) {
            this.setDebugStatus("blocked:pullDisabled");
            return;
        }
        if (this.isHeld) {
            this.setDebugStatus("blocked:pullWhileHeld");
            return;
        }
        if (!this.canInteractNow()) return;

        this.setDebugStatus("action:pull");
        this.pull();
    }

    private canInteractNow(): boolean {
        if (!this.target || !this.getInteractionActor() || !this.game?.physics) {
            this.setDebugStatus("blocked:missingTargetOrActorOrPhysics");
            return false;
        }
        if (!this.physicsEnabled) {
            this.physicsEnabled = PhysicsUtil.isPhysicsEnabled(this.target);
            if (!this.physicsEnabled) {
                this.setDebugStatus("blocked:physicsDisabled");
                return false;
            }
        }
        if (this.placedInInventory || this.target.visible === false) {
            this.setDebugStatus("blocked:inventoryOrHidden");
            return false;
        }

        const now = performance.now();
        const cooldownMs = this.getNumberAttr("interactionCooldownMs", 150);
        if (now - this.lastInteractionMs < cooldownMs) {
            this.setDebugStatus("blocked:cooldown");
            return false;
        }

        if (!this.isHeld && !this.isTargetInRangeForCurrentFrame()) {
            this.setDebugStatus("blocked:outOfRange");
            return false;
        }

        this.lastInteractionMs = now;
        this.setDebugStatus("ready");
        return true;
    }

    private pickUp(): void {
        if (!this.target || !this.game?.physics) return;

        // Remove the physics body entirely so it doesn't interfere while held.
        // This avoids the broadphase-stale-AABB problem with static bodies.
        this.game.physics.remove(this.target.uuid);
        this.isHeld = true;
        this.updateHeldObjectPose();
    }

    private drop(): void {
        if (!this.target || !this.game?.physics) return;

        this.isHeld = false;

        // Re-add the physics body at the current Three.js position.
        // This creates a fresh body with a correct broadphase AABB.
        const physics = this.game.physics;
        const target = this.target;
        void PhysicsUtil.addObjectShapeToPhysics(target, physics).then(() => {
            const forwardImpulse = this.getNumberAttr("dropForwardImpulse", 0);
            const upwardImpulse = this.getNumberAttr("dropUpwardImpulse", 0);
            if (forwardImpulse === 0 && upwardImpulse === 0) return;

            const interactionActor = this.getInteractionActor();
            if (!interactionActor) return;
            interactionActor.getWorldDirection(this.forward).normalize();
            this.impulse.copy(this.forward).multiplyScalar(forwardImpulse);
            this.impulse.y += upwardImpulse;
            physics.applyCentralImpulse(target.uuid, this.impulse);
        });
    }

    private dropIfHeld(): void {
        if (this.isHeld) {
            this.drop();
        }
    }

    private placeInInventory(): void {
        if (!this.target || this.placedInInventory) return;

        if (this.isHeld) {
            // Physics body is already removed while held, just clear the flag
            this.isHeld = false;
        }

        dispatchCustomInventoryEvent(EVENTS.INVENTORY_ADD, {
            Amount: 1,
            UUID: this.target.uuid,
            Name: this.target.name || "Object",
        });

        const inventoryType = typeof this.attributes.inventoryType === "string"
            ? this.attributes.inventoryType
            : "default";

        EventBus.instance.send(IN_GAME_EVENTS.CONSUMABLE_COLLECTED, {
            target: this.target,
            type: "INSTANT",
            inventoryType,
        });

        this.game?.engine.physics?.removePhysicsObjectBody(this.target);
        this.target.visible = false;
        this.placedInInventory = true;
    }

    private push(): void {
        this.applyDirectionalImpulse(this.getNumberAttr("pushImpulse", 8), 1);
    }

    private pull(): void {
        this.applyDirectionalImpulse(this.getNumberAttr("pullImpulse", 8), -1);
    }

    private applyDirectionalImpulse(strength: number, directionSign: 1 | -1): void {
        if (!this.target || !this.game?.physics) return;
        const interactionActor = this.getInteractionActor();
        if (!interactionActor) return;

        interactionActor.getWorldPosition(this.playerPos);
        this.target.getWorldPosition(this.targetPos);

        this.forward.subVectors(this.targetPos, this.playerPos);
        if (this.forward.lengthSq() < 1e-6) return;

        this.forward.normalize().multiplyScalar(strength * directionSign);
        this.game.physics.applyCentralImpulse(this.target.uuid, this.forward);
    }

    private updateHeldObjectPose(): void {
        if (!this.target) return;
        const interactionActor = this.getInteractionActor();
        if (!interactionActor) return;

        interactionActor.getWorldPosition(this.playerPos);
        interactionActor.getWorldDirection(this.forward).normalize();

        const holdDistance = this.getNumberAttr("holdDistance", 1.75);
        const holdHeight = this.getNumberAttr("holdHeight", 1.1);

        this.holdPos.copy(this.playerPos);
        this.holdPos.addScaledVector(this.forward, holdDistance);
        this.holdPos.y += holdHeight;

        const sideOffset = this.getNumberAttr("holdSideOffset", 0);
        if (sideOffset !== 0) {
            this.rightVec.crossVectors(this.forward, UP).normalize();
            this.holdPos.addScaledVector(this.rightVec, sideOffset);
        }

        // Move the Three.js object directly (physics body is removed while held)
        this.target.position.copy(this.holdPos);

        const rotateWithPlayer = this.attributes.rotateWithPlayer !== false;
        if (rotateWithPlayer) {
            interactionActor.getWorldQuaternion(this.targetQuat);
            this.target.quaternion.copy(this.targetQuat);
        }
    }

    private isTargetInRange(): boolean {
        if (!this.target) return false;
        const interactionActor = this.getInteractionActor();
        if (!interactionActor) return false;

        interactionActor.getWorldPosition(this.playerPos);
        this.target.getWorldPosition(this.targetPos);

        const distance = this.getNumberAttr("interactionDistance", 3.5);
        return this.playerPos.distanceToSquared(this.targetPos) <= distance * distance;
    }

    private isTargetInRangeForCurrentFrame(): boolean {
        return this.rangeDetector?.isTargetInRange ?? this.isTargetInRange();
    }

    private isEPressed(): boolean {
        const actor = this.getInteractionActor();
        return (
            this.game?.scene?.userData?.pressE === true ||
            actor?.userData?.pressE === true ||
            this.game?.player?.userData?.pressE === true
        );
    }

    private isFPressed(): boolean {
        const actor = this.getInteractionActor();
        return (
            this.game?.scene?.userData?.pressF === true ||
            actor?.userData?.pressF === true ||
            this.game?.player?.userData?.pressF === true
        );
    }

    private isPPressed(): boolean {
        const actor = this.getInteractionActor();
        return (
            this.game?.scene?.userData?.pressP === true ||
            actor?.userData?.pressP === true ||
            this.game?.player?.userData?.pressP === true
        );
    }

    private getInteractionActor(): Object3D | null {
        const cameraControl = this.game?.cameraControl as unknown as { character?: Object3D } | undefined;
        const cameraCharacter = cameraControl?.character;
        return cameraCharacter || this.game?.player || null;
    }

    private getNumberAttr(key: string, fallback: number): number {
        const value = Number(this.attributes[key]);
        return Number.isFinite(value) ? value : fallback;
    }

    private getBooleanAttr(key: string, fallback: boolean): boolean {
        const value = this.attributes[key];
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (normalized === "true") return true;
            if (normalized === "false") return false;
        }
        if (typeof value === "number") {
            return value !== 0;
        }
        return fallback;
    }

    private pushPullOnContact(): void {
        if (!this.target || !this.game?.physics) return;
        const interactionActor = this.getInteractionActor();
        if (!interactionActor) return;

        interactionActor.getWorldPosition(this.playerPos);
        this.target.getWorldPosition(this.targetPos);

        const contactDist = this.getNumberAttr("contactPushDistance", 0.1);
        const distSq = this.playerPos.distanceToSquared(this.targetPos);
        if (distSq > contactDist * contactDist || distSq < 1e-6) return;

        // Direction from player to target (horizontal)
        this.impulse.subVectors(this.targetPos, this.playerPos);
        this.impulse.y = 0;
        if (this.impulse.lengthSq() < 1e-6) return;
        this.impulse.normalize();

        // Check player facing vs target direction
        interactionActor.getWorldDirection(this.forward);
        this.forward.y = 0;
        this.forward.normalize();
        const dot = this.forward.dot(this.impulse);

        if (dot > 0 && this.attributes.push !== false) {
            // Facing toward target → push
            const force = this.getNumberAttr("contactPushForce", 0.5);
            this.impulse.multiplyScalar(force);
            this.game.physics.applyCentralImpulse(this.target.uuid, this.impulse);
        } else if (dot < 0 && this.attributes.pull) {
            // Facing away from target → pull (impulse toward player)
            const force = this.getNumberAttr("contactPullForce", 0.5);
            this.impulse.multiplyScalar(-force); // Reverse direction = toward player
            this.game.physics.applyCentralImpulse(this.target.uuid, this.impulse);
        }
    }

    private convertToDynamicIfNeeded(): void {
        if (!this.target || !this.game?.physics || !this.physicsEnabled) return;
        if (this.attributes.pickUp === false && !this.attributes.push) return;

        const config = PhysicsUtil.getPhysicsConfig(this.target);
        if (!config) return;

        const ctype = config.ctype;
        if (ctype !== CollisionType.Static && ctype !== "Kinematic") return;

        this.originalCtype = ctype;
        this.originalMass = config.mass ?? 0;

        config.ctype = CollisionType.Dynamic;
        config.mass = this.getNumberAttr("interactionMass", 1);

        this.game.physics.remove(this.target.uuid);
        void PhysicsUtil.addObjectShapeToPhysics(this.target, this.game.physics);
    }

    private restoreOriginalPhysics(): void {
        if (!this.target || !this.game?.physics || this.originalCtype === null) return;

        const config = PhysicsUtil.getPhysicsConfig(this.target);
        if (!config) return;

        config.ctype = this.originalCtype as CollisionType;
        config.mass = this.originalMass ?? 0;
        this.originalCtype = null;
        this.originalMass = null;
    }

    private setDebugStatus(status: string): void {
        if (this.debugStatus === status) return;
        this.debugStatus = status;
        if (this.getBooleanAttr("debugLogs", false)) {
            console.warn(`[ObjectInteractions][${this.target?.name || this.target?.uuid}] ${status}`);
        }
    }

}

export default ObjectInteractionsBehavior;

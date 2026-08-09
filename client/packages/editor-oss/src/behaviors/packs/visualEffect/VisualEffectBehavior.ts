import {Object3D, Vector3, Vector3Like} from "three";
import {ParticleEmitter, QuarksUtil} from "three.quarks";

import EventBus from "../../../behaviors/event/EventBus";
import {IMultiplayerState} from "../../../behaviors/state/IMultiplayerState";
import global from "@stem/editor-oss/global";
import {findObjectDepthFirst, traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {PhysicsUtil} from "../../../physics/PhysicsUtil";
import {BehaviorBase} from "../../Behavior";
import GameManager from "../../game/GameManager";
import {BehaviorThrottlePriority} from "../../performance/interfaces/IThrottleStrategy";

class VisualEffectBehavior extends BehaviorBase {
    private isPlaying: boolean = false;
    private originalParent: Object3D | null = null;
    private originalPosition: Vector3Like | null = null;
    private eventTokens: string[] = []; // Store event subscription tokens for cleanup
    private stopTimer: number | null = null; // Store timer for cleanup
    private needsPositionUpdate: boolean = false; // Track if we need position updates
    private multiplayerState?: IMultiplayerState | null = null;
    private readonly _worldPosAux = new Vector3();

    init(gameManager: GameManager) {
        this.game = gameManager;
        this.multiplayerState = this.game.multiplayerState;
        // Set throttle config based on behavior.json
        this.throttleConfig = {
            ...this.throttleConfig,
            throttlePriority: BehaviorThrottlePriority.CRITICAL,
            enableFrustumCulling: true,
            enableDistanceThrottling: true,
            requiresConsistentUpdates: false,
        };
    }

    onPaused(): void {
        this.stopVFX();
        this.isPaused = true;
        this.needsPositionUpdate = false;
    }

    onResumed(): void {
        this.stopVFX();
        this.cleanupEventSubscriptions(); // Clean up before re-subscribing
        this.subscribeToEvents();
        this.isPaused = false;
    }

    onAdded() {
        this.originalParent = this.target?.parent || null;
        this.originalPosition = this.target
            ? {x: this.target.position.x, y: this.target.position.y, z: this.target.position.z}
            : null;

        this.processParticleSystems(this.target);
        this.moveVFXToScene();
        this.stopVFX();
        this.subscribeToEvents();

        // Only set up position tracking if we have an original parent
        this.needsPositionUpdate = !!this.originalParent && this.originalParent !== this.game?.scene;

        if (this.attributes.triggerOnAdded) {
            this.playVFX();
        }
    }

    onRemoved(): void {
        this.stopVFX();
        this.cleanupEventSubscriptions();
        this.cleanupTimer();
    }

    onReset() {
        this.stopVFX();
        this.cleanupTimer();
    }

    onEvent(msg: string, data: any): void {
        if (msg === "trigger" && this.attributes.startOnTrigger) {
            if (data.actionType === "activate") {
                this.playVFX(null, true);
            } else if (data.actionType === "deactivate") {
                this.stopVFX(null, true);
            }
        }
    }

    update(): void {
        if (this.multiplayerState && !this.multiplayerState.isHost() && this.game.player !== this.originalParent) {
            return; // Only the host should control VFX position updates
        }
        // Only update position if we need to track parent movement and we're not paused
        if (this.needsPositionUpdate && !this.isPaused && this.target && this.originalParent && this.originalPosition) {
            // Get the world position of the original parent (reuse cached vector)
            this.originalParent.getWorldPosition(this._worldPosAux);
            const worldPosition = this._worldPosAux;
            const position = {
                x: worldPosition.x + this.originalPosition.x,
                y: worldPosition.y + this.originalPosition.y,
                z: worldPosition.z + this.originalPosition.z,
            };

            // Apply the original local offset to the world position
            this.target.position.set(position.x, position.y, position.z);
            this.syncMultiplayerState("position", position);
        }
    }

    onAttributesUpdated(): void {}

    dispose(): void {
        this.stopVFX();
        this.cleanupEventSubscriptions();
        this.cleanupTimer();
        this.isPlaying = false;
        this.originalParent = null;
        this.originalPosition = null;
    }

    private moveVFXToScene = () => {
        if (this.target && this.target.parent !== this.game?.scene) {
            this.target.removeFromParent();
            this.game?.scene.add(this.target);

            if (this.originalParent) {
                if (PhysicsUtil.isPhysicsEnabled(this.originalParent)) {
                    PhysicsUtil.updateShapeOffsetAndScale(this.originalParent);
                }
            }

            if (PhysicsUtil.isPhysicsEnabled(this.target)) {
                PhysicsUtil.updateShapeOffsetAndScale(this.target);
            }
        }
    };

    private playVFX = (data?: any, skipCheck?: boolean) => {
        if (!this.target || this.isPaused || this.isPlaying) {
            return;
        }

        if (this.attributes.triggerByParent && !skipCheck) {
            if (data?.target && data.target instanceof Object3D) {
                // Check if the target is a parent of the visual effect. We can also check original parent here
                if (!this.triggerTargetContainsOriginalParent(data.target)) {
                    return;
                }
            } else {
                return;
            }
        }

        if (this.multiplayerState) {
            this.syncMultiplayerState("play");
            return;
        }

        // Clean up existing timer before creating a new one
        this.cleanupTimer();

        QuarksUtil.runOnAllParticleEmitters(this.target, (emitter: ParticleEmitter) => {
            if (this.attributes.restartOnTrigger) {
                QuarksUtil.restart(emitter);
            } else {
                QuarksUtil.play(emitter);
                this.isPlaying = true;
                if (emitter.system.duration > 0 && !emitter.system.looping) {
                    // Store timer reference for cleanup
                    this.stopTimer = window.setTimeout(() => {
                        QuarksUtil.stop(emitter);
                        this.isPlaying = false;
                        this.stopTimer = null;
                    }, emitter.system.duration * 1000);
                }
            }
        });
    };

    private stopVFX = (data?: any, skipCheck?: boolean) => {
        if (!this.target) {
            return;
        }

        if (this.attributes.triggerByParent && !skipCheck) {
            if (data?.target && data.target instanceof Object3D) {
                // Check if the target is a parent of the visual effect. We can also check original parent here
                if (!this.triggerTargetContainsOriginalParent(data.target)) {
                    return;
                }
            } else {
                return;
            }
        }

        if (this.multiplayerState) {
            this.syncMultiplayerState("stop");
            return;
        }

        // Clean up timer when manually stopping VFX
        this.cleanupTimer();

        QuarksUtil.runOnAllParticleEmitters(this.target, (emitter: ParticleEmitter) => {
            QuarksUtil.stop(emitter);
            this.isPlaying = false;
        });
    };

    private subscribeToEvents() {
        // Clean up existing subscriptions before creating new ones
        this.cleanupEventSubscriptions();

        if (this.attributes.useCustomEvents) {
            if (this.attributes.customTriggerEvents && this.attributes.customTriggerEvents.length > 0) {
                this.attributes.customTriggerEvents.forEach((eventName: string) => {
                    if (eventName && eventName.trim() !== "") {
                        const token = EventBus.instance.subscribe(eventName, (msg: string, data: any) =>
                            this.playVFX(data),
                        );
                        this.eventTokens.push(token);
                    }
                });
            }
            if (this.attributes.customStopEvents && this.attributes.customStopEvents.length > 0) {
                this.attributes.customStopEvents.forEach((eventName: string) => {
                    if (eventName && eventName.trim() !== "") {
                        const token = EventBus.instance.subscribe(eventName, (msg: string, data: any) =>
                            this.stopVFX(data),
                        );
                        this.eventTokens.push(token);
                    }
                });
            }
        }

        if (this.attributes.triggerEvents && this.attributes.triggerEvents.length > 0) {
            this.attributes.triggerEvents.forEach((eventName: string) => {
                if (eventName === "none" || !eventName) {
                    return;
                }
                const token = EventBus.instance.subscribe(eventName, (msg: string, data: any) => this.playVFX(data));
                this.eventTokens.push(token);
            });
        }

        if (this.attributes.stopEvents && this.attributes.stopEvents.length > 0) {
            this.attributes.stopEvents.forEach((eventName: string) => {
                if (eventName === "none" || !eventName) {
                    return;
                }
                const token = EventBus.instance.subscribe(eventName, (msg: string, data: any) => this.stopVFX(data));
                this.eventTokens.push(token);
            });
        }
    }

    /**
     * Clean up all event subscriptions to prevent memory leaks
     */
    private cleanupEventSubscriptions(): void {
        this.eventTokens.forEach(token => {
            EventBus.instance.unsubscribe(token);
        });
        this.eventTokens = [];
    }

    /**
     * Clean up the stop timer to prevent memory leaks
     */
    private cleanupTimer(): void {
        if (this.stopTimer !== null) {
            clearTimeout(this.stopTimer);
            this.stopTimer = null;
        }
    }

    private triggerTargetContainsOriginalParent(target: Object3D): boolean {
        const originalParentUuid = this.originalParent?.uuid;
        return !!originalParentUuid && findObjectDepthFirst(target, object => object.uuid === originalParentUuid) !== null;
    }

    /**
     * Sync VFX state to multiplayer
     * @param action - 'play' or 'stop' or 'position'
     * @param value - Optional position data for 'position' action
     */
    syncMultiplayerState(action: "play" | "stop" | "position", value?: any): void {
        if (this.multiplayerState) {
            const stateData = {
                timestamp: Date.now(),
                value: value || null,
            };

            this.multiplayerState.setBehaviorData(this.target, this.id, action, JSON.stringify(stateData));
        }
    }

    /**
     * Handle multiplayer state updates from other clients
     * @param key - State key to update
     * @param value - JSON string containing state data
     * @param data
     */
    onStateUpdated(key: string, data: string | undefined): void {
        if (!data) return;
        try {
            const parsedData = JSON.parse(data);
            // Only apply state update if it came from a different user

            if (key === "play") {
                // Call playVFX without syncing again (skip multiplayer sync)
                this.playVFXLocal();
            } else if (key === "stop") {
                // Call stopVFX without syncing again (skip multiplayer sync)
                this.stopVFXLocal();
            } else if (key === "position" && parsedData.value) {
                // Update position directly without affecting original parent tracking
                if (this.target && !this.multiplayerState?.isHost()) {
                    const pos = parsedData.value;
                    if (typeof pos.x !== "number" || typeof pos.y !== "number" || typeof pos.z !== "number") {
                        return;
                    }
                    this.target.position.set(pos.x, pos.y, pos.z);
                }
            }
        } catch (error) {
            console.error("[VFX] Error parsing state data:", error);
        }
    }

    /**
     * Play VFX locally without multiplayer sync (used for remote triggers)
     */
    private playVFXLocal(): void {
        if (!this.target || this.isPaused || this.isPlaying) {
            return;
        }

        this.cleanupTimer();

        QuarksUtil.runOnAllParticleEmitters(this.target, (emitter: ParticleEmitter) => {
            if (this.attributes.restartOnTrigger) {
                QuarksUtil.restart(emitter);
            } else {
                QuarksUtil.play(emitter);
                this.isPlaying = true;
                if (emitter.system.duration > 0 && !emitter.system.looping) {
                    this.stopTimer = window.setTimeout(() => {
                        QuarksUtil.stop(emitter);
                        this.isPlaying = false;
                        this.stopTimer = null;
                    }, emitter.system.duration * 1000);
                }
            }
        });
    }

    /**
     * Stop VFX locally without multiplayer sync (used for remote triggers)
     */
    private stopVFXLocal(): void {
        if (!this.target) {
            return;
        }

        this.cleanupTimer();

        QuarksUtil.runOnAllParticleEmitters(this.target, (emitter: ParticleEmitter) => {
            QuarksUtil.stop(emitter);
            this.isPlaying = false;
        });
    }

    private processParticleSystems = (object3d: Object3D) => {
        const emitters: ParticleEmitter[] = [];
        traverseObjectDepthFirst(object3d, obj => {
            if (obj instanceof ParticleEmitter) {
                emitters.push(obj);
            }
        });
        if (emitters.length === 0) {
            return;
        }

        void global.app?.ensureBatchedRenderer()
            .then(batchedRenderer => {
                for (const emitter of emitters) {
                    QuarksUtil.addToBatchRenderer(emitter, batchedRenderer);
                }
            })
            .catch(error => {
                console.warn("[VisualEffectBehavior] Failed to initialize VFX renderer:", error);
            });
    };
}

export default VisualEffectBehavior;

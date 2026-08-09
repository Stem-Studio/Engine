import {AnimationAction, AnimationClip, AnimationMixer, AnimationObjectGroup, Camera, LoopOnce, Object3D, Timer, type Clock} from "three";
import GameManager from "@stem/editor-oss/behaviors/game/GameManager";
import {AvatarBudgetPolicy, configureAvatarBudgetPolicyFromEngine} from "@stem/editor-oss/core/budget/AvatarBudgetPolicy";
import global from "@stem/editor-oss/global";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {setRuntimeUserDataValue} from "@stem/editor-oss/utils/userDataRuntime";

export type BlendedAnimationParams = {
    name: string | AnimationClip;
    weight?: number;
    speed?: number;
    fadeDuration?: number;
};

export type StoredAnimationData = {
    mixer: AnimationMixer;
    speed: number;
    actions: AnimationAction[];
    blends: BlendedAnimationParams[];
    paused: boolean;
    onComplete?: () => void;
    //DEPRECATED: for backward compatibility only
    clip?: AnimationClip;
    action?: AnimationAction;
};

type AnimationSourceObject = Object3D & {
    _obj?: {
        animations?: AnimationClip[];
    };
};

export class AnimationController {
    game?: GameManager | null;
    animations: StoredAnimationData[];
    requestAnimationFrameId: number;
    clock?: Pick<Clock, "getDelta">;
    gameStarted: boolean = false;
    private frameCount = 0;
    private readonly fallbackTimer = new Timer();
    private readonly avatarBudgetPolicy = new AvatarBudgetPolicy();

    constructor() {
        this.animations = [];
        this.requestAnimationFrameId = -1;
    }

    start = (gameManager: GameManager) => {
        this.game = gameManager;
        global.app?.on("gameStarted.AnimationController", () => {
            this.gameStarted = true;
        });
    };

    playAnimation = (
        object: Object3D,
        animationName: string,
        speed: number,
        playOnce?: boolean,
        fadeDuration: number = 0.5,
        onComplete?: () => void,
    ) => {
        this.playBlendedAnimations(
            object,
            [{name: animationName, speed: speed, fadeDuration: fadeDuration}],
            playOnce,
            onComplete,
        );
    };

    playCustomAnimation = (
        object: Object3D,
        clip: AnimationClip,
        speed: number,
        playOnce?: boolean,
        fadeDuration: number = 0.5,
    ) => {
        this.playBlendedAnimations(object, [{name: clip, speed: speed, fadeDuration: fadeDuration}], playOnce);
    };

    getMixer = (object: Object3D): AnimationMixer => {
        const animation = AnimationController.getStoredAnimationData(object);
        if (animation) {
            return animation.mixer;
        }
        return new AnimationMixer(object);
    };

    private static getCurrentAnimation(object: Object3D): StoredAnimationData {
        // TODO: probably better to not expose StoredAnimationData publicly
        // since it may contain private fields
        // TODO: should this be object.userData.animation? (no 's')
        return object.userData.animation as StoredAnimationData;
    }

    static getCurrentAnimationParams(object: Object3D): BlendedAnimationParams[] | undefined {
        // TODO: should this be object.userData.animation? (no 's')
        const animation = object.userData.animation as StoredAnimationData;
        return animation ? animation.blends : undefined;
    }

    stopAnimation = (object: Object3D) => {
        const animation = AnimationController.getStoredAnimationData(object);
        if (animation?.mixer) {
            animation.mixer.stopAllAction();
            animation.mixer.uncacheRoot(animation.mixer.getRoot());
        }
        delete object.userData.animation;
    };

    setAnimationPaused = (object: Object3D, paused: boolean) => {
        const animation = AnimationController.getStoredAnimationData(object);
        if (animation) {
            animation.paused = paused;
        }
    };

    update = (deltaTime?: number) => {
        if (!this.game || !this.game.isGameStarted()) {
            return;
        }

        const delta = this.getFrameDelta(deltaTime);
        this.frameCount++;
        const camera = this.game.camera;
        configureAvatarBudgetPolicyFromEngine(this.avatarBudgetPolicy, this.game.engine);

        if (this.animations.length > 0) {
            if (camera) {
                this.avatarBudgetPolicy.beginFrame(camera);
            }
            try {
                for (let i = 0; i < this.animations.length; i++) {
                    const animation = this.animations[i];
                    if (animation && !animation.paused) {
                        const root = animation.mixer.getRoot();
                        if (camera) {
                            if (root instanceof Object3D && this.avatarBudgetPolicy.isEnabled(root)) {
                                const decision = this.avatarBudgetPolicy.decide(root, camera);
                                this.avatarBudgetPolicy.applyVisibilityState(root, decision);
                                if (!this.avatarBudgetPolicy.shouldRunAnimationUpdate(root, decision, delta)) continue;
                            } else {
                                const skip = this.getSkipFrames(root, camera);
                                if (skip > 0 && root instanceof Object3D) {
                                    const hash = this.getObjectAnimationHash(root);
                                    if ((this.frameCount + hash) % (skip + 1) !== 0) continue;
                                }
                            }
                        }
                        animation.mixer.update(delta * animation.speed);
                    }
                }
            } finally {
                if (camera) {
                    this.avatarBudgetPolicy.endFrame();
                }
            }
        }
    };

    private getSkipFrames(root: Object3D | AnimationObjectGroup, camera: Camera): number {
        const obj = root as Object3D;
        if (!obj.matrixWorld) return 0;
        const e = obj.matrixWorld.elements;
        const ce = camera.matrixWorld.elements;
        const dx = e[12] - ce[12], dy = e[13] - ce[13], dz = e[14] - ce[14];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > 10000) return 4;  // >100m: update every 5th frame
        if (distSq > 2500) return 1;   // >50m: update every 2nd frame
        return 0;
    }

    private stableHash(uuid: string): number {
        let h = 0;
        for (let i = 0; i < uuid.length; i++) {
            h = (h << 5) - h + uuid.charCodeAt(i) | 0;
        }
        return Math.abs(h);
    }

    private getObjectAnimationHash(object: Object3D): number {
        let hash = object.userData._animHash;
        if (typeof hash !== "number" || !Number.isFinite(hash)) {
            hash = this.stableHash(object.uuid);
            this.cacheObjectAnimationHash(object, hash);
            return hash;
        }

        if (Object.prototype.propertyIsEnumerable.call(object.userData, "_animHash")) {
            this.cacheObjectAnimationHash(object, hash);
        }
        return hash;
    }

    private cacheObjectAnimationHash(object: Object3D, hash: number): void {
        setRuntimeUserDataValue(object, "_animHash", hash);
    }

    stop = () => {
        if (this.requestAnimationFrameId !== -1) {
            cancelAnimationFrame(this.requestAnimationFrameId);
            this.requestAnimationFrameId = -1;
        }
    };

    dispose = () => {
        const scene = this.game?.scene;
        if (scene) traverseObjectDepthFirst(scene, object => {
            const animation = AnimationController.getStoredAnimationData(object);
            if (animation) {
                const {mixer} = animation;
                if (mixer) {
                    mixer.stopAllAction();
                    mixer.uncacheRoot(mixer.getRoot());
                }
                delete object.userData.animation;
            }
        });
        this.requestAnimationFrameId = -1;
        global.app?.on("gameStarted.AnimationController", null);
        this.fallbackTimer.dispose();
    };

    private getFrameDelta(deltaTime?: number): number {
        if (deltaTime !== undefined) {
            return deltaTime;
        }
        if (this.clock) {
            return this.clock.getDelta();
        }

        this.fallbackTimer.update();
        return this.fallbackTimer.getDelta();
    }

    /**
     * Play and blend multiple animations on an object.
     * @param object The Object3D to animate
     * @param blends Array of { name, weight, speed, fadeDuration }
     * @param playOnce If true, all actions will play once
     * @param onComplete Optional callback invoked when a non-looping animation finishes
     */
    playBlendedAnimations = (
        object: Object3D,
        blends: BlendedAnimationParams[],
        playOnce?: boolean,
        onComplete?: () => void,
    ) => {
        if (!object) return;
        const mixer = this.getMixer(object);
        const wrapped = object as AnimationSourceObject;
        const animations =
            (wrapped._obj?.animations?.length ?? 0) > 0
                ? (wrapped._obj?.animations as AnimationClip[])
                : object.animations;
        if (!animations || blends.length === 0) return;

        // Track actions to keep
        const activeActions: AnimationAction[] = [];
        const activeActionSet = new Set<AnimationAction>();

        for (let i = 0; i < blends.length; i++) {
            const blend = blends[i];
            if (!blend) continue;
            const {name, weight = 1, speed = 1, fadeDuration = 0.5} = blend;
            const clip = name instanceof AnimationClip ? name : animations.find(c => c.name === name);
            if (!clip) {
                if (name && name !== "none") {
                    console.warn(`AnimationController: clip ${name} not found on object ${object.name}`);
                }
                continue;
            }
            const action = mixer.clipAction(clip);
            action.enabled = true;
            action.reset();
            action.setEffectiveWeight(weight);
            action.setEffectiveTimeScale(1);
            action.fadeIn(fadeDuration);
            action.play();
            action.timeScale = speed;
            if (playOnce) {
                action.setLoop(LoopOnce, 1);
                action.clampWhenFinished = true;
            }
            activeActions.push(action);
            activeActionSet.add(action);
        }

        // Fade out any other actions not in the blend set
        if (animations && Array.isArray(animations)) {
            for (let i = 0; i < animations.length; i++) {
                const clip = animations[i];
                if (!clip) continue;
                const action = mixer.existingAction(clip);
                if (action && !activeActionSet.has(action)) {
                    action.fadeOut(0.3);
                }
            }
        }

        this.animations = this.animations.filter(anim => {
            const animRoot = anim.mixer.getRoot();
            return animRoot.uuid !== object.uuid;
        });

        // Store the blended animation data for this object
        const animationData: StoredAnimationData = {
            mixer,
            actions: activeActions,
            speed: 1,
            blends: blends,
            paused: false,
            onComplete: onComplete,
            //DEPRECATED: for backward compatibility only
            clip: activeActions[0]?.getClip(),
            action: activeActions[0],
        };

        // Set up completion callback for non-looping animations
        if (playOnce && onComplete) {
            const finishedHandler = () => {
                mixer.removeEventListener("finished", finishedHandler);
                onComplete();
            };
            mixer.addEventListener("finished", finishedHandler);
        }

        object.userData.animation = animationData;
        this.animations.push(animationData);
    };

    /**
     * Update the weights of currently blended animations on an object.
     * @param object The Object3D being animated
     * @param weights An object mapping animation names to new weights
     */
    updateBlendedAnimationWeights = (object: Object3D, weights: {[name: string]: number}) => {
        const animation = AnimationController.getStoredAnimationData(object);
        if (!Array.isArray(animation?.actions)) {
            return;
        }

        const {actions} = animation;
        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            if (!action) continue;
            const name = action.getClip().name;
            if (Object.prototype.hasOwnProperty.call(weights, name)) {
                action.setEffectiveWeight(weights[name] ?? 0);
            }
        }
        // Optionally update the stored blends for reference
        const storedAnimation = AnimationController.getCurrentAnimation(object);
        if (Array.isArray(storedAnimation.blends)) {
            const blends = storedAnimation.blends;
            for (let i = 0; i < blends.length; i++) {
                const b = blends[i];
                if (!b) continue;
                if (typeof b.name === "string" && Object.prototype.hasOwnProperty.call(weights, b.name)) {
                    blends[i] = {...b, name: b.name, weight: weights[b.name] ?? 0};
                }
            }
            storedAnimation.blends = blends;
        }
    };

    private static getStoredAnimationData(object: Object3D): StoredAnimationData | undefined {
        return object.userData.animation as StoredAnimationData | undefined;
    }
}

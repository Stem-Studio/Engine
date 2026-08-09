import {Tween, Group, Easing} from "@tweenjs/tween.js";
import * as THREE from "three";

import {BehaviorBase} from "../../Behavior";
import GameManager from "../../game/GameManager";

enum ANIMATION_TYPES {
    REPEAT = "Repeat",
    LOOP = "Loop",
    PLAY_ONCE = "Play Once",
}

const EASING_FUNCTIONS: Record<string, (amount: number) => number> = {
    linear: Easing.Linear.None,
    quadIn: Easing.Quadratic.In,
    quadOut: Easing.Quadratic.Out,
    quadInOut: Easing.Quadratic.InOut,
    cubicIn: Easing.Cubic.In,
    cubicOut: Easing.Cubic.Out,
    cubicInOut: Easing.Cubic.InOut,
    quartIn: Easing.Quartic.In,
    quartOut: Easing.Quartic.Out,
    quartInOut: Easing.Quartic.InOut,
    quintIn: Easing.Quintic.In,
    quintOut: Easing.Quintic.Out,
    quintInOut: Easing.Quintic.InOut,
    sineIn: Easing.Sinusoidal.In,
    sineOut: Easing.Sinusoidal.Out,
    sineInOut: Easing.Sinusoidal.InOut,
    backIn: Easing.Back.In,
    backOut: Easing.Back.Out,
    backInOut: Easing.Back.InOut,
    circIn: Easing.Circular.In,
    circOut: Easing.Circular.Out,
    circInOut: Easing.Circular.InOut,
    bounceIn: Easing.Bounce.In,
    bounceOut: Easing.Bounce.Out,
    bounceInOut: Easing.Bounce.InOut,
    elasticIn: Easing.Elastic.In,
    elasticOut: Easing.Elastic.Out,
    elasticInOut: Easing.Elastic.InOut,
};

interface TweenAnimationConfig {
    startPosition: THREE.Vector3;
    startQuaternion: THREE.Quaternion;
    startScale: THREE.Vector3;
    endPosition: THREE.Vector3;
    endQuaternion: THREE.Quaternion;
    endScale: THREE.Vector3;
    hasPositionAnimation: boolean;
    hasRotationAnimation: boolean;
    hasScaleAnimation: boolean;
}

class TweenAnimationBehavior extends BehaviorBase {
    private tweenGroup: Group = new Group();
    private currentTween: Tween | null = null;
    private backwardTween: Tween | null = null;
    private isStarted: boolean = false;
    private gameManager?: GameManager;

    init(game: GameManager) {
        this.gameManager = game;
    }

    onAdded(): void {
        if (!this.attributes.startOnTrigger) {
            this.removeAnimation();
            this.addAnimation();
        }
    }

    onPaused(): void {
        this.tweenGroup.getAll().forEach(tween => {
            tween.pause();
        });
    }

    onResumed(): void {
        this.tweenGroup.getAll().forEach(tween => {
            tween.resume();
        });
    }

    onRemoved(): void {
        this.removeAnimation();
    }

    update() {
        if (this.isStarted) {
            this.tweenGroup.update();
        }
    }

    onReset() {}

    onAttributesUpdated(): void {
        this.removeAnimation();
        this.addAnimation();
    }

    onEvent(msg: string, data: any): void {
        if (msg === "trigger") {
            if (data.actionType === "activate" && !this.isStarted) {
                this.addAnimation();
            } else if (data.actionType === "deactivate" && this.isStarted) {
                this.removeAnimation();
            }
        }
    }

    private getAnimationConfig(): TweenAnimationConfig {
        const target = this.target;

        // Store initial values
        const startPosition = target.position.clone();
        const startRotation = target.rotation.clone();
        const startQuaternion = target.quaternion.clone();
        const startScale = target.scale.clone();

        const moveX = this.attributes.move?.x ?? 0;
        const moveY = this.attributes.move?.y ?? 0;
        const moveZ = this.attributes.move?.z ?? 0;

        const rotateX = this.attributes.rotate?.x ?? 0;
        const rotateY = this.attributes.rotate?.y ?? 0;
        const rotateZ = this.attributes.rotate?.z ?? 0;

        const scaleX = this.attributes.scale?.x ?? 0;
        const scaleY = this.attributes.scale?.y ?? 0;
        const scaleZ = this.attributes.scale?.z ?? 0;

        // Check which parameters need animation
        const hasPositionAnimation = moveX !== 0 || moveY !== 0 || moveZ !== 0;
        const hasRotationAnimation = rotateX !== 0 || rotateY !== 0 || rotateZ !== 0;
        const hasScaleAnimation = scaleX !== 0 || scaleY !== 0 || scaleZ !== 0;

        // Calculate target values
        let endPosition = startPosition.clone();
        let endQuaternion = startQuaternion.clone();
        let endScale = startScale.clone();

        if (hasPositionAnimation) {
            const displacement = new THREE.Vector3(
                moveX,
                moveY,
                moveZ,
            );
            endPosition.add(displacement);
        }

        if (hasRotationAnimation) {
            const endRotation = startRotation.clone();
            endRotation.set(
                startRotation.x + THREE.MathUtils.degToRad(rotateX),
                startRotation.y + THREE.MathUtils.degToRad(rotateY),
                startRotation.z + THREE.MathUtils.degToRad(rotateZ),
            );
            endQuaternion = new THREE.Quaternion().setFromEuler(endRotation);
        }

        if (hasScaleAnimation) {
            endScale.set(
                startScale.x + scaleX,
                startScale.y + scaleY,
                startScale.z + scaleZ,
            );
        }

        return {
            startPosition,
            startQuaternion,
            startScale,
            endPosition,
            endQuaternion,
            endScale,
            hasPositionAnimation,
            hasRotationAnimation,
            hasScaleAnimation,
        };
    }

    private createUpdateFunction(config: TweenAnimationConfig): (progress: number) => void {
        const target = this.target;

        return (progress: number) => {
            if (config.hasPositionAnimation) {
                target.position.lerpVectors(config.startPosition, config.endPosition, progress);
            }

            if (config.hasRotationAnimation) {
                target.quaternion.copy(config.startQuaternion).slerp(config.endQuaternion, progress);
            }

            if (config.hasScaleAnimation) {
                target.scale.lerpVectors(config.startScale, config.endScale, progress);
            }
        };
    }

    private createTween(
        isReversed: boolean,
        duration: number,
        easingFunction: (amount: number) => number,
        updateFunction: (progress: number) => void,
    ): Tween {
        const tweenTarget = {progress: isReversed ? 1 : 0};

        return new Tween(tweenTarget)
            .to({progress: isReversed ? 0 : 1}, duration)
            .easing(easingFunction)
            .onUpdate(() => updateFunction(tweenTarget.progress));
    }

    private addAnimation() {
        if (this.isStarted || !this.target) {
            return;
        }

        this.isStarted = true;

        const config = this.getAnimationConfig();
        const updateFunction = this.createUpdateFunction(config);
        const duration = 10000 / this.attributes.speed; // Duration in milliseconds, 1 speed unit = 10 seconds
        const easingFunction = this.getEasingFunction(this.attributes.easing || "linear");

        const forwardTween = this.createTween(false, duration, easingFunction, updateFunction);

        switch (this.attributes.loopMode) {
            case ANIMATION_TYPES.LOOP: {
                // TweenJS has a bug with yoyo loops, so we create a backward tween manually
                const backwardTween = this.createTween(true, duration, easingFunction, updateFunction);
                this.setupLoopTweens(forwardTween, backwardTween);

                this.currentTween = forwardTween;
                this.backwardTween = backwardTween;
                this.addTweensToGroup(forwardTween, backwardTween);
                break;
            }

            case ANIMATION_TYPES.REPEAT:
                forwardTween.repeat(Infinity).onRepeat(() => {
                    // Reset progress for repeat mode
                });

                this.currentTween = forwardTween;
                this.addTweensToGroup(forwardTween);
                break;

            default: // PLAY_ONCE
                this.currentTween = forwardTween;
                this.addTweensToGroup(forwardTween);
                break;
        }

        this.currentTween.start();
    }

    private removeAnimation() {
        if (!this.isStarted) {
            return;
        }

        this.isStarted = false;

        this.currentTween?.stop();
        this.backwardTween?.stop();
        this.tweenGroup.removeAll();

        this.currentTween = null;
        this.backwardTween = null;
    }

    private setupLoopTweens(forwardTween: Tween, backwardTween: Tween): void {
        forwardTween.onComplete(() => {
            if (this.isStarted) {
                backwardTween.start();
            }
        });

        backwardTween.onComplete(() => {
            if (this.isStarted) {
                forwardTween.start();
            }
        });
    }

    private addTweensToGroup(...tweens: Tween[]): void {
        tweens.forEach(tween => this.tweenGroup.add(tween));
    }

    private getEasingFunction(easingName: string) {
        return EASING_FUNCTIONS[easingName] || Easing.Linear.None;
    }
}

export default TweenAnimationBehavior;

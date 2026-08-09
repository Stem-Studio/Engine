import {AnimationClip, NumberKeyframeTrack, Object3D} from "three";
import {VRM, VRMExpressionPresetName} from "@pixiv/three-vrm";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import GameManager from "@stem/editor-oss/behaviors/game/GameManager";
import {
    AvatarBudgetPolicy,
    configureAvatarBudgetPolicyFromEngine,
    markObjectForAvatarBudget,
} from "@stem/editor-oss/core/budget/AvatarBudgetPolicy";
import {FrameClock} from "@stem/editor-oss/utils/FrameClock";

type ExtendedVRMExpressionManager = VRM["expressionManager"] & {userData: any};
export class VRMExpressionController {
    engine: EngineRuntime;
    registeredModels: VRM[] = [];
    activeModels: VRM[] = [];
    clock: FrameClock;
    requestAnimationFrameId: number;
    gameStarted: boolean = false;
    game?: GameManager | null;
    subtleMovementEnabled: boolean = true;
    private readonly avatarBudgetPolicy = new AvatarBudgetPolicy();

    constructor(engine: EngineRuntime) {
        this.engine = engine;
        this.clock = new FrameClock();
        this.requestAnimationFrameId = -1;
    }

    start = (game: GameManager) => {
        this.engine.on("gameStarted.VRMExpressionController", () => {
            this.gameStarted = true;
        });
        this.game = game;
    };

    registerModel = (model: VRM) => {
        if (model.expressionManager) {
            (model.expressionManager as ExtendedVRMExpressionManager).userData = {
                isTalking: false,
                minBlinkValue: 0,
                blinkTimer: null,
            };
        }

        this.registeredModels.push(model);
        markObjectForAvatarBudget(model.scene, {enabled: true});
    };

    getRegisteredVRMModel = (model: Object3D) => {
        return this.registeredModels.find(vrm => vrm.scene.uuid === model.uuid);
    };

    createExpressionTrack = (model: Object3D, expression: string) => {
        const vrmModel = this.getRegisteredVRMModel(model);
        if (vrmModel && vrmModel.expressionManager) {
            return new NumberKeyframeTrack(
                vrmModel.expressionManager.getExpressionTrackName(expression) || expression, // name
                [0.0, 0.5, 1.0], // times
                [0.0, 1.0, 0.0],
            ); // values
        } else {
            return null;
        }
    };

    animateModel = (model: Object3D, clip: AnimationClip) => {
        const vrmModel = this.getRegisteredVRMModel(model);

        if (vrmModel) {
            this.engine?.animationControl?.playCustomAnimation(model, clip, 1);
            if (!this.activeModels.includes(vrmModel)) {
                this.activeModels.push(vrmModel);
            }
            return clip;
        }
    };

    playMixamoAnimation = async (model: Object3D, animationName: string) => {
        const vrmModel = this.getRegisteredVRMModel(model);

        if (vrmModel) {
            try {
                const {loadMixamoAnimationToVRM} = await import(
                    "@stem/editor-oss/editor/assets/v2/utils/loadMixamoAnimationToVRM"
                );
                const animation = await loadMixamoAnimationToVRM(animationName, vrmModel);
                if (animation) {
                    this.engine?.animationControl?.playCustomAnimation(model, animation, 1);
                    if (!this.activeModels.includes(vrmModel)) {
                        this.activeModels.push(vrmModel);
                    }
                    return animation;
                }
            } catch (e) {
                console.error(e);
                throw e;
            }
        }
    };

    stopAnimation = (model: Object3D) => {
        const vrmModel = this.getRegisteredVRMModel(model);

        if (vrmModel) {
            this.engine?.animationControl?.stopAnimation(model);
            this.activeModels = this.activeModels.filter(vrm => vrm.scene.uuid !== model.uuid);
        }
    };

    update = (deltaTime?: number) => {
        if (!this.game || !this.game.scene || !this.gameStarted) {
            return;
        }

        const delta = deltaTime ?? this.clock.getDelta();
        const camera = this.game.camera;
        configureAvatarBudgetPolicyFromEngine(this.avatarBudgetPolicy, this.engine);

        if (this.activeModels.length > 0) {
            if (camera) {
                this.avatarBudgetPolicy.beginFrame(camera);
            }
            try {
                this.activeModels.forEach(vrm => {
                    if (vrm) {
                        if (camera) {
                            const decision = this.avatarBudgetPolicy.decide(vrm.scene, camera);
                            this.avatarBudgetPolicy.applyVisibilityState(vrm.scene, decision);
                            if (!this.avatarBudgetPolicy.shouldRunExpressionUpdate(vrm.scene, decision, delta)) return;
                        }
                        if (this.subtleMovementEnabled) {
                            this.applySubtleFaceMovement(vrm, delta);
                        }
                        vrm.update(delta);
                        vrm.expressionManager?.update();
                    }
                });
            } finally {
                if (camera) {
                    this.avatarBudgetPolicy.endFrame();
                }
            }
        }
    };

    resetExpressions(vrm: VRM) {
        const expressionManager = vrm.expressionManager as ExtendedVRMExpressionManager;
        if (!expressionManager) return;

        const presets: VRMExpressionPresetName[] = [
            "aa",
            "ih",
            "ou",
            "ee",
            "oh",
            "blink",
            "happy",
            "angry",
            "sad",
            "relaxed",
            "lookUp",
            "surprised",
            "lookDown",
            "lookLeft",
            "lookRight",
            "blinkLeft",
            "blinkRight",
            "neutral",
        ];

        for (const preset of presets) {
            expressionManager.setValue(preset, 0);
        }

        expressionManager.userData.minBlinkValue = 0;
        expressionManager.userData.isTalking = false;
    }

    setFaceExpression(vrm: VRM, expression: Partial<Record<VRMExpressionPresetName, number>>) {
        this.resetExpressions(vrm);

        const expressionManager = vrm.expressionManager as ExtendedVRMExpressionManager;
        if (!expressionManager) return;

        for (const [preset, value] of Object.entries(expression)) {
            expressionManager.setValue(preset, value || 0);
            if (preset === "blink") {
                expressionManager.userData.minBlinkValue = value;
            }
        }

        expressionManager.userData.isTalking = true;
    }

    applySubtleFaceMovement(vrm: VRM, delta: number) {
        const expressionManager = vrm.expressionManager as ExtendedVRMExpressionManager;
        if (!expressionManager) return;

        if (!expressionManager.userData.blinkTimer) {
            expressionManager.userData.blinkTimer = {timeLeft: Math.random() * 3 + 2, isBlinking: false}; // Random interval between 2-5 seconds
        }

        const blinkTimer = expressionManager.userData.blinkTimer;

        blinkTimer.timeLeft -= delta;

        const minBlinkValue = expressionManager.userData.minBlinkValue || 0;

        if (blinkTimer.timeLeft <= 0) {
            blinkTimer.isBlinking = true;
            blinkTimer.timeLeft = Math.random() * 3 + 2;
        } else if (blinkTimer.isBlinking) {
            const blinkValue = Math.max(0, Math.sin(performance.now() * 0.005));

            if (blinkValue <= minBlinkValue) {
                blinkTimer.isBlinking = false;
            } else {
                expressionManager.setValue("blink", blinkValue);
            }
        } else {
            expressionManager.setValue("blink", minBlinkValue);
        }

        if (expressionManager.userData.isTalking) {
            const mouthValue = Math.abs(Math.sin(performance.now() * 0.008)) * 0.3;
            expressionManager.setValue("aa", mouthValue);
            expressionManager.setValue("ih", mouthValue * 0.7);
            expressionManager.setValue("ou", mouthValue * 0.5);
        }
    }

    setHappyExpression(vrm: VRM) {
        this.setFaceExpression(vrm, {
            happy: 1,
            blink: 0.3,
            neutral: 0.2,
        });
    }

    setAngryExpression(vrm: VRM) {
        this.setFaceExpression(vrm, {
            angry: 1,
            blink: 0.2,
        });
    }

    setConfusedExpression(vrm: VRM) {
        this.setFaceExpression(vrm, {
            sad: 0.6,
            lookLeft: 0.4,
            neutral: 0.3,
        });
    }

    setDisappointedExpression(vrm: VRM) {
        this.setFaceExpression(vrm, {
            sad: 1,
            blink: 0.2,
        });
    }

    setSillyExpression(vrm: VRM) {
        this.setFaceExpression(vrm, {
            happy: 0.7,
            surprised: 0.5,
            blink: 0.4,
        });
    }

    setSweetExpression(vrm: VRM) {
        this.setFaceExpression(vrm, {
            happy: 0.8,
            relaxed: 0.5,
            blink: 0.4,
        });
    }

    setAnnoyedExpression(vrm: VRM) {
        this.setFaceExpression(vrm, {
            angry: 0.8,
            sad: 0.4,
            blink: 0.3,
        });
    }

    setRelievedExpression(vrm: VRM) {
        this.setFaceExpression(vrm, {
            relaxed: 0.6,
            happy: 0.5,
            blink: 0.3,
        });
    }

    setThoughtfulExpression(vrm: VRM) {
        this.setFaceExpression(vrm, {
            sad: 0.5,
            lookDown: 0.6,
        });
    }

    setTiredExpression(vrm: VRM) {
        this.setFaceExpression(vrm, {
            sad: 0.5,
            neutral: 0.3,
            blink: 0.7,
            relaxed: 0.4,
            lookDown: 0.6,
        });
    }

    stop = () => {
        if (this.requestAnimationFrameId !== -1) {
            cancelAnimationFrame(this.requestAnimationFrameId);
            this.requestAnimationFrameId = -1;
        }
    };

    dispose = () => {
        this.stop();
        this.registeredModels = [];
        this.activeModels = [];
        this.engine.on("gameStarted.VRMExpressionController", null);
    };
}

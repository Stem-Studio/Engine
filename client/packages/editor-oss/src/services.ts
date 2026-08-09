import {AdditiveBlending, DoubleSide, MeshBasicMaterial, type Object3D, type Object3DEventMap} from "three";
import {
    ConstantColor,
    ConstantValue,
    IntervalValue,
    type ParticleSystemParameters,
    type ParticleEmitter,
    PointEmitter,
    RenderMode,
    Vector4,
} from "three.quarks";
import {
    allEmittersPlayer,
    collectEmitters as collectEmittersImpl,
    findTopVFXParent,
    isParticleEmitterObject,
    isVFXAutoStartEnabled,
    isVFXParent,
    setVFXAutoStart,
} from "./utils/vfxRuntime";

export {getThumbnail} from "./utils/thumbnailUrl";
export {
    allEmittersPlayer,
    findTopVFXParent,
    isParticleEmitterObject,
    isVFXAutoStartEnabled,
    isVFXParent,
    setVFXAutoStart,
};
export type {ParticleEmitterLike, ParticlePlayerActionType, ParticleSystemLike} from "./utils/vfxRuntime";

export const collectEmitters = collectEmittersImpl as unknown as (
    object: Object3D<Object3DEventMap>,
) => Array<{emitter: ParticleEmitter; name: string}>;

export const DEFAULT_PARTICLE_CONFIG: ParticleSystemParameters = {
    duration: 1,
    looping: true,
    startLife: new IntervalValue(1, 2),
    startSpeed: new IntervalValue(1, 3),
    startSize: new IntervalValue(0.1, 0.5),
    startRotation: new IntervalValue(-Math.PI, Math.PI),
    startColor: new ConstantColor(new Vector4(1, 1, 1, 1)),
    worldSpace: false,
    emissionOverTime: new ConstantValue(10),
    emissionBursts: [
        {
            time: 0,
            count: new ConstantValue(2),
            cycle: 1,
            interval: 0.01,
            probability: 1,
        },
    ],

    shape: new PointEmitter(),
    material: new MeshBasicMaterial({
        blending: AdditiveBlending,
        transparent: true,
        side: DoubleSide,
    }),
    startTileIndex: new ConstantValue(81),
    renderMode: RenderMode.BillBoard,
    renderOrder: 2,
    autoDestroy: false,
    prewarm: false,
    onlyUsedByOther: false,
    rendererEmitterSettings: {},
    behaviors: [],
};

/**
 *
 */
export function createFreshParticleConfig(): ParticleSystemParameters {
    return {
        ...DEFAULT_PARTICLE_CONFIG,
        material: DEFAULT_PARTICLE_CONFIG.material.clone(),
        startLife: DEFAULT_PARTICLE_CONFIG.startLife!.clone(),
        startSpeed: DEFAULT_PARTICLE_CONFIG.startSpeed!.clone(),
        startSize: DEFAULT_PARTICLE_CONFIG.startSize!.clone(),
        startRotation: DEFAULT_PARTICLE_CONFIG.startRotation!.clone(),
        startColor: DEFAULT_PARTICLE_CONFIG.startColor!.clone(),
        emissionOverTime: DEFAULT_PARTICLE_CONFIG.emissionOverTime!.clone(),
        emissionBursts: DEFAULT_PARTICLE_CONFIG.emissionBursts!.map(burst => ({
            ...burst,
            count: burst.count.clone(),
        })),
        shape: DEFAULT_PARTICLE_CONFIG.shape!.clone(),
        rendererEmitterSettings: {...DEFAULT_PARTICLE_CONFIG.rendererEmitterSettings},
        behaviors: [...DEFAULT_PARTICLE_CONFIG.behaviors!],
    };
}

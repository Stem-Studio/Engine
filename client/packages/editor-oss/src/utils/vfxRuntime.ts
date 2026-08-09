import type {Object3D, Object3DEventMap, Scene} from "three";

export interface ParticleSystemLike {
    paused?: boolean;
    emitter?: ParticleEmitterLike;
    play?: () => void;
    restart?: () => void;
    pause?: () => void;
    stop?: () => void;
}

export type ParticleEmitterLike = Object3D<Object3DEventMap> & {
    type: "ParticleEmitter";
    system?: ParticleSystemLike;
};

type EmitterVisitor = (emitter: ParticleEmitterLike, name: string) => boolean | void;

export const isParticleEmitterObject = (
    object: Object3D<Object3DEventMap> | null | undefined,
): object is ParticleEmitterLike => {
    return object?.type === "ParticleEmitter" && (object as ParticleEmitterLike).system != null;
};

const visitEmitterOnObject = (object: Object3D, visitor: EmitterVisitor): boolean => {
    if (isParticleEmitterObject(object)) {
        if (visitor(object, object.name || "Unnamed Emitter") === false) return false;
    }

    const emitter = (object as unknown as ParticleSystemLike).emitter;
    if (isParticleEmitterObject(emitter)) {
        if (visitor(emitter, emitter.name || "Unnamed ParticleSystem Emitter") === false) return false;
    }

    return true;
};

const pushChildrenInSceneOrder = (stack: Object3D[], object: Object3D): void => {
    for (let i = object.children.length - 1; i >= 0; i--) {
        const child = object.children[i];
        if (child) stack.push(child);
    }
};

const visitEmittersDepthFirst = (object: Object3D, visitor: EmitterVisitor): boolean => {
    const stack: Object3D[] = [object];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;

        if (!visitEmitterOnObject(current, visitor)) return false;

        pushChildrenInSceneOrder(stack, current);
    }

    return true;
};

export const isVFXParent = (object: Object3D<Object3DEventMap>) => {
    if (!object || Array.isArray(object) || !object.children || object.children.length === 0) return false;

    const stack: Object3D[] = [];
    pushChildrenInSceneOrder(stack, object);

    while (stack.length > 0) {
        const child = stack.pop();
        if (!child) continue;

        if (isParticleEmitterObject(child)) return true;

        pushChildrenInSceneOrder(stack, child);
    }

    return false;
};

const hasEmitterDeep = (object: Object3D): boolean => {
    const stack: Object3D[] = [];
    pushChildrenInSceneOrder(stack, object);

    while (stack.length > 0) {
        const child = stack.pop();
        if (!child) continue;

        if (isParticleEmitterObject(child)) return true;

        const emitter = (child as unknown as ParticleSystemLike).emitter as ParticleEmitterLike | undefined;
        if (isParticleEmitterObject(emitter)) {
            return true;
        }

        pushChildrenInSceneOrder(stack, child);
    }

    return false;
};

export const findTopVFXParent = (object: Object3D, scene: Scene | Object3D | undefined): Object3D | null => {
    let current: Object3D | null = object;
    let lastVFXParent: Object3D | null = null;
    let foundVFXDescendant = false;

    while (current && current !== scene) {
        if (foundVFXDescendant || hasEmitterDeep(current)) {
            lastVFXParent = current;
            foundVFXDescendant = true;
        }
        current = current.parent;
    }

    return lastVFXParent;
};

export const collectEmitters = (object: Object3D): Array<{emitter: ParticleEmitterLike; name: string}> => {
    const result: Array<{emitter: ParticleEmitterLike; name: string}> = [];

    visitEmittersDepthFirst(object, (emitter, name) => {
        result.push({emitter, name});
    });

    return result;
};

const parseBooleanFlag = (value: unknown): boolean | undefined => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }
    return undefined;
};

const getAutoStartFromUserData = (userData: Record<string, unknown> | undefined): boolean | undefined => {
    if (!userData) return undefined;

    const autoStart = parseBooleanFlag(userData.autoStart);
    if (autoStart !== undefined) return autoStart;

    const autoplay = parseBooleanFlag(userData.autoplay);
    if (autoplay !== undefined) return autoplay;

    return parseBooleanFlag(userData.autoPlay);
};

export const isVFXAutoStartEnabled = (target?: Object3D | null): boolean => {
    if (!target) return false;

    if (isParticleEmitterObject(target)) {
        return getAutoStartFromUserData(target.userData as Record<string, unknown> | undefined) ?? true;
    }

    let hasEmitter = false;
    let enabled = true;
    visitEmittersDepthFirst(target, emitter => {
        hasEmitter = true;
        enabled = getAutoStartFromUserData(emitter.userData as Record<string, unknown> | undefined) ?? true;
        return enabled;
    });

    if (hasEmitter) {
        return enabled;
    }

    return getAutoStartFromUserData(target.userData as Record<string, unknown> | undefined) ?? true;
};

export const setVFXAutoStart = (target: Object3D | null | undefined, enabled: boolean): void => {
    if (!target) return;

    const apply = (object: Object3D) => {
        object.userData.autoStart = enabled;
        // Keep legacy keys in sync so existing content continues to work.
        object.userData.autoplay = enabled;
        object.userData.autoPlay = enabled;
    };

    if (isParticleEmitterObject(target)) {
        apply(target);
        return;
    }

    let appliedEmitter = false;
    visitEmittersDepthFirst(target, emitter => {
        appliedEmitter = true;
        apply(emitter);
    });
    if (appliedEmitter) return;

    apply(target);
};

export type ParticlePlayerActionType = "play" | "stop" | "pause";

export const allEmittersPlayer = (
    element: Object3D<Object3DEventMap>,
    action: ParticlePlayerActionType,
) => {
    if (!element) return;
    visitEmittersDepthFirst(element, emitter => {
        const system = emitter.system;
        if (!system) return;

        switch (action) {
            case "play":
                if (system.paused) {
                    system.play?.();
                } else {
                    system.restart?.();
                }
                break;
            case "pause":
                system.pause?.();
                break;
            case "stop":
                system.stop?.();
                break;
            default:
                break;
        }
    });
};

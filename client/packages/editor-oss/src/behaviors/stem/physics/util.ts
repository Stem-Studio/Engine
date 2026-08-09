import { BoxShapeDimensions, CapsuleShapeDimensions, PhysicsBodyType, PhysicsMaterial, PhysicsSettings, PhysicsShape, ShapeDimensions, SphereShapeDimensions } from './PhysicsSettings';
import { CollisionType, PhysicsConfig } from '../../../physics/common/physicsConfig';
import { BodyShapeType, CollisionShape } from '../../../physics/common/types';
import { COLLISION_MATERIAL_TYPE } from '@stem/editor-oss/types/editor';

// Mapping from friendly API names to internal PhysicsConfig values

const BODY_TYPE_TO_CTYPE: Record<PhysicsBodyType, CollisionType> = {
    'static': CollisionType.Static,
    'dynamic': CollisionType.Dynamic,
    'kinematic': CollisionType.Kinematic,
};

const CTYPE_TO_BODY_TYPE: Record<string, PhysicsBodyType> = {
    [CollisionType.Static]: 'static',
    [CollisionType.Dynamic]: 'dynamic',
    [CollisionType.Kinematic]: 'kinematic',
};

const SHAPE_TO_INTERNAL: Record<PhysicsShape, PhysicsConfig['shape']> = {
    'box': 'btBoxShape',
    'sphere': 'btSphereShape',
    'capsule': 'btCapsuleShape',
    'convexHull': 'btConvexHullShape',
    'concaveHull': 'btConcaveHullShape',
};

const INTERNAL_TO_SHAPE: Record<string, PhysicsShape> = {
    'btBoxShape': 'box',
    'btSphereShape': 'sphere',
    'btCapsuleShape': 'capsule',
    'btConvexHullShape': 'convexHull',
    'btConcaveHullShape': 'concaveHull',
};

const MATERIAL_TO_INTERNAL: Record<PhysicsMaterial, COLLISION_MATERIAL_TYPE> = {
    'metal': COLLISION_MATERIAL_TYPE.METAL,
    'dirt': COLLISION_MATERIAL_TYPE.DIRT,
    'ground': COLLISION_MATERIAL_TYPE.GROUND,
    'plastic': COLLISION_MATERIAL_TYPE.PLASTIC,
    'snow': COLLISION_MATERIAL_TYPE.SNOW,
    'wood': COLLISION_MATERIAL_TYPE.WOOD,
    'concrete': COLLISION_MATERIAL_TYPE.CONCRETE,
    'mud': COLLISION_MATERIAL_TYPE.MUD,
    'ice': COLLISION_MATERIAL_TYPE.ICE,
    'slime': COLLISION_MATERIAL_TYPE.SLIME,
    'water': COLLISION_MATERIAL_TYPE.WATER,
    'slipperyGround': COLLISION_MATERIAL_TYPE.SLIPPERY_GROUND,
    'rubber': COLLISION_MATERIAL_TYPE.RUBBER,
    'sand': COLLISION_MATERIAL_TYPE.SAND,
};

const INTERNAL_TO_MATERIAL: Record<string, PhysicsMaterial> = {
    [COLLISION_MATERIAL_TYPE.METAL]: 'metal',
    [COLLISION_MATERIAL_TYPE.DIRT]: 'dirt',
    [COLLISION_MATERIAL_TYPE.GROUND]: 'ground',
    [COLLISION_MATERIAL_TYPE.PLASTIC]: 'plastic',
    [COLLISION_MATERIAL_TYPE.SNOW]: 'snow',
    [COLLISION_MATERIAL_TYPE.WOOD]: 'wood',
    [COLLISION_MATERIAL_TYPE.CONCRETE]: 'concrete',
    [COLLISION_MATERIAL_TYPE.MUD]: 'mud',
    [COLLISION_MATERIAL_TYPE.ICE]: 'ice',
    [COLLISION_MATERIAL_TYPE.SLIME]: 'slime',
    [COLLISION_MATERIAL_TYPE.WATER]: 'water',
    [COLLISION_MATERIAL_TYPE.SLIPPERY_GROUND]: 'slipperyGround',
    [COLLISION_MATERIAL_TYPE.RUBBER]: 'rubber',
    [COLLISION_MATERIAL_TYPE.SAND]: 'sand',
};

// Type guards for shape dimensions
const isBoxDimensions = (dims: ShapeDimensions): dims is BoxShapeDimensions => {
    return 'width' in dims && 'height' in dims && 'length' in dims;
};

const isSphereDimensions = (dims: ShapeDimensions): dims is SphereShapeDimensions => {
    return 'radius' in dims && !('height' in dims);
};

const isCapsuleDimensions = (dims: ShapeDimensions): dims is CapsuleShapeDimensions => {
    return 'radius' in dims && 'height' in dims;
};

/**
 * Convert ShapeDimensions to CollisionShape format for shapeData.
 * @param shape - The shape to convert
 * @param dims - The shape dimensions
 * @returns The matching CollisionShape
 */
export const shapeDimensionsToShapeData = (
    shape: PhysicsShape,
    dims: ShapeDimensions,
): CollisionShape | undefined => {
    switch (shape) {
        case 'box':
            if (isBoxDimensions(dims)) {
                return {
                    type: BodyShapeType.BOX,
                    width: dims.width,
                    height: dims.height,
                    length: dims.length,
                };
            }
            break;
        case 'sphere':
            if (isSphereDimensions(dims)) {
                return {
                    type: BodyShapeType.SPHERE,
                    radius: dims.radius,
                };
            }
            break;
        case 'capsule':
            if (isCapsuleDimensions(dims)) {
                return {
                    type: BodyShapeType.CAPSULE,
                    radius: dims.radius,
                    height: dims.height,
                };
            }
            break;
    }
    return undefined;
};

/**
 * Convert shapeData (CollisionShape) back to ShapeDimensions.
 * @param shapeData - The shapeData to convert
 * @returns The matching ShapeDimensions
 */
export const shapeDataToShapeDimensions = (shapeData: CollisionShape): ShapeDimensions | undefined => {
    switch (shapeData.type) {
        case BodyShapeType.BOX:
            return {
                width: shapeData.width,
                height: shapeData.height,
                length: shapeData.length,
            };
        case BodyShapeType.SPHERE:
            return {
                radius: shapeData.radius,
            };
        case BodyShapeType.CAPSULE:
            return {
                radius: shapeData.radius,
                height: shapeData.height,
            };
        default:
            return undefined;
    }
};

/**
 * Convert PhysicsSettings (friendly API) to PhysicsConfig (internal format).
 * @param settings - The settings to convert
 * @returns The matching PhysicsConfig
 */
export const settingsToConfig = (settings: PhysicsSettings): Partial<PhysicsConfig> => {
    const config: Partial<PhysicsConfig> = {};

    if (settings.enabled !== undefined) {
        config.enabled = settings.enabled;
    }
    if (settings.bodyType !== undefined) {
        config.ctype = BODY_TYPE_TO_CTYPE[settings.bodyType];
    }
    if (settings.shape !== undefined) {
        config.shape = SHAPE_TO_INTERNAL[settings.shape];
    }
    if (settings.mass !== undefined) {
        config.mass = settings.mass;
    }
    if (settings.friction !== undefined) {
        config.friction = settings.friction;
    }
    if (settings.restitution !== undefined) {
        config.restitution = settings.restitution;
    }
    if (settings.ccd !== undefined) {
        config.ccd = settings.ccd;
    }
    if (settings.rollingFriction !== undefined) {
        config.rollingFriction = settings.rollingFriction;
    }
    if (settings.spinningFriction !== undefined) {
        config.spinningFriction = settings.spinningFriction;
    }
    if (settings.material !== undefined) {
        config.collision_material = MATERIAL_TO_INTERNAL[settings.material];
    }
    if (settings.climbable !== undefined) {
        config.climbable = settings.climbable;
    }
    if (settings.rotationLock !== undefined) {
        config.rotationLock = {
            x: settings.rotationLock.x ?? false,
            y: settings.rotationLock.y ?? false,
            z: settings.rotationLock.z ?? false,
        };
    }
    if (settings.shapeOffset !== undefined) {
        config.userShapeOffset = {
            x: settings.shapeOffset.x,
            y: settings.shapeOffset.y,
            z: settings.shapeOffset.z,
        };
    }
    if (settings.shapeScale !== undefined) {
        config.userShapeScale = {
            x: settings.shapeScale.x,
            y: settings.shapeScale.y,
            z: settings.shapeScale.z,
        };
    }
    if (settings.excludeHiddenObjects !== undefined) {
        config.shapeExcludesHiddenObjects = settings.excludeHiddenObjects;
    }
    if (settings.shapeDimensions !== undefined && settings.shape !== undefined) {
        const shapeData = shapeDimensionsToShapeData(settings.shape, settings.shapeDimensions);
        if (shapeData) {
            config.shapeData = shapeData;
        }
    }

    return config;
};

/**
 * Convert PhysicsConfig (internal format) to PhysicsSettings (friendly API).
 * @param config - The config to convert
 * @returns The matching PhysicsSettings
 */
export const configToSettings = (config: PhysicsConfig): PhysicsSettings => {
    const settings: PhysicsSettings = {};

    settings.enabled = config.enabled;
    settings.bodyType = CTYPE_TO_BODY_TYPE[config.ctype] ?? 'static';
    settings.shape = INTERNAL_TO_SHAPE[config.shape] ?? 'box';
    settings.mass = config.mass;
    settings.friction = config.friction;
    settings.restitution = config.restitution;
    settings.ccd = config.ccd === true;
    settings.rollingFriction = config.rollingFriction;
    settings.spinningFriction = config.spinningFriction;
    settings.material = INTERNAL_TO_MATERIAL[config.collision_material] ?? 'ground';
    settings.climbable = config.climbable;

    if (config.rotationLock) {
        settings.rotationLock = { ...config.rotationLock };
    }
    if (config.userShapeOffset) {
        settings.shapeOffset = { ...config.userShapeOffset };
    }
    if (config.userShapeScale) {
        settings.shapeScale = { ...config.userShapeScale };
    }
    settings.excludeHiddenObjects = config.shapeExcludesHiddenObjects;
    if (config.shapeData) {
        const shapeDimensions = shapeDataToShapeDimensions(config.shapeData as CollisionShape);
        if (shapeDimensions) {
            settings.shapeDimensions = shapeDimensions;
        }
    }

    return settings;
};

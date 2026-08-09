import type {Vector3Like} from "three";

// ============================================================================
// Physics Types
// ============================================================================

export type PhysicsBodyType = 'static' | 'dynamic' | 'kinematic';

export type PhysicsShape = 'box' | 'sphere' | 'capsule' | 'convexHull' | 'concaveHull';

export type PhysicsMaterial =
    | 'metal'
    | 'dirt'
    | 'ground'
    | 'plastic'
    | 'snow'
    | 'wood'
    | 'concrete'
    | 'mud'
    | 'ice'
    | 'slime'
    | 'water'
    | 'slipperyGround'
    | 'rubber'
    | 'sand';

export type PhysicsCollisionBehavior = 'regular' | 'ghost';

// ============================================================================
// Shape Dimension Types (for manual shape specification)
// ============================================================================

/** Dimensions for a box collision shape */
export interface BoxShapeDimensions {
    width: number;
    height: number;
    length: number;
}

/** Dimensions for a sphere collision shape */
export interface SphereShapeDimensions {
    radius: number;
}

/** Dimensions for a capsule collision shape */
export interface CapsuleShapeDimensions {
    radius: number;
    /** Height of the cylindrical portion (excluding hemispherical caps) */
    height: number;
}

/**
 * Manual shape dimensions for physics collision shapes.
 * Use with box, sphere, or capsule shapes to override automatic geometry-based sizing.
 */
export type ShapeDimensions = BoxShapeDimensions | SphereShapeDimensions | CapsuleShapeDimensions;

/**
 * Physics configuration settings for an object.
 *
 * These settings are applied when the object is added to the scene via
 * `erth.scene.addObject()`. To modify physics at runtime after the object
 * is in the scene, use `erth.physics.getBody()`.
 */
export interface PhysicsSettings {
    /** Enable physics simulation for this object. Default: false */
    enabled?: boolean;
    /** Body type: 'static' (immovable), 'dynamic' (affected by forces), 'kinematic' (scripted motion). Default: 'static' */
    bodyType?: PhysicsBodyType;
    /** Collision shape type. Default: 'box' */
    shape?: PhysicsShape;
    /** Mass in kg. Only applies to dynamic bodies. Default: 0 */
    mass?: number;
    /** Surface friction coefficient (0-1). Default: 0 */
    friction?: number;
    /** Bounciness coefficient (0-1). Default: 0 */
    restitution?: number;
    /** Enable continuous collision detection for fast-moving dynamic bodies. Default: false */
    ccd?: boolean;
    /** Rolling friction coefficient. Default: 0 */
    rollingFriction?: number;
    /** Spinning friction coefficient. Default: 0 */
    spinningFriction?: number;
    /** Surface material type for audio/effects. Default: 'ground' */
    material?: PhysicsMaterial;
    /** Whether the player can climb this object. Default: false */
    climbable?: boolean;
    /** Lock rotation on specific axes. Useful for NPCs/characters. */
    rotationLock?: { x?: boolean; y?: boolean; z?: boolean };
    /** Offset the collision shape from the object's origin. */
    shapeOffset?: Vector3Like;
    /** Scale the collision shape relative to the object. */
    shapeScale?: Vector3Like;
    /** Exclude hidden child objects when computing the collision shape. Default: false */
    excludeHiddenObjects?: boolean;
    /**
     * Manual shape dimensions. When provided, these dimensions are used
     * instead of computing from object geometry.
     * Only applicable for box, sphere, and capsule shapes.
     * ConvexHull and concaveHull shapes always compute from geometry.
     */
    shapeDimensions?: ShapeDimensions;
}

import {COLLISION_MATERIAL_TYPE} from "@stem/editor-oss/types/editor";
import {BodyShapeType, COLLISION_FLAGS} from "./types";

/** Default constraint iterations for a normal fixed simulation step. */
export const DEFAULT_SOLVER_ITERATIONS = 4;
export const MAX_SOLVER_ITERATIONS = 8;

/** Keep backend solver quality on a small, deterministic safe range. */
export const normalizeSolverIterations = (value: unknown): number => {
    const numeric = typeof value === "number" ? value : Number(value);
    return Math.min(
        MAX_SOLVER_ITERATIONS,
        Math.max(1, Math.floor(Number.isFinite(numeric) ? numeric : DEFAULT_SOLVER_ITERATIONS)),
    );
};

/** @deprecated Use DEFAULT_SOLVER_ITERATIONS for backend-neutral code. */
export const DEFAULT_RAPIER_SOLVER_ITERATIONS = DEFAULT_SOLVER_ITERATIONS;

export enum CollisionType {
    Static = "Static",
    Dynamic = "Dynamic",
    Kinematic = "Kinematic",
}

export const normalizeCType = (ctype: unknown): CollisionType | undefined => {
    if (typeof ctype === "number") {
        switch (ctype) {
            case COLLISION_FLAGS.CF_STATIC_OBJECT: return CollisionType.Static;
            case COLLISION_FLAGS.CF_DYNAMIC_OBJECT: return CollisionType.Dynamic;
            case COLLISION_FLAGS.CF_KINEMATIC_OBJECT: return CollisionType.Kinematic;
            default: return undefined;
        }
    }
    if (typeof ctype !== "string") return undefined;
    switch (ctype.trim().toLowerCase()) {
        case "static": return CollisionType.Static;
        case "dynamic": return CollisionType.Dynamic;
        case "kinematic": return CollisionType.Kinematic;
        default: return undefined;
    }
};

/**
 * Resolve a physics body type at the runtime boundary.
 *
 * Authored configs normally carry a `CollisionType` string, but behavior
 * scripts can omit or provide an unknown value. The physics data path treats
 * those values as dynamic (see `PhysicsUtil.getCommonData`), so keep the
 * validation policy consistent with that fallback instead of accidentally
 * allowing an unsupported concave body through.
 */
export const resolveCollisionType = (ctype: unknown): CollisionType =>
    normalizeCType(ctype) ?? CollisionType.Dynamic;

/**
 * Resolve the body type that the shared physics adapters actually create.
 *
 * The adapter contract gives positive-mass bodies dynamic semantics. For
 * zero/absent mass, only an explicit kinematic type remains kinematic; every
 * other value is treated as static. Keep this helper aligned with
 * `PhysicsBase.getCollisionFlag` so shape validation cannot disagree with the
 * body that Ammo/Rapier receive.
 */
export const resolveEffectiveCollisionType = (ctype: unknown, mass: unknown): CollisionType => {
    // Match PhysicsBase's JS `mass > 0` semantics even for malformed JSON
    // values that arrive as numeric strings. This keeps authored validation
    // fail-closed before geometry work and backend dispatch.
    const numericMass = typeof mass === "number" ? mass : Number(mass);
    if (numericMass > 0) return CollisionType.Dynamic;
    return normalizeCType(ctype) === CollisionType.Kinematic
        ? CollisionType.Kinematic
        : CollisionType.Static;
};

/** Return whether the body that the adapters will create can use a terrain mesh. */
export const isConcaveHullEffectiveBodyTypeSupported = (ctype: unknown, mass: unknown): boolean =>
    resolveEffectiveCollisionType(ctype, mass) === CollisionType.Static;

/**
 * Low-level engine equivalent of the authored-config static-mesh policy.
 *
 * `PhysicsEngine.addRigidBody` receives the resolved body type rather than an
 * authored `ctype`/mass pair, so keep this check next to the shared collision
 * type normalisation.  Triangle meshes are valid for fixed world geometry
 * only; Ammo and Rapier intentionally reject dynamic and kinematic concave
 * bodies instead of silently changing their collision semantics.
 */
export const isConcaveHullBodyTypeSupported = (shapeType: unknown, bodyType: unknown): boolean =>
    (shapeType !== BodyShapeType.CONCAVE_HULL && shapeType !== BodyShapeType.HEIGHTFIELD)
    || normalizeCType(bodyType) === CollisionType.Static;

export enum Shape {
    btBoxShape = "BoxShape",
    btSphereShape = "SphereShape",
    btConcaveHullShape = "ConcaveHullShape",
    btConvexHullShape = "ConvexHullShape",
    btCapsuleShape = "CapsuleShape",
}

export enum BouncinessPreset {
    CUSTOM = "Custom",
    METAL = "Metal",
    DIRT = "Dirt",
    GROUND = "Ground",
    PLASTIC = "Plastic",
    SNOW = "Snow",
    WOOD = "Wood",
    CONCRETE = "Concrete",
    MUD = "Mud",
    ICE = "Ice",
    SLIME = "Slime",
    WATER = "Water",
    SLIPPERY_GROUND = "Slippery Ground",
    RUBBER = "Rubber",
    SAND = "Sand",
}

export interface BouncinessPresetValues {
    restitution: number;
    friction: number;
    contactStiffness: number;
    contactDamping: number;
}

export const BOUNCINESS_PRESET_VALUES: Record<BouncinessPreset, BouncinessPresetValues> = {
    [BouncinessPreset.CUSTOM]: {restitution: 0.5, friction: 0.5, contactStiffness: 0.5, contactDamping: 0.25},
    [BouncinessPreset.METAL]: {restitution: 0.4, friction: 0.35, contactStiffness: 0.95, contactDamping: 0.08},
    [BouncinessPreset.DIRT]: {restitution: 0.15, friction: 0.7, contactStiffness: 0.3, contactDamping: 0.45},
    [BouncinessPreset.GROUND]: {restitution: 0.2, friction: 0.55, contactStiffness: 0.5, contactDamping: 0.3},
    [BouncinessPreset.PLASTIC]: {restitution: 0.45, friction: 0.3, contactStiffness: 0.55, contactDamping: 0.2},
    [BouncinessPreset.SNOW]: {restitution: 0.05, friction: 0.15, contactStiffness: 0.1, contactDamping: 0.7},
    [BouncinessPreset.WOOD]: {restitution: 0.35, friction: 0.45, contactStiffness: 0.7, contactDamping: 0.25},
    [BouncinessPreset.CONCRETE]: {restitution: 0.25, friction: 0.65, contactStiffness: 0.9, contactDamping: 0.15},
    [BouncinessPreset.MUD]: {restitution: 0.0, friction: 0.8, contactStiffness: 0.05, contactDamping: 0.95},
    [BouncinessPreset.ICE]: {restitution: 0.3, friction: 0.03, contactStiffness: 0.85, contactDamping: 0.1},
    [BouncinessPreset.SLIME]: {restitution: 0.4, friction: 0.15, contactStiffness: 0.08, contactDamping: 0.8},
    [BouncinessPreset.WATER]: {restitution: 0.02, friction: 0.05, contactStiffness: 0.02, contactDamping: 0.5},
    [BouncinessPreset.SLIPPERY_GROUND]: {restitution: 0.25, friction: 0.08, contactStiffness: 0.45, contactDamping: 0.25},
    [BouncinessPreset.RUBBER]: {restitution: 0.85, friction: 0.9, contactStiffness: 0.35, contactDamping: 0.35},
    [BouncinessPreset.SAND]: {restitution: 0.1, friction: 0.6, contactStiffness: 0.2, contactDamping: 0.55},
};

export interface PhysicsConfig {
    enabled: boolean;
    shape: keyof typeof Shape;
    shapeData?: any;
    anchorOffset?: {
        x: number;
        y: number;
        z: number;
    };
    anchorScale?: {
        x: number;
        y: number;
        z: number;
    };
    userShapeOffset?: {
        x: number;
        y: number;
        z: number;
    };
    userShapeScale?: {
        x: number;
        y: number;
        z: number;
    };
    shapeExcludesHiddenObjects?: boolean;
    mass: number;
    inertia: {
        x: number;
        y: number;
        z: number;
    };
    restitution: number;
    friction: number;
    rollingFriction: number;
    spinningFriction: number;
    contactStiffness: number;
    contactDamping: number;
    /** Enable continuous collision detection for fast-moving dynamic bodies. */
    ccd?: boolean;
    /** Allow idle dynamic bodies to sleep; enabled by default for performance. */
    allowSleep?: boolean;
    ctype: CollisionType;
    position: {
        x: number;
        y: number;
        z: number;
    };
    scale: {
        x: number;
        y: number;
        z: number;
    };
    rotation: {
        x: number;
        y: number;
        z: number;
    };
    rotationLock?: {
        x: boolean;
        y: boolean;
        z: boolean;
    };
    enable_preview: boolean;
    collision_material: COLLISION_MATERIAL_TYPE;
    bounciness_preset: BouncinessPreset;
    climbable: boolean;
    type: string;
}

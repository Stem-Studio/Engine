import {Light, Object3D} from "three";

import {COLLISION_MATERIAL_TYPE} from "@stem/editor-oss/types/editor";
import {BouncinessPreset, CollisionType, normalizeCType, PhysicsConfig} from "./physicsConfig";

const SHAPE_TO_EDITOR_SHAPE: Record<string, PhysicsConfig["shape"]> = {
    box: "btBoxShape",
    sphere: "btSphereShape",
    capsule: "btCapsuleShape",
    convexhull: "btConvexHullShape",
    concavehull: "btConcaveHullShape",
    trimesh: "btConcaveHullShape",
    cylinder: "btCapsuleShape",
};

const VALID_EDITOR_SHAPES: ReadonlySet<PhysicsConfig["shape"]> = new Set([
    "btBoxShape",
    "btSphereShape",
    "btCapsuleShape",
    "btConvexHullShape",
    "btConcaveHullShape",
]);

const normalizeShapeForEditor = (shape: unknown): PhysicsConfig["shape"] => {
    if (typeof shape !== "string") return "btBoxShape";
    if (VALID_EDITOR_SHAPES.has(shape as PhysicsConfig["shape"])) {
        return shape as PhysicsConfig["shape"];
    }
    const mapped = SHAPE_TO_EDITOR_SHAPE[shape.toLowerCase()];
    return mapped || "btBoxShape";
};

export const getPhysics = (physics: any, object?: Object3D): PhysicsConfig => {
    const {
        enabled,
        shape,
        shapeExcludesHiddenObjects,
        mass,
        inertia,
        restitution,
        friction,
        rollingFriction,
        spinningFriction,
        contactStiffness,
        contactDamping,
        ccd,
        ctype,
        position,
        scale,
        rotation,
        anchorOffset,
        anchorScale,
        userShapeOffset,
        userShapeScale,
        enable_preview,
        climbable,
        collision_material,
        bounciness_preset,
        type,
        rotationLock,
    } = physics || {};

    let newCType = normalizeCType(ctype) ?? CollisionType.Static;
    let newMass = newCType === CollisionType.Static ? 0 : mass || 0;

    if (object && object instanceof Light) {
        newCType = normalizeCType(ctype) ?? CollisionType.Kinematic;
        newMass = mass || 0;
    }

    return {
        enabled: enabled || false,
        shape: normalizeShapeForEditor(shape),
        shapeExcludesHiddenObjects: shapeExcludesHiddenObjects || false,
        mass: newMass,
        inertia: {
            x: inertia?.x || 0,
            y: inertia?.y || 0,
            z: inertia?.z || 0,
        },
        restitution: restitution || 0,
        friction: friction || 0,
        rollingFriction: rollingFriction || 0,
        spinningFriction: spinningFriction || 0,
        contactStiffness: contactStiffness || 0,
        contactDamping: contactDamping || 0,
        ccd: ccd === true,
        ctype: newCType,
        position: {
            x: position?.x || 0,
            y: position?.y || 0,
            z: position?.z || 0,
        },
        scale: {
            x: scale?.x || 1,
            y: scale?.y || 1,
            z: scale?.z || 1,
        },
        rotation: {
            x: rotation?.x || 0,
            y: rotation?.y || 0,
            z: rotation?.z || 0,
        },
        anchorOffset,
        anchorScale,
        userShapeOffset,
        userShapeScale,
        enable_preview: enable_preview || false,
        climbable: climbable || false,
        collision_material: collision_material || COLLISION_MATERIAL_TYPE.GROUND,
        bounciness_preset: bounciness_preset || BouncinessPreset.CUSTOM,
        type: type || "rigidBody",
        rotationLock,
    };
};

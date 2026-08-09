import type {Vector3Like} from "three";

import { PhysicsCollisionBehavior } from './PhysicsSettings';

/**
 * Handle for manipulating a physics body at runtime.
 *
 * Obtained via `erth.physics.getBody()` after an object has been added to the scene.
 */
export interface RigidBodyHandle {
    /** The UUID of the physics body */
    readonly uuid: string;

    // Velocity & Forces

    /** Apply an instantaneous impulse */
    applyImpulse(impulse: Vector3Like, relativePosition?: Vector3Like): void;
    /** Set the linear velocity */
    setVelocity(velocity: Vector3Like): void;

    // Collision

    /** Set collision behavior: 'regular' (solid) or 'ghost' (pass-through but detects) */
    setCollisionBehavior(behavior: PhysicsCollisionBehavior): void;

    // Removal

    /** Remove this body from the physics simulation */
    remove(): void;
}

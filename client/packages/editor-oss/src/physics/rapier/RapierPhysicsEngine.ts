import Rapier from "@dimforge/rapier3d-compat";
import {
    BufferAttribute,
    BufferGeometry,
    LineSegments,
    LineBasicMaterial,
    Object3D,
    DynamicDrawUsage,
    type QuaternionLike,
    type Vector3Like,
} from "three";

import MathUtils from '../common/math';
import { ShapeCache } from '../common/ShapeCache';
import {
    DEFAULT_SOLVER_ITERATIONS,
    isConcaveHullBodyTypeSupported,
    normalizeSolverIterations,
} from '../common/physicsConfig';
import {normalizeHeightfieldShape} from '../common/heightfield';
import {createRapierHeightfieldShape} from './rapierHeightfield';
import {
    CollisionShape,
    BodyShapeType,
    ConvexHullShape,
    ConcaveHullShape,
    CollisionBehavior,
    FixedJointOptions,
    HingeJointOptions,
    PointToPointJointOptions,
    VehicleData,
    VehicleInput,
    VehicleOptions,
    PhysicsDebugRenderData,
} from "../common/types";
import {
    CollisionCallback,
    DEFAULT_CHARACTER_CONTROLLER_COLLISION_GROUP,
    DEFAULT_CHARACTER_CONTROLLER_COLLISION_MASK,
    DEFAULT_CHARACTER_CONTROLLER_MAX_SLOPE,
    DEFAULT_CHARACTER_CONTROLLER_SNAP_DISTANCE,
    DEFAULT_CHARACTER_CONTROLLER_STEP_HEIGHT,
    DEFAULT_RIGID_BODY_ANGULAR_DAMPING,
    DEFAULT_RIGID_BODY_COLLISION_GROUP,
    DEFAULT_RIGID_BODY_COLLISION_MASK,
    DEFAULT_RIGID_BODY_CCD_MOTION_THRESHOLD,
    DEFAULT_RIGID_BODY_CCD_SWEPT_SPHERE_RADIUS,
    DEFAULT_RIGID_BODY_FRICTION,
    DEFAULT_RIGID_BODY_LINEAR_DAMPING,
    DEFAULT_RIGID_BODY_MASS,
    DEFAULT_RIGID_BODY_RESTITUTION,
    DEFAULT_STEP_DURATION,
    PhysicsEngine,
    RigidBodyOptions,
    RigidBodyType,
} from '../PhysicsEngine';
const DEFAULT_CHARACTER_CONTROLLER_OFFSET = 0.01;
const DEFAULT_DEBUG_VERTEX_COUNT = 1000;
const MAX_MULTI_ITERATION_STEP_DURATION = 1 / 30;

/**
 * Threshold for snapping linear velocity of a character controller to zero when
 * it is close to zero
 */
const LINEAR_VELOCITY_SNAP_THRESHOLD = 0.001;

const RIGID_BODY_TYPE_MAP = {
    [RigidBodyType.Static]: 'fixed',
    [RigidBodyType.Dynamic]: 'dynamic',
    [RigidBodyType.Kinematic]: 'kinematicPositionBased',
} as const;

const REVERSE_RIGID_BODY_TYPE_MAP = {
    [Rapier.RigidBodyType.Fixed]: RigidBodyType.Static,
    [Rapier.RigidBodyType.Dynamic]: RigidBodyType.Dynamic,
    [Rapier.RigidBodyType.KinematicPositionBased]: RigidBodyType.Kinematic,
    [Rapier.RigidBodyType.KinematicVelocityBased]: RigidBodyType.Kinematic,
} as const;

interface Controller {
    controller: Rapier.KinematicCharacterController;
    collider: Rapier.Collider | null;
    walkVelocity: { x: number; y: number; z: number; };

    // Computed values
    linearVelocity: { x: number; y: number; z: number; };
    isGrounded: boolean;

    // Rapier's KinematicCharacterController owns step height, snap, and
    // slope angles, but not gravity integration — callers hand it a
    // per-step displacement. We track the running vertical velocity
    // (gravity + jump + impulse) here; walkVelocity carries any
    // caller-supplied motion (including platform carry).
    gravity: number;
    internalVerticalVelocity: number;
    isJumping: boolean;
}

interface ControllerCollision {
    controllerColliderHandle: number;
    colliderHandle: number;
    contactPoint?: { x: number; y: number; z: number };
    contactNormal?: { x: number; y: number; z: number };
}

interface RapierVehicle {
    controller: Rapier.DynamicRayCastVehicleController;
    chassisBody: Rapier.RigidBody;
    frontWheelIndices: number[];
    driveWheelIndices: number[];
    wheelCount: number;
    wheelRadii: number[];
    options: VehicleOptions;
}

interface SharedShape {
    type: BodyShapeType;
    shape: Rapier.Shape | null;
}

/**
 * An implementation of {@link PhysicsEngine} that uses Rapier.
 */
export class RapierPhysicsEngine implements PhysicsEngine {
    stepDuration = DEFAULT_STEP_DURATION;

    private readonly rigidBodies = new Map<string, Rapier.RigidBody>();
    private readonly controllers = new Map<string, Controller>();
    private readonly vehicles = new Map<string, RapierVehicle>();
    private readonly jointMap = new Map<string, Rapier.ImpulseJoint>();

    /** Collision object (body or controller) UUID to Shape UUID */
    private readonly collisionObjectToShapeMap = new Map<string, string>();

    /** Collider handle to rigid body or controller UUID */
    private readonly colliderHandleToOwnerMap = new Map<number, string>();

    /** Current scale per rigid body (for avoiding redundant updates) */
    private readonly rigidBodyScales = new Map<string, { x: number; y: number; z: number }>();

    private controllerCollisions = new Map<string, ControllerCollision>();
    private nextControllerCollisions = new Map<string, ControllerCollision>();
    private collisionEventQueue: Rapier.EventQueue | null = null;

    private readonly shapeCache = new ShapeCache<SharedShape>((shape) => {
        shape.shape = null;
    });

    private world: Rapier.World;

    private debugGeometry: BufferGeometry | null = null;
    private debugMaterial: LineBasicMaterial | null = null;
    private debugMesh: LineSegments | null = null;
    private debugEnabled = false;
    private debugVertices: Float32Array | null = null;
    private debugColors: Float32Array | null = null;

    private started = false;
    private solverIterations: number;

    constructor(
        private readonly gravity: number,
        solverIterations: number = DEFAULT_SOLVER_ITERATIONS,
    ) {
        this.world = new Rapier.World({ x: 0, y: gravity, z: 0 });
        // Fixed-duration substeps still benefit from multiple constraint
        // iterations: one iteration leaves stacks and joints visibly soft,
        // while an unbounded caller-provided value can dominate frame time.
        this.solverIterations = normalizeSolverIterations(solverIterations);
        this.world.integrationParameters.numSolverIterations = this.solverIterations;
        this.started = true;
    }

    dispose(): void {
        this.started = false;

        this.debugGeometry?.dispose();
        this.debugGeometry = null;
        this.debugMaterial?.dispose();
        this.debugMaterial = null;
        this.debugMesh?.removeFromParent();
        this.debugMesh = null;
        this.debugEnabled = false;
        this.debugVertices = null;
        this.debugColors = null;
        this.collisionEventQueue?.free();
        this.collisionEventQueue = null;

        for (const uuid of this.vehicles.keys()) {
            this.removeVehicle(uuid);
        }

        for (const key of this.jointMap.keys()) {
            this.removeJointByKey(key);
        }

        for (const uuid of this.rigidBodies.keys()) {
            this.removeRigidBody(uuid);
        }

        for (const uuid of this.controllers.keys()) {
            this.removeCharacterController(uuid);
        }

        this.shapeCache.dispose();

        this.rigidBodies.clear();

        this.world.free();
    }

    getGravity(): number {
        return this.gravity;
    }

    setSolverIterations(solverIterations: number): void {
        this.solverIterations = normalizeSolverIterations(solverIterations);
        this.world.integrationParameters.numSolverIterations = this.solverIterations;
    }

    simulate(onCollision?: CollisionCallback): void {
        if (!this.started) {
            return;
        }

        const eventQueue = onCollision ? this.getCollisionEventQueue() : undefined;
        const currentControllerCollisions = onCollision ? this.nextControllerCollisions : undefined;
        currentControllerCollisions?.clear();
        this.world.timestep = this.stepDuration;
        // Large manually-selected timesteps (used by legacy callers and
        // conformance tests) are intentionally solved once to preserve the
        // backend's historical integration semantics. Normal fixed steps at
        // 30–60 Hz receive the configured multi-iteration quality pass.
        this.world.integrationParameters.numSolverIterations =
            this.stepDuration <= MAX_MULTI_ITERATION_STEP_DURATION ? this.solverIterations : 1;
        this.world.step(eventQueue);

        for (const vehicle of this.vehicles.values()) {
            vehicle.controller.updateVehicle(this.stepDuration);
        }

        for (const controller of this.controllers.values()) {
            this.simulateCharacterController(controller, this.stepDuration, currentControllerCollisions);
        }

        if (onCollision && eventQueue) {
            eventQueue.drainCollisionEvents((handle1, handle2, started) => {
                this.dispatchCollisionEvent(handle1, handle2, started, onCollision);
            });
        }

        if (onCollision && currentControllerCollisions) {
            for (const [key, collision] of currentControllerCollisions) {
                if (this.controllerCollisions.has(key)) {
                    continue;
                }

                this.dispatchCollisionEvent(collision.controllerColliderHandle, collision.colliderHandle, true, onCollision, collision.contactPoint, collision.contactNormal);
            }

            for (const [key, collision] of this.controllerCollisions) {
                if (currentControllerCollisions?.has(key)) {
                    continue;
                }

                this.dispatchCollisionEvent(collision.controllerColliderHandle, collision.colliderHandle, false, onCollision);
            }

            this.controllerCollisions.clear();
            this.nextControllerCollisions = this.controllerCollisions;
            this.controllerCollisions = currentControllerCollisions;
        }

        if (this.debugEnabled) {
            const buffers = this.world.debugRender();
            this.debugVertices = buffers.vertices;
            this.debugColors = buffers.colors;
            if (this.debugGeometry) {
                this.debugGeometry.setAttribute(
                    "position",
                    new BufferAttribute(buffers.vertices, 3),
                );
                this.debugGeometry.setAttribute(
                    "color",
                    new BufferAttribute(buffers.colors, 4),
                );
                this.debugGeometry.setDrawRange(0, buffers.vertices.length / 3);
            }
        }
    }

    pause(): void {
        this.started = false;
    }

    resume(): void {
        this.started = true;
    }

    getDebugRenderData(): PhysicsDebugRenderData | null {
        if (!this.debugEnabled || !this.debugVertices || !this.debugColors) return null;
        return {
            vertices: this.debugVertices.slice(),
            colors: this.debugColors.slice(),
            drawCount: this.debugVertices.length / 3,
        };
    }

    private getCollisionEventQueue(): Rapier.EventQueue {
        if (!this.collisionEventQueue) {
            this.collisionEventQueue = new Rapier.EventQueue(true);
        }
        return this.collisionEventQueue;
    }

    addRigidBody(
        uuid: string,
        shapeUuid: string,
        type: RigidBodyType,
        options: RigidBodyOptions = {},
    ): void {
        if (this.rigidBodies.has(uuid)) {
            console.warn("RapierPhysicsEngine.addRigidBody: body already exists", uuid);
            return;
        }

        const sharedShape = this.shapeCache.get(shapeUuid);
        if (!sharedShape) {
            console.warn("RapierPhysicsEngine.addRigidBody: shape not found", shapeUuid);
            return;
        }

        if (!isConcaveHullBodyTypeSupported(sharedShape.type, type)) {
            console.warn(
                `RapierPhysicsEngine.addRigidBody: rejected ${type} body "${uuid}" with concave hull/static-mesh shape "${shapeUuid}". ` +
                "Ammo/Rapier support concave and heightfield shapes only for Static bodies; use a static collider, ConvexHull, or compound primitive colliders.",
            );
            return;
        }

        const {
            friction = DEFAULT_RIGID_BODY_FRICTION,
            mass = DEFAULT_RIGID_BODY_MASS,
            restitution = DEFAULT_RIGID_BODY_RESTITUTION,
            linearDamping = DEFAULT_RIGID_BODY_LINEAR_DAMPING,
            angularDamping = DEFAULT_RIGID_BODY_ANGULAR_DAMPING,
            collisionGroup = DEFAULT_RIGID_BODY_COLLISION_GROUP,
            collisionMask = DEFAULT_RIGID_BODY_COLLISION_MASK,
            position,
            quaternion,
        } = options;
        // Static and kinematic bodies are non-dynamic by contract. Keep the
        // native collider mass at zero even when authored data contains a
        // stale or overly large mass value from an older scene schema.
        const effectiveMass = type === RigidBodyType.Dynamic ? mass : 0;

        const ccdEnabled = options.ccd === true && type === RigidBodyType.Dynamic;
        const ccdMotionThreshold = Number.isFinite(options.ccdMotionThreshold)
            ? Math.max(0, options.ccdMotionThreshold as number)
            : DEFAULT_RIGID_BODY_CCD_MOTION_THRESHOLD;
        const ccdSweptSphereRadius = Number.isFinite(options.ccdSweptSphereRadius)
            ? Math.max(0, options.ccdSweptSphereRadius as number)
            : DEFAULT_RIGID_BODY_CCD_SWEPT_SPHERE_RADIUS;

        const rigidBodyType = RIGID_BODY_TYPE_MAP[type];
        const rigidBodyDescriptor = Rapier.RigidBodyDesc[rigidBodyType]()
            .setLinearDamping(linearDamping)
            .setAngularDamping(angularDamping)
            .setCanSleep(type === RigidBodyType.Dynamic && options.allowSleep !== false);

        if (ccdEnabled) {
            // Rapier's hard CCD is the cross-backend equivalent of Bullet's
            // swept test. Its soft prediction distance is the closest native
            // equivalent for Bullet's motion-threshold/radius tuning knobs.
            rigidBodyDescriptor
                .setCcdEnabled(true)
                .setSoftCcdPrediction(Math.max(ccdMotionThreshold, ccdSweptSphereRadius));
        }

        if (position) {
            rigidBodyDescriptor.setTranslation(position.x, position.y, position.z);
        }
        if (quaternion) {
            rigidBodyDescriptor.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
        }

        const body = this.world.createRigidBody(rigidBodyDescriptor);

        if (sharedShape.shape) {
            const colliderDescriptor = new Rapier.ColliderDesc(sharedShape.shape)
                .setMass(effectiveMass)
                .setFriction(friction)
                .setRestitution(restitution)
                .setActiveEvents(Rapier.ActiveEvents.COLLISION_EVENTS)
                .setCollisionGroups((collisionGroup << 16) | (collisionMask & 0xffff));

            const collider = this.world.createCollider(colliderDescriptor, body);
            this.colliderHandleToOwnerMap.set(collider.handle, uuid);
        }

        this.rigidBodies.set(uuid, body);
        this.collisionObjectToShapeMap.set(uuid, shapeUuid);
        this.shapeCache.retain(shapeUuid);
    }

    removeRigidBody(uuid: string): void {
        const body = this.rigidBodies.get(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.remove: rigid body not found", uuid);
            return;
        }

        // Rapier removes constraints attached to a body as part of the native
        // body teardown, but the JS wrapper does not clean our ownership map.
        // Remove them first so later replacement/disposal cannot address a
        // freed impulse-joint handle.
        this.removeJointsForBody(uuid);

        const colliderCount = body.numColliders();
        for (let i = 0; i < colliderCount; i++) {
            const collider = body.collider(i);
            this.world.removeCollider(collider, false);
            this.colliderHandleToOwnerMap.delete(collider.handle);
        }

        this.world.removeRigidBody(body);
        this.rigidBodies.delete(uuid);
        this.rigidBodyScales.delete(uuid);

        const shapeUuid = this.collisionObjectToShapeMap.get(uuid);
        if (shapeUuid) {
            this.shapeCache.release(shapeUuid);
            this.collisionObjectToShapeMap.delete(uuid);
        }
    }

    hasRigidBody(uuid: string): boolean {
        return this.rigidBodies.has(uuid) || this.vehicles.has(uuid);
    }

    rigidBodyUuids(): IterableIterator<string> {
        return this.rigidBodies.keys();
    }

    private getRigidBody(uuid: string): Rapier.RigidBody | null {
        const body = this.rigidBodies.get(uuid);
        if (body) {
            return body;
        }

        const vehicle = this.vehicles.get(uuid);
        if (vehicle) {
            return vehicle.chassisBody;
        }

        return null;
    }

    applyImpulseToRigidBody(uuid: string, impulse: Vector3Like, relativePosition?: Vector3Like): void {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.applyImpulseToRigidBody: rigid body not found", uuid);
            return;
        }

        if (relativePosition === undefined) {
            body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
        } else {
            body.applyImpulseAtPoint(
                { x: impulse.x, y: impulse.y, z: impulse.z },
                { x: relativePosition.x, y: relativePosition.y, z: relativePosition.z },
                true);
        }
    }

    getRigidBodyLinearVelocity(uuid: string): Vector3Like | null {
        const body = this.getRigidBody(uuid);
        if (!body) {
            return null;
        }

        const vel = body.linvel();
        return { x: vel.x, y: vel.y, z: vel.z };
    }

    getRigidBodyAngularVelocity(uuid: string): Vector3Like | null {
        const body = this.getRigidBody(uuid);
        if (!body) {
            return null;
        }

        const vel = body.angvel();
        return { x: vel.x, y: vel.y, z: vel.z };
    }

    setRigidBodyLinearDamping(uuid: string, damping: number): void {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.setRigidBodyLinearDamping: rigid body not found", uuid);
            return;
        }

        body.setLinearDamping(damping);
    }

    setRigidBodyAngularDamping(uuid: string, damping: number): void {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.setRigidBodyAngularDamping: rigid body not found", uuid);
            return;
        }

        body.setAngularDamping(damping);
    }

    getRigidBodyPosition(uuid: string): Vector3Like | null {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.getRigidBodyPosition: rigid body not found", uuid);
            return null;
        }

        return body.translation();
    }

    getRigidBodyRotation(uuid: string): QuaternionLike | null {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.getRigidBodyRotation: rigid body not found", uuid);
            return null;
        }
        
        return body.rotation();
    }

    getRigidBodyShapeUuid(uuid: string): string | null {
        if (!this.hasRigidBody(uuid)) {
            return null;
        }

        return this.collisionObjectToShapeMap.get(uuid) || null;
    }

    getRigidBodyType(uuid: string): RigidBodyType | null {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.getRigidBodyType: rigid body not found", uuid);
            return null;
        }

        const rigidBodyType = body.bodyType();
        return REVERSE_RIGID_BODY_TYPE_MAP[rigidBodyType];
    }

    setRigidBodyCollisionBehavior(uuid: string, behavior: CollisionBehavior): void {
        // Try to get a Collider from your map.
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysics.setCollisionBehavior: rigid body not found", uuid);
            return;
        }

        const collider = body.collider(0);

        switch (behavior) {
            case CollisionBehavior.Ghost:
                // Make it a sensor → no collision response, but still gets collision events
                collider.setSensor(true);
                break;

            case CollisionBehavior.Regular:
                // Re-enable normal collision response
                collider.setSensor(false);
                break;
        }
    }

    setRigidBodyCollisionMasks(uuid: string, collisionGroup: number, collisionMask: number): void {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.setRigidBodyCollisionMasks: rigid body not found", uuid);
            return;
        }

        // The collision collision group mask is stored in the leftmost 16 bits
        // and the collision mask is stored in the rightmost 16 bits.
        const mask = (collisionGroup & 0xffff) << 16 | collisionMask & 0xffff;

        const colliderCount = body.numColliders();
        for (let i = 0; i < colliderCount; i++) {
            const collider = body.collider(i);
            collider.setCollisionGroups(mask);
        }
    }

    setRigidBodyAngularVelocity(uuid: string, velocity: Vector3Like): void {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.setRigidBodyAngularVelocity: rigid body not found", uuid);
            return;
        }

        body.setAngvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
    }

    setRigidBodyLinearVelocity(uuid: string, velocity: Vector3Like): void {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.setRigidBodyLinearVelocity: rigid body not found", uuid);
            return;
        }

        body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
    }

    setRigidBodyPosition(uuid: string, position: Vector3Like): void {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.setRigidBodyPosition: rigid body not found", uuid);
            return;
        }

        const bodyType = body.bodyType();
        switch (bodyType) {
            case Rapier.RigidBodyType.KinematicPositionBased:
            case Rapier.RigidBodyType.KinematicVelocityBased:
                body.setNextKinematicTranslation(position);
                break;
            default:
                body.setTranslation(position, true);
                break;
        }
    }

    setRigidBodyRotation(uuid: string, quaternion: QuaternionLike): void {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.setRigidBodyRotation: rigid body not found", uuid);
            return;
        }

        const bodyType = body.bodyType();
        switch (bodyType) {
            case Rapier.RigidBodyType.KinematicPositionBased:
            case Rapier.RigidBodyType.KinematicVelocityBased:
                body.setNextKinematicRotation(quaternion);
                break;
            default:
                body.setRotation(quaternion, true);
                break;
        }
    }

    setRigidBodyRotationLock(uuid: string, lock: { x: boolean; y: boolean; z: boolean }): void {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.setRigidBodyRotationLock: rigid body not found", uuid);
            return;
        }

        // Rapier's setEnabledRotations takes *enabled* flags, whereas our
        // interface is defined in terms of *locked* axes (true = locked).
        body.setEnabledRotations(!lock.x, !lock.y, !lock.z, true);
    }

    setRigidBodyScale(uuid: string, scale: Vector3Like): void {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.setRigidBodyScale: rigid body not found", uuid);
            return;
        }

        // Check if scale has changed
        const currentScale = this.rigidBodyScales.get(uuid);
        if (currentScale &&
            currentScale.x === scale.x &&
            currentScale.y === scale.y &&
            currentScale.z === scale.z) {
            return; // Scale unchanged, skip expensive collider recreation
        }

        if (!body.numColliders()) {
            console.warn("RapierPhysicsEngine.setRigidBodyScale: rigid body has no colliders", uuid);
            return;
        }

        const shapeUuid = this.collisionObjectToShapeMap.get(uuid);
        if (!shapeUuid) {
            console.warn("RapierPhysicsEngine.setRigidBodyScale: rigid body has no shape", uuid);
            return;
        }

        const sharedShape = this.shapeCache.get(shapeUuid);
        if (!sharedShape) {
            console.warn("RapierPhysicsEngine.setRigidBodyScale: shape not found", shapeUuid);
            return;
        }

        // Retreive properties from existing collider
        const oldCollider = body.collider(0);
        const mass = oldCollider.mass();
        const friction = oldCollider.friction();
        const restitution = oldCollider.restitution();
        const activeEvents = oldCollider.activeEvents();
        const collisionGroups = oldCollider.collisionGroups();
        const isSensor = oldCollider.isSensor();

        // Remove existing collider
        this.colliderHandleToOwnerMap.delete(oldCollider.handle);
        this.world.removeCollider(oldCollider, false);

        // Create new scaled collider
        if (sharedShape.shape) {
            let scaledShape: Rapier.Shape;

            switch (sharedShape.type) {
                case BodyShapeType.BOX: {
                    const box = sharedShape.shape as Rapier.Cuboid;
                    scaledShape = new Rapier.Cuboid(
                        box.halfExtents.x * scale.x,
                        box.halfExtents.y * scale.y,
                        box.halfExtents.z * scale.z,
                    );
                    break;
                }
                case BodyShapeType.CAPSULE: {
                    const capsule = sharedShape.shape as Rapier.Capsule;
                    const newScale = MathUtils.computeCapsuleScale(capsule.radius, 2 * capsule.halfHeight, scale);
                    scaledShape = new Rapier.Capsule(
                        capsule.halfHeight * newScale.y,
                        capsule.radius * newScale.x,
                    );
                    break;
                }
                case BodyShapeType.SPHERE: {
                    const sphere = sharedShape.shape as Rapier.Ball;
                    scaledShape = new Rapier.Ball(sphere.radius * scale.x);
                    break;
                }
                default: {
                    console.warn("RapierPhysicsEngine.setRigidBodyScale: unsupported shape type", sharedShape.type);
                    scaledShape = sharedShape.shape;
                    break;
                }
            }

            const colliderDescriptor = new Rapier.ColliderDesc(scaledShape)
                .setMass(mass)
                .setFriction(friction)
                .setRestitution(restitution)
                .setActiveEvents(activeEvents)
                .setCollisionGroups(collisionGroups)
                .setSensor(isSensor);
            
            const collider = this.world.createCollider(colliderDescriptor, body);
            this.colliderHandleToOwnerMap.set(collider.handle, uuid);
        }

        // Update tracked scale
        this.rigidBodyScales.set(uuid, { x: scale.x, y: scale.y, z: scale.z });

        // Wake up the body
        body.wakeUp();
    }

    setRigidBodyShape(uuid: string, newShapeUuid: string): void {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("RapierPhysicsEngine.setRigidBodyShape: rigid body not found", uuid);
            return;
        }

        const newSharedShape = this.shapeCache.get(newShapeUuid);
        if (!newSharedShape) {
            console.warn("RapierPhysicsEngine.setRigidBodyShape: shape not found", newShapeUuid);
            return;
        }

        if (!isConcaveHullBodyTypeSupported(newSharedShape.type, this.getRigidBodyType(uuid))) {
            console.warn(
                `RapierPhysicsEngine.setRigidBodyShape: rejected concave hull/static-mesh shape "${newShapeUuid}" for ${this.getRigidBodyType(uuid)} body "${uuid}". ` +
                "Ammo/Rapier support concave and heightfield shapes only for Static bodies; use a ConvexHull or compound primitive colliders.",
            );
            return;
        }

        if (!newSharedShape.shape) {
            console.warn("RapierPhysicsEngine.setRigidBodyShape: shape not found", newShapeUuid);
            return;
        }

        // Get the old shape UUID for cleanup
        const oldShapeUuid = this.collisionObjectToShapeMap.get(uuid);

        // Preserve properties from existing collider (if any)
        let mass = DEFAULT_RIGID_BODY_MASS;
        let friction = DEFAULT_RIGID_BODY_FRICTION;
        let restitution = DEFAULT_RIGID_BODY_RESTITUTION;
        let collisionGroups = DEFAULT_RIGID_BODY_COLLISION_GROUP << 16 | DEFAULT_RIGID_BODY_COLLISION_MASK;

        // Remove existing colliders and preserve their properties
        const colliderCount = body.numColliders();
        for (let i = colliderCount - 1; i >= 0; i--) {
            const collider = body.collider(i);
            // Preserve properties from the first collider
            if (i === 0) {
                mass = collider.mass();
                friction = collider.friction();
                restitution = collider.restitution();
                collisionGroups = collider.collisionGroups();
            }
            this.colliderHandleToOwnerMap.delete(collider.handle);
            this.world.removeCollider(collider, false);
        }

        // Create new collider with the new shape
        const colliderDescriptor = new Rapier.ColliderDesc(newSharedShape.shape)
            .setMass(mass)
            .setFriction(friction)
            .setRestitution(restitution)
            .setActiveEvents(Rapier.ActiveEvents.COLLISION_EVENTS)
            .setCollisionGroups(collisionGroups);

        const newCollider = this.world.createCollider(colliderDescriptor, body);
        this.colliderHandleToOwnerMap.set(newCollider.handle, uuid);

        // Wake up the body so it responds to the new shape
        body.wakeUp();

        // Update shape tracking
        this.collisionObjectToShapeMap.set(uuid, newShapeUuid);
        this.shapeCache.retain(newShapeUuid);

        // Release the old shape
        if (oldShapeUuid) {
            this.shapeCache.release(oldShapeUuid);
        }
    }

    addShape(uuid: string, collisionShape: CollisionShape) {
        if (this.shapeCache.hasShape(uuid)) {
            console.warn("RapierPhysicsEngine.addShape: shape already exists", uuid);
            return;
        }

        const sharedShape = this.createSharedShape(collisionShape);
        this.shapeCache.add(uuid, sharedShape);
    }

    removeShape(uuid: string): void {
        if (!this.shapeCache.hasShape(uuid)) {
            console.warn("RapierPhysicsEngine.removeShape: shape does not exist", uuid);
            return;
        }

        this.shapeCache.remove(uuid);
    }

    hasShape(uuid: string): boolean {
        return this.shapeCache.hasShape(uuid);
    }

    addCharacterController(uuid: string, shapeUuid: string): void {
        if (this.controllers.has(uuid)) {
            console.warn("RapierPhysicsEngine.addCharacterController: controller already exists", uuid);
            return;
        }

        const sharedShape = this.shapeCache.get(shapeUuid);
        if (!sharedShape) {
            console.warn("RapierPhysicsEngine.addCharacterController: shape not found", shapeUuid);
            return;
        }

        if (!isConcaveHullBodyTypeSupported(sharedShape.type, RigidBodyType.Kinematic)) {
            console.warn(
                `RapierPhysicsEngine.addCharacterController: rejected concave hull shape "${shapeUuid}" for controller "${uuid}". ` +
                "Ammo/Rapier support concave hulls only for Static colliders; use a capsule, convex hull, or primitive collider.",
            );
            return;
        }

        const controller = this.world.createCharacterController(DEFAULT_CHARACTER_CONTROLLER_OFFSET);
        controller.setSlideEnabled(true);
        controller.enableSnapToGround(DEFAULT_CHARACTER_CONTROLLER_SNAP_DISTANCE);
        controller.enableAutostep(DEFAULT_CHARACTER_CONTROLLER_STEP_HEIGHT, 0.1, true);
        controller.setMaxSlopeClimbAngle(DEFAULT_CHARACTER_CONTROLLER_MAX_SLOPE);
        controller.setMinSlopeSlideAngle(DEFAULT_CHARACTER_CONTROLLER_MAX_SLOPE * 0.5);

        let collider: Rapier.Collider | null = null;
        if (sharedShape.shape) {
            const colliderDescriptor = new Rapier.ColliderDesc(sharedShape.shape)
                .setActiveEvents(Rapier.ActiveEvents.COLLISION_EVENTS)
                .setCollisionGroups(DEFAULT_CHARACTER_CONTROLLER_COLLISION_GROUP << 16 | DEFAULT_CHARACTER_CONTROLLER_COLLISION_MASK);
            collider = this.world.createCollider(colliderDescriptor);
            this.colliderHandleToOwnerMap.set(collider.handle, uuid);
        }

        this.controllers.set(uuid, {
            controller,
            collider,
            walkVelocity: { x: 0, y: 0, z: 0 },
            linearVelocity: { x: 0, y: 0, z: 0 },
            isGrounded: false,
            gravity: this.gravity,
            internalVerticalVelocity: 0,
            isJumping: false,
        });

        this.collisionObjectToShapeMap.set(uuid, shapeUuid);
        this.shapeCache.retain(shapeUuid);
    }

    removeCharacterController(uuid: string): void {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("RapierPhysicsEngine.removeCharacterController: controller does not exist", uuid);
            return;
        }

        this.world.removeCharacterController(controller.controller);

        if (controller.collider) {
            this.world.removeCollider(controller.collider, false);
            this.colliderHandleToOwnerMap.delete(controller.collider.handle);
        }

        this.controllers.delete(uuid);

        const shapeUuid = this.collisionObjectToShapeMap.get(uuid);
        if (shapeUuid) {
            this.shapeCache.release(shapeUuid);
            this.collisionObjectToShapeMap.delete(uuid);
        }
    }

    hasCharacterController(uuid: string): boolean {
        return this.controllers.has(uuid);
    }

    characterControllerUuids(): IterableIterator<string> {
        return this.controllers.keys();
    }

    getCharacterControllerLinearVelocity(uuid: string): Vector3Like | null {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("RapierPhysicsEngine.getCharacterControllerLinearVelocity: controller does not exist", uuid);
            return null;
        }

        return controller.linearVelocity || null;
    }

    getCharacterControllerPosition(uuid: string): Vector3Like | null {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("RapierPhysicsEngine.getCharacterControllerPosition: controller does not exist", uuid);
            return null;
        }

        return controller.collider?.translation() || null;
    }

    getCharacterControllerRotation(uuid: string): QuaternionLike | null {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("RapierPhysicsEngine.getCharacterControllerRotation: controller does not exist", uuid);
            return null;
        }

        return controller.collider?.rotation() || null;
    }

    isCharacterControllerOnGround(uuid: string): boolean {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("RapierPhysicsEngine.isCharacterControllerOnGround: controller does not exist", uuid);
            return false;
        }

        return controller.isGrounded;
    }

    setCharacterControllerCollisionBehavior(uuid: string, behavior: CollisionBehavior): void {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("RapierPhysicsEngine.setCharacterControllerCollisionBehavior: controller does not exist", uuid);
            return;
        }

        const collider = controller.collider;
        if (!collider) {
            return;
        }

        switch (behavior) {
            case CollisionBehavior.Ghost:
                // Make it a sensor → no collision response, but still gets collision events
                collider.setSensor(true);
                break;

            case CollisionBehavior.Regular:
                // Re-enable normal collision response
                collider.setSensor(false);
                break;
        }
    }

    setCharacterControllerMaxSlope(uuid: string, maxSlope: number): void {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("RapierPhysicsEngine.setCharacterControllerMaxSlope: controller does not exist", uuid);
            return;
        }

        controller.controller.setMaxSlopeClimbAngle(maxSlope);
        controller.controller.setMinSlopeSlideAngle(maxSlope * 0.5);
    }

    setCharacterControllerPosition(uuid: string, position: Vector3Like): void {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("RapierPhysicsEngine.setCharacterControllerPosition: controller does not exist", uuid);
            return;
        }

        if (controller.collider) {
            controller.collider.setTranslation(position);
        }
    }

    setCharacterControllerRotation(uuid: string, quaternion: QuaternionLike): void {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("RapierPhysicsEngine.setCharacterControllerRotation: controller does not exist", uuid);
            return;
        }

        if (controller.collider) {
            controller.collider.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
        }
    }

    setCharacterControllerStepHeight(uuid: string, stepHeight: number): void {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("RapierPhysicsEngine.setCharacterControllerStepHeight: controller does not exist", uuid);
            return;
        }

        controller.controller.enableSnapToGround(stepHeight);
        controller.controller.enableAutostep(stepHeight, 0.1, true);
    }

    // Character-controller gravity / jump / platform-carry API. The
    // engine tracks gravity + vertical velocity internally and feeds
    // combined motion through computeColliderMovement each step.
    // Rapier's KinematicCharacterController owns slope/step/snap natively.

    setCharacterControllerGravity(uuid: string, gravity: Vector3Like): void {
        const entry = this.controllers.get(uuid);
        if (!entry) {
            console.warn("RapierPhysicsEngine.setCharacterControllerGravity: controller does not exist", uuid);
            return;
        }
        entry.gravity = gravity.y;
    }

    setCharacterControllerWalkVelocity(uuid: string, velocity: Vector3Like): void {
        const entry = this.controllers.get(uuid);
        if (!entry) {
            console.warn("RapierPhysicsEngine.setCharacterControllerWalkVelocity: controller does not exist", uuid);
            return;
        }
        entry.walkVelocity.x = velocity.x;
        entry.walkVelocity.y = velocity.y;
        entry.walkVelocity.z = velocity.z;
    }

    jumpCharacterController(uuid: string, jumpSpeed: number): boolean {
        const entry = this.controllers.get(uuid);
        if (!entry) {
            console.warn("RapierPhysicsEngine.jumpCharacterController: controller does not exist", uuid);
            return false;
        }
        if (!entry.isGrounded || entry.isJumping) {
            return false;
        }
        entry.internalVerticalVelocity += jumpSpeed;
        entry.isJumping = true;
        return true;
    }

    applyImpulseToCharacterController(uuid: string, impulse: Vector3Like): void {
        const entry = this.controllers.get(uuid);
        if (!entry) {
            console.warn("RapierPhysicsEngine.applyImpulseToCharacterController: controller does not exist", uuid);
            return;
        }
        entry.internalVerticalVelocity += impulse.y;
    }

    ////////////////////////////////////////////////////////////////////////////
    // Joint methods
    ////////////////////////////////////////////////////////////////////////////

    addFixedJoint(options: FixedJointOptions): void {
        const { collisionEnabled, uuidA, uuidB, pivotB, rotationB } = options;
        const bodyA = this.rigidBodies.get(uuidA);
        const bodyB = this.rigidBodies.get(uuidB);
        if (!bodyA || !bodyB) {
            console.warn("RapierPhysicsEngine.addFixedJoint: rigid body not found", uuidA, uuidB);
            return;
        }

        this.replaceJoint(uuidA, uuidB);

        const data = Rapier.JointData.fixed(
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0, w: 1 },
            pivotB,
            rotationB,
        );
        const joint = this.world.createImpulseJoint(data, bodyA, bodyB, true);
        joint.setContactsEnabled(collisionEnabled);
        this.jointMap.set(this.getJointKey(uuidA, uuidB), joint);
    }

    addHingeJoint(options: HingeJointOptions): void {
        const {
            collisionEnabled, uuidA, uuidB,
            hingeAxis, relPos,
            angularLimitEnabled, angularLimit,
            motorEnabled, motorSpeed, motorTorque,
        } = options;
        const bodyA = this.rigidBodies.get(uuidA);
        const bodyB = this.rigidBodies.get(uuidB);
        if (!bodyA || !bodyB) {
            console.warn("RapierPhysicsEngine.addHingeJoint: rigid body not found", uuidA, uuidB);
            return;
        }

        this.replaceJoint(uuidA, uuidB);

        // Rapier's revolute joint takes anchors in each body's local
        // frame plus a single hinge axis in A's local frame; it derives
        // B's axis automatically, so options.relRotation is ignored here.
        const data = Rapier.JointData.revolute(
            { x: 0, y: 0, z: 0 },
            relPos,
            hingeAxis,
        );
        const joint = this.world.createImpulseJoint(data, bodyA, bodyB, true) as Rapier.RevoluteImpulseJoint;
        joint.setContactsEnabled(collisionEnabled);

        if (angularLimitEnabled) {
            const minRad = angularLimit.x * Math.PI / 180;
            const maxRad = angularLimit.y * Math.PI / 180;
            joint.setLimits(minRad, maxRad);
        }

        if (motorEnabled) {
            // Rapier's `configureMotorVelocity(target, factor)` takes a
            // damping factor rather than a torque ceiling; forward the
            // caller's torque as the factor to preserve magnitude
            // ordering across engines without claiming unit parity.
            joint.configureMotorVelocity(motorSpeed, motorTorque);
        }

        this.jointMap.set(this.getJointKey(uuidA, uuidB), joint);
    }

    addPointToPointJoint(options: PointToPointJointOptions): void {
        const { collisionEnabled, uuidA, uuidB, pivotA, pivotB } = options;
        const bodyA = this.rigidBodies.get(uuidA);
        const bodyB = this.rigidBodies.get(uuidB);
        if (!bodyA || !bodyB) {
            console.warn("RapierPhysicsEngine.addPointToPointJoint: rigid body not found", uuidA, uuidB);
            return;
        }

        this.replaceJoint(uuidA, uuidB);

        const data = Rapier.JointData.spherical(pivotA, pivotB);
        const joint = this.world.createImpulseJoint(data, bodyA, bodyB, true);
        joint.setContactsEnabled(collisionEnabled);
        this.jointMap.set(this.getJointKey(uuidA, uuidB), joint);
    }

    removeJoint(uuidA: string, uuidB: string): void {
        this.removeJointByKey(this.getJointKey(uuidA, uuidB));
    }

    /** Remove a single owned joint, tolerating an already-removed handle. */
    private removeJointByKey(key: string): void {
        const joint = this.jointMap.get(key);
        if (!joint) return;

        this.jointMap.delete(key);
        try {
            this.world.removeImpulseJoint(joint, true);
        } catch (error) {
            // Body teardown can make Rapier invalidate a native handle before
            // a caller reaches this cleanup path. Ownership is already gone;
            // keep disposal idempotent and surface only a debug diagnostic.
            console.debug("RapierPhysicsEngine: joint handle was already removed", key, error);
        }
    }

    private replaceJoint(uuidA: string, uuidB: string): void {
        this.removeJointByKey(this.getJointKey(uuidA, uuidB));
    }

    private removeJointsForBody(uuid: string): void {
        for (const key of this.jointMap.keys()) {
            const separator = key.indexOf(":");
            if (separator === -1) continue;
            const keyA = key.slice(0, separator);
            const keyB = key.slice(separator + 1);
            if (keyA === uuid || keyB === uuid) {
                this.removeJointByKey(key);
            }
        }
    }

    private getJointKey(uuidA: string, uuidB: string): string {
        return uuidA < uuidB ? `${uuidA}:${uuidB}` : `${uuidB}:${uuidA}`;
    }

    ////////////////////////////////////////////////////////////////////////////
    // Vehicle methods
    ////////////////////////////////////////////////////////////////////////////

    addVehicle(vehicleUuid: string, spec: VehicleData, options: VehicleOptions): void {
        if (this.vehicles.has(vehicleUuid)) {
            console.warn("RapierPhysicsEngine.addVehicle: vehicle already exists", vehicleUuid);
            return;
        }

        const mass = options.mass ?? 800;
        const halfExtents = spec.chassis.halfExtents;
        const centerOffset = spec.chassis.centerOffset;
        const initialTransform = spec.chassis.initialTransform;

        // Create chassis rigid body
        const rigidBodyDesc = Rapier.RigidBodyDesc.dynamic()
            .setTranslation(initialTransform.position.x, initialTransform.position.y, initialTransform.position.z)
            .setRotation(initialTransform.quaternion)
            .setCanSleep(false);
        const chassisBody = this.world.createRigidBody(rigidBodyDesc);
        chassisBody.setBodyType(Rapier.RigidBodyType.Dynamic, true);

        // Create box collider with center offset (compound shape equivalent)
        const colliderDesc = Rapier.ColliderDesc.cuboid(
            Math.max(0.1, halfExtents.x),
            Math.max(0.05, halfExtents.y),
            Math.max(0.1, halfExtents.z),
        )
            .setMass(mass)
            .setTranslation(centerOffset.x, centerOffset.y, centerOffset.z)
            .setActiveEvents(Rapier.ActiveEvents.COLLISION_EVENTS)
            .setCollisionGroups(DEFAULT_RIGID_BODY_COLLISION_GROUP << 16 | DEFAULT_RIGID_BODY_COLLISION_MASK);

        const collider = this.world.createCollider(colliderDesc, chassisBody);
        this.colliderHandleToOwnerMap.set(collider.handle, vehicleUuid);

        // Disable deactivation by setting sleep threshold very high
        chassisBody.setLinearDamping(0);
        chassisBody.setAngularDamping(0);

        // Create vehicle controller
        const controller = this.world.createVehicleController(chassisBody);
        controller.indexUpAxis = 1;
        controller.setIndexForwardAxis = 2;

        // Add wheels
        const frontWheelIndices: number[] = [];
        const driveWheelIndices: number[] = [];
        const wheelRadii: number[] = [];

        for (let i = 0; i < spec.wheels.length; i++) {
            const wheelSpec = spec.wheels[i]!;
            controller.addWheel(
                { x: wheelSpec.connection.x, y: wheelSpec.connection.y, z: wheelSpec.connection.z },
                { x: 0, y: -1, z: 0 },  // direction (down)
                { x: -1, y: 0, z: 0 },   // axle
                options.suspensionRestLength,
                wheelSpec.radius,
            );

            controller.setWheelSuspensionStiffness(i, options.suspensionStiffness);
            controller.setWheelSuspensionRelaxation(i, options.suspensionDamping);
            controller.setWheelSuspensionCompression(i, options.suspensionCompression);
            controller.setWheelFrictionSlip(i, options.wheelFriction);
            controller.setWheelSideFrictionStiffness(i, 1.0 - options.rollInfluence);

            wheelRadii.push(wheelSpec.radius);

            if (wheelSpec.isFront) {
                frontWheelIndices.push(i);
            } else {
                driveWheelIndices.push(i);
            }
        }

        // If no explicit drive wheels, all wheels are drive wheels
        if (driveWheelIndices.length === 0) {
            for (let i = 0; i < spec.wheels.length; i++) {
                driveWheelIndices.push(i);
            }
        }

        this.vehicles.set(vehicleUuid, {
            controller,
            chassisBody,
            frontWheelIndices,
            driveWheelIndices,
            wheelCount: spec.wheels.length,
            wheelRadii,
            options,
        });
    }

    removeVehicle(vehicleUuid: string): void {
        const vehicle = this.vehicles.get(vehicleUuid);
        if (!vehicle) {
            return;
        }

        this.world.removeVehicleController(vehicle.controller);

        // Remove chassis colliders and body
        const colliderCount = vehicle.chassisBody.numColliders();
        for (let i = 0; i < colliderCount; i++) {
            const collider = vehicle.chassisBody.collider(i);
            this.colliderHandleToOwnerMap.delete(collider.handle);
            this.world.removeCollider(collider, false);
        }
        this.world.removeRigidBody(vehicle.chassisBody);

        this.vehicles.delete(vehicleUuid);
    }

    hasVehicle(vehicleUuid: string): boolean {
        return this.vehicles.has(vehicleUuid);
    }

    vehicleUuids(): IterableIterator<string> {
        return this.vehicles.keys();
    }

    setVehicleInput(vehicleUuid: string, input: VehicleInput): void {
        const vehicle = this.vehicles.get(vehicleUuid);
        if (!vehicle) {
            return;
        }

        let throttle = input.throttle;
        let steer = input.steer;
        const brake = input.brake;
        const opts = vehicle.options;

        if (Math.abs(throttle) < opts.throttleDeadzone) {
            throttle = 0;
        }
        if (Math.abs(steer) < opts.steerDeadzone) {
            steer = 0;
        }

        const engineForce = throttle * opts.maxEngineForce;
        const brakeForce = brake * opts.maxBrakeForce;
        const steeringValue = -steer * opts.maxSteerAngle;

        for (let i = 0; i < vehicle.wheelCount; i++) {
            vehicle.controller.setWheelBrake(i, brakeForce);
        }

        for (const i of vehicle.frontWheelIndices) {
            vehicle.controller.setWheelSteering(i, steeringValue);
        }

        for (const i of vehicle.driveWheelIndices) {
            vehicle.controller.setWheelEngineForce(i, engineForce);
        }
    }

    getVehicleChassisPosition(vehicleUuid: string): Vector3Like | null {
        const vehicle = this.vehicles.get(vehicleUuid);
        if (!vehicle) {
            return null;
        }

        return vehicle.chassisBody.translation();
    }

    getVehicleChassisRotation(vehicleUuid: string): QuaternionLike | null {
        const vehicle = this.vehicles.get(vehicleUuid);
        if (!vehicle) {
            return null;
        }

        return vehicle.chassisBody.rotation();
    }

    getVehicleWheelTransform(
        vehicleUuid: string,
        wheelIndex: number,
    ): { position: Vector3Like; rotation: QuaternionLike } | null {
        const vehicle = this.vehicles.get(vehicleUuid);
        if (!vehicle || wheelIndex < 0 || wheelIndex >= vehicle.wheelCount) {
            return null;
        }

        const ctrl = vehicle.controller;
        const chassisPos = vehicle.chassisBody.translation();
        const chassisRot = vehicle.chassisBody.rotation();

        // Get wheel connection point (chassis-space)
        const connectionCs = ctrl.wheelChassisConnectionPointCs(wheelIndex);
        if (!connectionCs) {
            return null;
        }

        // Get suspension length to compute how far down the wheel is
        const suspensionLength = ctrl.wheelSuspensionLength(wheelIndex) ?? 0;

        // Wheel position in chassis space: connection point + suspension direction * suspensionLength.
        // Direction is (0, -1, 0), so we subtract suspensionLength from y.
        const wheelLocalX = connectionCs.x;
        const wheelLocalY = connectionCs.y - suspensionLength;
        const wheelLocalZ = connectionCs.z;

        // Transform to world space using chassis rotation
        const worldPos = quatRotateVec(chassisRot, wheelLocalX, wheelLocalY, wheelLocalZ);
        worldPos.x += chassisPos.x;
        worldPos.y += chassisPos.y;
        worldPos.z += chassisPos.z;

        // Wheel rotation: chassis rotation * steering rotation * rolling rotation
        const steeringAngle = ctrl.wheelSteering(wheelIndex) ?? 0;
        const rollingAngle = ctrl.wheelRotation(wheelIndex) ?? 0;

        // Steering quaternion (around Y axis)
        const steerQuat = quatFromAxisAngle(0, 1, 0, steeringAngle);
        // Rolling quaternion (around X axis, negative because axle is -X)
        const rollQuat = quatFromAxisAngle(-1, 0, 0, rollingAngle);

        // Final rotation: chassis * steer * roll
        const wheelRot = quatMultiply(
            quatMultiply(chassisRot, steerQuat),
            rollQuat,
        );

        return {
            position: worldPos,
            rotation: wheelRot,
        };
    }

    getVehicleWheelCount(vehicleUuid: string): number {
        const vehicle = this.vehicles.get(vehicleUuid);
        if (!vehicle) {
            return 0;
        }

        return vehicle.wheelCount;
    }

    initDebug(): Object3D {
        this.debugEnabled = true;
        const debugVertices = new Float32Array(3 * DEFAULT_DEBUG_VERTEX_COUNT);
        const debugColors = new Float32Array(4 * DEFAULT_DEBUG_VERTEX_COUNT);

        this.debugGeometry = new BufferGeometry();
        this.debugGeometry.setAttribute(
            "position",
            new BufferAttribute(debugVertices, 3).setUsage(DynamicDrawUsage),
        );
        this.debugGeometry.setAttribute(
            "color",
            new BufferAttribute(debugColors, 4).setUsage(DynamicDrawUsage),
        );

        this.debugMaterial = new LineBasicMaterial({
            color: 0x3300ff,
            linewidth: 1,
            vertexColors: true /*VertexColors*/,
        });

        this.debugMesh = new LineSegments(this.debugGeometry, this.debugMaterial);
        this.debugMesh.frustumCulled = false;

        return this.debugMesh;
    }
    
    private createSharedShape(collisionShape: CollisionShape): SharedShape {
        switch (collisionShape.type) {
            case BodyShapeType.BOX:
                if (collisionShape.width < 0 || collisionShape.height < 0 || collisionShape.length < 0) {
                    console.warn("RapierPhysicsEngine.createSharedShape: invalid box dimensions", collisionShape);
                    return {
                        type: BodyShapeType.BOX,
                        shape: null,
                    };
                }

                return {
                    type: BodyShapeType.BOX,
                    shape: new Rapier.Cuboid(
                        collisionShape.width / 2,
                        collisionShape.height / 2,
                        collisionShape.length / 2,
                    ),
                };

            case BodyShapeType.CAPSULE:
                if (collisionShape.radius < 0 || collisionShape.height < 0) {
                    console.warn("RapierPhysicsEngine.createSharedShape: invalid capsule dimensions", collisionShape);
                    return {
                        type: BodyShapeType.CAPSULE,
                        shape: null,
                    };
                }

                return {
                    type: BodyShapeType.CAPSULE,
                    shape: new Rapier.Capsule(
                        collisionShape.height / 2,
                        collisionShape.radius,
                    ),
                };

            case BodyShapeType.SPHERE:
                if (collisionShape.radius < 0) {
                    console.warn("RapierPhysicsEngine.createSharedShape: invalid sphere radius", collisionShape);
                    return {
                        type: BodyShapeType.SPHERE,
                        shape: null,
                    };
                }

                return {
                    type: BodyShapeType.SPHERE,
                    shape: new Rapier.Ball(
                        collisionShape.radius,
                    ),
                };

            case BodyShapeType.CONVEX_HULL:
                return {
                    type: BodyShapeType.CONVEX_HULL,
                    shape: this.createConvexHullShape(collisionShape),
                };

            case BodyShapeType.CONCAVE_HULL:
                return {
                    type: BodyShapeType.CONCAVE_HULL,
                    shape: this.createConcaveHullShape(collisionShape),
                };

            case BodyShapeType.HEIGHTFIELD: {
                const heightfield = normalizeHeightfieldShape(collisionShape);
                return {
                    type: BodyShapeType.HEIGHTFIELD,
                    shape: createRapierHeightfieldShape(heightfield),
                };
            }
        }
        throw new Error(`RapierPhysicsEngine.createSharedShape: unhandled collision shape type ${(collisionShape as {type: string}).type}`);
    }

    private createConvexHullShape({ vertices }: Omit<ConvexHullShape, 'type'>): Rapier.Shape | null {
        // We defend against bad input here because Rapier's hull
        // machinery handles it poorly:
        //   - `new Rapier.ConvexPolyhedron(points)` defers the hull
        //     computation to `intoRaw()`.
        //   - `Rapier.ColliderDesc.convexHull(points)` is documented as
        //     returning `null` on failure, but its actual implementation
        //     just wraps a ConvexPolyhedron and always returns a
        //     truthy ColliderDesc — the hull isn't computed until
        //     `intoRaw()` runs either.
        //   - When the hull computation fails (NaN vertices, fewer than
        //     4 unique points, all coplanar, etc.), `intoRaw()` returns
        //     `undefined`. Rapier passes that `undefined` to its
        //     wasm-bindgen instance check inside `createCollider`,
        //     which throws "expected instance of OA" with no indication
        //     of which shape is at fault.
        //
        // Defense in two parts:
        //   1. Reject obviously-bad input (non-finite, too few points).
        //   2. Probe `intoRaw()` so we catch degenerate-but-finite
        //      point sets (coplanar, collinear) before they reach
        //      createCollider.
        if (vertices.length < 12) {
            console.warn("RapierPhysicsEngine.createConvexHullShape: fewer than 4 points, cannot form convex hull");
            return null;
        }
        for (let i = 0; i < vertices.length; i++) {
            if (!Number.isFinite(vertices[i]!)) {
                console.warn("RapierPhysicsEngine.createConvexHullShape: non-finite vertex coordinate, skipping");
                return null;
            }
        }

        // TODO: Modify ConvexHullShape to use typed arrays to avoid this
        // conversion.
        const shape = new Rapier.ConvexPolyhedron(new Float32Array(vertices));
        const rawShape = shape.intoRaw();
        if (!rawShape) {
            console.warn("RapierPhysicsEngine.createConvexHullShape: hull computation failed (degenerate point set?)");
            return null;
        }
        rawShape.free();
        return shape;
    }

    private createConcaveHullShape(
        { vertices, indexes }: Omit<ConcaveHullShape, 'type'>,
    ): Rapier.Shape | null {
        // TODO: Modify ConcaveHullShape to use a single set of vertices and
        // indexes, and to use typed arrays to avoid this conversion.
        const indexLength = indexes.reduce((sum, index) => sum + index.length, 0);
        if (indexLength === 0) {
            return null;
        }

        const vertexLength = vertices.reduce((sum, verts) => sum + verts.length, 0);
        const totalVertexCount = vertexLength / 3;
        if (totalVertexCount < 3) {
            return null;
        }

        const indexArray = new Uint32Array(indexLength);
        const vertexArray = new Float32Array(vertexLength);

        let floatOffset = 0;
        for (let i = 0; i < vertices.length; i++) {
            const sub = vertices[i]!;
            for (let j = 0; j < sub.length; j++) {
                if (!Number.isFinite(sub[j]!)) {
                    console.warn("RapierPhysicsEngine.createConcaveHullShape: non-finite vertex coordinate, skipping");
                    return null;
                }
            }
            vertexArray.set(sub, floatOffset);
            floatOffset += sub.length;
        }

        // Indices reference vertex triplets in the flat vertex array, so
        // per-sub-mesh offsets must be the running vertex count
        // (floats / 3), cumulative across all preceding sub-meshes.
        let cumulativeVertexCount = 0;
        let idxOut = 0;
        for (let i = 0; i < indexes.length; i++) {
            const subIndexes = indexes[i]!;
            const subVertexCount = vertices[i]!.length / 3;
            for (let j = 0; j < subIndexes.length; j++, idxOut++) {
                const localIdx = subIndexes[j]!;
                // Reject out-of-bounds indices — Rapier's TriMesh
                // constructor wasm-traps with `RuntimeError: unreachable`
                // rather than returning an error.
                if (localIdx < 0 || localIdx >= subVertexCount) {
                    console.warn("RapierPhysicsEngine.createConcaveHullShape: index out of bounds for sub-mesh, skipping");
                    return null;
                }
                indexArray[idxOut] = localIdx + cumulativeVertexCount;
            }
            cumulativeVertexCount += subVertexCount;
        }

        return new Rapier.TriMesh(vertexArray, indexArray);
    }

    private dispatchCollisionEvent(
        handle1: number,
        handle2: number,
        started: boolean,
        onCollision: CollisionCallback,
        contactPoint?: { x: number; y: number; z: number },
        contactNormal?: { x: number; y: number; z: number },
    ): void {
        const collider1 = this.world.getCollider(handle1);
        const collider2 = this.world.getCollider(handle2);
        const uuid1 = this.colliderHandleToOwnerMap.get(handle1);
        const uuid2 = this.colliderHandleToOwnerMap.get(handle2);

        if (!uuid1 || !uuid2 || !collider1 || !collider2) {
            return;
        }

        onCollision({
            uuid1,
            uuid2,
            type1: this.rigidBodies.has(uuid1) ? "rigidBody" : "characterController",
            type2: this.rigidBodies.has(uuid2) ? "rigidBody" : "characterController",
            group1: collider1.collisionGroups() >> 16 & 0xffff,
            group2: collider2.collisionGroups() >> 16 & 0xffff,
            started,
            contactPoint,
            contactNormal,
        });
    }

    private simulateCharacterController(
        controller: Controller,
        deltaTime: number,
        collisions?: Map<string, ControllerCollision>,
    ): void {
        if (!controller.collider) {
            return;
        }

        controller.internalVerticalVelocity += controller.gravity * deltaTime;

        // effectiveY combines caller-supplied walkVelocity.y (platform
        // carry, etc.) with the engine-owned gravity/jump/impulse term.
        const effectiveX = controller.walkVelocity.x;
        const effectiveY = controller.walkVelocity.y + controller.internalVerticalVelocity;
        const effectiveZ = controller.walkVelocity.z;

        // Rapier's snap-to-ground kicks in whenever the character ends
        // a step within the snap distance of a surface below. During a
        // jump the character is within that distance but genuinely
        // rising, so we have to disable snap during upward motion to
        // avoid the jump being canceled on the first frame.
        if (effectiveY > 0) {
            controller.controller.disableSnapToGround();
        } else {
            controller.controller.enableSnapToGround(DEFAULT_CHARACTER_CONTROLLER_SNAP_DISTANCE);
        }

        const translationDelta = {
            x: effectiveX * deltaTime,
            y: effectiveY * deltaTime,
            z: effectiveZ * deltaTime,
        };

        // If the collider is a sensor, the character shouldn't respond to any
        // collisions, so skip calling computeColliderMovement().
        let correctedDelta = translationDelta;
        if (!controller.collider?.isSensor()) {
            controller.controller.computeColliderMovement(controller.collider, translationDelta);
            correctedDelta = controller.controller.computedMovement();
        }

        const currentPosition = controller.collider.translation();
        const newPosition = {
            x: currentPosition.x + correctedDelta.x,
            y: currentPosition.y + correctedDelta.y,
            z: currentPosition.z + correctedDelta.z,
        };

        controller.collider.setTranslation(newPosition);
        controller.isGrounded = controller.controller.computedGrounded();

        // Clamp engine-owned vertical velocity DOWN toward what actually
        // happened — only shrinking, never growing. Catches the ceiling
        // case (we requested upward motion, the engine blocked it — drop
        // the residual so the character doesn't rocket up later). Does
        // not touch falling, resting, or penetration-correction cases
        // where the engine moved us more than requested.
        const actualVy = correctedDelta.y / deltaTime;
        const actualInternalVy = actualVy - controller.walkVelocity.y;
        if (controller.internalVerticalVelocity > actualInternalVy) {
            controller.internalVerticalVelocity = actualInternalVy;
        }

        // Reset engine-owned vertical velocity on landing.
        if (controller.isGrounded && controller.internalVerticalVelocity <= 0) {
            controller.internalVerticalVelocity = 0;
            controller.isJumping = false;
        }

        // Interpolate the linear velocity to avoid sudden jumps due to the
        // character controller's collision resolution.
        controller.linearVelocity.x = correctedDelta.x / deltaTime;
        controller.linearVelocity.y = correctedDelta.y / deltaTime;
        controller.linearVelocity.z = correctedDelta.z / deltaTime;

        // Snap the linear velocity to zero when it is close. Otherwise, code
        // that checks for zero velocity (e.g., landing after a jump) may take a
        // long time to converge, or may not work if minor corrections are made
        // to the character controller's position (e.g., to prevent it from
        // falling through the floor).
        if (Math.abs(controller.linearVelocity.x) < LINEAR_VELOCITY_SNAP_THRESHOLD) {
            controller.linearVelocity.x = 0;
        }

        if (Math.abs(controller.linearVelocity.y) < LINEAR_VELOCITY_SNAP_THRESHOLD) {
            controller.linearVelocity.y = 0;
        }

        if (Math.abs(controller.linearVelocity.z) < LINEAR_VELOCITY_SNAP_THRESHOLD) {
            controller.linearVelocity.z = 0;
        }

        // Track controller collisions
        if (collisions) {
            const controllerColliderHandle = controller.collider.handle;

            for (let i = 0; i < controller.controller.numComputedCollisions(); ++i) {
                const collision = controller.controller.computedCollision(i);
                if (!collision?.collider) {
                    continue;
                }

                const key = controllerColliderHandle < collision.collider.handle
                    ? `${controllerColliderHandle}-${collision.collider.handle}`
                    : `${collision.collider.handle}-${controllerColliderHandle}`;

                // Extract contact point and normal from the character collision
                const contactPoint = collision.witness1
                    ? { x: collision.witness1.x, y: collision.witness1.y, z: collision.witness1.z }
                    : undefined;
                const contactNormal = collision.normal1
                    ? { x: collision.normal1.x, y: collision.normal1.y, z: collision.normal1.z }
                    : undefined;

                collisions.set(key, {
                    controllerColliderHandle: controller.collider.handle,
                    colliderHandle: collision.collider.handle,
                    contactPoint,
                    contactNormal,
                });
            }
        }
    }
}

/**
 * Rotate a vector by a quaternion (no Three.js dependency)
 * @param q
 * @param vx
 * @param vy
 * @param vz
 */
function quatRotateVec(
    q: QuaternionLike,
    vx: number, vy: number, vz: number,
): { x: number; y: number; z: number } {
    const ix = q.w * vx + q.y * vz - q.z * vy;
    const iy = q.w * vy + q.z * vx - q.x * vz;
    const iz = q.w * vz + q.x * vy - q.y * vx;
    const iw = -q.x * vx - q.y * vy - q.z * vz;
    return {
        x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
        y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
        z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
    };
}

/**
 * Create a quaternion from an axis-angle rotation
 * @param ax
 * @param ay
 * @param az
 * @param angle
 */
function quatFromAxisAngle(
    ax: number, ay: number, az: number, angle: number,
): QuaternionLike {
    const halfAngle = angle * 0.5;
    const s = Math.sin(halfAngle);
    return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(halfAngle) };
}

/**
 * Multiply two quaternions
 * @param a
 * @param b
 */
function quatMultiply(a: QuaternionLike, b: QuaternionLike): QuaternionLike {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}

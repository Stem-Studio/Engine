import { isNumber, isObject } from 'lodash';
import {
    BufferAttribute,
    BufferGeometry,
    DynamicDrawUsage,
    LineBasicMaterial,
    LineSegments,
    Object3D,
    type QuaternionLike,
    type Vector3Like,
} from "three";

import type Ammo from "ammo";
import {
    AmmoDebugConstants,
    AmmoDebugDrawer,
    DefaultBufferSize,
} from "../../assets/js/ammo-debug-drawer/AmmoDebugDrawer";
import MathUtils from '../common/math';
import { ShapeCache } from '../common/ShapeCache';
import {normalizeHeightfieldShape} from '../common/heightfield';
import {
    BodyShapeType,
    BoxShape,
    CapsuleShape,
    CollisionBehavior,
    CollisionShape,
    ConcaveHullShape,
    ConvexHullShape,
    FixedJointOptions,
    HingeJointOptions,
    PointToPointJointOptions,
    SphereShape,
    HeightfieldShape,
    PhysicsDebugRenderData,
    VehicleData,
    VehicleInput,
    VehicleOptions,
} from "../common/types";
import {
    CollisionCallback,
    DEFAULT_CHARACTER_CONTROLLER_COLLISION_GROUP,
    DEFAULT_CHARACTER_CONTROLLER_COLLISION_MASK,
    DEFAULT_CHARACTER_CONTROLLER_MAX_SLOPE,
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
import {
    DEFAULT_SOLVER_ITERATIONS,
    isConcaveHullBodyTypeSupported,
    normalizeSolverIterations,
} from '../common/physicsConfig';

const DEG_TO_RAD = Math.PI / 180;

interface SharedConvexHullShape {
    type: BodyShapeType.CONVEX_HULL;
    ammoShape: Ammo.btConvexHullShape;
    resources: undefined;
}

interface SharedConcaveHullShape {
    type: BodyShapeType.CONCAVE_HULL;
    /** Invalid/empty mesh input retains its concave type for body policy checks. */
    ammoShape: Ammo.btBvhTriangleMeshShape | undefined;
    resources: [Ammo.btTriangleMesh] | undefined;
}

interface SharedHeightfieldShape extends HeightfieldShape {
    type: BodyShapeType.HEIGHTFIELD;
}

interface EmptyShape {
    type: 'empty';
    ammoShape: undefined;
    resources: undefined;
}

type PrimitiveShape = (BoxShape | SphereShape | CapsuleShape) & {
    ammoShape: undefined;
    resources: undefined;
};

type SharedShape = PrimitiveShape | SharedConvexHullShape | SharedConcaveHullShape | SharedHeightfieldShape | EmptyShape;

interface Controller {
    controller: Ammo.btKinematicCharacterController;
    readonly walkVelocity: { x: number; y: number; z: number };
    // Derived per-second velocity, computed from position deltas across
    // simulate steps. Exposes the vertical component that Bullet's
    // internal m_verticalVelocity contributes (via stepDown under its
    // own gravity) — `controller.getLinearVelocity()` only returns
    // m_walkDirection so we compute it ourselves.
    lastPosition: { x: number; y: number; z: number };
    lastVelocity: { x: number; y: number; z: number };
}

interface ContactPair {
    uuid1: string;
    uuid2: string;
    contactPoint?: { x: number; y: number; z: number };
    contactNormal?: { x: number; y: number; z: number };
}

// Ammo constants
const CHARACTER_COLLISION_FLAG = 16;

const ACTIVATION_STATE = { DISABLE_DEACTIVATION: 4 };

enum AmmoCollisionFlag {
    CF_STATIC_OBJECT = 1,
    CF_KINEMATIC_OBJECT = 2,
    CF_NO_CONTACT_RESPONSE = 4,
    CF_CUSTOM_MATERIAL_CALLBACK = 8,
    CF_CHARACTER_OBJECT = 16,
    CF_DISABLE_VISUALIZE_OBJECT = 32,
    CF_DISABLE_SPU_COLLISION_PROCESSING = 64,
    CF_HAS_CONTACT_STIFFNESS_DAMPING = 128,
    CF_HAS_CUSTOM_DEBUG_RENDERING_COLOR = 256,
    CF_HAS_FRICTION_ANCHOR = 512,
    CF_HAS_COLLISION_SOUND_TRIGGER = 1024,
}

const RIGID_BODY_TYPE_MAP = {
    [RigidBodyType.Static]: AmmoCollisionFlag.CF_STATIC_OBJECT,
    [RigidBodyType.Dynamic]: 0,
    [RigidBodyType.Kinematic]: AmmoCollisionFlag.CF_KINEMATIC_OBJECT,
} as const;

/**
 * An implementation of {@link PhysicsEngine} that uses Ammo.js.
 */
type VehicleEntry = {
    vehicle: Ammo.btRaycastVehicle;
    chassisBody: Ammo.btRigidBody;
    compoundShape: Ammo.btCompoundShape;
    boxShape: Ammo.btBoxShape;
    wheelCount: number;
    frontWheelIndices: number[];
    driveWheelIndices: number[];
    options: VehicleOptions;
};

export class AmmoPhysicsEngine implements PhysicsEngine {
    stepDuration = DEFAULT_STEP_DURATION;

    private readonly rigidBodies = new Map<string, Ammo.btRigidBody>();
    private readonly dampingValues = new Map<string, { linear: number; angular: number }>();
    private readonly userPointerToUuidMap = new Map<number, string>();
    private readonly vehicles = new Map<string, VehicleEntry>();
    private readonly constraints = new Set<Ammo.btTypedConstraint>();
    private readonly jointMap = new Map<string, Ammo.btTypedConstraint>();
    /** Vehicle helpers are world-scoped and intentionally shared by vehicles. */
    private readonly vehicleTuning: Ammo.btVehicleTuning;
    private readonly vehicleRayCaster: Ammo.btDefaultVehicleRaycaster;
    private nextUserPointer = 1;

    private readonly shapeCache = new ShapeCache<SharedShape>((sharedShape) => {
        if ('ammoShape' in sharedShape && sharedShape.ammoShape) {
            this.ammo.destroy(sharedShape.ammoShape);
        }

        if ('resources' in sharedShape) {
            for (const resource of sharedShape.resources || []) {
                this.ammo.destroy(resource);
            }
        }
    });

    /** Collision object (body or controller) UUID to Shape UUID */
    private readonly collisionObjectToShapeMap = new Map<string, string>();
    /** Heap buffers owned by per-body Bullet heightfield shape instances. */
    private readonly heightfieldDataPointers = new WeakMap<object, number>();
    /**
     * Bullet centers heightfield vertices around (min+max)/2, whereas the
     * shared/Rapier contract treats samples as authored world-space heights.
     * Keep the internal body translation hidden from callers.
     */
    private readonly heightfieldBodyOriginOffsets = new Map<string, number>();

    /** A map of all current contact pairs (key is `uuid1-uuid2`) */
    private contactPairs = new Map<string, ContactPair>();
    private nextContactPairs = new Map<string, ContactPair>();

    private started = false;

    //to be destroyed
    private world: Ammo.btDiscreteDynamicsWorld;
    private collisionConfiguration: Ammo.btDefaultCollisionConfiguration;
    private collisionDispatcher: Ammo.btCollisionDispatcher;
    private broadphase: Ammo.btDbvtBroadphase;
    private solver: Ammo.btSequentialImpulseConstraintSolver;
    private ghostPairCallback: Ammo.btGhostPairCallback;
    private auxVectorA: Ammo.btVector3;
    private auxVectorB: Ammo.btVector3;
    private auxVectorC: Ammo.btVector3;
    private auxQuaternionA: Ammo.btQuaternion;
    private auxTransformA: Ammo.btTransform;
    /** Reused for synchronous controller contact probes (avoids callback-table churn). */
    private readonly contactResultCallback: Ammo.ConcreteContactResultCallback;
    private contactProbeHasPoint = false;
    private contactProbePoint: { x: number; y: number; z: number } | undefined;
    private contactProbeNormal: { x: number; y: number; z: number } | undefined;

    //debugger
    private debugGeometry: BufferGeometry | null = null;
    private debugMaterial: LineBasicMaterial | null = null;
    private debugDrawer: AmmoDebugDrawer | null = null;
    private debugMesh: LineSegments | null = null;
    private debugEnabled = false;

    //controller
    private readonly playerUuids = new Set<string>();
    private readonly controllers = new Map<string, Controller>();
    private solverIterations: number;

    constructor(
        private readonly ammo: typeof Ammo,
        private gravity: number,
        solverIterations: number = DEFAULT_SOLVER_ITERATIONS,
    ) {
        this.solverIterations = normalizeSolverIterations(solverIterations);
        this.auxVectorA = new ammo.btVector3(0, 0, 0);
        this.auxVectorB = new ammo.btVector3(0, 0, 0);
        this.auxVectorC = new ammo.btVector3(0, 0, 0);
        this.auxQuaternionA = new ammo.btQuaternion(0, 0, 0, 1);
        this.auxTransformA = new ammo.btTransform();
        
        this.collisionConfiguration = new this.ammo.btDefaultCollisionConfiguration();
        this.collisionDispatcher = new this.ammo.btCollisionDispatcher(this.collisionConfiguration);
        this.broadphase = new this.ammo.btDbvtBroadphase();
        this.ghostPairCallback = new this.ammo.btGhostPairCallback();
        this.broadphase.getOverlappingPairCache().setInternalGhostPairCallback(this.ghostPairCallback);
        this.solver = new this.ammo.btSequentialImpulseConstraintSolver();
        this.world = new this.ammo.btDiscreteDynamicsWorld(
            this.collisionDispatcher,
            this.broadphase,
            this.solver,
            this.collisionConfiguration,
        );
        this.world.getSolverInfo().set_m_numIterations(this.solverIterations);
        this.world.getDispatchInfo().set_m_allowedCcdPenetration(0.0001);

        // btRaycastVehicle copies tuning values into each wheel and keeps the
        // raycaster as a non-owning world reference. Reusing these helpers
        // avoids one native allocation per vehicle; the generated bindings do
        // not expose a destroyable btVehicleTuning destructor.
        this.vehicleTuning = new ammo.btVehicleTuning();
        this.vehicleRayCaster = new ammo.btDefaultVehicleRaycaster(this.world);

        this.contactResultCallback = new ammo.ConcreteContactResultCallback();
        (this.contactResultCallback as any).addSingleResult = (cp: number) => {
            this.contactProbeHasPoint = true;
            const wrapPointer = (this.ammo as any).wrapPointer;
            const manifoldPoint: Ammo.btManifoldPoint = wrapPointer(cp, this.ammo.btManifoldPoint);
            const posOnB = manifoldPoint.getPositionWorldOnB();
            const normalOnB = manifoldPoint.get_m_normalWorldOnB();
            this.contactProbePoint = { x: posOnB.x(), y: posOnB.y(), z: posOnB.z() };
            this.contactProbeNormal = { x: normalOnB.x(), y: normalOnB.y(), z: normalOnB.z() };
            return 0; // stop contact point detection
        };

        this.auxVectorA.setValue(0, this.gravity, 0);
        this.world.setGravity(this.auxVectorA);

        this.started = true;
    }

    setSolverIterations(solverIterations: number): void {
        this.solverIterations = normalizeSolverIterations(solverIterations);
        this.world.getSolverInfo().set_m_numIterations(this.solverIterations);
    }

    dispose() {
        if (!this.started) {
            return;
        }
        this.started = false;

        this.debugGeometry?.dispose();
        this.debugGeometry = null;
        this.debugMaterial?.dispose();
        this.debugMaterial = null;
        this.debugDrawer?.dispose();
        this.debugDrawer = null;
        this.debugMesh?.removeFromParent();
        this.debugMesh = null;
        this.debugEnabled = false;

        for (const uuid of this.vehicles.keys()) {
            this.removeVehicle(uuid);
        }

        // Constraints must come out of the world before the bodies they
        // reference are removed.
        for (const constraint of this.constraints) {
            this.world?.removeConstraint(constraint);
            this.ammo.destroy(constraint);
        }
        this.constraints.clear();
        this.jointMap.clear();

        for (const uuid of this.rigidBodies.keys()) {
            this.removeRigidBody(uuid);
        }

        for (const uuid of this.controllers.keys()) {
            this.removeCharacterController(uuid);
        }

        this.ammo.destroy(this.vehicleRayCaster);

        this.shapeCache.dispose();

        this.ammo.destroy(this.contactResultCallback);

        if (this.collisionConfiguration) {
            this.ammo.destroy(this.collisionConfiguration);
        }

        if (this.collisionDispatcher) {
            this.ammo.destroy(this.collisionDispatcher);
        }
        
        if (this.broadphase) {
            this.ammo.destroy(this.broadphase);
        }

        if (this.ghostPairCallback) {
            this.ammo.destroy(this.ghostPairCallback);
        }
        
        if (this.solver) {
            this.ammo.destroy(this.solver);
        }

        this.ammo.destroy(this.auxVectorA);
        this.ammo.destroy(this.auxVectorB);
        this.ammo.destroy(this.auxVectorC);
        this.ammo.destroy(this.auxQuaternionA);
        this.ammo.destroy(this.auxTransformA);

        // The generated Ammo bindings retain the world wrapper until the
        // dependent objects above have been released. Destroy it last so
        // repeated Playground engine lifetimes reclaim the native world.
        this.ammo.destroy(this.world);

    }

    getGravity(): number {
        return this.gravity;
    }

    simulate(onCollision?: CollisionCallback): void {
        if (!this.started) {
            return;
        }

        // Bullet's btKinematicCharacterController owns gravity
        // integration, stepUp / stepDown, maxSlope, ground detection,
        // and jump — we just feed it a per-step walk direction derived
        // from the caller's walk velocity. Capture pre-step positions so
        // we can compute an actual linear velocity after stepSimulation
        // (Bullet's getLinearVelocity only exposes walkDirection).
        for (const entry of this.controllers.values()) {
            const origin = entry.controller.getGhostObject().getWorldTransform().getOrigin();
            entry.lastPosition.x = origin.x();
            entry.lastPosition.y = origin.y();
            entry.lastPosition.z = origin.z();

            this.auxVectorA.setValue(
                entry.walkVelocity.x * this.stepDuration,
                entry.walkVelocity.y * this.stepDuration,
                entry.walkVelocity.z * this.stepDuration,
            );
            entry.controller.setWalkDirection(this.auxVectorA);
        }

        // Run physics in fixed time steps (this.stepDuration). The second
        // argument is the maximum number of substeps. Setting this to 0
        // effectively disables substepping.
        this.world.stepSimulation(this.stepDuration, 0, this.stepDuration);

        for (const entry of this.controllers.values()) {
            const origin = entry.controller.getGhostObject().getWorldTransform().getOrigin();
            entry.lastVelocity.x = (origin.x() - entry.lastPosition.x) / this.stepDuration;
            entry.lastVelocity.y = (origin.y() - entry.lastPosition.y) / this.stepDuration;
            entry.lastVelocity.z = (origin.z() - entry.lastPosition.z) / this.stepDuration;
        }

        if (onCollision) {
            this.dispatchCollisionEvents(onCollision);
        }

        if (this.debugDrawer && this.debugGeometry) {
            this.debugDrawer.update();
            if (this.debugDrawer.index !== 0) {
                this.debugGeometry.attributes.position!.needsUpdate = true;
                this.debugGeometry.attributes.color!.needsUpdate = true;
            }
            this.debugGeometry.setDrawRange(0, this.debugDrawer.index);
        }
    }

    pause() {
        this.started = false;
    }

    resume() {
        this.started = true;
    }

    getDebugRenderData(): PhysicsDebugRenderData | null {
        if (!this.debugEnabled || !this.debugDrawer || !this.debugGeometry) return null;
        const drawCount = Math.max(0, Math.floor(this.debugDrawer.index));
        const position = this.debugGeometry.getAttribute("position");
        const color = this.debugGeometry.getAttribute("color");
        if (!position || !color || drawCount === 0) return null;
        return {
            vertices: (position.array as Float32Array).slice(0, drawCount * 3),
            colors: (color.array as Float32Array).slice(0, drawCount * color.itemSize),
            drawCount,
        };
    }

    addRigidBody(
        uuid: string,
        shapeUuid: string,
        type: RigidBodyType,
        options: RigidBodyOptions = {},
    ): void {
        if (this.rigidBodies.has(uuid)) {
            console.warn("AmmoPhysics.addRigidBody: rigid body already exists", uuid);
            return;
        }

        const sharedShape = this.shapeCache.get(shapeUuid);
        if (!sharedShape) {
            console.warn("AmmoPhysics.addRigidBody: shape not found", shapeUuid);
            return;
        }

        if (!isConcaveHullBodyTypeSupported(sharedShape.type, type)) {
            console.warn(
                `AmmoPhysicsEngine.addRigidBody: rejected ${type} body "${uuid}" with concave hull/static-mesh shape "${shapeUuid}". ` +
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
        } = options;
        // Static and kinematic bodies are non-dynamic by contract. Normalize
        // their native mass to zero instead of letting a caller-supplied mass
        // allocate inertia or leave Bullet with contradictory body state.
        const effectiveMass = type === RigidBodyType.Dynamic ? mass : 0;

        const shape = this.createShapeInstance(sharedShape);

        // motionState is freed in destroyRigidBody()
        this.auxTransformA.setIdentity();
        if (options.position) {
            const heightfieldOffset = sharedShape.type === BodyShapeType.HEIGHTFIELD
                ? this.getHeightfieldBodyOriginOffset(sharedShape)
                : 0;
            this.heightfieldBodyOriginOffsets.set(uuid, heightfieldOffset);
            this.auxVectorA.setValue(
                options.position.x,
                options.position.y + heightfieldOffset,
                options.position.z,
            );
            this.auxTransformA.setOrigin(this.auxVectorA);
        } else if (sharedShape.type === BodyShapeType.HEIGHTFIELD) {
            const heightfieldOffset = this.getHeightfieldBodyOriginOffset(sharedShape);
            this.heightfieldBodyOriginOffsets.set(uuid, heightfieldOffset);
            this.auxVectorA.setValue(0, heightfieldOffset, 0);
            this.auxTransformA.setOrigin(this.auxVectorA);
        }
        if (options.quaternion) {
            this.auxQuaternionA.setValue(
                options.quaternion.x,
                options.quaternion.y,
                options.quaternion.z,
                options.quaternion.w,
            );
            this.auxTransformA.setRotation(this.auxQuaternionA);
        }
        const motionState = new this.ammo.btDefaultMotionState(this.auxTransformA);
        this.auxVectorA.setValue(0, 0, 0);
        shape.calculateLocalInertia(effectiveMass, this.auxVectorA);

        const rbInfo: Ammo.btRigidBodyConstructionInfo = new this.ammo.btRigidBodyConstructionInfo(
            effectiveMass,
            motionState,
            shape,
            this.auxVectorA,
        );
        const body: Ammo.btRigidBody = new this.ammo.btRigidBody(rbInfo);
        this.ammo.destroy(rbInfo);

        body.setCollisionFlags(RIGID_BODY_TYPE_MAP[type]);

        if (type === RigidBodyType.Kinematic || (mass > 0 && options.allowSleep === false)) {
            // Kinematic bodies must stay active or Bullet skips
            // saveKinematicState for them, breaking motion-state sync.
            // Dynamic bodies opt into Bullet's normal deactivation path by
            // default; callers can explicitly keep a dynamic body awake for
            // continuously driven gameplay objects.
            body.setActivationState(ACTIVATION_STATE.DISABLE_DEACTIVATION);
        }
        body.setFriction(friction);
        body.setRestitution(restitution);
        body.setDamping(linearDamping, angularDamping);
        if (options.ccd === true && type === RigidBodyType.Dynamic) {
            const ccdMotionThreshold = Number.isFinite(options.ccdMotionThreshold)
                ? Math.max(0, options.ccdMotionThreshold as number)
                : DEFAULT_RIGID_BODY_CCD_MOTION_THRESHOLD;
            const ccdSweptSphereRadius = Number.isFinite(options.ccdSweptSphereRadius)
                ? Math.max(0, options.ccdSweptSphereRadius as number)
                : DEFAULT_RIGID_BODY_CCD_SWEPT_SPHERE_RADIUS;
            body.setCcdMotionThreshold(
                ccdMotionThreshold,
            );
            body.setCcdSweptSphereRadius(
                ccdSweptSphereRadius,
            );
        }
        this.dampingValues.set(uuid, { linear: linearDamping, angular: angularDamping });

        // storing uuid for future reference
        this.setCollisionObjectUuid(body, uuid);

        this.shapeCache.retain(shapeUuid);
        this.collisionObjectToShapeMap.set(uuid, shapeUuid);

        this.world.addRigidBody(
            body,
            options.collisionGroup ?? DEFAULT_RIGID_BODY_COLLISION_GROUP,
            options.collisionMask ?? DEFAULT_RIGID_BODY_COLLISION_MASK,
        );

        this.rigidBodies.set(uuid, body);
    }

    removeRigidBody(uuid: string): void {
        const body = this.rigidBodies.get(uuid);
        if (!body) {
            console.warn("AmmoPhysics.remove: rigid body not found", uuid);
            return;
        }

        // Constraints reference native bodies. Remove our owned constraints
        // before Bullet tears the body down so replacement and later disposal
        // never retain a dangling btTypedConstraint handle.
        this.removeJointsForBody(uuid);

        this.world.removeRigidBody(body);
        this.rigidBodies.delete(uuid);
        this.heightfieldBodyOriginOffsets.delete(uuid);
        this.dampingValues.delete(uuid);
        this.destroyRigidBody(uuid, body);
    }

    hasRigidBody(uuid: string): boolean {
        return this.rigidBodies.has(uuid);
    }

    rigidBodyUuids(): IterableIterator<string> {
        return this.rigidBodies.keys();
    }

    // Resolves a uuid to its rigid body, falling back to the vehicle's
       // chassis. Vehicles register their chassis in `this.vehicles` only,
       // not in `this.rigidBodies`, so methods that mutate body state would
       // otherwise refuse to operate on a vehicle.
       private getRigidBody(uuid: string): Ammo.btRigidBody | null {
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

    applyForceToRigidBody(uuid: string, force: Vector3Like, relativePosition: Vector3Like) {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.applyForce: rigid body not found", uuid);
            return;
        }

        this.auxVectorA.setValue(force.x, force.y, force.z);
        this.auxVectorB.setValue(relativePosition.x, relativePosition.y, relativePosition.z);
        body.applyForce(this.auxVectorA, this.auxVectorB);
    }

    applyImpulseToRigidBody(uuid: string, impulse: Vector3Like, relativePosition?: Vector3Like) {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.applyCentralImpulse: rigid body not found", uuid);
            return;
        }

        this.auxVectorA.setValue(impulse.x, impulse.y, impulse.z);
        if (relativePosition === undefined) {
            body.applyCentralImpulse(this.auxVectorA);
        } else {
            this.auxVectorB.setValue(relativePosition.x, relativePosition.y, relativePosition.z);
            body.applyImpulse(this.auxVectorA, this.auxVectorB);
        }
    }

    getRigidBodyLinearVelocity(uuid: string): Vector3Like | null {
        const body = this.getRigidBody(uuid);
        if (!body) {
            return null;
        }

        const velocity = body.getLinearVelocity();
        return { x: velocity.x(), y: velocity.y(), z: velocity.z() };
    }

    getRigidBodyAngularVelocity(uuid: string): Vector3Like | null {
        const body = this.getRigidBody(uuid);
        if (!body) {
            return null;
        }

        const velocity = body.getAngularVelocity();
        return { x: velocity.x(), y: velocity.y(), z: velocity.z() };
    }

    setRigidBodyLinearDamping(uuid: string, damping: number): void {
        const body = this.rigidBodies.get(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.setRigidBodyLinearDamping: rigid body not found", uuid);
            return;
        }

        const current = this.dampingValues.get(uuid) || { linear: 0, angular: 0 };
        current.linear = damping;
        this.dampingValues.set(uuid, current);
        body.setDamping(damping, current.angular);
    }

    setRigidBodyAngularDamping(uuid: string, damping: number): void {
        const body = this.rigidBodies.get(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.setRigidBodyAngularDamping: rigid body not found", uuid);
            return;
        }

        const current = this.dampingValues.get(uuid) || { linear: 0, angular: 0 };
        current.angular = damping;
        this.dampingValues.set(uuid, current);
        body.setDamping(current.linear, damping);
    }

    getRigidBodyPosition(uuid: string): Vector3Like | null {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.getRigidBodyPosition: rigid body not found", uuid);
            return null;
        }

        const position = body.getWorldTransform().getOrigin();
        const heightfieldOffset = this.heightfieldBodyOriginOffsets.get(uuid) ?? 0;
        return {
            x: position.x(),
            y: position.y() - heightfieldOffset,
            z: position.z(),
        };
    }

    getRigidBodyRotation(uuid: string): QuaternionLike | null {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.getRigidBodyRotation: rigid body not found", uuid);
            return null;
        }

        const rotation = body.getWorldTransform().getRotation();
        return {
            x: rotation.x(),
            y: rotation.y(),
            z: rotation.z(),
            w: rotation.w(),
        };
    }

    getRigidBodyShapeUuid(uuid: string): string | null {
        if (!this.hasRigidBody(uuid)) {
            return null;
        }

        return this.collisionObjectToShapeMap.get(uuid) || null;
    }

    getRigidBodyType(uuid: string): RigidBodyType | null {
        const body = this.rigidBodies.get(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.getRigidBodyType: rigid body not found", uuid);
            return null;
        }

        const collisionFlags = body.getCollisionFlags();
        if (collisionFlags & AmmoCollisionFlag.CF_KINEMATIC_OBJECT) {
            return RigidBodyType.Kinematic;
        } else if (collisionFlags & AmmoCollisionFlag.CF_STATIC_OBJECT) {
            return RigidBodyType.Static;
        }
        return RigidBodyType.Dynamic;
    }

    setRigidBodyCollisionBehavior(uuid: string, behavior: CollisionBehavior): void {
        const body = this.rigidBodies.get(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.setRigidBodyCollisionBehavior: rigid body not found", uuid);
            return;
        }

        switch (behavior) {
            case CollisionBehavior.Ghost:
                body.setCollisionFlags(body.getCollisionFlags() | AmmoCollisionFlag.CF_NO_CONTACT_RESPONSE);
                break;
            
            case CollisionBehavior.Regular:
                body.setCollisionFlags(body.getCollisionFlags() & ~AmmoCollisionFlag.CF_NO_CONTACT_RESPONSE);
                break;
        }
    }

    setRigidBodyCollisionMasks(uuid: string, collisionGroup: number, collisionMask: number): void {
        const body = this.rigidBodies.get(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.setRigidBodyCollisionMasks: rigid body not found", uuid);
            return;
        }

        this.world.removeRigidBody(body);
        this.world.addRigidBody(body, collisionGroup & 0xffff, collisionMask & 0xffff);
    }

    setRigidBodyAngularVelocity(uuid: string, velocity: Vector3Like) {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.setRigidBodyAngularVelocity: rigid body not found", uuid);
            return;
        }

        this.auxVectorA.setValue(velocity.x, velocity.y, velocity.z);
        body.setAngularVelocity(this.auxVectorA);
    }

    setRigidBodyLinearVelocity(uuid: string, velocity: Vector3Like) {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.setRigidBodyLinearVelocity: rigid body not found", uuid);
            return;
        }

        this.auxVectorA.setValue(velocity.x, velocity.y, velocity.z);
        body.setLinearVelocity(this.auxVectorA);

        // TODO: remove this special case for capsule
        const sharedShape = this.shapeCache.get(uuid);
        if (body && sharedShape?.type === BodyShapeType.CAPSULE) {
            this.auxVectorA.setValue(0, 0, 0);
            body.setAngularFactor(this.auxVectorA);
        }
    }

    setRigidBodyPosition(uuid: string, position: Vector3Like) {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.setRigidBodyPosition: rigid body not found", uuid);
            return;
        }

        const worldTransform = body.getWorldTransform();
        const heightfieldOffset = this.heightfieldBodyOriginOffsets.get(uuid) ?? 0;
        this.auxVectorA.setValue(position.x, position.y + heightfieldOffset, position.z);
        worldTransform.setOrigin(this.auxVectorA);
        // Kinematic bodies are driven from the motion state: Bullet reads it
        // in saveKinematicState() at the start of each stepSimulation and
        // overwrites body.m_worldTransform from it. Writing the motion state
        // too ensures the move survives the next step. For dynamic bodies it's
        // harmless — synchronizeSingleMotionState rewrites the motion state
        // from the integrated body transform at the end of the step anyway.
        body.getMotionState()?.setWorldTransform(worldTransform);
    }

    setRigidBodyRotation(uuid: string, quaternion: QuaternionLike) {
        const body = this.getRigidBody(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.setRigidBodyRotation: rigid body not found", uuid);
            return;
        }

        const worldTransform = body.getWorldTransform();
        this.auxQuaternionA.setValue(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
        worldTransform.setRotation(this.auxQuaternionA);
        body.getMotionState()?.setWorldTransform(worldTransform);
    }


    setRigidBodyRotationLock(uuid: string, lock: { x: boolean; y: boolean; z: boolean }): void {
        const body = this.rigidBodies.get(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.setRigidBodyRotationLock: rigid body not found", uuid);
            return;
        }

        this.auxVectorA.setValue(lock.x ? 0 : 1, lock.y ? 0 : 1, lock.z ? 0 : 1);
        body.setAngularFactor(this.auxVectorA);
    }

    setRigidBodyScale(uuid: string, scale: Vector3Like): void {
        const rigidBody = this.rigidBodies.get(uuid);
        if (!rigidBody) {
            console.warn("AmmoPhysicsEngine.setRigidBodyScale: object not found", uuid);
            return;
        }

        const collisionShape = rigidBody.getCollisionShape();
        if (!collisionShape) {
            console.warn("AmmoPhysicsEngine.setRigidBodyScale: no collision shape found", uuid);
            return;
        }

        // Get the shared shape to check if it's a capsule
        const shapeUuid = this.collisionObjectToShapeMap.get(uuid);
        const sharedShape = shapeUuid ? this.shapeCache.get(shapeUuid) : null;

        // Apply the new scale (with capsule adjustment if needed)
        if (sharedShape?.type === BodyShapeType.CAPSULE) {
            const adjustedScale = MathUtils.computeCapsuleScale(
                sharedShape.radius,
                sharedShape.height,
                scale,
            );
            this.auxVectorA.setValue(adjustedScale.x, adjustedScale.y, adjustedScale.z);
        } else {
            this.auxVectorA.setValue(scale.x, scale.y, scale.z);
        }
        collisionShape.setLocalScaling(this.auxVectorA);

        // Recalculate inertia for dynamic bodies
        const mass = 1.0 / rigidBody.getInvMass();
        if (mass > 0) {
            this.auxVectorA.setValue(0, 0, 0);
            collisionShape.calculateLocalInertia(mass, this.auxVectorA);
            rigidBody.setMassProps(mass, this.auxVectorA);
        }

        // Wake up the body so it responds to the new scale
        rigidBody.activate(true);
    }

    setRigidBodyShape(uuid: string, newShapeUuid: string): void {
        const body = this.rigidBodies.get(uuid);
        if (!body) {
            console.warn("AmmoPhysicsEngine.setRigidBodyShape: rigid body not found", uuid);
            return;
        }

        const newSharedShape = this.shapeCache.get(newShapeUuid);
        if (!newSharedShape) {
            console.warn("AmmoPhysicsEngine.setRigidBodyShape: shape not found", newShapeUuid);
            return;
        }

        if (!isConcaveHullBodyTypeSupported(newSharedShape.type, this.getRigidBodyType(uuid))) {
            console.warn(
                `AmmoPhysicsEngine.setRigidBodyShape: rejected concave hull/static-mesh shape "${newShapeUuid}" for ${this.getRigidBodyType(uuid)} body "${uuid}". ` +
                "Ammo/Rapier support concave and heightfield shapes only for Static bodies; use a ConvexHull or compound primitive colliders.",
            );
            return;
        }

        // Get the old shape for cleanup
        const oldShape = body.getCollisionShape();
        const oldShapeUuid = this.collisionObjectToShapeMap.get(uuid);

        // Create new shape instance
        const newShape = this.createShapeInstance(newSharedShape);

        // Get the mass to recalculate inertia
        const mass = 1.0 / body.getInvMass();

        // Recalculate local inertia for dynamic bodies
        if (mass > 0) {
            this.auxVectorA.setValue(0, 0, 0);
            newShape.calculateLocalInertia(mass, this.auxVectorA);
            body.setMassProps(mass, this.auxVectorA);
        }

        // Preserve collision properties before removing from world
        const broadphaseHandle = body.getBroadphaseHandle();
        const collisionGroup = broadphaseHandle.get_m_collisionFilterGroup();
        const collisionMask = broadphaseHandle.get_m_collisionFilterMask();

        // Remove body from world before changing shape
        this.world.removeRigidBody(body);

        // Set the new collision shape
        body.setCollisionShape(newShape);

        // Re-add body to world with preserved collision group and mask
        this.world.addRigidBody(body, collisionGroup, collisionMask);

        // Wake up the body so it responds to the new shape
        body.activate(true);

        // Destroy the old shape instance
        if (oldShape) {
            this.destroyShapeInstance(oldShape);
        }

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
            console.warn("AmmoPhysicsEngine.addShape: shape already exists", uuid);
            return;
        }

        const sharedShape = this.createSharedShape(collisionShape);
        this.shapeCache.add(uuid, sharedShape);
    }

    removeShape(uuid: string) {
        if (!this.shapeCache.hasShape(uuid)) {
            console.warn("AmmoPhysicsEngine.removeShape: shape not found", uuid);
            return;
        }

        this.shapeCache.remove(uuid);
    }

    hasShape(uuid: string) {
        return this.shapeCache.hasShape(uuid);
    }

    addCharacterController(uuid: string, shapeUuid: string): void {
        if (this.controllers.has(uuid)) {
            console.warn("AmmoPhysicsEngine.addCharacterController: controller already exists", uuid);
            return;
        }

        const sharedShape = this.shapeCache.get(shapeUuid);
        if (!sharedShape) {
            console.warn("AmmoPhysicsEngine.addCharacterController: failed to find shape", shapeUuid);
            return;
        }

        if (!isConcaveHullBodyTypeSupported(sharedShape.type, RigidBodyType.Kinematic)) {
            console.warn(
                `AmmoPhysicsEngine.addCharacterController: rejected concave hull shape "${shapeUuid}" for controller "${uuid}". ` +
                "Ammo/Rapier support concave hulls only for Static colliders; use a capsule, convex hull, or primitive collider.",
            );
            return;
        }

        const collisionShape = this.createShapeInstance(sharedShape);
        this.shapeCache.retain(shapeUuid);

        const ghostObject = new this.ammo.btPairCachingGhostObject();
        ghostObject.setCollisionShape(collisionShape);
        ghostObject.setCollisionFlags(CHARACTER_COLLISION_FLAG);
        ghostObject.setActivationState(ACTIVATION_STATE.DISABLE_DEACTIVATION);
        ghostObject.activate(true);
        ghostObject
            .getWorldTransform()
            .getBasis()
            .setEulerZYX(Math.PI / 2, 0, 0); //sync ghost obj rotation with the model
        
        this.auxVectorA.setValue(0, 1, 0);
        const controller = new this.ammo.btKinematicCharacterController(
            ghostObject,
            ghostObject.getCollisionShape(),
            DEFAULT_CHARACTER_CONTROLLER_STEP_HEIGHT,
            this.auxVectorA,
        );

        // Use Bullet's native gravity/jump/onGround machinery. Default
        // to world gravity; callers override via
        // `setCharacterControllerGravity`.
        this.auxVectorA.setValue(0, this.gravity, 0);
        controller.setGravity(this.auxVectorA);
        controller.setMaxPenetrationDepth(0.0);
        controller.setMaxSlope(DEFAULT_CHARACTER_CONTROLLER_MAX_SLOPE);
        controller.setUseGhostSweepTest(false);

        //add controller objects to the world
        this.world.addCollisionObject(
            ghostObject,
            DEFAULT_CHARACTER_CONTROLLER_COLLISION_GROUP,
            DEFAULT_CHARACTER_CONTROLLER_COLLISION_MASK,
        );
        this.world.addAction(controller);

        this.controllers.set(uuid, {
            controller,
            walkVelocity: { x: 0, y: 0, z: 0 },
            lastPosition: { x: 0, y: 0, z: 0 },
            lastVelocity: { x: 0, y: 0, z: 0 },
        });
        this.setCollisionObjectUuid(ghostObject, uuid);
        this.collisionObjectToShapeMap.set(uuid, shapeUuid);
    }

    removeCharacterController(uuid: string) {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("AmmoPhysicsEngine.removeCharacterController: controller does not exist", uuid);
            return;
        }

        this.playerUuids.delete(uuid);

        this.world.removeAction(controller.controller);
        this.world.removeCollisionObject(controller.controller.getGhostObject());
        this.destroyCharacterController(uuid, controller.controller);
        this.controllers.delete(uuid);
    }

    hasCharacterController(uuid: string): boolean {
        return this.controllers.has(uuid);
    }

    characterControllerUuids(): IterableIterator<string> {
        return this.controllers.keys();
    }

    getCharacterControllerLinearVelocity(uuid: string): Vector3Like | null {
        const entry = this.controllers.get(uuid);
        if (!entry) {
            console.warn("AmmoPhysicsEngine.getCharacterControllerLinearVelocity: controller does not exist", uuid);
            return null;
        }
        return { ...entry.lastVelocity };
    }

    getCharacterControllerPosition(uuid: string): Vector3Like | null {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("AmmoPhysicsEngine.getCharacterControllerPosition: controller does not exist", uuid);
            return null;
        }

        const transform = controller.controller.getGhostObject().getWorldTransform();
        return {
            x: transform.getOrigin().x(),
            y: transform.getOrigin().y(),
            z: transform.getOrigin().z(),
        };
    }

    getCharacterControllerRotation(uuid: string): QuaternionLike | null {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("AmmoPhysicsEngine.getCharacterControllerRotation: controller does not exist", uuid);
            return null;
        }

        const transform = controller.controller.getGhostObject().getWorldTransform();
        return {
            x: transform.getRotation().x(),
            y: transform.getRotation().y(),
            z: transform.getRotation().z(),
            w: transform.getRotation().w(),
        };
    }

    isCharacterControllerOnGround(uuid: string): boolean {
        const entry = this.controllers.get(uuid);
        if (!entry) {
            console.warn("AmmoPhysicsEngine.isCharacterControllerOnGround: controller does not exist", uuid);
            return false;
        }

        return entry.controller.onGround();
    }

    setCharacterControllerCollisionBehavior(uuid: string, behavior: CollisionBehavior): void {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("AmmoPhysicsEngine.setCharacterControllerCollisionBehavior: controller does not exist", uuid);
            return;
        }

        const ghostObject = controller.controller.getGhostObject();

        switch (behavior) {
            case CollisionBehavior.Ghost:
                ghostObject.setCollisionFlags(ghostObject.getCollisionFlags() | AmmoCollisionFlag.CF_NO_CONTACT_RESPONSE);
                break;
            
            case CollisionBehavior.Regular:
                ghostObject.setCollisionFlags(ghostObject.getCollisionFlags() & ~AmmoCollisionFlag.CF_NO_CONTACT_RESPONSE);
                break;
        }
    }

    setCharacterControllerMaxSlope(uuid: string, maxSlope: number): void {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("AmmoPhysicsEngine.setCharacterControllerMaxSlope: controller does not exist", uuid);
            return;
        }

        controller.controller.setMaxSlope(maxSlope);
    }

    setCharacterControllerPosition(uuid: string, position: Vector3Like) {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("AmmoPhysicsEngine.setCharacterControllerPosition: controller does not exist", uuid);
            return;
        }

        const ghostObject = controller.controller.getGhostObject();
        const worldTransform = ghostObject.getWorldTransform();

        this.auxVectorA.setValue(0, 0, 0);
        controller.controller.setWalkDirection(this.auxVectorA);

        this.auxVectorA.setValue(position.x, position.y, position.z);
        worldTransform.setOrigin(this.auxVectorA);
        ghostObject.setWorldTransform(worldTransform);

        controller.controller.warp(this.auxVectorA);
    }

    setCharacterControllerRotation(uuid: string, quaternion: QuaternionLike): void {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("AmmoPhysicsEngine.setCharacterControllerRotation: controller does not exist", uuid);
            return;
        }

        const ghostObject = controller.controller.getGhostObject();
        const worldTransform = ghostObject.getWorldTransform();
        
        this.auxQuaternionA.setValue(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
        worldTransform.setRotation(this.auxQuaternionA);
        ghostObject.setWorldTransform(worldTransform);
    }

    setCharacterControllerStepHeight(uuid: string, stepHeight: number): void {
        const controller = this.controllers.get(uuid);
        if (!controller) {
            console.warn("AmmoPhysicsEngine.setCharacterControllerStepHeight: controller does not exist", uuid);
            return;
        }

        controller.controller.setStepHeight(stepHeight);
    }

    // Character-controller gravity / jump / impulse API — thin wrappers
    // over Bullet's native btKinematicCharacterController. Gravity,
    // stepUp, stepDown, maxSlope, snap-to-ground, and ground detection
    // are all handled internally by Bullet. No shadow state needed.

    setCharacterControllerGravity(uuid: string, gravity: Vector3Like): void {
        const entry = this.controllers.get(uuid);
        if (!entry) {
            console.warn("AmmoPhysicsEngine.setCharacterControllerGravity: controller does not exist", uuid);
            return;
        }
        this.auxVectorA.setValue(gravity.x, gravity.y, gravity.z);
        entry.controller.setGravity(this.auxVectorA);
    }

    setCharacterControllerWalkVelocity(uuid: string, velocity: Vector3Like): void {
        const entry = this.controllers.get(uuid);
        if (!entry) {
            console.warn("AmmoPhysicsEngine.setCharacterControllerWalkVelocity: controller does not exist", uuid);
            return;
        }
        entry.walkVelocity.x = velocity.x;
        entry.walkVelocity.y = velocity.y;
        entry.walkVelocity.z = velocity.z;
    }

    jumpCharacterController(uuid: string, jumpSpeed: number): boolean {
        const entry = this.controllers.get(uuid);
        if (!entry) {
            console.warn("AmmoPhysicsEngine.jumpCharacterController: controller does not exist", uuid);
            return false;
        }
        if (!entry.controller.onGround()) {
            return false;
        }
        entry.controller.setJumpSpeed(jumpSpeed);
        entry.controller.jump();
        return true;
    }

    applyImpulseToCharacterController(uuid: string, impulse: Vector3Like): void {
        const entry = this.controllers.get(uuid);
        if (!entry) {
            console.warn("AmmoPhysicsEngine.applyImpulseToCharacterController: controller does not exist", uuid);
            return;
        }
        this.auxVectorA.setValue(impulse.x, impulse.y, impulse.z);
        entry.controller.applyImpulse(this.auxVectorA);
    }

    // ========================================================================
    // Joint methods (btTypedConstraint)
    // ========================================================================

    addFixedJoint(options: FixedJointOptions): void {
        const { collisionEnabled, uuidA, uuidB, pivotB, rotationB } = options;
        const bodyA = this.rigidBodies.get(uuidA);
        if (!bodyA) {
            console.warn("AmmoPhysicsEngine.addFixedJoint: rigid body A not found", uuidA);
            return;
        }
        const bodyB = this.rigidBodies.get(uuidB);
        if (!bodyB) {
            console.warn("AmmoPhysicsEngine.addFixedJoint: rigid body B not found", uuidB);
            return;
        }

        const frameInA = new this.ammo.btTransform();
        frameInA.setIdentity();

        const frameInB = new this.ammo.btTransform();
        frameInB.setIdentity();
        frameInB.getOrigin().setValue(pivotB.x, pivotB.y, pivotB.z);
        const rotationAmmo = new this.ammo.btQuaternion(rotationB.x, rotationB.y, rotationB.z, rotationB.w);
        try {
            frameInB.setRotation(rotationAmmo);
            const joint = new this.ammo.btFixedConstraint(bodyA, bodyB, frameInA, frameInB);
            this.registerConstraint(joint, collisionEnabled, uuidA, uuidB);
        } finally {
            this.ammo.destroy(rotationAmmo);
            this.ammo.destroy(frameInA);
            this.ammo.destroy(frameInB);
        }
    }

    addHingeJoint(options: HingeJointOptions): void {
        const {
            collisionEnabled, uuidA, uuidB,
            hingeAxis, relPos, relRotation,
            angularLimitEnabled, angularLimit,
            motorEnabled, motorSpeed, motorTorque,
        } = options;
        const bodyA = this.rigidBodies.get(uuidA);
        if (!bodyA) {
            console.warn("AmmoPhysicsEngine.addHingeJoint: rigid body A not found", uuidA);
            return;
        }
        const bodyB = this.rigidBodies.get(uuidB);
        if (!bodyB) {
            console.warn("AmmoPhysicsEngine.addHingeJoint: rigid body B not found", uuidB);
            return;
        }

        const axisInA = new this.ammo.btVector3(hingeAxis.x, hingeAxis.y, hingeAxis.z);
        const relRotationAmmo = new this.ammo.btQuaternion(relRotation.x, relRotation.y, relRotation.z, relRotation.w);
        const axisInB = this.rotateVectorByQuaternion(relRotationAmmo, axisInA);
        const pivotInA = new this.ammo.btVector3(0, 0, 0);
        const pivotInB = new this.ammo.btVector3(relPos.x, relPos.y, relPos.z);

        try {
            const hinge = new this.ammo.btHingeConstraint(bodyA, bodyB, pivotInA, pivotInB, axisInA, axisInB, false);

            if (angularLimitEnabled) {
                // Bullet's setLimit(low, high, softness, biasFactor, relaxationFactor).
                // Preserving the pre-migration defaults (0.9 / 0.3 / 1.0).
                hinge.setLimit(angularLimit.x * DEG_TO_RAD, angularLimit.y * DEG_TO_RAD, 0.9, 0.3, 1);
            }

            if (motorEnabled) {
                hinge.enableAngularMotor(true, motorSpeed, motorTorque);
            }

            this.registerConstraint(hinge, collisionEnabled, uuidA, uuidB);
        } finally {
            this.ammo.destroy(axisInA);
            this.ammo.destroy(relRotationAmmo);
            this.ammo.destroy(axisInB);
            this.ammo.destroy(pivotInA);
            this.ammo.destroy(pivotInB);
        }
    }

    addPointToPointJoint(options: PointToPointJointOptions): void {
        const { collisionEnabled, uuidA, uuidB, pivotA, pivotB } = options;
        const bodyA = this.rigidBodies.get(uuidA);
        if (!bodyA) {
            console.warn("AmmoPhysicsEngine.addPointToPointJoint: rigid body A not found", uuidA);
            return;
        }
        const bodyB = this.rigidBodies.get(uuidB);
        if (!bodyB) {
            console.warn("AmmoPhysicsEngine.addPointToPointJoint: rigid body B not found", uuidB);
            return;
        }

        const pA = new this.ammo.btVector3(pivotA.x, pivotA.y, pivotA.z);
        const pB = new this.ammo.btVector3(pivotB.x, pivotB.y, pivotB.z);

        try {
            const joint = new this.ammo.btPoint2PointConstraint(bodyA, bodyB, pA, pB);
            this.registerConstraint(joint, collisionEnabled, uuidA, uuidB);
        } finally {
            this.ammo.destroy(pA);
            this.ammo.destroy(pB);
        }
    }

    removeJoint(uuidA: string, uuidB: string): void {
        this.removeJointByKey(this.getJointKey(uuidA, uuidB));
    }

    private registerConstraint(
        constraint: Ammo.btTypedConstraint,
        collisionEnabled: boolean,
        uuidA: string,
        uuidB: string,
    ): void {
        // The engine contract permits a constraint to be re-authored for the
        // same pair. Replace the old native constraint instead of leaving two
        // active solvers behind while the map only points at the newest one.
        this.removeJointByKey(this.getJointKey(uuidA, uuidB));
        this.constraints.add(constraint);
        this.jointMap.set(this.getJointKey(uuidA, uuidB), constraint);
        // Bullet's addConstraint takes `disableCollisionsBetweenLinkedBodies`,
        // so invert the caller's `collisionEnabled` flag.
        this.world.addConstraint(constraint, !collisionEnabled);
    }

    private removeJointByKey(jointKey: string): void {
        const constraint = this.jointMap.get(jointKey);
        if (!constraint) return;

        this.jointMap.delete(jointKey);
        this.constraints.delete(constraint);
        this.world?.removeConstraint(constraint);
        this.ammo.destroy(constraint);
    }

    private removeJointsForBody(uuid: string): void {
        for (const jointKey of this.jointMap.keys()) {
            const separator = jointKey.indexOf(":");
            if (separator === -1) continue;
            const uuidA = jointKey.slice(0, separator);
            const uuidB = jointKey.slice(separator + 1);
            if (uuidA === uuid || uuidB === uuid) {
                this.removeJointByKey(jointKey);
            }
        }
    }

    private getJointKey(uuidA: string, uuidB: string): string {
        return uuidA < uuidB ? `${uuidA}:${uuidB}` : `${uuidB}:${uuidA}`;
    }

    private rotateVectorByQuaternion(
        quat: Ammo.btQuaternion,
        axis: Ammo.btVector3,
    ): Ammo.btVector3 {
        const qx = quat.x(), qy = quat.y(), qz = quat.z(), qw = quat.w();
        const vx = axis.x(), vy = axis.y(), vz = axis.z();
        const tx = 2 * (qy * vz - qz * vy);
        const ty = 2 * (qz * vx - qx * vz);
        const tz = 2 * (qx * vy - qy * vx);
        const resultX = vx + qw * tx + (qy * tz - qz * ty);
        const resultY = vy + qw * ty + (qz * tx - qx * tz);
        const resultZ = vz + qw * tz + (qx * ty - qy * tx);
        return new this.ammo.btVector3(resultX, resultY, resultZ);
    }

    // ========================================================================
    // Vehicle methods (btRaycastVehicle)
    // ========================================================================

    addVehicle(vehicleUuid: string, spec: VehicleData, options: VehicleOptions): void {
        if (this.vehicles.has(vehicleUuid)) {
            console.warn("AmmoPhysicsEngine.addVehicle: vehicle already exists", vehicleUuid);
            return;
        }

        const mass = options.mass ?? 800;
        const halfExtents = spec.chassis.halfExtents;
        const centerOffset = spec.chassis.centerOffset;
        const initialTransform = spec.chassis.initialTransform;

        const halfExtentsVec = new this.ammo.btVector3(
            Math.max(0.1, halfExtents.x),
            Math.max(0.05, halfExtents.y),
            Math.max(0.1, halfExtents.z),
        );
        const boxShape = new this.ammo.btBoxShape(halfExtentsVec);
        this.ammo.destroy(halfExtentsVec);

        const compoundShape = new this.ammo.btCompoundShape();
        const childTransform = new this.ammo.btTransform();
        childTransform.setIdentity();
        const centerOffsetVec = new this.ammo.btVector3(centerOffset.x, centerOffset.y, centerOffset.z);
        childTransform.setOrigin(centerOffsetVec);
        compoundShape.addChildShape(childTransform, boxShape);
        this.ammo.destroy(centerOffsetVec);
        this.ammo.destroy(childTransform);

        const worldTransform = new this.ammo.btTransform();
        worldTransform.setIdentity();
        const initialRotation = new this.ammo.btQuaternion(
            initialTransform.quaternion.x,
            initialTransform.quaternion.y,
            initialTransform.quaternion.z,
            initialTransform.quaternion.w,
        );
        const initialPosition = new this.ammo.btVector3(
            initialTransform.position.x,
            initialTransform.position.y,
            initialTransform.position.z,
        );
        worldTransform.setRotation(initialRotation);
        worldTransform.setOrigin(initialPosition);
        this.ammo.destroy(initialRotation);
        this.ammo.destroy(initialPosition);

        const motionState = new this.ammo.btDefaultMotionState(worldTransform);
        this.ammo.destroy(worldTransform);

        const localInertia = new this.ammo.btVector3(0, 0, 0);
        compoundShape.calculateLocalInertia(mass, localInertia);

        const rbInfo = new this.ammo.btRigidBodyConstructionInfo(mass, motionState, compoundShape, localInertia);
        const chassisBody = new this.ammo.btRigidBody(rbInfo);
        this.ammo.destroy(rbInfo);
        this.ammo.destroy(localInertia);

        // 4 = DISABLE_DEACTIVATION: a vehicle's chassis must never
        // fall asleep, or the raycast vehicle stops tracking wheel
        // motion.
        chassisBody.setActivationState(4);
        this.world.addRigidBody(chassisBody);

        const vehicle = new this.ammo.btRaycastVehicle(this.vehicleTuning, chassisBody, this.vehicleRayCaster);
        vehicle.setCoordinateSystem(0, 1, 2);
        this.world.addAction(vehicle);

        const frontWheelIndices: number[] = [];
        const driveWheelIndices: number[] = [];

        for (let index = 0; index < spec.wheels.length; index++) {
            const wheelSpec = spec.wheels[index]!;
            const connectionVec = new this.ammo.btVector3(
                wheelSpec.connection.x,
                wheelSpec.connection.y,
                wheelSpec.connection.z,
            );
            const directionVec = new this.ammo.btVector3(0, -1, 0);
            const axleVec = new this.ammo.btVector3(-1, 0, 0);

            const wheelInfo = vehicle.addWheel(
                connectionVec,
                directionVec,
                axleVec,
                options.suspensionRestLength,
                wheelSpec.radius,
                this.vehicleTuning,
                wheelSpec.isFront,
            );

            wheelInfo.set_m_suspensionStiffness(options.suspensionStiffness);
            wheelInfo.set_m_wheelsDampingRelaxation(options.suspensionDamping);
            wheelInfo.set_m_wheelsDampingCompression(options.suspensionCompression);
            wheelInfo.set_m_frictionSlip(options.wheelFriction);
            wheelInfo.set_m_rollInfluence(options.rollInfluence);

            if (wheelSpec.isFront) {
                frontWheelIndices.push(index);
            } else {
                driveWheelIndices.push(index);
            }

            this.ammo.destroy(connectionVec);
            this.ammo.destroy(directionVec);
            this.ammo.destroy(axleVec);
        }

        // If no wheel opted into drive, every wheel drives (matches
        // the legacy AmmoPhysics behavior).
        if (driveWheelIndices.length === 0) {
            for (let index = 0; index < spec.wheels.length; index++) {
                driveWheelIndices.push(index);
            }
        }

        this.vehicles.set(vehicleUuid, {
            vehicle,
            chassisBody,
            compoundShape,
            boxShape,
            wheelCount: spec.wheels.length,
            frontWheelIndices,
            driveWheelIndices,
            options,
        });
    }

    removeVehicle(vehicleUuid: string): void {
        const entry = this.vehicles.get(vehicleUuid);
        if (!entry) return;

        this.world.removeAction(entry.vehicle);
        this.world.removeRigidBody(entry.chassisBody);

        // `destroyRigidBody` destroys the motion state and calls
        // `destroyCollisionObject`, which destroys the body's
        // collision shape (the compound) and then the body itself.
        this.ammo.destroy(entry.vehicle);
        this.destroyRigidBody(vehicleUuid, entry.chassisBody);

        // Inner primitives aren't cascaded by the compound, so they
        // have to be destroyed separately.
        this.ammo.destroy(entry.boxShape);
        // The shared tuning wrapper is a value-like Ammo binding without a
        // destroyable native destructor; it is retained once per world.

        this.vehicles.delete(vehicleUuid);
    }

    hasVehicle(vehicleUuid: string): boolean {
        return this.vehicles.has(vehicleUuid);
    }

    *vehicleUuids(): IterableIterator<string> {
        yield* this.vehicles.keys();
    }

    setVehicleInput(vehicleUuid: string, input: VehicleInput): void {
        const entry = this.vehicles.get(vehicleUuid);
        if (!entry) return;

        const options = entry.options;
        let throttle = input.throttle;
        let steer = input.steer;
        const brake = input.brake;

        if (Math.abs(throttle) < options.throttleDeadzone) throttle = 0;
        if (Math.abs(steer) < options.steerDeadzone) steer = 0;

        const engineForce = throttle * options.maxEngineForce;
        const brakeForce = brake * options.maxBrakeForce;
        const steeringValue = -steer * options.maxSteerAngle;

        for (let index = 0; index < entry.wheelCount; index++) {
            entry.vehicle.setBrake(brakeForce, index);
        }
        for (const index of entry.frontWheelIndices) {
            entry.vehicle.setSteeringValue(steeringValue, index);
        }
        for (const index of entry.driveWheelIndices) {
            entry.vehicle.applyEngineForce(engineForce, index);
        }
    }

    getVehicleChassisPosition(vehicleUuid: string): Vector3Like | null {
        const entry = this.vehicles.get(vehicleUuid);
        if (!entry) return null;
        const transform = entry.vehicle.getChassisWorldTransform();
        const origin = transform.getOrigin();
        return { x: origin.x(), y: origin.y(), z: origin.z() };
    }

    getVehicleChassisRotation(vehicleUuid: string): QuaternionLike | null {
        const entry = this.vehicles.get(vehicleUuid);
        if (!entry) return null;
        const transform = entry.vehicle.getChassisWorldTransform();
        const rotation = transform.getRotation();
        return { x: rotation.x(), y: rotation.y(), z: rotation.z(), w: rotation.w() };
    }

    getVehicleWheelTransform(
        vehicleUuid: string,
        wheelIndex: number,
    ): { position: Vector3Like; rotation: QuaternionLike } | null {
        const entry = this.vehicles.get(vehicleUuid);
        if (!entry || wheelIndex < 0 || wheelIndex >= entry.wheelCount) return null;

        // Exact (non-interpolated) transform — matches
        // getChassisWorldTransform so wheels don't lag the chassis
        // visually when accelerating.
        entry.vehicle.updateWheelTransform(wheelIndex, false);
        const transform = entry.vehicle.getWheelTransformWS(wheelIndex);
        const origin = transform.getOrigin();
        const rotation = transform.getRotation();
        return {
            position: { x: origin.x(), y: origin.y(), z: origin.z() },
            rotation: { x: rotation.x(), y: rotation.y(), z: rotation.z(), w: rotation.w() },
        };
    }

    getVehicleWheelCount(vehicleUuid: string): number {
        return this.vehicles.get(vehicleUuid)?.wheelCount ?? 0;
    }

    initDebug(): Object3D {
        this.debugEnabled = true;
        const debugVertices = new Float32Array(DefaultBufferSize);
        const debugColors = new Float32Array(DefaultBufferSize);

        this.debugGeometry = new BufferGeometry();
        this.debugGeometry.setAttribute(
            "position",
            new BufferAttribute(debugVertices, 3).setUsage(DynamicDrawUsage),
        );
        this.debugGeometry.setAttribute(
            "color",
            new BufferAttribute(debugColors, 3).setUsage(DynamicDrawUsage),
        );

        this.debugMaterial = new LineBasicMaterial({
            color: 0x3300ff,
            linewidth: 1,
            vertexColors: true /*VertexColors*/,
        });

        this.debugDrawer = new AmmoDebugDrawer(this.ammo, null, debugVertices, debugColors, this.world, {
            debugDrawMode: AmmoDebugConstants.DrawWireframe
                | AmmoDebugConstants.DrawAabb
                | AmmoDebugConstants.DrawContactPoints,
        });
        this.debugDrawer.enable();

        this.debugMesh = new LineSegments(this.debugGeometry, this.debugMaterial);
        this.debugMesh.frustumCulled = false;

        return this.debugMesh;
    }

    private createShapeInstance(sharedShape: SharedShape): Ammo.btCollisionShape {
        switch (sharedShape.type) {
            case BodyShapeType.BOX:
                return this.createBoxShapeInstance(sharedShape);
            case BodyShapeType.CAPSULE:
                return this.createCapsuleShapeInstance(sharedShape);
            case BodyShapeType.SPHERE:
                return this.createSphereShapeInstance(sharedShape);
            case BodyShapeType.CONVEX_HULL:
                return this.createConvexHullShapeInstance(sharedShape);
            case BodyShapeType.CONCAVE_HULL:
                return this.createConcaveHullShapeInstance(sharedShape);
            case BodyShapeType.HEIGHTFIELD:
                return this.createHeightfieldShapeInstance(sharedShape);
            case 'empty':
                return new this.ammo.btEmptyShape();
        }
    }

    private createBoxShapeInstance({ width, height, length }: Omit<BoxShape, 'type'>): Ammo.btBoxShape {
        this.auxVectorA.setValue(width * 0.5, height * 0.5, length * 0.5);
        return new this.ammo.btBoxShape(this.auxVectorA);
    }

    private createCapsuleShapeInstance({ radius, height }: Omit<CapsuleShape, 'type'>): Ammo.btCapsuleShape {
        return new this.ammo.btCapsuleShape(radius, height);
    }

    private createSphereShapeInstance({ radius }: Omit<SphereShape, 'type'>): Ammo.btSphereShape {
        return new this.ammo.btSphereShape(radius);
    }

    private createConvexHullShapeInstance({ ammoShape }: Omit<SharedConvexHullShape, 'type'>): Ammo.btUniformScalingShape {
        return new this.ammo.btUniformScalingShape(ammoShape, 1);
    }

    private createConcaveHullShapeInstance({ ammoShape }: Omit<SharedConcaveHullShape, 'type'>): Ammo.btCollisionShape {
        if (!ammoShape) {
            return new this.ammo.btEmptyShape();
        }
        this.auxVectorA.setValue(1, 1, 1);
        return new this.ammo.btScaledBvhTriangleMeshShape(ammoShape, this.auxVectorA);
    }

    private createHeightfieldShapeInstance(shape: SharedHeightfieldShape): Ammo.btCollisionShape {
        const heightfield = normalizeHeightfieldShape(shape);
        const ammoAny = this.ammo as any;
        if (typeof ammoAny._malloc !== "function" || !ammoAny.HEAPF32) {
            throw new Error("Ammo heightfields require _malloc and HEAPF32 support");
        }

        const dataPtr = ammoAny._malloc(heightfield.heightSamples.byteLength);
        if (!dataPtr) {
            throw new Error("Ammo heightfield allocation failed");
        }
        ammoAny.HEAPF32.set(heightfield.heightSamples, dataPtr >> 2);

        try {
            let minHeight = Infinity;
            let maxHeight = -Infinity;
            for (const sample of heightfield.heightSamples) {
                minHeight = Math.min(minHeight, sample);
                maxHeight = Math.max(maxHeight, sample);
            }
            const ammoShape = new ammoAny.btHeightfieldTerrainShape(
                heightfield.columns,
                heightfield.rows,
                dataPtr,
                1,
                minHeight,
                maxHeight,
                1,
                ammoAny.PHY_FLOAT,
                false,
            ) as Ammo.btCollisionShape;

            // Bullet's unscaled grid spans (samples - 1) units. Scale it to
            // the authored terrain extents used by Three's PlaneGeometry.
            this.auxVectorA.setValue(
                heightfield.scale.x / Math.max(1, heightfield.columns - 1),
                heightfield.scale.y,
                heightfield.scale.z / Math.max(1, heightfield.rows - 1),
            );
            (ammoShape as any).setLocalScaling(this.auxVectorA);
            this.heightfieldDataPointers.set(ammoShape, dataPtr);
            return ammoShape;
        } catch (error) {
            ammoAny._free(dataPtr);
            throw error;
        }
    }

    private getHeightfieldBodyOriginOffset(shape: SharedHeightfieldShape): number {
        let minHeight = Infinity;
        let maxHeight = -Infinity;
        for (const sample of shape.heightSamples) {
            minHeight = Math.min(minHeight, sample);
            maxHeight = Math.max(maxHeight, sample);
        }
        if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) {
            return 0;
        }
        return (minHeight + maxHeight) / 2;
    }

    private createConvexHullShape({ vertices }: Omit<ConvexHullShape, 'type'>): Ammo.btConvexHullShape {
        const convexHullShape = new this.ammo.btConvexHullShape();

        for (let i = 0; i < vertices.length; i += 3) {
            this.auxVectorA.setValue(vertices[i]!, vertices[i + 1]!, vertices[i + 2]!);
            convexHullShape.addPoint(this.auxVectorA);
        }

        return convexHullShape;
    }

    private createConcaveHullShape(
        { vertices, indexes }: Omit<ConcaveHullShape, 'type'>,
    ): {
        ammoShape: Ammo.btBvhTriangleMeshShape;
        resources: [Ammo.btTriangleMesh];
    } | undefined {
        // Creating a btBvhTriangleMeshShape with no vertices will cause a
        // crash. If there are no vertices, return undefined.
        const hasVertices = indexes.some((index) => index.length > 0);
        if (!hasVertices) {
            return undefined;
        }

        const removeDuplicateVertices = true;
        const triangleMesh = new this.ammo.btTriangleMesh();

        vertices.forEach((verts, i) => {
            const index = indexes[i]!;

            for (let j = 0; j < index.length; j += 3) {
                const ai = index[j]! * 3;
                const bi = index[j + 1]! * 3;
                const ci = index[j + 2]! * 3;

                this.auxVectorA.setValue(verts[ai]!, verts[ai + 1]!, verts[ai + 2]!);
                this.auxVectorB.setValue(verts[bi]!, verts[bi + 1]!, verts[bi + 2]!);
                this.auxVectorC.setValue(verts[ci]!, verts[ci + 1]!, verts[ci + 2]!);

                try {
                    triangleMesh.addTriangle(
                        this.auxVectorA,
                        this.auxVectorB,
                        this.auxVectorC,
                        removeDuplicateVertices,
                    );
                } catch (error) {
                    console.error(
                        "Error adding triangle:",
                        error,
                        {
                            v0: this.auxVectorA,
                            v1: this.auxVectorB,
                            v2: this.auxVectorC,
                        },
                    );
                }
            }
        });

        return {
            ammoShape: new this.ammo.btBvhTriangleMeshShape(triangleMesh, true, true),
            resources: [triangleMesh],
        };
    }

    private createSharedShape(collisionShape: CollisionShape): SharedShape {
        switch (collisionShape.type) {
            case BodyShapeType.BOX:
                return {
                    type: BodyShapeType.BOX,
                    width: collisionShape.width,
                    height: collisionShape.height,
                    length: collisionShape.length,
                    ammoShape: undefined,
                    resources: undefined,
                };

            case BodyShapeType.CAPSULE:
                return {
                    type: BodyShapeType.CAPSULE,
                    radius: collisionShape.radius,
                    height: collisionShape.height,
                    ammoShape: undefined,
                    resources: undefined,
                };

            case BodyShapeType.SPHERE:
                return {
                    type: BodyShapeType.SPHERE,
                    radius: collisionShape.radius,
                    ammoShape: undefined,
                    resources: undefined,
                };

            case BodyShapeType.CONVEX_HULL:
                return {
                    type: BodyShapeType.CONVEX_HULL,
                    ammoShape: this.createConvexHullShape(collisionShape),
                    resources: undefined,
                };

            case BodyShapeType.CONCAVE_HULL:
                {
                    const results = this.createConcaveHullShape(collisionShape);
                    if (!results) {
                        return {
                            // Preserve the source shape type so addRigidBody
                            // can still reject dynamic/kinematic concave
                            // bodies before constructing an Ammo body.
                            type: BodyShapeType.CONCAVE_HULL,
                            ammoShape: undefined,
                            resources: undefined,
                        };
                    }

                    return {
                        type: BodyShapeType.CONCAVE_HULL,
                        ammoShape: results.ammoShape,
                        resources: results.resources,
                    };
                }

            case BodyShapeType.HEIGHTFIELD:
                // Heightfield native objects are instantiated per rigid body;
                // the shared cache retains only validated, serializable data.
                normalizeHeightfieldShape(collisionShape);
                return {
                    type: BodyShapeType.HEIGHTFIELD,
                    rows: collisionShape.rows,
                    columns: collisionShape.columns,
                    sampleCount: collisionShape.sampleCount,
                    heightSamples: collisionShape.heightSamples.slice(),
                    offset: {...collisionShape.offset},
                    scale: {...collisionShape.scale},
                };
        }
        throw new Error(`AmmoPhysicsEngine.createSharedShape: unhandled collision shape type ${(collisionShape as {type: string}).type}`);
    }

    private destroyCharacterController(uuid: string, controller: Ammo.btKinematicCharacterController) {
        const ghostObject = controller.getGhostObject();
        // Release the action before its ghost object. Bullet's controller
        // destructor still reads the ghost during teardown; destroying the
        // collision object first can strand controller-side native state.
        this.ammo.destroy(controller);
        this.destroyCollisionObject(uuid, ghostObject);
    }

    private destroyCollisionObject(uuid: string, object: Ammo.btCollisionObject) {
        const shape = object.getCollisionShape();
        if (shape) {
            this.destroyShapeInstance(shape);
        }

        const shapeUuid = this.collisionObjectToShapeMap.get(uuid);
        if (shapeUuid) {
            this.shapeCache.release(shapeUuid);
            this.collisionObjectToShapeMap.delete(uuid);
        }

        this.ammo.destroy(object);
    }

    private destroyShapeInstance(shape: Ammo.btCollisionShape): void {
        const ammoAny = this.ammo as any;
        const dataPtr = this.heightfieldDataPointers.get(shape);
        if (dataPtr && typeof ammoAny._free === "function") {
            ammoAny._free(dataPtr);
            this.heightfieldDataPointers.delete(shape);
        }
        this.ammo.destroy(shape);
    }

    private destroyRigidBody(uuid: string, body: Ammo.btRigidBody) {
        const motionState = body.getMotionState?.();
        if (motionState) {
            this.ammo.destroy(motionState);
        }

        this.destroyCollisionObject(uuid, body);
    }
    
    private dispatchCollisionEvents(onCollision: CollisionCallback) {
        const currentContactPairs = this.nextContactPairs;
        currentContactPairs.clear();
        this.getRigidBodyContactPairs(currentContactPairs);
        this.getCharacterControllerContactPairs(currentContactPairs);

        // Collision "stopped" events
        for (const [key, { uuid1, uuid2 }] of this.contactPairs) {
            if (currentContactPairs.has(key)) {
                continue;
            }

            this.dispatchCollisionEvent(uuid1, uuid2, false, onCollision);
        }

        // Collision "started" events
        for (const [key, pair] of currentContactPairs) {
            if (this.contactPairs.has(key)) {
                continue;
            }

            this.dispatchCollisionEvent(pair.uuid1, pair.uuid2, true, onCollision, pair.contactPoint, pair.contactNormal);
        }

        const previousContactPairs = this.contactPairs;
        this.contactPairs = currentContactPairs;
        this.nextContactPairs = previousContactPairs;
    }

    private getRigidBodyContactPairs(contactPairs: Map<string, ContactPair>) {
        const dispatcher = this.world.getDispatcher();
        const numManifolds = dispatcher.getNumManifolds();

        for (let i = 0; i < numManifolds; i++) {
            const contactManifold = dispatcher.getManifoldByIndexInternal(i);
            const collisionObject1 = contactManifold.getBody0();
            const collisionObject2 = contactManifold.getBody1();
            const uuid1 = this.getCollisionObjectUuid(collisionObject1);
            const uuid2 = this.getCollisionObjectUuid(collisionObject2);

            if (!uuid1 || !uuid2) {
                continue;
            }

            const numContacts = contactManifold.getNumContacts();

            for (let i = 0; i < numContacts; i++) {
                const contactPoint = contactManifold.getContactPoint(i);
                const distance = contactPoint.getDistance();
                if (distance > 0.0) {
                    continue;
                }

                const key = uuid1 <= uuid2 ? `${uuid1}-${uuid2}` : `${uuid2}-${uuid1}`;
                contactPairs.set(key, { uuid1, uuid2 });
                break;
            }
        }
    }

    private getCharacterControllerContactPairs(contactPairs: Map<string, ContactPair>) {
        for (const [uuid, controller] of this.controllers) {
            const ghostObject = controller.controller.getGhostObject();
            const overlapCount = ghostObject.getNumOverlappingObjects();

            for (let i = 0; i < overlapCount; i++) {
                const overlappingObject = ghostObject.getOverlappingObject(i);
                const targetUuid = this.getCollisionObjectUuid(overlappingObject);
                if (!targetUuid) {
                    continue;
                }

                // Test for contact points between the ghost object and the
                // overlapping object. Capture the first contact point and normal.
                this.contactProbeHasPoint = false;
                this.contactProbePoint = undefined;
                this.contactProbeNormal = undefined;
                this.world.contactPairTest(ghostObject, overlappingObject, this.contactResultCallback);
                if (!this.contactProbeHasPoint) {
                    continue;
                }

                const key = uuid <= targetUuid ? `${uuid}-${targetUuid}` : `${targetUuid}-${uuid}`;
                contactPairs.set(key, {
                    uuid1: uuid,
                    uuid2: targetUuid,
                    contactPoint: this.contactProbePoint,
                    contactNormal: this.contactProbeNormal,
                });
            }
        }
    }

    private dispatchCollisionEvent(
        uuid1: string,
        uuid2: string,
        started: boolean,
        onCollision: CollisionCallback,
        contactPoint?: { x: number; y: number; z: number },
        contactNormal?: { x: number; y: number; z: number },
    ): void {
        const rigidBody1 = this.rigidBodies.get(uuid1);
        const rigidBody2 = this.rigidBodies.get(uuid2);
        const controller1 = this.controllers.get(uuid1)?.controller?.getGhostObject();
        const controller2 = this.controllers.get(uuid2)?.controller?.getGhostObject();
        const collisionObject1 = rigidBody1 || controller1;
        const collisionObject2 = rigidBody2 || controller2;

        if (!collisionObject1 || !collisionObject2) {
            return;
        }

        onCollision({
            uuid1,
            uuid2,
            type1: rigidBody1 ? "rigidBody" : "characterController",
            type2: rigidBody2 ? "rigidBody" : "characterController",
            group1: collisionObject1.getBroadphaseHandle().get_m_collisionFilterGroup(),
            group2: collisionObject2.getBroadphaseHandle().get_m_collisionFilterGroup(),
            started,
            contactPoint,
            contactNormal,
        });
    }

    private getCollisionObjectUuid(collisionObject: Ammo.btCollisionObject): string | null {
        const userPointerObj = collisionObject.getUserPointer();
        if (!isObject(userPointerObj)) {
            return null;
        }
        // Legacy ammo.js wrappers expose the pointer as `lU`; modern
        // Emscripten WebIDL wrappers expose it as `ptr`.
        const userPointer = (userPointerObj as any).lU ?? (userPointerObj as any).ptr;
        if (!isNumber(userPointer)) {
            return null;
        }
        return this.userPointerToUuidMap.get(Number(userPointer)) || null;
    }

    private setCollisionObjectUuid(collisionObject: Ammo.btCollisionObject, uuid: string) {
        this.userPointerToUuidMap.set(this.nextUserPointer, uuid);
        collisionObject.setUserPointer(this.nextUserPointer);
        this.nextUserPointer++;
    }
}

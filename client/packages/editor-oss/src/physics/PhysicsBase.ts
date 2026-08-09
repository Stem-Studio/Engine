import {Object3D, Vector3, type QuaternionLike, type Vector3Like} from "three";

import {BoxData, CapsuleData, CollisionBehavior, CollisionFlag, CollisionRegistration, CollisionShape, CommonData, ConcaveHullData, ConvexHullData, IPhysics, IPlayerOptions, PhysicsDebugRenderData, SphereData, TerrainData, VehicleInput, VehicleOptions, VehicleSpec} from "./common/types";

export default
abstract class PhysicsBase implements IPhysics {
    private readonly _isMultiplayer;
    private readonly _isWorker;
    private readonly _isLocal;

    protected dynamicObjects = new Map<string, Object3D>();
    protected kinematicObjects = new Map<string, Object3D>();

    protected constructor(isMultiplayer: boolean, isWorker: boolean, isLocal: boolean) {
        this._isMultiplayer = isMultiplayer;
        this._isWorker = isWorker;
        this._isLocal = isLocal;
    }
    
    abstract getGravity(): number;
    abstract start(): Promise<void>;
    abstract terminate(): void;
    abstract simulate(deltaTime: number): void;
    setSolverIterations(_solverIterations: number): void { /* optional backend capability */ }
    abstract pause(): void;
    abstract resume(): void;
    abstract initDebug(): Object3D | null;
    getDebugRenderData(): PhysicsDebugRenderData | null { return null; }
    abstract ping(): Promise<void>;
    abstract addBody(object: Object3D, shapeUuuid: string, data: CommonData): void;
    abstract addTerrain(object: Object3D, data: TerrainData): void;
    abstract remove(uuid: string): void;
    abstract removePrefab(uuid: string): void;
    abstract addShape(uuid: string, collisionShape: CollisionShape): void;
    abstract removeShape(uuid: string): void;
    abstract hasShape(uuid: string): boolean;
    abstract setRigidBodyShape(uuid: string, newShapeUuid: string): void;
    abstract applyCentralImpulse(uuid: string, impulse: Vector3): void;
    abstract setOrigin(uuid: string, position: Vector3Like): void;
    abstract setRotation(uuid: string, quaternion: QuaternionLike): void;
    abstract setScale(uuid: string, scale: Vector3Like): void;
    abstract setAngularVelocity(uuid: string, velocity: Vector3): void;
    abstract setLinearVelocity(uuid: string, velocity: Vector3): void;
    abstract getLinearVelocity(uuid: string): Vector3Like | null;
    abstract getAngularVelocity(uuid: string): Vector3Like | null;
    abstract setLinearDamping(uuid: string, damping: number): void;
    abstract setAngularDamping(uuid: string, damping: number): void;
    abstract addPlayerObject(uuid: string, useController: boolean, options?: IPlayerOptions): Promise<Object3D | null>;
    abstract removePlayerObject(uuid: string): void;
    abstract movePlayerObject(uuid: string, walkDirection: Vector3, jump: boolean): void;
    abstract setPlayerGravity(uuid: string, acceleration: Vector3Like): void;
    abstract setPlayerPosition(uuid: string, position: Vector3): void;
    abstract setPlayerSpeedAdjustment(uuid: string, speedAdjustment: Vector3): void;
    abstract applyImpulseToPlayer(uuid: string, impulse: Vector3): void;
    abstract applyImpulseToRigidBody(uuid: string, impulse: Vector3, relativePosition: Vector3): void;
    abstract addVehicleObject(vehicleUuid: string, spec: VehicleSpec, options: VehicleOptions): Promise<void>;
    abstract removeVehicleObject(vehicleUuid: string): void;
    abstract moveVehicleObject(vehicleUuid: string, input: VehicleInput): void;
    abstract addCollidableObject(uuid: string): void;
    abstract removeCollidableObject(uuid: string): void;
    abstract detectCollisionsForObject(uuid: string, registration: CollisionRegistration, enable: boolean): void;
    abstract setCollisionBehavior(uuid: string, behavior: CollisionBehavior): void;
    kickNearbyObjects(_uuid: string, _kickImpulse: number): void { /* no-op by default */ }
    abstract setCurrentAnimation(uuid: string, animation: string): void;
    abstract addOtsShiftVector(otsShiftVector: Vector3): void;
    abstract addFixedJoint(collisionEnabled: boolean, uuidA: string, uuidB: string, vec3PivotB: Vector3, vec4RotationB: QuaternionLike): void;
    abstract addHingeJoint(collisionEnabled: boolean, uuidA: string, uuidB: string, hingeAxis: Vector3Like, relPos: Vector3Like, relRotation: QuaternionLike, angularLimitEnabled: boolean, angularLimit: Vector3Like, motorEnabled: boolean, motorSpeed: number, motorTorque: number): void;
    abstract addPoint2PointJoint(collisionEnabled: boolean, uuidA: string, vec3PivotA: Vector3, uuidB: string, vec3PivotB: Vector3): void;
    abstract removeJoint(uuidA: string, uuidB: string): void;

    add(object: Object3D) {
        void import("./PhysicsUtil").then(({PhysicsUtil}) => {
            void PhysicsUtil.addObjectShapeToPhysics(object, this);
        });
    }

    private addObjectImpl(object: Object3D, data: BoxData | CapsuleData |SphereData | ConcaveHullData | ConvexHullData) {
        const shapeUuid = data.uuid;
        this.addShape(shapeUuid, data);
        this.addBody(object, shapeUuid, data);
        this.removeShape(shapeUuid);
    }

    addBox(object: Object3D, data: BoxData): void {
        this.addObjectImpl(object, data);
    }

    addSphere(object: Object3D, data: SphereData): void {
        this.addObjectImpl(object, data);
    }

    addConcaveHull(object: Object3D, data: ConcaveHullData): void {
        this.addObjectImpl(object, data);
    }

    addConvexHull(object: Object3D, data: ConvexHullData): void {
        this.addObjectImpl(object, data);
    }

    addCapsuleShape(object: Object3D, data: CapsuleData): void {
        this.addObjectImpl(object, data);
    }

    getDynamicBodyObject(uuid: string): Object3D | undefined {
        return this.dynamicObjects.get(uuid);
    }

    getKinematicBodyObjects() {
        return this.kinematicObjects;
    }

    addObject(uuid: string, mass: number, collisionFlag: CollisionFlag, object: Object3D) {
        collisionFlag = this.getCollisionFlag(mass, collisionFlag);
        //map local objects for updates
        if (collisionFlag === CollisionFlag.DYNAMIC) {
            this.dynamicObjects.set(uuid, object);
        } else if (collisionFlag === CollisionFlag.KINEMATIC) {
            this.kinematicObjects.set(uuid, object);
        }
        return collisionFlag;
    }

    removeObject(uuid: string) {
        this.dynamicObjects.delete(uuid);
        this.kinematicObjects.delete(uuid);
    }

    /**
     * Release the Three.js object references owned by the adapter/proxy.
     * Implementations call this from terminate() after their backend-specific
     * world has been disposed. Keeping this in the shared base prevents a
     * stopped Play session from retaining the authored scene through physics
     * bookkeeping maps.
     */
    protected clearTrackedObjects(): void {
        this.dynamicObjects.clear();
        this.kinematicObjects.clear();
    }

    isMultiplayer(): boolean {
        return this._isMultiplayer;
    }

    isWorker(): boolean {
        return this._isWorker;
    }

    isLocal(): boolean {
        return this._isLocal;
    }

    protected getCollisionFlag(mass: number, collisionFlag: CollisionFlag) {
        if (mass > 0) {
            collisionFlag = CollisionFlag.DYNAMIC;
        } else if (collisionFlag === CollisionFlag.KINEMATIC) {
            collisionFlag = CollisionFlag.KINEMATIC;
        } else {
            collisionFlag = CollisionFlag.STATIC;
        }
        return collisionFlag;
    }
}

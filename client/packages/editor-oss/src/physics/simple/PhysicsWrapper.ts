import {Object3D, Scene, Vector3, type QuaternionLike, type Vector3Like} from "three";

import {MultiplayerUtils} from "./MultiplayerUtils";
import {markLocalPlayerAvatar} from "@stem/editor-oss/core/budget/AvatarBudgetPolicy";
import global from "@stem/editor-oss/global";
import SimpleMultiplayerClient from "@stem/editor-oss/multiplayer/worker/SimpleMultiplayerClient";
import SimpleMultiplayerCollaborativeClient from "@stem/editor-oss/multiplayer/worker/SimpleMultiplayerCollaborativeClient";
import {getObjectTemplate, getObjectTemplateType} from '@stem/editor-oss/utils/ObjectUtils';
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {
    BoxData,
    CapsuleData,
    CollisionBehavior,
    CollisionFlag,
    CollisionRegistration,
    CollisionShape,
    CommonData,
    ConcaveHullData,
    ConvexHullData,
    IDispatcher,
    IPhysics,
    IPlayerOptions,
    SphereData,
    TerrainData,
    VehicleInput,
    VehicleOptions,
    VehicleSpec,
} from "../common/types";
import {PhysicsRuntimeUtil as PhysicsUtil} from "../PhysicsRuntimeUtil";

export class PhysicsWrapper implements IPhysics {
    physics: IPhysics;
    mpClient: SimpleMultiplayerClient;
    scene: Scene;

    constructor(physics: IPhysics, userId: string, sceneId: string, scene: Scene, maxMultiplayerClientsPerRoom: number, dispatcher: IDispatcher) {
        this.physics = physics;
        this.scene = scene;
        //create MP client
        const isSandbox = !!global.app?.editor?.isSandbox;
        const isCollaborative = !!global.app?.editor?.isCollaborative;
        console.log(`MP: isSandbox || isCollaborative = ${isSandbox} || ${isCollaborative}`);
        this.mpClient =  isSandbox ? new SimpleMultiplayerCollaborativeClient(userId, maxMultiplayerClientsPerRoom, sceneId, scene, physics, dispatcher, true) : new SimpleMultiplayerClient(userId, maxMultiplayerClientsPerRoom, sceneId, scene, physics, dispatcher);
    }

    private addObjectToMP(object: Object3D) {
        const templateType = getObjectTemplateType(object);
        const template = getObjectTemplate(object);
        if (templateType !== undefined && template) {
            this.mpClient.addObject(object);
        }
    }

    async start(): Promise<void> {
        //moved this call to GameManager to avoid getting MP events before it's initialized
        //await this.mpClient.start();
    }

    terminate(): void {
        this.physics.terminate();
        void this.mpClient.terminate();
    }

    addShape(uuid: string, collisionShape: CollisionShape): void {
        this.physics.addShape(uuid, collisionShape);
    }

    removeShape(uuid: string): void {
        this.physics.removeShape(uuid);
    }

    hasShape(uuid: string): boolean {
        return this.physics.hasShape(uuid);
    }

    setRigidBodyShape(uuid: string, newShapeUuid: string): void {
        this.physics.setRigidBodyShape(uuid, newShapeUuid);
    }

    addBody(object: Object3D, shapeUuid: string, data: CommonData): void {
        this.physics.addBody(object, shapeUuid, data);
        this.addObjectToMP(object);
    }

    addBox(object: Object3D, data: BoxData): void {
        this.physics.addBox(object, data);
        this.addObjectToMP(object);
    }

    addCapsuleShape(object: Object3D, data: CapsuleData): void {
        this.physics.addCapsuleShape(object, data);
        this.addObjectToMP(object);
    }

    addConcaveHull(object: Object3D, data: ConcaveHullData): void {
        this.physics.addConcaveHull(object, data);
        this.addObjectToMP(object);
    }

    addConvexHull(object: Object3D, data: ConvexHullData): void {
        this.physics.addConvexHull(object, data);
        this.addObjectToMP(object);
    }

    addSphere(object: Object3D, data: SphereData): void {
        this.physics.addSphere(object, data);
        this.addObjectToMP(object);
    }

    remove(uuid: string): void {
        this.physics.remove(uuid);
        this.mpClient.removeObject(uuid);
    }

    async addPlayerObject(uuid: string, useController: boolean, options?: IPlayerOptions): Promise<Object3D | null> {
        const newPlayer = await MultiplayerUtils.clonePlayerObject(this, uuid, this.scene, undefined, this.mpClient.getSlot());
        const usesProfileAvatar = (global.app as {game?: {useAvatar?: () => boolean | undefined}} | null | undefined)
            ?.game?.useAvatar?.() === true;
        markLocalPlayerAvatar(newPlayer, {
            playerId: this.mpClient.userId,
            sourceObjectUuid: uuid,
            usesProfileAvatar,
            avatarSource: usesProfileAvatar ? "profile-avatar" : "multiplayer-template",
        });
        //FIXME: temp hack - remember original player children
        let count = 0;
        traverseObjectDepthFirst(newPlayer, child => {
            child.userData.originalPlayerObject = true;
            count++;
        });
        console.log(`clonePlayerObject: count=${count} uuid=${newPlayer.uuid}`);
        //it's ok to ignore returned Promise as this method in sync in this case and returns null
        if (PhysicsUtil.isPhysicsEnabled(newPlayer)) {
            await this.physics.addPlayerObject(newPlayer.uuid, useController, options);
        } else {
            console.warn("MP: player object is ignore because it doesn't have physics enabled", newPlayer);
        }
        this.mpClient.setPlayer(newPlayer);
        return newPlayer;
    }

    getGravity(): number {
        return this.physics.getGravity();
    }

    setSolverIterations(solverIterations: number): void {
        this.physics.setSolverIterations?.(solverIterations);
    }

    setPlayerGravity(uuid: string, acceleration: Vector3Like): void {
        this.physics.setPlayerGravity(uuid, acceleration);
    }

    addCollidableObject(uuid: string): void {
        this.physics.addCollidableObject(uuid);
    }

    addObject(uuid: string, mass: number, collisionFlag: CollisionFlag, object: Object3D): CollisionFlag {
        return this.physics.addObject(uuid, mass, collisionFlag, object);
    }

    addOtsShiftVector(otsShiftVector: Vector3): void {
        this.physics.addOtsShiftVector(otsShiftVector);
    }

    addTerrain(object: Object3D, data: TerrainData): void {
        this.physics.addTerrain(object, data);
    }

    applyCentralImpulse(uuid: string, impulse: Vector3): void {
        this.physics.applyCentralImpulse(uuid, impulse);
    }

    applyImpulseToPlayer(uuid: string, impulse: Vector3): void {
        this.physics.applyImpulseToPlayer(uuid, impulse);
    }

    detectCollisionsForObject(uuid: string, registration: CollisionRegistration, enable: boolean): void {
        this.physics.detectCollisionsForObject(uuid, registration, enable);
    }

    getDynamicBodyObject(uuid: string): Object3D | undefined {
        return this.physics.getDynamicBodyObject(uuid);
    }

    getKinematicBodyObjects(): Map<string, Object3D> {
        return this.physics.getKinematicBodyObjects();
    }

    initDebug(): Object3D | null {
        return this.physics.initDebug();
    }

    isLocal(): boolean {
        return this.physics.isLocal();
    }

    isMultiplayer(): boolean {
        return this.physics.isMultiplayer();
    }

    isWorker(): boolean {
        return this.physics.isWorker();
    }

    movePlayerObject(uuid: string, walkDirection: Vector3, jump: boolean): void {
        this.physics.movePlayerObject(uuid, walkDirection, jump);
    }

    pause(): void {
        this.physics.pause();
    }

    ping(): Promise<void> {
        return this.physics.ping();
    }

    removeCollidableObject(uuid: string): void {
        this.physics.removeCollidableObject(uuid);
    }

    removeObject(uuid: string): void {
        this.physics.removeObject(uuid);
    }

    removePlayerObject(uuid: string): void {
        this.physics.removePlayerObject(uuid);
    }

    addVehicleObject(vehicleUuid: string, spec: VehicleSpec, options: VehicleOptions): Promise<void> {
        return this.physics.addVehicleObject(vehicleUuid, spec, options);
    }

    removeVehicleObject(vehicleUuid: string): void {
        this.physics.removeVehicleObject(vehicleUuid);
    }

    moveVehicleObject(vehicleUuid: string, input: VehicleInput): void {
        this.physics.moveVehicleObject(vehicleUuid, input);
    }

    resume(): void {
        this.physics.resume();
    }

    setCurrentAnimation(uuid: string, animation: string): void {
        this.physics.setCurrentAnimation(uuid, animation);
        this.mpClient.setCurrentAnimation(uuid);
    }

    setLinearVelocity(uuid: string, velocity: Vector3): void {
        this.physics.setLinearVelocity(uuid, velocity);
    }

    setAngularVelocity(uuid: string, velocity: Vector3): void {
        this.physics.setAngularVelocity(uuid, velocity);
    }

    getLinearVelocity(uuid: string): Vector3Like | null {
        return this.physics.getLinearVelocity(uuid);
    }

    getAngularVelocity(uuid: string): Vector3Like | null {
        return this.physics.getAngularVelocity(uuid);
    }

    setLinearDamping(uuid: string, damping: number): void {
        this.physics.setLinearDamping(uuid, damping);
    }

    setAngularDamping(uuid: string, damping: number): void {
        this.physics.setAngularDamping(uuid, damping);
    }

    setOrigin(uuid: string, position: Vector3Like): void {
        this.physics.setOrigin(uuid, position);
    }

    setRotation(uuid: string, quaternion: QuaternionLike): void {
        this.physics.setRotation(uuid, quaternion);
    }

    setScale(uuid: string, scale: Vector3Like): void {
        this.physics.setScale(uuid, scale);
    }

    setPlayerPosition(uuid: string, position: Vector3): void {
        this.physics.setPlayerPosition(uuid, position);
    }

    setPlayerSpeedAdjustment(uuid: string, speedAdjustment: Vector3): void {
        this.physics.setPlayerSpeedAdjustment(uuid, speedAdjustment);
    }

    simulate(deltaTime: number): void {
        this.physics.simulate(deltaTime);
    }

    simulateFixedStep(deltaTime: number, substeps: number): boolean {
        return this.physics.simulateFixedStep?.(deltaTime, substeps) ?? false;
    }

    removePrefab(uuid: string): void {
        this.physics.removePrefab(uuid);
    }

    setCollisionBehavior(uuid: string, behavior: CollisionBehavior): void {
        this.mpClient.setCollisionBehavior(uuid, behavior);
        this.physics.setCollisionBehavior(uuid, behavior);
    }

    kickNearbyObjects(uuid: string, kickImpulse: number): void {
        this.physics.kickNearbyObjects(uuid, kickImpulse);
    }

    addFixedJoint(collisionEnabled: boolean, uuidA: string, uuidB: string, vec3PivotB: Vector3, vec4RotationB: QuaternionLike): void {
        this.physics.addFixedJoint(collisionEnabled, uuidA, uuidB, vec3PivotB, vec4RotationB);
    }

    addHingeJoint(collisionEnabled: boolean, uuidA: string, uuidB: string, hingeAxis: Vector3Like, relPos: Vector3Like, relRotation: QuaternionLike, angularLimitEnabled: boolean, angularLimit: Vector3Like, motorEnabled: boolean, motorSpeed: number, motorTorque: number): void {
        this.physics.addHingeJoint(collisionEnabled, uuidA, uuidB, hingeAxis, relPos, relRotation, angularLimitEnabled, angularLimit, motorEnabled, motorSpeed, motorTorque);
    }

    addPoint2PointJoint(collisionEnabled: boolean, uuidA: string, vec3PivotA: Vector3, uuidB: string, vec3PivotB: Vector3): void {
        this.physics.addPoint2PointJoint(collisionEnabled, uuidA, vec3PivotA, uuidB, vec3PivotB);
    }

    removeJoint(uuidA: string, uuidB: string): void {
        this.physics.removeJoint(uuidA, uuidB);
    }

    add(object: Object3D): void {
        this.physics.add(object);
    }

    applyImpulseToRigidBody(uuid: string, impulse: Vector3, relativePosition: Vector3): void {
        this.physics.applyImpulseToRigidBody(uuid, impulse, relativePosition);
    }
}

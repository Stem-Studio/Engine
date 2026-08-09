import {BufferGeometry, InstancedMesh, Matrix4, Mesh, Object3D, type Vector3Like} from "three";

import { CollisionType } from '../../../physics/common/physicsConfig';
import { getPhysics } from '../../../physics/common/getPhysics';
import {BodyShapeType, CollisionFlag, ConcaveHullShape, IPhysics} from '../../../physics/common/types';
import type { SerializableGeometry } from '../../../physics/hull/HullCompute';
import { PhysicsUtil } from '../../../physics/PhysicsUtil';
import { getGeometryComputePool } from '../../../physics/worker/GeometryComputePool';
import PlayerPhysics2 from '@web-shared/player/component/PlayerPhysics2';
import CameraUtils from '@stem/editor-oss/utils/CameraUtils';

/**
 * Serialize a BufferGeometry for worker transfer.
 * @param geometry
 */
function serializeGeometry(geometry: BufferGeometry): SerializableGeometry {
    const positionAttr = geometry.getAttribute('position');
    const positions = new Float32Array(positionAttr.array);

    const indexAttr = geometry.getIndex();
    const indices = indexAttr ? new Uint32Array(indexAttr.array) : null;

    return { positions, indices };
}

interface InstanceData {
    object: Object3D;
    mesh: Object3D;
    collisionShape: ConcaveHullShape | null;
    shapeReady: boolean;
    addedToPhysics: boolean;
    physicsUuid?: string;
}

interface TypedObject3D extends Object3D {
    isInstancedMesh?: boolean;
    isMesh?: boolean;
    // Duck typing properties
    instanceMatrix?: unknown;
    count?: number;
    geometry?: unknown;
}

/**
 * A helper class that manages physics for terrain objects.
 * 
 * @remarks
 * Call `addPhysicsForTerrainObject` to add the terrain object to the physics
 * world. Call `removePhysicsForTerrainObject` to remove it.
 */
export class EndlessTerrainPhysics {
    private static readonly tmpMatrix = new Matrix4();

    private readonly instanceDataMap = new Map<string, InstanceData>();
    private readonly collisionShapeMap = new Map<string, ConcaveHullShape>();

    /**
     * The distance between the player and a terrain object where the terrain
     * object is added to the physics world.
     */
    public distanceThreshold = 15;

    constructor(
        private readonly physics: IPhysics,
        private readonly playerPhysics: PlayerPhysics2,
    ) {
    }

    addPhysicsForChunk(mesh: Object3D) {
        if (!mesh.userData.physics) {
            const physics = getPhysics(null);
            physics.enabled = true;
            physics.type = "rigidBody";
            physics.shape = "btConcaveHullShape";
            physics.ctype = CollisionType.Static;
            mesh.userData.physics = physics;
            mesh.userData.enabled = true;
            mesh.userData.collidersSet = true;
            CameraUtils.disableCameraCollision(mesh);
            void this.playerPhysics.addObject(mesh);
        }
    }

    removePhysicsForChunk(mesh: Object3D) {
        if (mesh.userData.physics) {
            this.playerPhysics.removeObject(mesh);
        }
    }

    /**
     * Adds the given terrain object to the physics world.
     *
     * @param mesh - The mesh representing the terrain object (InstancedMesh or individual Mesh).
     * @param index - The index of the terrain object in the instanced mesh.
     * @param objectId - The ID of the terrain object.
     */
    addPhysicsForTerrainObject(mesh: Object3D, index: number, objectId: string) {
        const instanceData = this.instanceDataMap.get(objectId);
        if (instanceData) {
            return;
        }

        const instanceObject = new Object3D();

        const typedMesh = mesh as TypedObject3D;
        // Use robust duck typing for InstancedMesh detection (works across three/webgpu boundaries)
        const isInstancedMesh = !!(typedMesh.isInstancedMesh || typedMesh.instanceMatrix && typedMesh.count !== undefined);

        if (isInstancedMesh) {
            (mesh as InstancedMesh).getMatrixAt(index, EndlessTerrainPhysics.tmpMatrix);
            instanceObject.applyMatrix4(EndlessTerrainPhysics.tmpMatrix);
        } else {
             // Individual Mesh
            instanceObject.position.copy(mesh.position);
            instanceObject.quaternion.copy(mesh.quaternion);
            instanceObject.scale.copy(mesh.scale);
        }

        CameraUtils.disableCameraCollision(instanceObject);

        // Create instance data with null shape (will be computed async)
        const newInstanceData: InstanceData = {
            object: instanceObject,
            mesh,
            addedToPhysics: false,
            collisionShape: null,
            shapeReady: false,
        };

        this.instanceDataMap.set(objectId, newInstanceData);

        // Start async shape computation
        void this.computeCollisionShapeAsync(mesh, objectId, newInstanceData);
    }

    /**
     * Compute collision shape asynchronously using worker pool.
     * @param mesh
     * @param objectId
     * @param instanceData
     */
    private async computeCollisionShapeAsync(mesh: Object3D, objectId: string, instanceData: InstanceData): Promise<void> {
        // Check if we have a cached shape
        const cachedShape = this.collisionShapeMap.get(mesh.uuid);
        if (cachedShape) {
            instanceData.collisionShape = cachedShape;
            instanceData.shapeReady = true;
            return;
        }

        // Try to use worker pool for async computation
        const typedMesh = mesh as TypedObject3D;
        const isMesh = !!(typedMesh.isMesh || typedMesh.geometry);

        if (!isMesh) {
            // Fall back to sync computation for non-mesh objects
            instanceData.collisionShape = this.getCollisionShapeSync(mesh);
            instanceData.shapeReady = true;
            return;
        }

        try {
            const geometry = (mesh as Mesh).geometry;
            const serialized = serializeGeometry(geometry);

            const pool = getGeometryComputePool();
            const result = await pool.computeConcaveHull([serialized]);

            // Create shape from worker result
            const shape: ConcaveHullShape = {
                type: BodyShapeType.CONCAVE_HULL,
                vertices: result.vertices,
                indexes: result.indices,
            };

            // Cache and assign
            this.collisionShapeMap.set(mesh.uuid, shape);
            instanceData.collisionShape = shape;
            instanceData.shapeReady = true;
        } catch (error) {
            // Fall back to sync computation on error
            console.warn('[EndlessTerrainPhysics] Worker computation failed, using sync fallback:', error);
            instanceData.collisionShape = this.getCollisionShapeSync(mesh);
            instanceData.shapeReady = true;
        }
    }

    /**
     * Removes the given terrain object from the physics world.
     * 
     * @param objectId - The ID of the terrain object (i.e., the `objectId`
     * passed to `addPhysicsForTerrainObject`).
     */
    removePhysicsForTerrainObject(objectId: string) {
        const instanceData = this.instanceDataMap.get(objectId);
        if (!instanceData) {
            return;
        }

        if (instanceData.addedToPhysics) {
            this.removeCollisionShape(instanceData);
        }

        this.instanceDataMap.delete(objectId);
    }

    /**
     * Update terrain-related physics.
     *
     * @param playerPosition - The player position in the terrain's local space
     */
    update(playerPosition: Vector3Like) {
        const distanceThresholdSq = this.distanceThreshold * this.distanceThreshold;
        for (const instanceData of this.instanceDataMap.values()) {
            const distanceSq = instanceData.object.position.distanceToSquared(playerPosition);

            // Only add physics if shape is ready (computed async)
            if (!instanceData.addedToPhysics && instanceData.shapeReady && distanceSq < distanceThresholdSq) {
                this.addCollisionShape(instanceData);
            } else if (instanceData.addedToPhysics && distanceSq >= distanceThresholdSq) {
                this.removeCollisionShape(instanceData);
            }
        }
    }

    /**
     * Called when the terrain parent has been moved (e.g., via editor transform gizmo).
     * Removes all active physics bodies so they are re-added at the correct world
     * positions on the next update cycle.
     */
    onParentMoved() {
        for (const instanceData of this.instanceDataMap.values()) {
            if (instanceData.addedToPhysics) {
                this.removeCollisionShape(instanceData);
            }
        }
    }

    dispose() {
        for (const instanceData of this.instanceDataMap.values()) {
            if (instanceData.addedToPhysics) {
                this.physics.remove(instanceData.object.uuid);
            }
        }
        
        this.instanceDataMap.clear();
        this.collisionShapeMap.clear();
    }

    private addCollisionShape(instanceData: InstanceData) {
        const { object: instanceObject, collisionShape, mesh } = instanceData;

        // Safety check - should not happen if shapeReady is true
        if (!collisionShape) {
            console.warn('[EndlessTerrainPhysics] Attempted to add collision shape but shape is null');
            return;
        }

        // Clone the object apply the world matrix of the parent mesh.
        const worldObject = instanceObject.clone();
        mesh.updateWorldMatrix(true, false);

        const typedMesh = mesh as TypedObject3D;
        const isInstancedMesh = !!(typedMesh.isInstancedMesh || typedMesh.instanceMatrix && typedMesh.count !== undefined);

        if (isInstancedMesh) {
            worldObject.applyMatrix4(mesh.matrixWorld);
        } else {
            // For individual meshes, the position/rotation/scale is already world-relative (via parent hierarchy),
            // but instanceObject only has local transform relative to parent.
            // We want the final world transform.
            worldObject.position.setFromMatrixPosition(mesh.matrixWorld);
            worldObject.quaternion.setFromRotationMatrix(mesh.matrixWorld);
            worldObject.scale.setFromMatrixScale(mesh.matrixWorld);
        }

        this.physics.addConcaveHull(
            worldObject,
            {
                uuid: worldObject.uuid,
                template: '',
                name: worldObject.name,
                position: {
                    x: worldObject.position.x,
                    y: worldObject.position.y,
                    z: worldObject.position.z,
                },
                quaternion: {
                    x: worldObject.quaternion.x,
                    y: worldObject.quaternion.y,
                    z: worldObject.quaternion.z,
                    w: worldObject.quaternion.w,
                },
                scale: {
                    x: worldObject.scale.x,
                    y: worldObject.scale.y,
                    z: worldObject.scale.z,
                },
                // TODO: create constants for these defaults
                mass: 0,
                friction: 0.3,
                rollingFriction: 0.3,
                spinningFriction: 0.3,
                contactStiffness: 0.5,
                contactDamping: 0.5,
                collision_flag: CollisionFlag.STATIC,
                ...collisionShape,
            },
        );

        instanceData.physicsUuid = worldObject.uuid;
        instanceData.addedToPhysics = true;
    }

    private removeCollisionShape(instanceData: InstanceData) {
        if (instanceData.physicsUuid) {
            this.physics.remove(instanceData.physicsUuid);
        }
        instanceData.addedToPhysics = false;
        instanceData.physicsUuid = undefined;
    }

    /**
     * Synchronous fallback for collision shape generation.
     * Used when worker pool computation fails.
     * @param instancedMesh
     */
    private getCollisionShapeSync(instancedMesh: Object3D): ConcaveHullShape {
        let collisionShape = this.collisionShapeMap.get(instancedMesh.uuid);
        if (collisionShape) {
            return collisionShape;
        }

        // Robust duck typing for Mesh (checks for geometry) to verify if it can produce a shape
        const typedMesh = instancedMesh as TypedObject3D;
        const isMesh = !!(typedMesh.isMesh || typedMesh.geometry);

        if (isMesh) {
            collisionShape = PhysicsUtil.getShapeData(instancedMesh, BodyShapeType.CONCAVE_HULL);
            this.collisionShapeMap.set(instancedMesh.uuid, collisionShape);
            return collisionShape;
        }
        throw new Error("Physics shape generation requires a Mesh or InstancedMesh");
    }
}

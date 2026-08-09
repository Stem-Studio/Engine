import {Box3, MathUtils, Object3D, Vector3} from "three";
import {CollisionData, ICollisionSource, IPhysics} from "../../physics/common/types";
import {COLLISION_TYPE} from "@stem/editor-oss/types/editor";
import {FrameWorldMatrixCache} from "@stem/editor-oss/utils/FrameWorldMatrixCache";
import BoundingBoxUtil from "@stem/editor-oss/utils/BoundingBoxUtil";
import {IControl} from "../game/GameManager";

export interface CollisionListener {
    id?: string;
    type: COLLISION_TYPE;
    useBoundingBoxes?: boolean;
    distanceThreshold?: number;
    callback: (context: CollisionContext) => void;
}

export type CollisionContext = {
    target: Object3D;
    other?: Object3D;
    listener: CollisionListener;
    source: "distance" | "physics";
    collision?: CollisionData;
};

/**
 * This class does both physics and distance base collision detection.
 */
class CollisionDetector {
    static readonly DEFAULT_COLLISION_THRESHOLD = 3.5;
    private static readonly BOUNDING_BOX_COLLISION_CACHE_KEY = Number.NEGATIVE_INFINITY;

    physics: IPhysics;
    player?: Object3D;
    control?: IControl;
    objBox = new Box3();
    targetBox = new Box3();

    private objectsWithoutPhysics: Map<Object3D, CollisionListener[]> = new Map<
        Object3D,
        CollisionListener[]
    >();
    private objectsWithPhysics: Map<Object3D, CollisionListener[]> = new Map<
        Object3D,
        CollisionListener[]
    >();
    private uuidToObjects: Map<string, Object3D> = new Map<string, Object3D>();
    private physicsListenersByObjectUuid: Map<string, Map<string, CollisionListener>> = new Map();
    private readonly distanceCollisionResults: Map<number, boolean> = new Map();
    private readonly distanceWorldMatrixCache = new FrameWorldMatrixCache();
    private readonly objectWorldPosition = new Vector3();
    private readonly targetWorldPosition = new Vector3();

    private lastCollisionsViaPhysics: CollisionData[] = [];

    constructor(physics: IPhysics, collisionSource: ICollisionSource) {
        this.physics = physics;
        //subscribe for physics collision events
        collisionSource.addCollisionListener(collision => {
            this.onCollisionViaPhysics(collision);
        });
    }

    setPlayer(player: Object3D | undefined) {
        this.player = player;
    }

    addListener(target: Object3D, listener: CollisionListener, usePhysics: boolean): string {
        const map = usePhysics ? this.objectsWithPhysics : this.objectsWithoutPhysics;
        let arr = map.get(target);
        if (!arr) {
            arr = [];
            map.set(target, arr);
        }
        if (!listener.id) {
            listener.id = MathUtils.generateUUID();
        }
        arr.push(listener);
        if (usePhysics) {
            const listenerId = listener.id;
            this.physics.detectCollisionsForObject(target.uuid, {id: listenerId, type: listener.type}, true);
            this.uuidToObjects.set(target.uuid, target);
            let listenersById = this.physicsListenersByObjectUuid.get(target.uuid);
            if (!listenersById) {
                listenersById = new Map();
                this.physicsListenersByObjectUuid.set(target.uuid, listenersById);
            }
            listenersById.set(listenerId, listener);
        }
        return listener.id;
    }

    deleteListener(target: Object3D, listenerId: string = ""): void {
        const removedPhysicsListener = this.removeListener(this.objectsWithPhysics, target, listenerId);
        this.removeListener(this.objectsWithoutPhysics, target, listenerId);

        if (removedPhysicsListener) {
            this.physics.detectCollisionsForObject(target.uuid, {id: listenerId, type: COLLISION_TYPE.UNKNOWN}, false);
            if (listenerId) {
                const listenersById = this.physicsListenersByObjectUuid.get(target.uuid);
                listenersById?.delete(listenerId);
                if (listenersById?.size === 0) {
                    this.physicsListenersByObjectUuid.delete(target.uuid);
                }
            } else {
                this.physicsListenersByObjectUuid.delete(target.uuid);
            }
        }
        if (!this.objectsWithPhysics.has(target)) {
            this.uuidToObjects.delete(target.uuid);
        }
    }

    isColliding(
        obj: Object3D,
        target: Object3D,
        useBoundingBoxes: boolean,
        distanceThreshold = CollisionDetector.DEFAULT_COLLISION_THRESHOLD,
        debug = false,
        targetBoundingBox?: Box3,
        forceWorldTransformRefresh = false,
    ) {
        if (useBoundingBoxes) {
            this.setWorldBounds(obj, this.objBox, forceWorldTransformRefresh);
            const targetBox = targetBoundingBox ?? this.setWorldBounds(
                target,
                this.targetBox,
                forceWorldTransformRefresh,
            );
            const isIntersecting = this.objBox.intersectsBox(targetBox);
            if (target === this.player) {
                obj.userData.isCollidingWithPlayer = isIntersecting;
            }
            if (debug) {
                console.log("isColliding.useBoundingBoxes", this.objBox, targetBox, isIntersecting);
            }
            return isIntersecting;
        }

        // Distance mode is intentionally a simple proximity trigger. Use
        // bounding boxes or physics listeners for shape-accurate collision.
        const collisionThreshold = distanceThreshold || obj.userData.collision_sensitivity;
        this.distanceWorldMatrixCache.updateAutoMatrices(obj, forceWorldTransformRefresh);
        this.distanceWorldMatrixCache.updateAutoMatrices(target, forceWorldTransformRefresh);
        this.objectWorldPosition.setFromMatrixPosition(obj.matrixWorld);
        this.targetWorldPosition.setFromMatrixPosition(target.matrixWorld);
        const distanceSq = this.objectWorldPosition.distanceToSquared(this.targetWorldPosition);
        const thresholdSq = collisionThreshold * collisionThreshold;
        const isIntersecting = distanceSq <= thresholdSq;
        if (debug) {
            console.log("isColliding.useDistance", Math.sqrt(distanceSq), collisionThreshold, isIntersecting);
        }
        return isIntersecting;
    }

    update() {
        if (this.objectsWithPhysics.size > 0) {
            this.detectCollisionViaPhysics();
        }
        if (this.objectsWithoutPhysics.size > 0) {
            this.detectCollisionViaDistance();
        }
    }

    private detectCollisionViaDistance() {
        const player = this.player;
        let playerBoundingBox: Box3 | null = null;
        let forceWorldTransformRefresh = false;
        this.distanceWorldMatrixCache.beginFrame();
        try {
            for (const [obj, listenerArr] of this.objectsWithoutPhysics) {
                const collisionResults = listenerArr.length > 1 ? this.distanceCollisionResults : null;
                collisionResults?.clear();

                for (const listener of listenerArr) {
                    if (listener.type === COLLISION_TYPE.WITH_PLAYER) {
                        if (!player) continue;
                        let isColliding: boolean;
                        if (collisionResults) {
                            const collisionKey = this.getDistanceCollisionKey(listener);
                            const cachedResult = collisionResults.get(collisionKey);
                            if (cachedResult !== undefined) {
                                isColliding = cachedResult;
                            } else {
                                if (listener.useBoundingBoxes === true && playerBoundingBox === null) {
                                    playerBoundingBox = this.setWorldBounds(
                                        player,
                                        this.targetBox,
                                        forceWorldTransformRefresh,
                                    );
                                }
                                isColliding = this.isColliding(
                                    obj,
                                    player,
                                    !!listener.useBoundingBoxes,
                                    listener.distanceThreshold,
                                    false,
                                    listener.useBoundingBoxes === true ? playerBoundingBox ?? undefined : undefined,
                                    forceWorldTransformRefresh,
                                );
                                forceWorldTransformRefresh = false;
                                collisionResults.set(collisionKey, isColliding);
                            }
                        } else {
                            if (listener.useBoundingBoxes === true && playerBoundingBox === null) {
                                playerBoundingBox = this.setWorldBounds(
                                    player,
                                    this.targetBox,
                                    forceWorldTransformRefresh,
                                );
                            }
                            isColliding = this.isColliding(
                                obj,
                                player,
                                !!listener.useBoundingBoxes,
                                listener.distanceThreshold,
                                false,
                                listener.useBoundingBoxes === true ? playerBoundingBox ?? undefined : undefined,
                                forceWorldTransformRefresh,
                            );
                            forceWorldTransformRefresh = false;
                        }
                        if (isColliding) {
                            listener.callback({
                                target: obj,
                                other: player,
                                listener,
                                source: "distance",
                            });
                            // Collision callbacks can move either participant.
                            playerBoundingBox = null;
                            forceWorldTransformRefresh = true;
                        }
                    } else {
                        console.warn("Unsupported collision type: "+listener.type);
                    }
                }
            }
        } finally {
            this.distanceWorldMatrixCache.endFrame();
        }
    }

    private getDistanceCollisionKey(listener: CollisionListener): number {
        if (listener.useBoundingBoxes === true) {
            return CollisionDetector.BOUNDING_BOX_COLLISION_CACHE_KEY;
        }

        return listener.distanceThreshold ?? CollisionDetector.DEFAULT_COLLISION_THRESHOLD;
    }

    private setWorldBounds(object: Object3D, target: Box3, forcePath = false): Box3 {
        if (object.parent) {
            this.distanceWorldMatrixCache.updateAutoMatrices(object.parent, forcePath);
        }
        return BoundingBoxUtil.updateAndGetBox(object, forcePath, target);
    }

    private detectCollisionViaPhysics() {
        for (const collision of this.lastCollisionsViaPhysics) {
            const target = this.uuidToObjects.get(collision.uuid);
            if (target) {
                const listener = this.physicsListenersByObjectUuid.get(collision.uuid)?.get(collision.listenerId);
                if (listener) {
                    listener.callback({
                        target,
                        other: listener.type === COLLISION_TYPE.WITH_PLAYER ? this.player : undefined,
                        listener,
                        source: "physics",
                        collision,
                    });
                } else {
                    console.warn("detectCollisionViaPhysics failed to get listener: " + collision.listenerId);
                }
            } else {
                console.warn("detectCollisionViaPhysics failed to get object by uuid: " + collision.uuid);
            }
        }
        this.lastCollisionsViaPhysics.length = 0;
    }

    private onCollisionViaPhysics(collision: CollisionData) {
        this.lastCollisionsViaPhysics.push(collision);
    }

    private removeListener(
        map: Map<Object3D, CollisionListener[]>,
        target: Object3D,
        listenerId: string,
    ): boolean {
        const listeners = map.get(target);
        if (!listeners) return false;

        if (!listenerId) {
            map.delete(target);
            return listeners.length > 0;
        }

        let writeIndex = 0;
        let removed = false;
        for (let readIndex = 0; readIndex < listeners.length; readIndex++) {
            const listener = listeners[readIndex]!;
            if (listener.id === listenerId) {
                removed = true;
                continue;
            }
            listeners[writeIndex++] = listener;
        }
        listeners.length = writeIndex;
        if (listeners.length === 0) {
            map.delete(target);
        }
        return removed;
    }
}

export default CollisionDetector;

import {Box3, Euler, Object3D, SkinnedMesh, Sphere, Vector3, Vector3Like} from "three";

import {
    traverseObjectDepthFirst,
    traverseObjectVisibleDepthFirst,
    updateObjectMatrixWorldDepthFirst,
} from "./SceneTraverser";

export type CapsuleShape = {
    radius: number;
    height: number;
    center: Vector3Like;
};

export default class BoundingBoxUtil {
    private static tmpVector = new Vector3();
    private static getBoxChildBox = new Box3();
    private static radiusSphere = new Sphere();
    private static radiusChildSphere = new Sphere();
    private static capsuleBox = new Box3();
    private static objectsCenterBox = new Box3();
    private static objectsCenterChildBox = new Box3();
    private static objectsCenterWorldPosition = new Vector3();
    private static savedPosition = new Vector3();
    private static savedRotation = new Euler();
    private static savedScale = new Vector3();
    private static updateBoundsNodes: Object3D[] = [];
    private static updateBoundsForces: boolean[] = [];
    private static updateBoundsSkipMatrices: boolean[] = [];

    private static markMatrixWorldDirty(object: Object3D): void {
        object.matrixWorldNeedsUpdate = true;
        traverseObjectDepthFirst(object, (child) => {
            child.matrixWorldNeedsUpdate = true;
        });
    }

    private static withIdentityRootTransform<T>(object: Object3D, callback: () => T): T {
        const parent = object.parent;
        if (parent) {
            object.parent = null;
        }

        BoundingBoxUtil.savedPosition.copy(object.position);
        BoundingBoxUtil.savedRotation.copy(object.rotation);
        BoundingBoxUtil.savedScale.copy(object.scale);

        object.position.set(0, 0, 0);
        object.rotation.set(0, 0, 0);
        object.scale.set(1, 1, 1);
        updateObjectMatrixWorldDepthFirst(object, true);

        try {
            return callback();
        } finally {
            object.position.copy(BoundingBoxUtil.savedPosition);
            object.rotation.copy(BoundingBoxUtil.savedRotation);
            object.scale.copy(BoundingBoxUtil.savedScale);

            if (parent) {
                object.parent = parent;
            }

            BoundingBoxUtil.markMatrixWorldDirty(object);
        }
    }

    private static expandBoxByObjectGeometry(
        box: Box3,
        object: Object3D,
        childBox: Box3,
        skipInvisible = false,
    ): boolean {
        let hasGeometry = false;

        const traverseFn = (child: Object3D) => {
            hasGeometry = BoundingBoxUtil.expandBoxByGeometry(box, child, childBox) || hasGeometry;
        };

        if (skipInvisible) {
            traverseObjectVisibleDepthFirst(object, traverseFn);
        } else {
            traverseObjectDepthFirst(object, traverseFn);
        }

        return hasGeometry;
    }

    private static expandBoxByGeometry(box: Box3, child: Object3D, childBox: Box3): boolean {
        // This mirrors THREE.Box3.expandByObject() while allowing iterative traversal.
        const childAsAny = child as SkinnedMesh;
        const geometry = childAsAny.geometry;
        if (!geometry) {
            return false;
        }
        if (childAsAny.isSkinnedMesh) {
            if (typeof childAsAny.computeBoundingBox === "function") {
                childAsAny.computeBoundingBox();
            }
            if (childAsAny.boundingBox) {
                childBox.copy(childAsAny.boundingBox);
            } else {
                if (geometry.boundingBox === null) geometry.computeBoundingBox();
                childBox.copy(geometry.boundingBox!);
            }
        } else if (childAsAny.boundingBox !== undefined) {
            if (childAsAny.boundingBox === null) {
                childAsAny.computeBoundingBox();
            }
            childBox.copy(childAsAny.boundingBox!);
        } else {
            if (geometry.boundingBox === null) {
                geometry.computeBoundingBox();
            }
            childBox.copy(geometry.boundingBox!);
        }

        childBox.applyMatrix4(child.matrixWorld);
        box.union(childBox);
        return true;
    }

    public static isInfiniteBox(box: Box3) {
        return box.min.x === Infinity || box.min.x === -Infinity ||
               box.min.y === Infinity || box.min.y === -Infinity ||
               box.min.z === Infinity || box.min.z === -Infinity ||
               box.max.x === Infinity || box.max.x === -Infinity ||
               box.max.y === Infinity || box.max.y === -Infinity ||
               box.max.z === Infinity || box.max.z === -Infinity;
    }

    public static getBox(object: Object3D, skipInvisible = false, target = new Box3()): Box3 {
        target.makeEmpty();
        BoundingBoxUtil.expandBoxByObjectGeometry(
            target,
            object,
            BoundingBoxUtil.getBoxChildBox,
            skipInvisible,
        );
        return target;
    }

    public static updateAndGetBox(object: Object3D, force = false, target = new Box3()): Box3 {
        target.makeEmpty();
        const nodes = BoundingBoxUtil.updateBoundsNodes;
        const forces = BoundingBoxUtil.updateBoundsForces;
        const skipMatrices = BoundingBoxUtil.updateBoundsSkipMatrices;
        nodes.push(object);
        forces.push(force);
        skipMatrices.push(false);

        try {
            while (nodes.length > 0) {
                const node = nodes.pop()!;
                const nodeForce = forces.pop()!;
                const skipMatrixUpdate = skipMatrices.pop()!;
                let localForce = nodeForce;
                let skipChildMatrixUpdate = skipMatrixUpdate;

                if (!skipMatrixUpdate) {
                    if (node.updateMatrixWorld !== Object3D.prototype.updateMatrixWorld) {
                        node.updateMatrixWorld(nodeForce);
                        skipChildMatrixUpdate = true;
                    } else {
                        if (node.matrixAutoUpdate) node.updateMatrix();
                        if (node.matrixWorldNeedsUpdate || nodeForce) {
                            if (node.matrixWorldAutoUpdate) {
                                if (node.parent === null) node.matrixWorld.copy(node.matrix);
                                else node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
                            }
                            node.matrixWorldNeedsUpdate = false;
                            localForce = true;
                        }
                    }
                }

                BoundingBoxUtil.expandBoxByGeometry(target, node, BoundingBoxUtil.getBoxChildBox);

                const children = node.children;
                for (let i = children.length - 1; i >= 0; i--) {
                    const child = children[i];
                    if (!child) continue;
                    nodes.push(child);
                    forces.push(localForce);
                    skipMatrices.push(skipChildMatrixUpdate);
                }
            }
            return target;
        } finally {
            nodes.length = 0;
            forces.length = 0;
            skipMatrices.length = 0;
        }
    }

    /**
     * Return the local bounding box of an object and its children.
     * 
     * @param object - The object to get the local bounding box for
     * @param skipInvisible - Whether to skip invisible objects
     * @returns The local bounding box of the object.
     */
    public static getBoxWithoutTransform(object: Object3D, skipInvisible = false, target = new Box3()): Box3 {
        return BoundingBoxUtil.withIdentityRootTransform(
            object,
            () => BoundingBoxUtil.getBox(object, skipInvisible, target),
        );
    }

    /**
     * Calculates and returns the radius of the bounding sphere of an Object3D with its children.
     *
     * @param object - The Object3D for which to calculate the radius.
     * @param skipInvisible - Whether to skip invisible objects.
     * @returns The radius of the Object3D.
     */
    public static getRadius(object: Object3D, skipInvisible = false): number {
        if (skipInvisible && !object.visible) {
            return 0;
        }

        const sphere = BoundingBoxUtil.radiusSphere.makeEmpty();
        const childSphere = BoundingBoxUtil.radiusChildSphere;
        const visit = (child: Object3D) => {
            const mesh = child as SkinnedMesh;
            const geometry = mesh.geometry;
            if (!geometry) return;

            let bounds: Sphere | null = null;
            if (mesh.isSkinnedMesh && typeof mesh.computeBoundingSphere === "function") {
                mesh.computeBoundingSphere();
                bounds = mesh.boundingSphere;
            } else {
                if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
                bounds = geometry.boundingSphere;
            }
            if (!bounds || bounds.isEmpty()) return;

            childSphere.copy(bounds).applyMatrix4(child.matrixWorld);
            sphere.union(childSphere);
        };

        if (skipInvisible) {
            traverseObjectVisibleDepthFirst(object, visit);
        } else {
            traverseObjectDepthFirst(object, visit);
        }

        return sphere.isEmpty() ? 0 : sphere.radius;
    }

    /**
     * Return the local bounding radius of an object and its children.
     * 
     * @remarks
     * This may not produce a tight sphere when the object is not centered
     * around the origin.
     * 
     * @param object - The object to get the local bounding radius for
     * @param skipInvisible - Whether to skip invisible objects
     * @returns The local bounding radius of the object.
     */
    public static getRadiusWithoutTransform(object: Object3D, skipInvisible = false): number {
        return BoundingBoxUtil.withIdentityRootTransform(
            object,
            () => BoundingBoxUtil.getRadius(object, skipInvisible),
        );
    }

    /**
     * Calculates the capsule shape parameters for a given Object3D with its children.
     *
     * @param object - The Object3D from which to get the capsule representation.
     * @param skipInvisible - Whether to skip invisible objects.
     * @returns The capsule representation of the object.
     */
    public static getCapsule(object: Object3D, skipInvisible = false): CapsuleShape {
        const box = BoundingBoxUtil.getBox(object, skipInvisible, BoundingBoxUtil.capsuleBox);
        if (box.isEmpty()) {
            return {
                radius: 0,
                height: 0,
                center: {x: 0, y: 0, z: 0},
            };
        }
        box.getCenter(BoundingBoxUtil.tmpVector);
        const width = box.max.x - box.min.x;
        const height = box.max.y - box.min.y;
        const length = box.max.z - box.min.z;
        const radius = Math.max(width, length) / 2;
        const capsuleHeight = Math.max(0, height - 2 * radius);
        return {
            radius,
            height: capsuleHeight,
            center: {
                x: BoundingBoxUtil.tmpVector.x,
                y: BoundingBoxUtil.tmpVector.y,
                z: BoundingBoxUtil.tmpVector.z,
            },
        };
    }

    /**
     * Return the local bounding capsule of an object and its children.
     * 
     * @param object - The object to get the local bounding capsule for
     * @param skipInvisible - Whether to skip invisible objects
     * @returns The local bounding capsule of the object.
     */
    public static getCapsuleWithoutTransform(object: Object3D, skipInvisible = false): CapsuleShape {
        return BoundingBoxUtil.withIdentityRootTransform(
            object,
            () => BoundingBoxUtil.getCapsule(object, skipInvisible),
        );
    }
    /**
     * Calculates the center of a collection of 3D objects.
     *
     * @param objects - An array of Object3D instances.
     * @returns The center point of the bounding box that encompasses all objects.
     */
    public static calculateObjectsCenter(objects: Object3D[], target = new Vector3()): Vector3 {
        if (!objects || objects.length === 0) {
            return target.set(0, 0, 0);
        }

        const box = BoundingBoxUtil.objectsCenterBox.makeEmpty();
        const childBox = BoundingBoxUtil.objectsCenterChildBox;
        const worldPos = BoundingBoxUtil.objectsCenterWorldPosition;

        for (let i = 0; i < objects.length; i++) {
            const object = objects[i]!;
            updateObjectMatrixWorldDepthFirst(object, true);
            if (!BoundingBoxUtil.expandBoxByObjectGeometry(box, object, childBox)) {
                object.getWorldPosition(worldPos);
                box.expandByPoint(worldPos);
            }
        }

        return box.getCenter(target);
    }

}

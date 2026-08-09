import {Box3, Matrix4, Mesh, Object3D, Quaternion, SkinnedMesh, Vector3} from "three";
import {updateObjectMatrixWorldDepthFirst} from "../utils/SceneTraverser";
/**
 * Result of computing an oriented bounding box for an Object3D.
 *
 * - `box` is an axis-aligned Box3 expressed in a local frame that has the
 *   object's world position and rotation removed but its world scale
 *   preserved. In that frame the box is tight to the geometry's natural
 *   axes.
 * - `basis` is the position+rotation of the object in world space (no
 *   scale), so `basis * compose(center, identity, size)` reconstructs the
 *   oriented box in world space.
 */
export interface OrientedBoxResult {
    box: Box3;
    basis: Matrix4;
    hasGeometry: boolean;
}

export interface ComputeOrientedBoxOptions {
    shouldAbort?: (object: Object3D) => boolean;
}

const _pos = new Vector3();
const _rot = new Quaternion();
const _scl = new Vector3();
const _one = new Vector3(1, 1, 1);
const _v = new Vector3();
const _skinnedVertex = new Vector3();
const _bounds = new Box3();
const _inv = new Matrix4();
const _childMat = new Matrix4();
const _sizeResult: OrientedBoxResult = {
    box: new Box3(),
    basis: new Matrix4(),
    hasGeometry: false,
};
const DEFAULT_COMPUTE_OPTIONS: ComputeOrientedBoxOptions = {};

type ObjectWithBounds = Object3D & {
    boundingBox?: Box3 | null;
    computeBoundingBox?: () => void;
    getBoundingBox?: (centersOnly?: boolean) => Box3;
};

const isSkinnedMesh = (object: Object3D): object is SkinnedMesh => {
    return (object as SkinnedMesh).isSkinnedMesh === true;
};

const expandBoxCorners = (
    box: Box3,
    matrix: Matrix4,
    target: Box3,
): boolean => {
    if (box.isEmpty()) return false;

    for (let i = 0; i < 8; i++) {
        _v.set(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(matrix);
        target.expandByPoint(_v);
    }

    return true;
};

const expandSkinnedMeshVertices = (
    mesh: SkinnedMesh,
    orientedInverse: Matrix4,
    target: Box3,
): boolean => {
    const positions = mesh.geometry.getAttribute("position");
    if (!positions) return false;

    _childMat.multiplyMatrices(orientedInverse, mesh.matrixWorld);

    let expanded = false;
    for (let i = 0; i < positions.count; i++) {
        mesh.getVertexPosition(i, _skinnedVertex);
        _skinnedVertex.applyMatrix4(_childMat);
        target.expandByPoint(_skinnedVertex);
        expanded = true;
    }

    return expanded;
};

export const createOrientedBoxResult = (): OrientedBoxResult => ({
    box: new Box3(),
    basis: new Matrix4(),
    hasGeometry: false,
});

export const computeOrientedBox = (
    object: Object3D,
    target: OrientedBoxResult = createOrientedBoxResult(),
    options: ComputeOrientedBoxOptions = DEFAULT_COMPUTE_OPTIONS,
): OrientedBoxResult => {
    updateObjectMatrixWorldDepthFirst(object, true);
    object.matrixWorld.decompose(_pos, _rot, _scl);
    target.basis.compose(_pos, _rot, _one);
    _inv.copy(target.basis).invert();

    target.box.makeEmpty();
    let hasGeometry = false;
    const stack: Object3D[] = [object];

    while (stack.length > 0) {
        const child = stack.pop();
        if (!child) continue;
        if (options.shouldAbort?.(child)) {
            target.box.makeEmpty();
            target.hasGeometry = false;
            return target;
        }

        const mesh = child as Mesh;
        const geom = mesh.geometry;
        const childWithBounds = child as ObjectWithBounds;

        if (geom && isSkinnedMesh(child)) {
            if (expandSkinnedMeshVertices(child, _inv, target.box)) {
                hasGeometry = true;
            }
        } else {
            _bounds.makeEmpty();

            if (typeof childWithBounds.getBoundingBox === "function") {
                try {
                    _bounds.copy(childWithBounds.getBoundingBox(false));
                } catch {
                    _bounds.makeEmpty();
                }
            }

            if (_bounds.isEmpty() && childWithBounds.boundingBox !== undefined) {
                if (childWithBounds.boundingBox === null) {
                    childWithBounds.computeBoundingBox?.();
                }
                if (childWithBounds.boundingBox) {
                    _bounds.copy(childWithBounds.boundingBox);
                }
            }

            if (_bounds.isEmpty() && geom) {
                if (!geom.boundingBox) geom.computeBoundingBox();
                if (geom.boundingBox) {
                    _bounds.copy(geom.boundingBox);
                }
            }

            if (!_bounds.isEmpty()) {
                _childMat.multiplyMatrices(_inv, child.matrixWorld);
                if (expandBoxCorners(_bounds, _childMat, target.box)) {
                    hasGeometry = true;
                }
            }
        }

        for (let index = child.children.length - 1; index >= 0; index--) {
            const descendant = child.children[index];
            if (descendant) stack.push(descendant);
        }
    }

    target.hasGeometry = hasGeometry;
    return target;
};

/**
 * Returns the oriented (object-aligned) size of an Object3D's geometry in
 * world units. Unlike `Box3.setFromObject`, this is invariant to the
 * object's world rotation: it gives the size you would see if the object
 * were aligned to world axes.
 *
 * @param object
 * @param target
 * @returns
 */
export const computeOrientedSize = (
    object: Object3D,
    target: Vector3 = new Vector3(),
): Vector3 => {
    const result = computeOrientedBox(object, _sizeResult);
    if (!result.hasGeometry || result.box.isEmpty()) {
        return target.set(0, 0, 0);
    }
    return result.box.getSize(target);
};

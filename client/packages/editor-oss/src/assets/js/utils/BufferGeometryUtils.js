import {
    computeMikkTSpaceTangents,
    computeMorphedAttributes,
    deepCloneAttribute,
    deinterleaveAttribute,
    deinterleaveGeometry,
    estimateBytesUsed,
    interleaveAttributes,
    mergeAttributes,
    mergeGeometries,
    mergeGroups,
    mergeVertices,
    toCreasedNormals,
    toTrianglesDrawMode,
} from "three/addons/utils/BufferGeometryUtils.js";

class BufferGeometryUtils {
    static computeTangents(geometry) {
        geometry.computeTangents();
        console.warn(
            "THREE.BufferGeometryUtils: .computeTangents() has been removed. Use THREE.BufferGeometry.computeTangents() instead.",
        );
    }

    static mergeBufferGeometries(geometries, useGroups = false) {
        return mergeGeometries(geometries, useGroups);
    }

    static mergeBufferAttributes(attributes) {
        return mergeAttributes(attributes);
    }

    static interleaveAttributes(attributes) {
        return interleaveAttributes(attributes);
    }

    static estimateBytesUsed(geometry) {
        return estimateBytesUsed(geometry);
    }

    static mergeVertices(geometry, tolerance = 1e-4) {
        return mergeVertices(geometry, tolerance);
    }

    static toTrianglesDrawMode(geometry, drawMode) {
        return toTrianglesDrawMode(geometry, drawMode);
    }

    static computeMorphedAttributes(object) {
        return computeMorphedAttributes(object);
    }

    static computeMikkTSpaceTangents(geometry, mikkTSpace, negateSign = true) {
        return computeMikkTSpaceTangents(geometry, mikkTSpace, negateSign);
    }

    static deepCloneAttribute(attribute) {
        return deepCloneAttribute(attribute);
    }

    static deinterleaveAttribute(attribute) {
        return deinterleaveAttribute(attribute);
    }

    static deinterleaveGeometry(geometry) {
        return deinterleaveGeometry(geometry);
    }

    static mergeGroups(geometry) {
        return mergeGroups(geometry);
    }

    static toCreasedNormals(geometry, creaseAngle = Math.PI / 3) {
        return toCreasedNormals(geometry, creaseAngle);
    }
}

export {
    computeMikkTSpaceTangents,
    computeMorphedAttributes,
    deepCloneAttribute,
    deinterleaveAttribute,
    deinterleaveGeometry,
    estimateBytesUsed,
    interleaveAttributes,
    mergeAttributes,
    mergeGeometries,
    mergeGroups,
    mergeVertices,
    toCreasedNormals,
    toTrianglesDrawMode,
};
export default BufferGeometryUtils;

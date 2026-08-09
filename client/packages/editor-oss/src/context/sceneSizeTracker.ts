import type {Object3D} from "three";

import {traverseObjectDepthFirst} from "../utils/SceneTraverser";

export type ObjectSizeCalculator = (object: Object3D) => number;

export function collectObjectSizeMap(
    root: Object3D,
    calculateObjectSize: ObjectSizeCalculator,
    options: {includeRoot?: boolean} = {},
): Map<string, number> {
    const sizeMap = new Map<string, number>();
    writeObjectSizesToMap(sizeMap, root, calculateObjectSize, options);
    return sizeMap;
}

export function writeObjectSizesToMap(
    sizeMap: Map<string, number>,
    root: Object3D,
    calculateObjectSize: ObjectSizeCalculator,
    options: {includeRoot?: boolean} = {},
): void {
    traverseObjectDepthFirst(root, object => {
        if (object.uuid) {
            sizeMap.set(object.uuid, calculateObjectSize(object));
        }
    }, {includeRoot: options.includeRoot ?? true});
}

export function deleteObjectSizesFromMap(sizeMap: Map<string, number>, root: Object3D): void {
    traverseObjectDepthFirst(root, object => {
        if (object.uuid) {
            sizeMap.delete(object.uuid);
        }
    });
}

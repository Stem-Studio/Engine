import type {Object3D} from "three";

export function getChildIndexPath(root: Object3D, target: Object3D): number[] | null {
    const path: number[] = [];
    let node: Object3D | null = target;

    while (node && node !== root) {
        const parent: Object3D | null = node.parent;
        if (!parent) return null;
        const index = parent.children.indexOf(node);
        if (index < 0) return null;
        path.unshift(index);
        node = parent;
    }

    return node === root ? path : null;
}

export function getObjectByChildIndexPath(root: Object3D, path: readonly number[]): Object3D | null {
    let node: Object3D | undefined = root;

    for (const index of path) {
        node = node.children[index];
        if (!node) return null;
    }

    return node;
}

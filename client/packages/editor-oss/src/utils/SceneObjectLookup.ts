import type {Object3D} from "three";

import {findObjectDepthFirst, traverseObjectDepthFirst} from "./SceneTraverser";

type RootProvider = Object3D | (() => Object3D);
type ObjectReference = WeakRef<Object3D>;

/**
 * Lazily indexes a scene hierarchy for repeated ID and UUID lookups.
 * Direct hierarchy mutations remain supported: misses fall back to one
 * iterative walk, while stale entries are rejected by checking ancestry.
 */
export class SceneObjectLookup {
    private readonly rootProvider: RootProvider;
    private indexedRoot: Object3D | null = null;
    private fullyIndexed = false;
    private readonly objectsById = new Map<number, ObjectReference>();
    private readonly objectsByUuid = new Map<string, ObjectReference>();

    constructor(rootProvider: RootProvider) {
        this.rootProvider = rootProvider;
    }

    clear(): void {
        this.indexedRoot = null;
        this.fullyIndexed = false;
        this.objectsById.clear();
        this.objectsByUuid.clear();
    }

    registerTree(object: Object3D): void {
        const root = this.ensureRoot();
        if (!this.belongsToRoot(object, root)) return;
        traverseObjectDepthFirst(object, child => this.cache(child));
    }

    unregisterTree(object: Object3D): void {
        traverseObjectDepthFirst(object, child => {
            if (this.objectsById.get(child.id)?.deref() === child) {
                this.objectsById.delete(child.id);
            }
            if (this.objectsByUuid.get(child.uuid)?.deref() === child) {
                this.objectsByUuid.delete(child.uuid);
            }
        });
    }

    getById(id: number): Object3D | null {
        if (!Number.isFinite(id)) return null;

        const root = this.ensureRoot();
        this.ensureIndexed(root);

        const cached = this.objectsById.get(id)?.deref();
        if (cached && cached.id === id && this.belongsToRoot(cached, root)) {
            return cached;
        }
        if (cached) this.objectsById.delete(id);

        return this.findAndCache(root, object => object.id === id);
    }

    getByUuid(uuid: string | null | undefined): Object3D | null {
        if (!uuid) return null;

        const root = this.ensureRoot();
        this.ensureIndexed(root);

        const cached = this.objectsByUuid.get(uuid)?.deref();
        if (cached && cached.uuid === uuid && this.belongsToRoot(cached, root)) {
            return cached;
        }
        if (cached) this.objectsByUuid.delete(uuid);

        return this.findAndCache(root, object => object.uuid === uuid);
    }

    private getRoot(): Object3D {
        return typeof this.rootProvider === "function" ? this.rootProvider() : this.rootProvider;
    }

    private ensureRoot(): Object3D {
        const root = this.getRoot();
        if (root !== this.indexedRoot) {
            this.indexedRoot = root;
            this.fullyIndexed = false;
            this.objectsById.clear();
            this.objectsByUuid.clear();
        }
        return root;
    }

    private ensureIndexed(root: Object3D): void {
        if (this.fullyIndexed) return;

        traverseObjectDepthFirst(root, object => this.cache(object));
        this.fullyIndexed = true;
    }

    private findAndCache(root: Object3D, predicate: (object: Object3D) => boolean): Object3D | null {
        const found = findObjectDepthFirst(root, predicate);
        if (found) this.cache(found);
        return found;
    }

    private cache(object: Object3D): void {
        const reference = new WeakRef(object);
        this.objectsById.set(object.id, reference);
        this.objectsByUuid.set(object.uuid, reference);
    }

    private belongsToRoot(object: Object3D, root: Object3D): boolean {
        for (let current: Object3D | null = object; current; current = current.parent) {
            if (current === root) return true;
        }
        return false;
    }
}

export default SceneObjectLookup;

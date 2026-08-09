import {Object3D} from "three";

export class FrameWorldMatrixCache {
    private epoch = 0;
    private active = false;
    private currentEpochs = new WeakMap<Object3D, number>();
    private changedAncestorEpochs = new WeakMap<Object3D, number>();
    private autoUpdatedEpochs = new WeakMap<Object3D, number>();
    private worldChangedEpochs = new WeakMap<Object3D, number>();
    private readonly checkPath: Object3D[] = [];

    beginFrame(): void {
        this.epoch++;
        if (!Number.isSafeInteger(this.epoch)) {
            this.epoch = 1;
            this.currentEpochs = new WeakMap();
            this.changedAncestorEpochs = new WeakMap();
            this.autoUpdatedEpochs = new WeakMap();
            this.worldChangedEpochs = new WeakMap();
        }
        this.active = true;
    }

    endFrame(): void {
        this.active = false;
        this.checkPath.length = 0;
    }

    ensureCurrent(object: Object3D): void {
        if (this.isCurrent(object)) {
            return;
        }
        object.updateWorldMatrix(true, false);
        this.markCurrent(object);
    }

    /**
     * Updates local auto matrices and composes the object's world matrix while
     * reusing shared ancestors already processed in the active frame.
     */
    updateAutoMatrices(object: Object3D, forcePath = false): void {
        if (!this.active) {
            object.updateWorldMatrix(true, false, forcePath);
            return;
        }

        const path = this.checkPath;
        path.length = 0;
        let node: Object3D | null = object;
        while (node) {
            if (!forcePath && this.autoUpdatedEpochs.get(node) === this.epoch) {
                break;
            }
            path.push(node);
            node = node.parent;
        }

        let parentWorldChanged = node !== null && this.worldChangedEpochs.get(node) === this.epoch;
        for (let i = path.length - 1; i >= 0; i--) {
            const current = path[i]!;
            if (current.matrixAutoUpdate) {
                current.updateMatrix();
            }

            const needsWorldUpdate = forcePath || parentWorldChanged || current.matrixWorldNeedsUpdate;
            let worldChanged = false;
            if (needsWorldUpdate) {
                if (current.matrixWorldAutoUpdate) {
                    if (current.parent === null) {
                        current.matrixWorld.copy(current.matrix);
                    } else {
                        current.matrixWorld.multiplyMatrices(current.parent.matrixWorld, current.matrix);
                    }
                    worldChanged = true;
                }
                current.matrixWorldNeedsUpdate = false;
            }

            this.autoUpdatedEpochs.set(current, this.epoch);
            if (worldChanged) {
                this.worldChangedEpochs.set(current, this.epoch);
            }
            parentWorldChanged = worldChanged;
        }
    }

    markCurrent(object: Object3D): void {
        if (this.active) {
            this.currentEpochs.set(object, this.epoch);
        }
    }

    reset(): void {
        this.endFrame();
        this.epoch = 0;
        this.currentEpochs = new WeakMap();
        this.changedAncestorEpochs = new WeakMap();
        this.autoUpdatedEpochs = new WeakMap();
        this.worldChangedEpochs = new WeakMap();
    }

    isCurrent(object: Object3D): boolean {
        if (!this.active) {
            let node: Object3D | null = object;
            while (node) {
                if (node.matrixWorldNeedsUpdate) {
                    return false;
                }
                node = node.parent;
            }
            return true;
        }

        const path = this.checkPath;
        path.length = 0;
        let node: Object3D | null = object;
        while (node) {
            path.push(node);
            if (this.changedAncestorEpochs.get(node) === this.epoch) {
                return false;
            }
            if (node.matrixWorldNeedsUpdate) {
                this.changedAncestorEpochs.set(node, this.epoch);
                return false;
            }
            if (this.currentEpochs.get(node) === this.epoch) {
                this.markPathCurrent(path);
                return true;
            }
            node = node.parent;
        }
        this.markPathCurrent(path);
        return true;
    }

    private markPathCurrent(path: readonly Object3D[]): void {
        for (let i = 0; i < path.length; i++) {
            this.currentEpochs.set(path[i]!, this.epoch);
        }
    }
}

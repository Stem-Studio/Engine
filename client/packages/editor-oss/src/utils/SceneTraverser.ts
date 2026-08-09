import {Object3D} from "three";

/**
 * A handler registered with SceneTraverser.
 * `test` is called for every visible node; if it returns true, the node
 * is appended to the handler's results array.
 */
export interface TraversalHandler<T extends Object3D = Object3D> {
    /** Return true to collect this node. */
    test(node: T): boolean;
    /** Results for the current frame. The array is reused across updates. */
    results: T[];
    /** Increments only when the ordered result identities change. */
    revision?: number;
}

export interface TraversalUpdateOptions {
    /** Force descendant world matrices to recompute. Matches Object3D.updateMatrixWorld(force). */
    force?: boolean;
    /** Run handler tests and collect results. Disable for matrix-only render passes. */
    collectHandlers?: boolean;
}

type SceneTraversalHandler = TraversalHandler<Object3D>;

export interface TraverseObjectOptions {
    includeRoot?: boolean;
}

/**
 * A node consumer used by the shared mutation walk. Returning false prunes
 * only that consumer's descendants; other consumers continue to receive
 * nodes below the same object. This lets independent tree registries retain
 * their candidate short-circuiting while sharing one iterative walk.
 */
export type TraversalConsumer = (object: Object3D) => boolean;

interface TraversalConsumerStackEntry {
    object: Object3D;
    activeConsumers: boolean[];
}

/**
 * Walk an object tree once, carrying per-consumer descend state through the
 * iterative stack. The root is always visited. Consumers are called in the
 * order supplied, which is significant when an earlier consumer annotates a
 * node for a later consumer.
 */
export function traverseObjectDepthFirstWithConsumers(
    root: Object3D,
    consumers: readonly TraversalConsumer[],
): void {
    if (consumers.length === 0) return;

    const stack: TraversalConsumerStackEntry[] = [{
        object: root,
        activeConsumers: consumers.map(() => true),
    }];

    while (stack.length > 0) {
        const entry = stack.pop();
        if (!entry) continue;

        const nextActiveConsumers = entry.activeConsumers.slice();
        let hasActiveConsumer = false;
        for (let i = 0; i < consumers.length; i++) {
            if (!entry.activeConsumers[i]) continue;
            nextActiveConsumers[i] = consumers[i]!(entry.object);
            hasActiveConsumer ||= nextActiveConsumers[i]!;
        }

        if (!hasActiveConsumer) continue;

        const children = entry.object.children;
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            if (child) {
                stack.push({object: child, activeConsumers: nextActiveConsumers.slice()});
            }
        }
    }
}

export function traverseObjectDepthFirst(
    root: Object3D,
    callback: (object: Object3D) => void,
    options: TraverseObjectOptions = {},
): void {
    const includeRoot = options.includeRoot ?? true;
    const stack: Object3D[] = [];

    if (includeRoot) {
        stack.push(root);
    } else {
        for (let i = root.children.length - 1; i >= 0; i--) {
            const child = root.children[i];
            if (child) stack.push(child);
        }
    }

    while (stack.length > 0) {
        const object = stack.pop();
        if (!object) continue;

        callback(object);

        for (let i = object.children.length - 1; i >= 0; i--) {
            const child = object.children[i];
            if (child) stack.push(child);
        }
    }
}

export function findObjectDepthFirst(
    root: Object3D,
    predicate: (object: Object3D) => boolean,
    options: TraverseObjectOptions = {},
): Object3D | null {
    const includeRoot = options.includeRoot ?? true;
    const stack: Object3D[] = [];

    if (includeRoot) {
        stack.push(root);
    } else {
        for (let i = root.children.length - 1; i >= 0; i--) {
            const child = root.children[i];
            if (child) stack.push(child);
        }
    }

    while (stack.length > 0) {
        const object = stack.pop();
        if (!object) continue;

        if (predicate(object)) {
            return object;
        }

        for (let i = object.children.length - 1; i >= 0; i--) {
            const child = object.children[i];
            if (child) stack.push(child);
        }
    }

    return null;
}

export function findObjectByUuidDepthFirst(
    root: Object3D,
    uuid: string | null | undefined,
    options: TraverseObjectOptions = {},
): Object3D | null {
    if (!uuid) {
        return null;
    }

    return findObjectDepthFirst(root, object => object.uuid === uuid, options);
}

export function findObjectByNameDepthFirst(
    root: Object3D,
    name: string | null | undefined,
    options: TraverseObjectOptions = {},
): Object3D | null {
    if (!name) {
        return null;
    }

    return findObjectDepthFirst(root, object => object.name === name, options);
}

export function findObjectByUuidOrNameDepthFirst(
    root: Object3D,
    identifier: string | null | undefined,
    options: TraverseObjectOptions = {},
): Object3D | null {
    if (!identifier) {
        return null;
    }

    const includeRoot = options.includeRoot ?? true;
    const stack: Object3D[] = [];
    let firstNameMatch: Object3D | null = null;

    if (includeRoot) {
        stack.push(root);
    } else {
        const rootChildren = root.children;
        for (let i = rootChildren.length - 1; i >= 0; i--) {
            const child = rootChildren[i];
            if (child) stack.push(child);
        }
    }

    while (stack.length > 0) {
        const object = stack.pop();
        if (!object) continue;

        if (object.uuid === identifier) {
            return object;
        }
        if (firstNameMatch === null && object.name === identifier) {
            firstNameMatch = object;
        }

        const children = object.children;
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            if (child) stack.push(child);
        }
    }

    return firstNameMatch;
}

export function traverseObjectVisibleDepthFirst(
    root: Object3D,
    callback: (object: Object3D) => void,
    options: TraverseObjectOptions = {},
): void {
    const includeRoot = options.includeRoot ?? true;
    const stack: Object3D[] = [];

    if (includeRoot) {
        stack.push(root);
    } else {
        for (let i = root.children.length - 1; i >= 0; i--) {
            const child = root.children[i];
            if (child) stack.push(child);
        }
    }

    while (stack.length > 0) {
        const object = stack.pop();
        if (!object || !object.visible) continue;

        callback(object);

        for (let i = object.children.length - 1; i >= 0; i--) {
            const child = object.children[i];
            if (child) stack.push(child);
        }
    }
}

export function updateObjectMatrixWorldDepthFirst(root: Object3D, force = false): void {
    const stackNodes: Object3D[] = [root];
    const stackForces: boolean[] = [force];
    const stackSkipMatrixUpdates: boolean[] = [false];

    while (stackNodes.length > 0) {
        const node = stackNodes.pop()!;
        const nodeForce = stackForces.pop()!;
        const skipMatrixUpdate = stackSkipMatrixUpdates.pop()!;
        let localForce = nodeForce;
        let skipChildMatrixUpdate = skipMatrixUpdate;

        if (!skipMatrixUpdate) {
            if (node.updateMatrixWorld !== Object3D.prototype.updateMatrixWorld) {
                node.updateMatrixWorld(nodeForce);
                skipChildMatrixUpdate = true;
            } else {
                if (node.matrixAutoUpdate) node.updateMatrix();
                if (node.matrixWorldNeedsUpdate || nodeForce) {
                    if (node.matrixWorldAutoUpdate === true) {
                        if (node.parent === null) node.matrixWorld.copy(node.matrix);
                        else node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
                    }
                    node.matrixWorldNeedsUpdate = false;
                    localForce = true;
                }
            }
        }

        const children = node.children;
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            if (child === undefined) continue;
            stackNodes.push(child);
            stackForces.push(localForce);
            stackSkipMatrixUpdates.push(skipChildMatrixUpdate);
        }
    }
}

export function traverseObjectReversePostOrder(
    root: Object3D,
    callback: (object: Object3D) => void,
    options: TraverseObjectOptions = {},
): void {
    const includeRoot = options.includeRoot ?? true;
    const stackNodes: Object3D[] = [];
    const stackExpanded: boolean[] = [];
    const pushNode = (node: Object3D, expanded: boolean) => {
        stackNodes.push(node);
        stackExpanded.push(expanded);
    };

    if (includeRoot) {
        pushNode(root, false);
    } else {
        for (let i = 0; i < root.children.length; i++) {
            const child = root.children[i];
            if (child) pushNode(child, false);
        }
    }

    while (stackNodes.length > 0) {
        const object = stackNodes.pop();
        const expanded = stackExpanded.pop();
        if (!object) continue;

        if (expanded) {
            callback(object);
            continue;
        }

        pushNode(object, true);
        for (let i = 0; i < object.children.length; i++) {
            const child = object.children[i];
            if (child) pushNode(child, false);
        }
    }
}

export default class SceneTraverser {
    private root: Object3D;
    private skipRoots: Set<Object3D> = new Set();
    private handlers: SceneTraversalHandler[] = [];
    private readonly stackNodes: Object3D[] = [];
    private readonly stackForces: boolean[] = [];
    private readonly stackSkipMatrixUpdates: boolean[] = [];
    private readonly handlerWriteCounts: number[] = [];
    private readonly handlerResultsChanged: boolean[] = [];

    constructor(root: Object3D) {
        this.root = root;
    }

    /**
     * Register a handler whose `test` is called for every visible node each frame.
     * @param handler
     */
    addHandler<T extends Object3D>(handler: TraversalHandler<T>): void {
        const sceneHandler = handler as unknown as SceneTraversalHandler;
        if (!this.handlers.includes(sceneHandler)) {
            sceneHandler.revision ??= 0;
            this.handlers.push(sceneHandler);
        }
    }

    removeHandler<T extends Object3D>(handler: TraversalHandler<T>): void {
        const sceneHandler = handler as unknown as SceneTraversalHandler;
        const idx = this.handlers.indexOf(sceneHandler);
        if (idx !== -1) this.handlers.splice(idx, 1);
    }

    /**
     * Subtrees rooted at these objects are skipped during traversal (e.g. batchRoot).
     * @param root
     */
    addSkipRoot(root: Object3D): void {
        this.skipRoots.add(root);
    }

    removeSkipRoot(root: Object3D): void {
        this.skipRoots.delete(root);
    }

    update(forceOrOptions: boolean | TraversalUpdateOptions = false): void {
        const options = typeof forceOrOptions === "object" ? forceOrOptions : null;
        const force = options?.force ?? (typeof forceOrOptions === "boolean" ? forceOrOptions : false);
        const collectHandlers = options?.collectHandlers ?? true;
        const handlers = this.handlers;
        const handlerWriteCounts = this.handlerWriteCounts;
        const handlerResultsChanged = this.handlerResultsChanged;
        handlerWriteCounts.length = handlers.length;
        handlerResultsChanged.length = handlers.length;
        for (let i = 0; i < handlers.length; i++) {
            handlerWriteCounts[i] = 0;
            handlerResultsChanged[i] = false;
            if (!collectHandlers && handlers[i]!.results.length > 0) {
                handlers[i]!.results.length = 0;
                handlers[i]!.revision = (handlers[i]!.revision ?? 0) + 1;
            }
        }
        const stackNodes = this.stackNodes;
        const stackForces = this.stackForces;
        const stackSkipMatrixUpdates = this.stackSkipMatrixUpdates;
        const activeHandlers = collectHandlers ? handlers : null;
        const skipRoots = this.skipRoots.size > 0 ? this.skipRoots : null;
        stackNodes.length = 0;
        stackForces.length = 0;
        stackSkipMatrixUpdates.length = 0;

        stackNodes.push(this.root);
        stackForces.push(force);
        stackSkipMatrixUpdates.push(false);

        while (stackNodes.length > 0) {
            const node = stackNodes.pop()!;
            const nodeForce = stackForces.pop()!;
            const skipMatrixUpdate = stackSkipMatrixUpdates.pop()!;
            if (!node.visible) continue;

            let localForce = nodeForce;
            let skipChildMatrixUpdate = skipMatrixUpdate;

            if (!skipMatrixUpdate) {
                if (node.updateMatrixWorld !== Object3D.prototype.updateMatrixWorld) {
                    node.updateMatrixWorld(nodeForce);
                    skipChildMatrixUpdate = true;
                } else {
                    if (node.matrixAutoUpdate) node.updateMatrix();
                    if (node.matrixWorldNeedsUpdate || nodeForce) {
                        if (node.matrixWorldAutoUpdate === true) {
                            if (node.parent === null) node.matrixWorld.copy(node.matrix);
                            else node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
                        }
                        node.matrixWorldNeedsUpdate = false;
                        localForce = true;
                    }
                }
            }

            if (activeHandlers) {
                for (let i = 0; i < activeHandlers.length; i++) {
                    const h = activeHandlers[i]!;
                    if (h.test(node)) {
                        const writeIndex = handlerWriteCounts[i]!;
                        if (h.results[writeIndex] !== node) {
                            handlerResultsChanged[i] = true;
                            h.results[writeIndex] = node;
                        }
                        handlerWriteCounts[i] = writeIndex + 1;
                    }
                }
            }

            const children = node.children;
            for (let i = children.length - 1; i >= 0; i--) {
                const child = children[i];
                if (child === undefined) continue;
                if (skipRoots !== null && skipRoots.has(child)) continue;
                stackNodes.push(child);
                stackForces.push(localForce);
                stackSkipMatrixUpdates.push(skipChildMatrixUpdate);
            }
        }

        if (activeHandlers) {
            for (let i = 0; i < activeHandlers.length; i++) {
                const handler = activeHandlers[i]!;
                const resultCount = handlerWriteCounts[i]!;
                if (handler.results.length !== resultCount) {
                    handlerResultsChanged[i] = true;
                    handler.results.length = resultCount;
                }
                if (handlerResultsChanged[i]) {
                    handler.revision = (handler.revision ?? 0) + 1;
                }
            }
        }
    }
}

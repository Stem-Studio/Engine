import {Object3D} from "three";

import {cloneJsonCompatible, jsonCompatibleEquals} from "@stem/editor-oss/utils/cloneJsonCompatible";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

type BehaviorSnapshot = {
    uuid: string;
    attributesData: unknown;
};

type ObjectSnapshot = {
    object: Object3D;
    parent: Object3D | null;
    childIndex: number;
    depth: number;
    visible: boolean;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    scale: [number, number, number];
    behaviors?: BehaviorSnapshot[];
};

export type PlaymodeSnapshot = {
    objects: Map<string, ObjectSnapshot>;
};

export type PlaymodeRestoreResult = {
    restoredObjects: Object3D[];
    removedObjects: Object3D[];
};

export type PlaymodeRestoreOptions = {
    removeExtraObject?: (object: Object3D) => void;
};

const cloneAttributes = (value: unknown): unknown => {
    if (value === undefined || value === null) return value;
    try {
        return structuredClone(value);
    } catch {
        return cloneJsonCompatible(value);
    }
};

const PLAYMODE_SNAPSHOT_FRAME_BUDGET_MS = 8;
const PLAYMODE_SNAPSHOT_OBJECT_BATCH_SIZE = 250;

const nowForSnapshot = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

const yieldSnapshotToPaint = (): Promise<void> =>
    new Promise(resolve => {
        const finish = () => setTimeout(() => resolve(), 0);
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => finish());
        } else {
            finish();
        }
    });

const createSnapshotYieldController = () => {
    let sliceStart = nowForSnapshot();
    let processedThisSlice = 0;

    return async (): Promise<void> => {
        if (
            processedThisSlice < PLAYMODE_SNAPSHOT_OBJECT_BATCH_SIZE &&
            nowForSnapshot() - sliceStart < PLAYMODE_SNAPSHOT_FRAME_BUDGET_MS
        ) {
            processedThisSlice += 1;
            return;
        }

        await yieldSnapshotToPaint();
        sliceStart = nowForSnapshot();
        processedThisSlice = 0;
    };
};

const createObjectSnapshot = (obj: Object3D, depth: number): ObjectSnapshot => {
    const snap: ObjectSnapshot = {
        object: obj,
        parent: obj.parent,
        childIndex: obj.parent?.children.indexOf(obj) ?? 0,
        depth,
        visible: obj.visible,
        position: [obj.position.x, obj.position.y, obj.position.z],
        quaternion: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w],
        scale: [obj.scale.x, obj.scale.y, obj.scale.z],
    };
    const behaviors = obj.userData?.behaviors as Array<{uuid: string; attributesData?: unknown}> | undefined;
    if (behaviors?.length) {
        snap.behaviors = behaviors.map(b => ({
            uuid: b.uuid,
            attributesData: cloneAttributes(b.attributesData ?? {}),
        }));
    }
    return snap;
};

export const capturePlaymodeSnapshot = (scene: Object3D): PlaymodeSnapshot => {
    const objects = new Map<string, ObjectSnapshot>();
    const stack: Array<{object: Object3D; depth: number}> = [{object: scene, depth: 0}];
    while (stack.length > 0) {
        const entry = stack.pop();
        if (!entry) continue;
        objects.set(entry.object.uuid, createObjectSnapshot(entry.object, entry.depth));

        for (let i = entry.object.children.length - 1; i >= 0; i--) {
            const child = entry.object.children[i];
            if (child) stack.push({object: child, depth: entry.depth + 1});
        }
    }
    return {objects};
};

export const capturePlaymodeSnapshotAsync = async (scene: Object3D): Promise<PlaymodeSnapshot> => {
    const objects = new Map<string, ObjectSnapshot>();
    const maybeYield = createSnapshotYieldController();
    const stack: Array<{object: Object3D; depth: number}> = [{object: scene, depth: 0}];

    while (stack.length > 0) {
        const entry = stack.pop();
        if (!entry) continue;
        objects.set(entry.object.uuid, createObjectSnapshot(entry.object, entry.depth));

        for (let i = entry.object.children.length - 1; i >= 0; i--) {
            const child = entry.object.children[i];
            if (child) stack.push({object: child, depth: entry.depth + 1});
        }

        await maybeYield();
    }

    return {objects};
};

export type TransformDiff = {
    uuid: string;
    name: string;
    type: string;
    position?: {before: [number, number, number]; after: [number, number, number]};
    quaternion?: {before: [number, number, number, number]; after: [number, number, number, number]};
    scale?: {before: [number, number, number]; after: [number, number, number]};
};

export type BehaviorAttributeDiff = {
    uuid: string;
    objectName: string;
    behaviorUuid: string;
    behaviorId: string;
    key: string;
    before: unknown;
    after: unknown;
};

export type PlaymodeDiff = {
    transforms: TransformDiff[];
    behaviorAttributes: BehaviorAttributeDiff[];
};

const EPSILON = 1e-5;
const tripleChanged = (a: [number, number, number], b: [number, number, number]): boolean =>
    Math.abs(a[0] - b[0]) > EPSILON || Math.abs(a[1] - b[1]) > EPSILON || Math.abs(a[2] - b[2]) > EPSILON;
const quadChanged = (
    a: [number, number, number, number],
    b: [number, number, number, number],
): boolean =>
    Math.abs(a[0] - b[0]) > EPSILON ||
    Math.abs(a[1] - b[1]) > EPSILON ||
    Math.abs(a[2] - b[2]) > EPSILON ||
    Math.abs(a[3] - b[3]) > EPSILON;

export const diffPlaymodeSnapshot = (scene: Object3D, snap: PlaymodeSnapshot): PlaymodeDiff => {
    const transforms: TransformDiff[] = [];
    const behaviorAttributes: BehaviorAttributeDiff[] = [];

    traverseObjectDepthFirst(scene, obj => {
        const s = snap.objects.get(obj.uuid);
        if (!s) return;

        const currentPos: [number, number, number] = [obj.position.x, obj.position.y, obj.position.z];
        const currentQuat: [number, number, number, number] = [
            obj.quaternion.x,
            obj.quaternion.y,
            obj.quaternion.z,
            obj.quaternion.w,
        ];
        const currentScale: [number, number, number] = [obj.scale.x, obj.scale.y, obj.scale.z];

        const tDiff: TransformDiff = {
            uuid: obj.uuid,
            name: obj.name || obj.type,
            type: obj.type,
        };
        let touched = false;
        if (tripleChanged(s.position, currentPos)) {
            tDiff.position = {before: s.position, after: currentPos};
            touched = true;
        }
        if (quadChanged(s.quaternion, currentQuat)) {
            tDiff.quaternion = {before: s.quaternion, after: currentQuat};
            touched = true;
        }
        if (tripleChanged(s.scale, currentScale)) {
            tDiff.scale = {before: s.scale, after: currentScale};
            touched = true;
        }
        if (touched) transforms.push(tDiff);

        if (s.behaviors && Array.isArray(obj.userData?.behaviors)) {
            const liveBehaviors = obj.userData.behaviors as Array<{
                uuid: string;
                id: string;
                attributesData?: Record<string, unknown>;
            }>;
            for (const snapBehavior of s.behaviors) {
                const live = liveBehaviors.find(b => b.uuid === snapBehavior.uuid);
                if (!live) continue;
                const beforeAttrs = (snapBehavior.attributesData ?? {}) as Record<string, unknown>;
                const afterAttrs = live.attributesData ?? {};
                const allKeys = new Set([...Object.keys(beforeAttrs), ...Object.keys(afterAttrs)]);
                for (const key of allKeys) {
                    if (!jsonCompatibleEquals(beforeAttrs[key], afterAttrs[key])) {
                        behaviorAttributes.push({
                            uuid: obj.uuid,
                            objectName: obj.name || obj.type,
                            behaviorUuid: live.uuid,
                            behaviorId: live.id,
                            key,
                            before: beforeAttrs[key],
                            after: afterAttrs[key],
                        });
                    }
                }
            }
        }
    });

    return {transforms, behaviorAttributes};
};

export const formatPlaymodeDiff = (diff: PlaymodeDiff): string => {
    const lines: string[] = [];
    lines.push(`# Play-mode Inspector — Changes Summary`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");

    lines.push(`## Transforms (${diff.transforms.length})`);
    if (diff.transforms.length === 0) {
        lines.push("(none)");
    } else {
        for (const t of diff.transforms) {
            lines.push(`- ${t.name} [${t.type}] uuid=${t.uuid}`);
            if (t.position) {
                lines.push(`    position: ${fmtTriple(t.position.before)} → ${fmtTriple(t.position.after)}`);
            }
            if (t.quaternion) {
                lines.push(
                    `    quaternion: ${fmtQuad(t.quaternion.before)} → ${fmtQuad(t.quaternion.after)}`,
                );
            }
            if (t.scale) {
                lines.push(`    scale: ${fmtTriple(t.scale.before)} → ${fmtTriple(t.scale.after)}`);
            }
        }
    }
    lines.push("");

    lines.push(`## Behavior Attributes (${diff.behaviorAttributes.length})`);
    if (diff.behaviorAttributes.length === 0) {
        lines.push("(none)");
    } else {
        for (const a of diff.behaviorAttributes) {
            lines.push(`- ${a.objectName} · ${a.behaviorId} · ${a.key}`);
            lines.push(`    before: ${JSON.stringify(a.before)}`);
            lines.push(`    after:  ${JSON.stringify(a.after)}`);
        }
    }
    return lines.join("\n");
};

const fmtTriple = (v: [number, number, number]): string =>
    `(${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)})`;
const fmtQuad = (v: [number, number, number, number]): string =>
    `(${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)}, ${v[3].toFixed(3)})`;

const collectExtraObjects = (scene: Object3D, snap: PlaymodeSnapshot): Object3D[] => {
    const extras: Object3D[] = [];

    const visit = (parent: Object3D) => {
        for (const child of [...parent.children]) {
            if (!snap.objects.has(child.uuid)) {
                extras.push(child);
                continue;
            }
            visit(child);
        }
    };

    visit(scene);
    return extras;
};

const restoreChildOrder = (snap: PlaymodeSnapshot) => {
    const childOrder = new Map<Object3D, Map<string, number>>();

    for (const [uuid, objectSnapshot] of snap.objects) {
        if (!objectSnapshot.parent) {
            continue;
        }

        let indexMap = childOrder.get(objectSnapshot.parent);
        if (!indexMap) {
            indexMap = new Map<string, number>();
            childOrder.set(objectSnapshot.parent, indexMap);
        }
        indexMap.set(uuid, objectSnapshot.childIndex);
    }

    for (const [parent, indexMap] of childOrder) {
        parent.children.sort((left, right) => {
            const leftIndex = indexMap.get(left.uuid);
            const rightIndex = indexMap.get(right.uuid);

            if (leftIndex === undefined && rightIndex === undefined) return 0;
            if (leftIndex === undefined) return 1;
            if (rightIndex === undefined) return -1;
            return leftIndex - rightIndex;
        });
    }
};

export const restorePlaymodeSnapshot = (
    scene: Object3D,
    snap: PlaymodeSnapshot,
    options: PlaymodeRestoreOptions = {},
): PlaymodeRestoreResult => {
    const removedObjects = collectExtraObjects(scene, snap);
    const removeExtraObject = options.removeExtraObject ?? ((object: Object3D) => object.removeFromParent());

    for (const extraObject of removedObjects) {
        removeExtraObject(extraObject);
    }

    const restoredObjects: Object3D[] = [];
    const snapshots = Array.from(snap.objects.values()).sort((left, right) => {
        if (left.depth !== right.depth) {
            return left.depth - right.depth;
        }
        return left.childIndex - right.childIndex;
    });

    for (const objectSnapshot of snapshots) {
        const {object, parent} = objectSnapshot;
        if (object === scene) {
            continue;
        }

        if (parent && object.parent !== parent) {
            parent.add(object);
            restoredObjects.push(object);
        }
    }

    restoreChildOrder(snap);

    for (const objectSnapshot of snapshots) {
        const {object} = objectSnapshot;
        object.visible = objectSnapshot.visible;
        object.position.set(objectSnapshot.position[0], objectSnapshot.position[1], objectSnapshot.position[2]);
        object.quaternion.set(
            objectSnapshot.quaternion[0],
            objectSnapshot.quaternion[1],
            objectSnapshot.quaternion[2],
            objectSnapshot.quaternion[3],
        );
        object.scale.set(objectSnapshot.scale[0], objectSnapshot.scale[1], objectSnapshot.scale[2]);
        object.updateMatrix();

        if (objectSnapshot.behaviors && Array.isArray(object.userData?.behaviors)) {
            const liveBehaviors = object.userData.behaviors as Array<{uuid: string; attributesData?: unknown}>;
            for (const snapBehavior of objectSnapshot.behaviors) {
                const live = liveBehaviors.find(b => b.uuid === snapBehavior.uuid);
                if (live) {
                    live.attributesData = cloneAttributes(snapBehavior.attributesData);
                }
            }
        }
    }

    return {
        restoredObjects,
        removedObjects,
    };
};

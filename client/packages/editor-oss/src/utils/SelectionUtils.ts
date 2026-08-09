import {Box3, Camera, GridHelper, Light, Mesh, Object3D, Scene, Vector2, Vector3} from "three";

import {DYNAMIC_ROOT_NAME} from "@stem/editor-oss/scene/dynamicRoots";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {findTopVFXParent} from "@stem/editor-oss/utils/vfxRuntime";
import MeshUtils from "./MeshUtils";
import {
    containsPlanCadSelectionMetadata,
    hasPlanCadSelectionMetadata,
    resolvePlanCadSelectionTarget,
} from "./PlanCadSelectionMetadata";

export type NonSelectableReason =
    | "null-object"
    | "tag-helper"
    | "tag-gizmo"
    | "editor-scene"
    | "editor-camera"
    | "grid-helper"
    | "locked-item"
    | "player-object"
    | "hidden-hierarchy"
    | "isSelectable-false-in-play-mode";

interface SelectionEditor {
    scene: Object3D | null | undefined;
    camera: Object3D | null | undefined;
    sceneLockedItems?: string[] | ReadonlySet<string> | null;
}

interface SelectionApp {
    editor: SelectionEditor | null | undefined;
    mode?: string;
    game?: {player?: {uuid?: string} | null} | null;
}

const selectionWorldPos = new Vector3();
const selectionScreenPoint = {x: 0, y: 0};
const selectionBox = new Box3();
const selectionCorners = [
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
];
const LOCKED_ITEMS_SET_THRESHOLD = 8;

const hasLockedItem = (
    sceneLockedItems: SelectionEditor["sceneLockedItems"],
    uuid: string,
): boolean => {
    if (!sceneLockedItems) return false;
    if (typeof (sceneLockedItems as ReadonlySet<string>).has === "function") {
        return (sceneLockedItems as ReadonlySet<string>).has(uuid);
    }
    return (sceneLockedItems as string[]).includes(uuid);
};

const createSelectionAppForRectangle = (
    app: SelectionApp | null | undefined,
): SelectionApp | null | undefined => {
    const editor = app?.editor;
    const lockedItems = editor?.sceneLockedItems;
    if (!editor || !Array.isArray(lockedItems) || lockedItems.length < LOCKED_ITEMS_SET_THRESHOLD) {
        return app;
    }

    return {
        ...app,
        editor: {
            ...editor,
            sceneLockedItems: new Set(lockedItems),
        },
    };
};

const isHiddenInfrastructureObject = (object: Object3D): boolean => {
    let hasPlanCadMetadata = hasPlanCadSelectionMetadata(object);
    let hasCheckedDescendantPlanCadMetadata = false;
    let current: Object3D | null = object;

    while (current) {
        const isRuntimeInfrastructure =
            current.name === DYNAMIC_ROOT_NAME ||
            current.userData?.isRuntimeOnly === true;

        if (isRuntimeInfrastructure && !hasPlanCadMetadata && !hasCheckedDescendantPlanCadMetadata) {
            hasPlanCadMetadata = containsPlanCadSelectionMetadata(object);
            hasCheckedDescendantPlanCadMetadata = true;
        }

        if (
            (isRuntimeInfrastructure && !hasPlanCadMetadata) ||
            current.userData?.isSceneHelper === true ||
            current.userData?.isSceneHelperRoot === true
        ) {
            return true;
        }

        current = current.parent;
    }

    return false;
};

export const getNonSelectableReason = (
    object: Object3D | null | undefined,
    app: SelectionApp | null | undefined,
): NonSelectableReason | null => {
    if (!object) return "null-object";
    const tag = (object as {tag?: string}).tag;
    if (tag === "helper") return "tag-helper";
    if (tag === "gizmo") return "tag-gizmo";

    const editor = app?.editor;
    if (editor) {
        if (object === editor.scene) return "editor-scene";
        if (object === editor.camera) return "editor-camera";
        if (hasLockedItem(editor.sceneLockedItems, object.uuid)) return "locked-item";
    }

    if (isHiddenInfrastructureObject(object)) return "hidden-hierarchy";

    if (object instanceof GridHelper) return "grid-helper";

    const playerUuid = app?.game?.player?.uuid;
    if (playerUuid && object.uuid === playerUuid) return "player-object";

    if (app?.mode === "play" && object.userData?.isSelectable === false) {
        return "isSelectable-false-in-play-mode";
    }

    return null;
};

export const canSelectObject = (
    object: Object3D | null | undefined,
    app: SelectionApp | null | undefined,
): object is Object3D => getNonSelectableReason(object, app) === null;

export interface ScreenRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface FindObjectsInRectangleOpts {
    scene: Scene | Object3D;
    camera: Camera;
    viewport: ScreenRect;
    start: Vector2;
    end: Vector2;
    app: SelectionApp | null | undefined;
}

const projectToScreen = (
    worldPos: Vector3,
    camera: Camera,
    viewport: ScreenRect,
    target: {x: number; y: number} = {x: 0, y: 0},
): {x: number; y: number} => {
    selectionWorldPos.copy(worldPos).project(camera);
    target.x = (selectionWorldPos.x * 0.5 + 0.5) * viewport.width + viewport.left;
    target.y = (-selectionWorldPos.y * 0.5 + 0.5) * viewport.height + viewport.top;
    return target;
};

export const findObjectsInRectangle = (opts: FindObjectsInRectangleOpts): Object3D[] => {
    const {scene, camera, viewport, start, end, app} = opts;
    const selected = new Set<Object3D>();
    const selectionApp = createSelectionAppForRectangle(app);

    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const leftToRight = end.x > start.x;

    const insideRect = (p: {x: number; y: number}) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;

    traverseObjectDepthFirst(scene, obj => {
        if (!(obj instanceof Mesh) && obj.type !== "ParticleEmitter" && !(obj instanceof Light)) return;

        if (obj instanceof Light) {
            obj.getWorldPosition(selectionWorldPos);
            const screen = projectToScreen(selectionWorldPos, camera, viewport, selectionScreenPoint);
            if (insideRect(screen) && canSelectObject(obj, selectionApp)) {
                selected.add(obj);
            }
            return;
        }

        let target: Object3D = obj;
        if (obj.type === "ParticleEmitter") {
            const vfxParent = findTopVFXParent(obj, scene as Scene);
            if (vfxParent) target = vfxParent;
        } else if (obj instanceof Mesh) {
            target = resolvePlanCadSelectionTarget(obj, scene) ?? MeshUtils.partToMesh(obj);
        }

        if ((target as {isBatchedMesh?: boolean}).isBatchedMesh) return;
        if (!canSelectObject(target, selectionApp)) return;
        if (selected.has(target)) return;

        selectionBox.setFromObject(obj);
        selectionCorners[0]!.set(selectionBox.min.x, selectionBox.min.y, selectionBox.min.z);
        selectionCorners[1]!.set(selectionBox.min.x, selectionBox.min.y, selectionBox.max.z);
        selectionCorners[2]!.set(selectionBox.min.x, selectionBox.max.y, selectionBox.min.z);
        selectionCorners[3]!.set(selectionBox.min.x, selectionBox.max.y, selectionBox.max.z);
        selectionCorners[4]!.set(selectionBox.max.x, selectionBox.min.y, selectionBox.min.z);
        selectionCorners[5]!.set(selectionBox.max.x, selectionBox.min.y, selectionBox.max.z);
        selectionCorners[6]!.set(selectionBox.max.x, selectionBox.max.y, selectionBox.min.z);
        selectionCorners[7]!.set(selectionBox.max.x, selectionBox.max.y, selectionBox.max.z);

        let inside = leftToRight;
        for (let i = 0; i < selectionCorners.length; i++) {
            const screen = projectToScreen(selectionCorners[i]!, camera, viewport, selectionScreenPoint);
            const cornerInside = insideRect(screen);
            if (leftToRight && !cornerInside) {
                inside = false;
                break;
            }
            if (!leftToRight && cornerInside) {
                inside = true;
                break;
            }
        }

        if (inside) {
            selected.add(target);
        }
    });

    return Array.from(selected);
};

import {Box3, Color, Group, Mesh, Object3D, Vector3} from "three";

import {getAsset, getAssetRevision} from "@stem/network/api/asset";
import ModelLoader from "../../../../assets/js/loaders/ModelLoader";
import type {UserAvatarPart} from "@stem/network/api/avatarCreator";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

/**
 * Per-category scale factor applied to a loaded part before parenting it under
 * the avatar root. Mirrors AvatarManager.SCALE so runtime composition matches
 * the AvatarCreator preview.
 */
const PART_SCALE: Record<string, number> = {
    Body: 1,
    Head: 1,
    Eyes: 0.3,
    Glasses: 0.3,
    Hat: 0.6,
    Hair: 0.8,
    Shoes: 0.6,
};

export type ComposeAvatarInput = {
    parts: UserAvatarPart[];
    skinTone?: string;
    avatarStyle?: string;
};

/**
 * Compose a user avatar at runtime from a saved part list. Always uses each
 * part asset's current head revision (so re-imported parts pick up the new
 * version automatically). Returns null if zero parts resolve.
 */
export async function composeUserAvatar(input: ComposeAvatarInput): Promise<Object3D | null> {
    const parts = input.parts ?? [];
    if (parts.length === 0) return null;

    const root = new Group();
    root.name = "user_avatar_composed";

    const loader = new ModelLoader();
    let attached = 0;

    for (const part of parts) {
        if (!part?.assetId) continue;
        try {
            const url = await resolvePartUrl(part.assetId);
            if (!url) continue;

            const loaded = await loader.load(url, {Type: "glb"});
            if (!loaded) continue;

            const clone = typeof loaded.clone === "function" ? loaded.clone(true) : loaded;
            const group = new Group();
            group.name = `part_${part.group}_${part.assetId}`;
            group.userData = {composedPart: true, group: part.group, assetId: part.assetId};
            group.add(clone);

            const scale = PART_SCALE[part.group] ?? 1;
            clone.scale.setScalar(scale);

            if (part.color) {
                applyTintToGroup(group, part.color);
            }

            root.add(group);
            attached++;
        } catch (e) {
            console.warn("[composeUserAvatar] failed to attach part", {part, error: e});
        }
    }

    if (attached === 0) {
        return null;
    }

    if (input.skinTone) {
        applySkinTone(root, input.skinTone);
    }

    alignPartsToLargest(root);
    normalizeBaseline(root);

    return root;
}

async function resolvePartUrl(assetId: string): Promise<string | null> {
    try {
        const asset = await getAsset(assetId);
        const headRev = asset?.headRevisionId;
        if (!headRev) return null;
        const revision = await getAssetRevision(assetId, headRev, {includeDataUrl: true});
        return revision?.dataUrl ?? null;
    } catch (e) {
        console.warn("[composeUserAvatar] resolvePartUrl failed", {assetId, error: e});
        return null;
    }
}

function applyTintToGroup(group: Object3D, hex: string): void {
    const color = safeColor(hex);
    if (!color) return;
    traverseObjectDepthFirst(group, node => {
        const mesh = node as Mesh;
        const material = mesh?.material;
        if (!material) return;
        if (Array.isArray(material)) {
            material.forEach(m => tryAssignColor(m, color));
        } else {
            tryAssignColor(material, color);
        }
    });
}

function applySkinTone(root: Object3D, hex: string): void {
    const color = safeColor(hex);
    if (!color) return;
    traverseObjectDepthFirst(root, node => {
        const name = (node.name || "").toLowerCase();
        const isSkinNode = name.includes("skin") || name.includes("body");
        if (!isSkinNode) return;
        const mesh = node as Mesh;
        const material = mesh?.material;
        if (!material) return;
        if (Array.isArray(material)) {
            material.forEach(m => tryAssignColor(m, color));
        } else {
            tryAssignColor(material, color);
        }
    });
}

function safeColor(hex: string): Color | null {
    try {
        return new Color(hex);
    } catch {
        return null;
    }
}

function tryAssignColor(material: unknown, color: Color): void {
    const mat = material as {color?: Color};
    if (mat && mat.color && typeof mat.color.copy === "function") {
        mat.color.copy(color);
    }
}

function alignPartsToLargest(root: Object3D): void {
    if (root.children.length === 0) return;
    let largest: Object3D | null = null;
    let maxVolume = 0;
    const boxes = new Map<Object3D, Box3>();

    for (const child of root.children) {
        child.updateMatrixWorld(true);
        const box = new Box3().setFromObject(child);
        boxes.set(child, box);
        const size = box.getSize(new Vector3());
        const volume = Math.max(0.0001, size.x * size.y * size.z);
        if (volume > maxVolume) {
            maxVolume = volume;
            largest = child;
        }
    }
    if (!largest) return;

    const refBox = boxes.get(largest);
    if (!refBox) return;
    const refCenter = refBox.getCenter(new Vector3());

    for (const child of root.children) {
        if (child === largest) continue;
        const box = boxes.get(child);
        if (!box) continue;
        const center = box.getCenter(new Vector3());
        child.position.x += refCenter.x - center.x;
        child.position.z += refCenter.z - center.z;
        child.updateMatrixWorld(true);
    }
}

function normalizeBaseline(root: Object3D): void {
    let minY = Infinity;
    for (const child of root.children) {
        child.updateMatrixWorld(true);
        const box = new Box3().setFromObject(child);
        if (Number.isFinite(box.min.y)) {
            minY = Math.min(minY, box.min.y);
        }
    }
    if (!Number.isFinite(minY)) return;
    root.position.y -= minY;
    root.updateMatrixWorld(true);
}

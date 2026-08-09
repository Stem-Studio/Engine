import * as THREE from "three";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

import {getQuickBuildMetadata, repairQuickBuildRenderableState} from "./quickBuildObjects";
import type {QuickBuildStampKind} from "./quickBuildObjects";

export type QuickBuildTexturePackLicense = "AGPL-3.0" | "MIT" | "CC0" | "custom" | "unknown";

export interface QuickBuildTexturePreset {
    id: string;
    label: string;
    category: "terrain" | "water" | "path" | "stone" | "wood" | "reference" | "custom";
    stampKinds: QuickBuildStampKind[];
    url: string;
    license: QuickBuildTexturePackLicense;
    attribution?: string;
}

export interface QuickBuildTexturePackManifest {
    schema: "stem.quickBuildTexturePack.v1";
    id: string;
    label: string;
    source?: string;
    license: QuickBuildTexturePackLicense;
    generatedAt?: string;
    presets: QuickBuildTexturePreset[];
}

export interface QuickBuildTexturePackIndex {
    schema: "stem.quickBuildTexturePackIndex.v1";
    packs: Array<{
        id: string;
        label: string;
        manifestUrl: string;
        license: QuickBuildTexturePackLicense;
    }>;
}

export interface QuickBuildTextureApplication {
    presetId: string;
    label: string;
    url: string;
    license: QuickBuildTexturePackLicense;
    attribution?: string;
}

export function formatQuickBuildTexturePresetCredit(
    preset: Pick<QuickBuildTexturePreset, "label" | "license" | "attribution">,
) {
    return [`${preset.label} (${preset.license})`, preset.attribution].filter(Boolean).join(" - ");
}

export const DEFAULT_QUICK_BUILD_TEXTURE_PACK_INDEX_URL =
    import.meta.env.REACT_APP_QUICK_BUILD_TEXTURE_PACKS_MANIFEST || "/vendor/texture-packs/manifest.json";

const textureCache = new Map<string, Promise<THREE.Texture>>();
const packIndexCache = new Map<string, Promise<QuickBuildTexturePackIndex | null>>();
const packManifestCache = new Map<string, Promise<QuickBuildTexturePackManifest>>();

export function clearQuickBuildTexturePackCaches() {
    for (const texturePromise of textureCache.values()) {
        void texturePromise.then(texture => texture.dispose()).catch(() => undefined);
    }
    packIndexCache.clear();
    packManifestCache.clear();
    textureCache.clear();
}

function runtimeBaseUrl() {
    return globalThis.location?.href ?? "http://localhost/";
}

export function resolveQuickBuildTexturePackUrl(url: string, baseUrl = runtimeBaseUrl()) {
    return new URL(url, new URL(baseUrl, runtimeBaseUrl())).toString();
}

export async function loadQuickBuildTexturePackIndex(
    indexUrl = DEFAULT_QUICK_BUILD_TEXTURE_PACK_INDEX_URL,
): Promise<QuickBuildTexturePackIndex | null> {
    const resolvedIndexUrl = resolveQuickBuildTexturePackUrl(indexUrl);
    const cached = packIndexCache.get(resolvedIndexUrl);
    if (cached) return cached;

    const promise = fetch(resolvedIndexUrl)
        .then(async response => {
            if (!response.ok) return null;

            const json = (await response.json()) as QuickBuildTexturePackIndex;
            if (json.schema !== "stem.quickBuildTexturePackIndex.v1" || !Array.isArray(json.packs)) {
                throw new Error("Invalid Quick Build texture pack index");
            }
            return {
                ...json,
                packs: json.packs.map(pack => ({
                    ...pack,
                    manifestUrl: resolveQuickBuildTexturePackUrl(pack.manifestUrl, resolvedIndexUrl),
                })),
            };
        })
        .catch(error => {
            packIndexCache.delete(resolvedIndexUrl);
            throw error;
        });
    packIndexCache.set(resolvedIndexUrl, promise);
    return promise;
}

export async function loadQuickBuildTexturePack(manifestUrl: string): Promise<QuickBuildTexturePackManifest> {
    const resolvedManifestUrl = resolveQuickBuildTexturePackUrl(manifestUrl);
    const cached = packManifestCache.get(resolvedManifestUrl);
    if (cached) return cached;

    const promise = fetch(resolvedManifestUrl)
        .then(async response => {
            if (!response.ok) {
                throw new Error(`Could not load Quick Build texture pack manifest: ${manifestUrl}`);
            }

            const json = (await response.json()) as QuickBuildTexturePackManifest;
            if (json.schema !== "stem.quickBuildTexturePack.v1" || !Array.isArray(json.presets)) {
                throw new Error("Invalid Quick Build texture pack manifest");
            }
            return {
                ...json,
                presets: json.presets.map(preset => ({
                    ...normalizeQuickBuildTexturePreset(preset),
                    url: resolveQuickBuildTexturePackUrl(preset.url, resolvedManifestUrl),
                })),
            };
        })
        .catch(error => {
            packManifestCache.delete(resolvedManifestUrl);
            throw error;
        });
    packManifestCache.set(resolvedManifestUrl, promise);
    return promise;
}

export function isQuickBuildTexturePresetCompatible(preset: QuickBuildTexturePreset, kind: QuickBuildStampKind) {
    return (
        preset.category !== "reference" &&
        !isReferenceTexturePreset(preset) &&
        preset.stampKinds.includes(kind)
    );
}

export function getTexturePresetsForKind(pack: QuickBuildTexturePackManifest, kind: QuickBuildStampKind) {
    return pack.presets.filter(preset => isQuickBuildTexturePresetCompatible(preset, kind));
}

export function configureQuickBuildTexture(texture: THREE.Texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.max(texture.anisotropy, 4);
    texture.generateMipmaps = true;
    return texture;
}

export function loadQuickBuildTexture(url: string) {
    const resolvedUrl = resolveQuickBuildTexturePackUrl(url);
    const cached = textureCache.get(resolvedUrl);
    if (cached) return cached;

    const loader = new THREE.TextureLoader();
    const promise = new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(
            resolvedUrl,
            texture => resolve(configureQuickBuildTexture(texture)),
            undefined,
            error => {
                textureCache.delete(resolvedUrl);
                reject(error);
            },
        );
    });
    textureCache.set(resolvedUrl, promise);
    return promise;
}

function canApplyTextureToMesh(kind: QuickBuildStampKind, part: unknown) {
    if (typeof part !== "string") {
        return kind === "tree" || kind === "bush" || kind === "rock" || kind === "house" || kind === "lamp";
    }
    if (kind === "ground" || kind === "sand" || kind === "stone" || kind === "farm") return part === `${kind}-tile`;
    if (kind === "water") return part === "water-tile";
    if (kind === "path" || kind === "bridge" || kind === "fence") {
        return (
            part === `${kind}-center` ||
            part === `${kind}-north` ||
            part === `${kind}-east` ||
            part === `${kind}-south` ||
            part === `${kind}-west`
        );
    }
    return true;
}

function isTinyWorldBuilderPreset(preset: Pick<QuickBuildTexturePreset, "id" | "attribution" | "url">) {
    return preset.id.startsWith("tw-") || preset.attribution?.toLowerCase().includes("tiny world builder") === true;
}

function isTinyWorldBuilderReferencePath(url: string) {
    const normalized = url.replace(/\\/g, "/").toLowerCase();
    return (
        !normalized.includes("/terrain-variants/") ||
        normalized.includes("/terrain-variants/source/") ||
        normalized.endsWith("/reference.jpeg") ||
        normalized.endsWith("/reference.jpg") ||
        normalized.endsWith("/reference.png")
    );
}

function isReferenceTexturePreset(preset: QuickBuildTexturePreset) {
    if (preset.category === "reference" || preset.stampKinds.length === 0) return true;
    return isTinyWorldBuilderPreset(preset) && isTinyWorldBuilderReferencePath(preset.url);
}

function normalizeQuickBuildTexturePreset(preset: QuickBuildTexturePreset): QuickBuildTexturePreset {
    if (!isTinyWorldBuilderPreset(preset) || !isTinyWorldBuilderReferencePath(preset.url)) return preset;
    return {
        ...preset,
        category: "reference",
        stampKinds: [],
    };
}

function getTextureMaterialTargets(mesh: THREE.Mesh, materialCount: number) {
    const indices = mesh.userData?.quickBuildTextureMaterialIndices;
    if (!Array.isArray(indices)) return null;

    const normalized = indices
        .map(index => Number(index))
        .filter(index => Number.isInteger(index) && index >= 0 && index < materialCount);
    return normalized.length > 0 ? new Set(normalized) : null;
}

function applyTextureToMaterial(material: THREE.Material, texture: THREE.Texture, kind: QuickBuildStampKind) {
    const next = material.clone() as THREE.MeshStandardMaterial;
    next.map = texture;
    next.color?.set(0xffffff);
    next.visible = true;
    if (kind === "water") {
        next.transparent = false;
        next.opacity = 1;
        next.depthWrite = true;
        next.metalness = 0;
        next.roughness = Math.max(next.roughness ?? 0, 0.65);
    }
    next.needsUpdate = true;
    return next;
}

export function applyQuickBuildTexturePreset(
    object: THREE.Object3D,
    preset: QuickBuildTexturePreset,
    texture: THREE.Texture,
) {
    const metadata = getQuickBuildMetadata(object);
    if (!metadata || isReferenceTexturePreset(preset) || !preset.stampKinds.includes(metadata.kind)) return false;

    repairQuickBuildRenderableState(object);

    let applied = false;
    traverseObjectDepthFirst(object, child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !canApplyTextureToMesh(metadata.kind, mesh.userData?.quickBuildPart)) return;

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const targetIndices = getTextureMaterialTargets(mesh, materials.length);
        const replacedMaterials = new Set<THREE.Material>();
        let appliedToMesh = false;
        const nextMaterials = materials.map((material, index) => {
            if (targetIndices && !targetIndices.has(index)) return material;

            const nextMaterial = applyTextureToMaterial(material, texture, metadata.kind);
            replacedMaterials.add(material);
            appliedToMesh = true;
            return nextMaterial;
        });

        if (!appliedToMesh) return;

        mesh.material = Array.isArray(mesh.material) ? nextMaterials : nextMaterials[0]!;
        for (const material of replacedMaterials) {
            material.dispose();
        }
        applied = true;
    });

    if (applied) {
        object.userData.quickBuildTexture = {
            presetId: preset.id,
            label: preset.label,
            url: preset.url,
            license: preset.license,
            attribution: preset.attribution,
        } satisfies QuickBuildTextureApplication;
    }
    return applied;
}

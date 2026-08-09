import JSZip from "jszip";
import {Euler, Material, Mesh, Object3D, PCFShadowMap, Quaternion, Vector3} from "three";
import {stringify as stringifyYaml} from "yaml";

import {
    Asset,
    AssetType,
    getAsset,
    getAssetRevision,
    getAssetRevisionData,
    getSceneAssets,
} from "@stem/network/api/asset";
import {downloadAudio} from "@stem/network/api/audio";
import {downloadImage} from "@stem/network/api/image";
import type {AssetRef} from "../../asset-management/AssetRef";
import {
    emptyAssetResolutionContext,
    getAssetResolutionContext,
    resolveAssetId,
    resolveAssetRevisionId,
} from "../../asset-management/AssetResolutionContext";
import {traverseAssetRefs} from "../../asset-management/dependencies";
import type BehaviorData from "../../behaviors/BehaviorData";
import global from "../../global";
import type {LambdaComponentData, LambdaConfig, LambdaInstanceData} from "../../lambdas/Lambda";
import {getModelId} from "../../model/util";
import {PhysicsUtil} from "../../physics/PhysicsUtil";
import {backendUrlFromPath} from "../../utils/UrlUtils";
import {cloneJsonCompatible, jsonCompatibleEquals} from "../../utils/cloneJsonCompatible";
import {
    findObjectByNameDepthFirst,
    traverseObjectDepthFirst,
} from "../../utils/SceneTraverser";

import {isDefaultSceneObject} from "./defaultSceneObjects";

type ExportSceneBundleOptions = {
    suggestedName?: string;
    /**
     * "dump" (default) packages every art asset as a physical file in the zip
     * and emits `import … filepath=…` lines. Replays offline via `exec`.
     *
     * "export" skips binary downloads and emits `import … url=…` lines using
     * the asset revision's signed dataUrl. `exec` fetches each URL on import
     * (same asset-create pipeline as dump). Much smaller bundles; URLs expire
     * with the signature window.
     */
    mode?: "dump" | "export";
};

type ExportSceneBundleResult = {
    success: boolean;
    message: string;
};

type ExportableObjectKind = "group" | "primitive" | "model";

type ExportableObject = {
    object: Object3D;
    kind: ExportableObjectKind;
    primitiveType?: string;
};

type ExportedBehaviorAsset = {
    assetId: string;
    revisionId: string;
    filePath: string;
    config: Record<string, any>;
    code: string;
    scriptId: string;
};

type ExportedLambdaAsset = {
    assetId: string;
    revisionId: string;
    filePath: string;
    config: LambdaConfig;
    code: string;
    scriptId: string;
};

type ExportedBinaryAsset = {
    assetId: string;
    revisionId: string;
    /** Relative path inside the zip. Empty string in export mode (no file written). */
    filePath: string;
    /** Signed dataUrl when exported by reference (export mode). */
    url?: string;
    importName: string;
    asset: Asset;
};

type ExportedScriptImport = {
    assetId: string;
    revisionId: string;
    filePath: string;
    importName: string;
    code: string;
    description?: string;
};

type LegacyAssetKind = "audio" | "image";

type LegacyAssetCandidate = {
    type: LegacyAssetKind;
    sourceLabel: string;
    legacyId?: string;
    sourceUrl?: string;
};

type ParsedLegacyAssetUrl = {
    type: LegacyAssetKind;
    legacyId: string;
    filename: string;
    normalizedPath: string;
};

type ResolvedLegacyAsset = {
    type: LegacyAssetKind;
    legacyId: string;
    name: string;
    /** Relative path inside the zip. Empty string in export mode (no file written). */
    filePath: string;
    /** Absolute URL to re-fetch this legacy asset at import time (export mode). */
    url?: string;
    importName: string;
    normalizedPath: string;
    /** Undefined in export mode — we never download the blob. */
    blob?: Blob;
};

const EXPORT_VERSION = 1;
const TOOL_NAME = "StemStudio";
const ASSET_ID_PATTERN = /^(?:[a-f0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const ASSET_ATTRIBUTE_TYPES = new Set(["audioAsset", "imageAsset", "modelAsset", "videoAsset", "prefab"]);
const DEFAULT_TRANSFORM = {
    position: {x: 0, y: 0, z: 0},
    rotation: {x: 0, y: 0, z: 0},
    scale: {x: 1, y: 1, z: 1},
};
const DEFAULT_GAME_SETTINGS = {
    isGame: true,
    lives: 3,
    maxScore: 500,
    timer: undefined,
    useAvatar: false,
    isMultiplayer: false,
    showHUD: false,
    isSandbox: false,
    voiceChatEnabled: false,
};
const DEFAULT_RENDER_SETTINGS = {
    useShadows: true,
    useInstancing: false,
    shadowMapType: PCFShadowMap,
    usePhysicsWorker: false,
};
const DEFAULT_SCENE_LIGHTING = {
    ambient: {color: "#ffffff", intensity: 0},
    hemisphere: {skyColor: "#c1e0fe", groundColor: "#e5e695", intensity: 3},
    shadows: {enabled: true, mapType: PCFShadowMap},
};
const DEFAULT_SCENE_FOG = {
    type: "none",
    color: "#aaaaaa",
    near: 5,
    far: 150,
    density: 0.011,
};
const DEFAULT_SCENE_BACKGROUND = {
    type: "Gradient",
    color: "#27272a",
    texture: "",
    cubemap: ["", "", "", "", "", ""],
    gradient: "linear-gradient(0deg, #3e4455 0%, #3e4455 65%, #4f576d 85%, #59677f 100%)",
    gradientMode: "2d",
    rotation: 0,
    intensity: 1,
    blurriness: 0,
};
const DEFAULT_TONE_MAPPING = {
    type: "None",
    exposure: 1,
};
const DEFAULT_CAMERA_SETTINGS = {
    fov: 60,
    near: 1,
    far: 100000,
    cameraType: "Third Person",
    defaultDistance: 3.5,
    minDistance: 0.5,
    maxDistance: 8,
    headHeight: 2,
    axis: 0,
};
const DEFAULT_DIRECTIONAL_LIGHT = {
    intensity: 5,
    color: "#ffffff",
    castShadow: true,
    shadowMapSize: 2048,
    shadowBias: 0,
    shadowNormalBias: 0.1,
    shadowRadius: 3,
    position: {x: 5, y: 50, z: 7.5},
};

const tmpWorldPosition = new Vector3();
const tmpWorldScale = new Vector3();
const tmpWorldQuaternion = new Quaternion();
const tmpWorldEuler = new Euler();

const round = (value: number): number => Math.round(value * 1000) / 1000;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

const deepEqual = (left: unknown, right: unknown): boolean => jsonCompatibleEquals(left, right);

const stripDefaults = <T>(value: T, defaults: unknown): T | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (defaults === undefined) {
        return value;
    }

    if (deepEqual(value, defaults)) {
        return undefined;
    }

    if (isPlainObject(value) && isPlainObject(defaults)) {
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            const stripped = stripDefaults(item, defaults[key]);
            if (stripped !== undefined) {
                result[key] = stripped;
            }
        }
        return (Object.keys(result).length > 0 ? result : undefined) as T | undefined;
    }

    return value;
};

const sanitizePathPart = (value: string, fallback: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const sanitized = trimmed
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, "-")
        .replace(/[^A-Za-z0-9._-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return sanitized || fallback;
};

const toValidId = (value: string, fallback: string): string => {
    const trimmed = value.trim().toLowerCase();
    const normalized = trimmed
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_.-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized || fallback;
};

export const isOpaqueAssetId = (value: string | null | undefined): boolean => {
    if (!value) return false;
    return ASSET_ID_PATTERN.test(value);
};

const makeUnique = (base: string, used: Set<string>): string => {
    let candidate = base;
    let index = 2;
    while (used.has(candidate)) {
        candidate = `${base}-${index}`;
        index++;
    }
    used.add(candidate);
    return candidate;
};

const makeUniqueDisplayName = (base: string, used: Set<string>, fallback: string): string => {
    const sanitized = base.trim() || fallback;
    let candidate = sanitized;
    let index = 2;
    while (used.has(candidate)) {
        candidate = `${sanitized} ${index}`;
        index++;
    }
    used.add(candidate);
    return candidate;
};

const getExtension = (asset: Asset, format?: string): string => {
    const fromFormat = (format || asset.format || "").trim().toLowerCase();
    if (fromFormat) {
        return fromFormat.startsWith(".") ? fromFormat.slice(1) : fromFormat;
    }

    const fromName = asset.name.split(".").pop()?.toLowerCase();
    if (fromName && fromName !== asset.name.toLowerCase()) {
        return fromName;
    }

    switch (asset.type) {
        case AssetType.Model:
            return "glb";
        case AssetType.Image:
            return "png";
        case AssetType.Audio:
            return "mp3";
        case AssetType.Video:
            return "mp4";
        case AssetType.Prefab:
            return "json";
        default:
            return "bin";
    }
};

const quoteIfNeeded = (value: string): string => {
    if (/^[A-Za-z0-9._#/-]+$/.test(value)) {
        return value;
    }
    return JSON.stringify(value);
};

const toStemLiteral = (value: unknown): string => {
    if (typeof value === "string") {
        return quoteIfNeeded(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (value === null) {
        return "null";
    }
    return JSON.stringify(value);
};

const buildCommand = (prefix: string, params: Record<string, unknown>): string => {
    const tokens = [prefix];
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        tokens.push(`${key}=${toStemLiteral(value)}`);
    }
    return tokens.join(" ");
};

const buildCommandIfAny = (prefix: string, params: Record<string, unknown>): string | null => {
    const pruned = pruneUndefined(params);
    return Object.keys(pruned).length > 0 ? buildCommand(prefix, pruned) : null;
};

const isAssetRef = (value: unknown): value is AssetRef => {
    return Boolean(
        value
        && typeof value === "object"
        && "assetId" in (value as Record<string, unknown>)
        && "revisionId" in (value as Record<string, unknown>),
    );
};

const cloneJson = <T>(value: T): T => cloneJsonCompatible(value);

const normalizePathLikeValue = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
        return null;
    }

    let path = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            path = new URL(trimmed).pathname;
        } catch {
            return null;
        }
    }

    if (path.startsWith("api/") || path.startsWith("Upload/")) {
        path = `/${path}`;
    }
    if (path.startsWith("/.proxy/")) {
        path = path.slice("/.proxy".length);
    }
    if (!path.startsWith("/")) {
        return null;
    }

    const queryIndex = path.indexOf("?");
    if (queryIndex >= 0) {
        path = path.slice(0, queryIndex);
    }
    const hashIndex = path.indexOf("#");
    if (hashIndex >= 0) {
        path = path.slice(0, hashIndex);
    }

    return path;
};

const parseLegacyAssetUrl = (value: string): ParsedLegacyAssetUrl | null => {
    const normalized = normalizePathLikeValue(value);
    if (!normalized) return null;

    const apiMatch = normalized.match(/^\/api\/Asset\/Download\/(audio|image)\/([^/]+)\/(.+)$/i);
    if (apiMatch) {
        const type = apiMatch[1]?.toLowerCase() as LegacyAssetKind;
        const legacyId = apiMatch[2] || "";
        const filename = apiMatch[3] || "";
        if (!legacyId || !filename) return null;
        return {
            type,
            legacyId,
            filename,
            normalizedPath: `/api/Asset/Download/${type}/${legacyId}/${filename}`,
        };
    }

    const uploadMatch = normalized.match(/^\/Upload\/(Audio|Image)\/([^/]+)\/(.+)$/i);
    if (uploadMatch) {
        const type = uploadMatch[1]?.toLowerCase() as LegacyAssetKind;
        const legacyId = uploadMatch[2] || "";
        const filename = uploadMatch[3] || "";
        if (!legacyId || !filename) return null;
        return {
            type,
            legacyId,
            filename,
            normalizedPath: `/api/Asset/Download/${type}/${legacyId}/${filename}`,
        };
    }

    return null;
};

const inferLegacyAssetKindFromPath = (path: string): LegacyAssetKind | null => {
    if (/audio|sound|music/i.test(path)) return "audio";
    if (/image|texture|cubemap|background|sprite|icon/i.test(path)) return "image";
    return null;
};

const addLegacyAssetCandidate = (
    candidates: Map<string, LegacyAssetCandidate>,
    candidate: LegacyAssetCandidate,
) => {
    const key = `${candidate.type}:${candidate.legacyId || ""}:${candidate.sourceUrl || ""}`;
    if (!candidates.has(key)) {
        candidates.set(key, candidate);
    }
};

const collectLegacyAssetCandidatesFromValue = (
    value: unknown,
    path: string,
    candidates: Map<string, LegacyAssetCandidate>,
    visited: WeakSet<object>,
) => {
    if (typeof value === "string") {
        const parsed = parseLegacyAssetUrl(value);
        if (parsed) {
            addLegacyAssetCandidate(candidates, {
                type: parsed.type,
                legacyId: parsed.legacyId,
                sourceUrl: parsed.normalizedPath,
                sourceLabel: path,
            });
        }
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => collectLegacyAssetCandidatesFromValue(item, `${path}[${index}]`, candidates, visited));
        return;
    }

    if (!value || typeof value !== "object") {
        return;
    }
    if (visited.has(value)) {
        return;
    }
    visited.add(value);

    const record = value as Record<string, unknown>;
    const id = typeof record.ID === "string"
        ? record.ID
        : typeof record.id === "string"
            ? record.id
            : undefined;
    const url = typeof record.Url === "string"
        ? record.Url
        : typeof record.url === "string"
            ? record.url
            : undefined;

    if (url) {
        const parsed = parseLegacyAssetUrl(url);
        if (parsed) {
            addLegacyAssetCandidate(candidates, {
                type: parsed.type,
                legacyId: id || parsed.legacyId,
                sourceUrl: parsed.normalizedPath,
                sourceLabel: path,
            });
        }
    } else if (id) {
        const inferredKind = inferLegacyAssetKindFromPath(path);
        if (inferredKind) {
            addLegacyAssetCandidate(candidates, {
                type: inferredKind,
                legacyId: id,
                sourceLabel: path,
            });
        }
    }

    for (const [key, item] of Object.entries(record)) {
        collectLegacyAssetCandidatesFromValue(item, `${path}.${key}`, candidates, visited);
    }
};

const resolveLegacyDownloadPathById = async (
    type: LegacyAssetKind,
    legacyId: string,
): Promise<string | null> => {
    if (!legacyId) return null;

    if (type === "audio") {
        const result = await downloadAudio(legacyId);
        return result?.Code === 200 && result.Path ? normalizePathLikeValue(result.Path) : null;
    }

    const result = await downloadImage(legacyId);
    return result?.Code === 200 && result.Path ? normalizePathLikeValue(result.Path) : null;
};

const fetchLegacyAssetBlob = async (normalizedPath: string): Promise<Blob> => {
    const url = backendUrlFromPath(normalizedPath) || normalizedPath;
    const response = await fetch(url, {
        method: "GET",
        credentials: "include",
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} while downloading ${normalizedPath}`);
    }
    return response.blob();
};

const extensionFromFilename = (filename: string, fallback: string): string => {
    const ext = filename.split(".").pop()?.toLowerCase();
    return ext && ext !== filename.toLowerCase() ? ext : fallback;
};

const rewriteLegacyMediaStringReferences = (
    value: unknown,
    legacyImportNameByPath: Map<string, string>,
    notes: Set<string>,
    path: string,
): unknown => {
    if (typeof value === "string") {
        const parsed = parseLegacyAssetUrl(value);
        if (!parsed) return value;
        const importName = legacyImportNameByPath.get(parsed.normalizedPath);
        if (importName) {
            return importName;
        }
        notes.add(`Legacy media URL at ${path} was detected but not exported: ${parsed.normalizedPath}`);
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item, index) =>
            rewriteLegacyMediaStringReferences(item, legacyImportNameByPath, notes, `${path}[${index}]`),
        );
    }

    if (value && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            result[key] = rewriteLegacyMediaStringReferences(item, legacyImportNameByPath, notes, `${path}.${key}`);
        }
        return result;
    }

    return value;
};

const getObjectTags = (object: Object3D): string[] => {
    const tags = object.userData?.tags;
    if (!Array.isArray(tags)) return [];
    return tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
};

const isWaypointPathObject = (object: Object3D): boolean =>
    Boolean(object.userData?.aiWaypointPath);

const isWaypointMarkerObject = (object: Object3D): boolean =>
    Boolean(object.userData?.aiWaypoint);

const getObjectSettings = (object: Object3D): Record<string, unknown> | undefined => {
    const settings: Record<string, unknown> = {};
    const defaults = {
        isBatchable: true,
        isStatic: false,
        isSelectable: true,
        enableAtStart: true,
        visibleByAI: true,
        gameVisibility: true,
        EnableMorphing: false,
    };

    for (const key of Object.keys(defaults) as Array<keyof typeof defaults>) {
        const value = object.userData?.[key];
        if (typeof value === "boolean" && value !== defaults[key]) {
            settings[key] = value;
        }
    }

    return Object.keys(settings).length > 0 ? settings : undefined;
};

const getMaterialSettings = (object: Object3D): Record<string, unknown> | undefined => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return undefined;
    const material = object.material as Material & {
        color?: {getHexString: () => string};
        opacity?: number;
        metalness?: number;
        roughness?: number;
    };

    const settings: Record<string, unknown> = {};
    if (material.opacity !== undefined && material.opacity !== 1) {
        settings.opacity = round(material.opacity);
    }
    if (material.metalness !== undefined && material.metalness !== 0) {
        settings.metalness = round(material.metalness);
    }
    if (material.roughness !== undefined && material.roughness !== 1) {
        settings.roughness = round(material.roughness);
    }

    return Object.keys(settings).length > 0 ? settings : undefined;
};

const getMaterialColor = (object: Object3D): string | undefined => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return undefined;
    const material = object.material as Material & {
        color?: {getHexString: () => string};
    };
    if (!material.color) return undefined;
    return `#${material.color.getHexString()}`;
};

const hasTextureMaps = (object: Object3D): boolean => {
    if (!(object instanceof Mesh)) return false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    return materials.some((material: Material) => {
        const materialRecord = material as unknown as Record<string, unknown>;
        for (const key of Object.keys(materialRecord)) {
            const value = materialRecord[key];
            if (value && typeof value === "object" && (value as {isTexture?: boolean}).isTexture) {
                return true;
            }
        }
        return false;
    });
};

const getPrimitiveType = (object: Object3D): string | null => {
    if (!(object instanceof Mesh) || !object.geometry) return null;
    switch (object.geometry.type) {
        case "BoxGeometry":
            return "box";
        case "SphereGeometry":
            return "sphere";
        case "CylinderGeometry":
            return "cylinder";
        case "ConeGeometry":
            return "cone";
        case "PlaneGeometry":
            return "plane";
        case "TorusGeometry":
            return "torus";
        case "TorusKnotGeometry":
            return "torusKnot";
        case "TetrahedronGeometry":
            return "triangle";
        case "CapsuleGeometry":
            return "capsule";
        case "IcosahedronGeometry":
            return "icosahedron";
        case "OctahedronGeometry":
            return "octahedron";
        case "DodecahedronGeometry":
            return "dodecahedron";
        case "RingGeometry":
            return "ring";
        default:
            return null;
    }
};

const getPrimitiveCommandParams = (object: Object3D, primitiveType: string): Record<string, unknown> => {
    if (!(object instanceof Mesh)) return {};

    const geometryWithParams = object.geometry;
    const params = geometryWithParams.parameters;
    if (!params) return {};

    primitiveType = primitiveType.toLowerCase();

    const size = (() => {
        switch (primitiveType) {
            case "box":
                return params.width === 1 && params.height === 1 && params.depth === 1
                    ? undefined
                    : {x: round(params.width), y: round(params.height), z: round(params.depth)};
            case "sphere": {
                const diameter = round((params.radius ?? 0.5) * 2);
                return diameter === 1 ? undefined : {x: diameter, y: diameter, z: diameter};
            }
            case "cylinder": {
                const diameter = round((params.radiusTop ?? 0.5) * 2);
                const height = round(params.height ?? 1);
                return diameter === 1 && height === 1 ? undefined : {x: diameter, y: height, z: diameter};
            }
            case "cone": {
                const diameter = round((params.radius ?? 0.5) * 2);
                const height = round(params.height ?? 1);
                return diameter === 1 && height === 1 ? undefined : {x: diameter, y: height, z: diameter};
            }
            case "plane": {
                const width = round(params.width ?? 1);
                const depth = round(params.height ?? 1);
                return width === 1 && depth === 1 ? undefined : {x: width, y: 1, z: depth};
            }
            case "torus": {
                const outerDiameter = round((params.radius ?? 0.5) * 2);
                const tubeDiameter = round((params.tube ?? 0.5) * 2);
                return outerDiameter === 1 && tubeDiameter === 1 ? undefined : {x: outerDiameter, y: tubeDiameter, z: tubeDiameter};
            }
            case "torusknot": {
                const outerDiameter = round((params.radius ?? 0.5) * 2);
                const tubeDiameter = round((params.tube ?? 0.5) * 2);
                return outerDiameter === 1 && tubeDiameter === 1 ? undefined : {x: outerDiameter, y: tubeDiameter, z: tubeDiameter};
            }
            case "capsule": {
                const diameter = round((params.radius ?? 0.5) * 2);
                const length = round(params.length ?? 1);
                return diameter === 1 && length === 1 ? undefined : {x: diameter, y: length, z: diameter};
            }
            case "ring": {
                const outerDiameter = round((params.outerRadius ?? 0.5) * 2);
                const innerDiameter = round((params.innerRadius ?? 0.5) * 2);
                return outerDiameter === 1 && innerDiameter === 1 ? undefined : {x: outerDiameter, y: innerDiameter, z: 1};
            }
            default:
                return undefined;
        }
    })();

    const commandParams = pruneUndefined({
        size,
        widthSegments: params.widthSegments,
        heightSegments: params.heightSegments,
        depthSegments: params.depthSegments,
        radialSegments: params.radialSegments,
        tubularSegments: params.tubularSegments,
        thetaSegments: params.thetaSegments,
        phiSegments: params.phiSegments,
        capSegments: params.capSegments,
    });

    if (primitiveType === "sphere") {
        if (commandParams.widthSegments === 32) delete commandParams.widthSegments;
        if (commandParams.heightSegments === 32) delete commandParams.heightSegments;
    }
    if (primitiveType === "cylinder" || primitiveType === "cone") {
        if (commandParams.radialSegments === 32) delete commandParams.radialSegments;
        if (commandParams.heightSegments === 1) delete commandParams.heightSegments;
    }
    if (primitiveType === "plane") {
        if (commandParams.widthSegments === 1) delete commandParams.widthSegments;
        if (commandParams.heightSegments === 1) delete commandParams.heightSegments;
    }
    if (primitiveType === "torus") {
        if (commandParams.radialSegments === 16) delete commandParams.radialSegments;
        if (commandParams.tubularSegments === 100) delete commandParams.tubularSegments;
    }
    if (primitiveType === "torusknot") {
        if (commandParams.radialSegments === 12) delete commandParams.radialSegments;
        if (commandParams.tubularSegments === 64) delete commandParams.tubularSegments;
    }
    if (primitiveType === "capsule") {
        if (commandParams.capSegments === 4) delete commandParams.capSegments;
        if (commandParams.radialSegments === 8) delete commandParams.radialSegments;
    }
    if (primitiveType === "ring") {
        if (commandParams.thetaSegments === 32) delete commandParams.thetaSegments;
        if (commandParams.phiSegments === 1) delete commandParams.phiSegments;
    }
    if (primitiveType === "box") {
        if (commandParams.widthSegments === 1) delete commandParams.widthSegments;
        if (commandParams.heightSegments === 1) delete commandParams.heightSegments;
        if (commandParams.depthSegments === 1) delete commandParams.depthSegments;
    }

    return commandParams;
};

const buildExportHeader = (type: "behavior" | "lambda", config: Record<string, unknown>, code: string): string => {
    return [
        "# StemStudio Export File",
        "# Generated by Script Tool scene export",
        "",
        stringifyYaml(
            {
                meta: {
                    tool: TOOL_NAME,
                    type,
                    exportVersion: EXPORT_VERSION,
                    exportedAt: new Date().toISOString(),
                },
                config,
                code,
            },
            {lineWidth: 0},
        ),
    ].join("\n");
};

const getBehaviorRegistryAliases = (): Map<string, string[]> => {
    const registry = (global.app?.editor?.behaviorConfigRegistry as unknown as {behaviorConfigs?: Map<string, {id: string}>})?.behaviorConfigs;
    const aliasMap = new Map<string, string[]>();
    if (!registry) return aliasMap;

    for (const [key, config] of registry.entries()) {
        if (!config?.id || key === config.id) continue;
        const aliases = aliasMap.get(config.id) || [];
        aliases.push(key);
        aliasMap.set(config.id, aliases);
    }

    return aliasMap;
};

const getLambdaRegistryAliases = (): Map<string, string[]> => {
    const registry = (global.app?.editor?.lambdaConfigRegistry as unknown as {assetMeta?: Map<string, {assetId: string}>})?.assetMeta;
    const aliasMap = new Map<string, string[]>();
    if (!registry) return aliasMap;

    for (const [key, meta] of registry.entries()) {
        if (!meta?.assetId || key === meta.assetId) continue;
        const aliases = aliasMap.get(meta.assetId) || [];
        aliases.push(key);
        aliasMap.set(meta.assetId, aliases);
    }

    return aliasMap;
};

export const chooseStableScriptId = (
    preferredId: string | undefined,
    aliases: string[],
    fallbackName: string,
    usedIds: Set<string>,
    prefix: string,
): string => {
    const candidates = [preferredId, ...aliases].filter((value): value is string => Boolean(value));
    const stableCandidate = candidates.find(value => !isOpaqueAssetId(value));
    const base = stableCandidate || `${prefix}.${toValidId(fallbackName, prefix)}`;
    const unique = makeUnique(base, usedIds);
    return unique;
};

const classifyExportableObjects = (
    root: Object3D,
    notes: Set<string>,
): ExportableObject[] => {
    const exportables: ExportableObject[] = [];
    const stack: Array<{object: Object3D; insideModel: boolean}> = [];
    for (let i = root.children.length - 1; i >= 0; i--) {
        const child = root.children[i];
        if (child) {
            stack.push({object: child, insideModel: false});
        }
    }

    const pushChildren = (object: Object3D, insideModel: boolean) => {
        for (let i = object.children.length - 1; i >= 0; i--) {
            const child = object.children[i];
            if (child) {
                stack.push({object: child, insideModel});
            }
        }
    };

    while (stack.length > 0) {
        const {object, insideModel} = stack.pop()!;
        if (object.userData?.isRuntimeOnly) continue;
        if (isDefaultSceneObject(object)) {
            pushChildren(object, false);
            continue;
        }

        const modelId = getModelId(object);
        if (modelId) {
            exportables.push({object, kind: "model"});
            continue;
        }

        if (insideModel) {
            continue;
        }

        if ((object as {isLight?: boolean}).isLight || (object as {isCamera?: boolean}).isCamera) {
            notes.add(`Skipped non-default ${object.type} "${object.name || object.uuid}" because the Script Tool export only recreates the default camera and default lights.`);
            continue;
        }

        if (object.type === "Group") {
            exportables.push({object, kind: "group"});
            pushChildren(object, false);
            continue;
        }

        const primitiveType = getPrimitiveType(object);
        if (primitiveType) {
            exportables.push({object, kind: "primitive", primitiveType});
            pushChildren(object, false);
            continue;
        }

        notes.add(`Skipped unsupported object "${object.name || object.uuid}" (${object.type}) because it is neither a model instance, a group, nor a supported primitive.`);
        pushChildren(object, false);
    }

    return exportables;
};

const buildExportNameMap = (exportables: ExportableObject[]): Map<string, string> => {
    const usedNames = new Set<string>();
    const result = new Map<string, string>();

    exportables.forEach((item, index) => {
        const fallbackBase = `${item.kind}-${index + 1}`;
        const baseName = item.object.name || fallbackBase;
        const exportName = makeUniqueDisplayName(baseName, usedNames, fallbackBase);
        result.set(item.object.uuid, exportName);
    });

    return result;
};

const getObjectTransform = (
    object: Object3D,
    hasExportedParent: boolean,
): {
    position: {x: number; y: number; z: number};
    rotation: {x: number; y: number; z: number};
    scale: {x: number; y: number; z: number};
} => {
    if (hasExportedParent) {
        return {
            position: {x: round(object.position.x), y: round(object.position.y), z: round(object.position.z)},
            rotation: {x: round(object.rotation.x), y: round(object.rotation.y), z: round(object.rotation.z)},
            scale: {x: round(object.scale.x), y: round(object.scale.y), z: round(object.scale.z)},
        };
    }

    object.getWorldPosition(tmpWorldPosition);
    object.getWorldScale(tmpWorldScale);
    object.getWorldQuaternion(tmpWorldQuaternion);
    tmpWorldEuler.setFromQuaternion(tmpWorldQuaternion, object.rotation.order);

    return {
        position: {x: round(tmpWorldPosition.x), y: round(tmpWorldPosition.y), z: round(tmpWorldPosition.z)},
        rotation: {x: round(tmpWorldEuler.x), y: round(tmpWorldEuler.y), z: round(tmpWorldEuler.z)},
        scale: {x: round(tmpWorldScale.x), y: round(tmpWorldScale.y), z: round(tmpWorldScale.z)},
    };
};

const pruneUndefined = <T extends Record<string, unknown>>(value: T): Partial<T> => {
    const result: Partial<T> = {};
    for (const [key, item] of Object.entries(value)) {
        if (item !== undefined) {
            result[key as keyof T] = item as T[keyof T];
        }
    }
    return result;
};

const rewriteUuidReferences = (
    value: unknown,
    exportNameByObjectUuid: Map<string, string>,
    notes: Set<string>,
    path: string,
): unknown => {
    if (typeof value === "string") {
        const exportName = exportNameByObjectUuid.get(value);
        if (exportName) {
            notes.add(`Rewrote behavior object reference at ${path} from UUID to object name "${exportName}". Verify the reference in the editor after import.`);
            return exportName;
        }
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item, index) =>
            rewriteUuidReferences(item, exportNameByObjectUuid, notes, `${path}[${index}]`),
        );
    }

    if (value && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            result[key] = rewriteUuidReferences(item, exportNameByObjectUuid, notes, `${path}.${key}`);
        }
        return result;
    }

    return value;
};

export const rewriteBehaviorConfigForStemscript = (
    behaviorConfig: Record<string, any> | null,
    attributesData: Record<string, any> | undefined,
    assetImportNameById: Map<string, string>,
    legacyImportNameByPath: Map<string, string>,
    exportNameByObjectUuid: Map<string, string>,
    notes: Set<string>,
    targetLabel: string,
): Record<string, any> | undefined => {
    if (!attributesData || Object.keys(attributesData).length === 0) {
        return undefined;
    }

    const cloned = rewriteLegacyMediaStringReferences(
        cloneJson(attributesData),
        legacyImportNameByPath,
        notes,
        `${targetLabel}.attributes`,
    ) as Record<string, any>;
    const attributeDefs = behaviorConfig?.attributes || {};

    for (const [key, value] of Object.entries(cloned)) {
        const attrType = attributeDefs[key]?.type;

        if (attrType && ASSET_ATTRIBUTE_TYPES.has(attrType)) {
            if (isAssetRef(value)) {
                const importName = assetImportNameById.get(value.assetId);
                if (importName) {
                    cloned[key] = importName;
                } else {
                    notes.add(`Behavior "${behaviorConfig?.name || behaviorConfig?.id || "unknown"}" on "${targetLabel}" references asset "${value.assetId}" which was not exported as an importable asset. Rebind "${key}" manually after import.`);
                }
            } else if (typeof value === "string") {
                const parsed = parseLegacyAssetUrl(value);
                if (parsed) {
                    const importName = legacyImportNameByPath.get(parsed.normalizedPath);
                    if (importName) {
                        cloned[key] = importName;
                    }
                }
            }
            continue;
        }

        if (attrType === "object" || attrType === "children") {
            cloned[key] = rewriteUuidReferences(value, exportNameByObjectUuid, notes, `${targetLabel}.${key}`);
            continue;
        }

        if (isAssetRef(value)) {
            notes.add(`Behavior "${behaviorConfig?.name || behaviorConfig?.id || "unknown"}" on "${targetLabel}" uses nested AssetRef data for "${key}". The exporter preserved the original value, but it may require manual rebinding after import.`);
            continue;
        }
    }

    return Object.keys(cloned).length > 0 ? cloned : undefined;
};

const buildBinaryDirectory = (assetType: Asset["type"]): string => {
    switch (assetType) {
        case AssetType.Model:
            return "models";
        case AssetType.Image:
            return "textures";
        case AssetType.Audio:
            return "audio";
        case AssetType.Video:
            return "videos";
        case AssetType.Prefab:
            return "prefabs";
        default:
            return "assets";
    }
};

const writeTextFile = (zip: JSZip, path: string, content: string, files: string[]) => {
    zip.file(path, content);
    files.push(path);
};

const writeBinaryFile = (zip: JSZip, path: string, blob: Blob, files: string[]) => {
    zip.file(path, blob);
    files.push(path);
};

type FileHandle = {
    createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
    }>;
};

/**
 * Prompt for a save-file handle while the browser's transient user activation
 * is still valid.  Must be called synchronously (or very shortly) after the
 * user gesture that triggered the export — before any heavy async work.
 * Returns `null` when the File System Access API is unavailable.
 * @param suggestedName
 */
const acquireSaveHandle = async (suggestedName: string): Promise<FileHandle | null> => {
    if (typeof window === "undefined" || !("showSaveFilePicker" in window)) {
        return null;
    }

    const handle = await (window as typeof window & {
        showSaveFilePicker?: (options: Record<string, unknown>) => Promise<FileHandle>;
    }).showSaveFilePicker?.({
        suggestedName,
        types: [{
            description: "StemStudio Scene Export",
            accept: {"application/zip": [".zip"]},
        }],
    });

    return handle ?? null;
};

const downloadZip = async (blob: Blob, suggestedName: string, handle: FileHandle | null): Promise<void> => {
    if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
};

const collectLegacyAssetCandidates = (scene: Object3D): LegacyAssetCandidate[] => {
    const candidates = new Map<string, LegacyAssetCandidate>();
    const visited = new WeakSet<object>();

    collectLegacyAssetCandidatesFromValue(scene.userData?.rendering?.background, "scene.userData.rendering.background", candidates, visited);
    collectLegacyAssetCandidatesFromValue(scene.userData?.gameUI, "scene.userData.gameUI", candidates, visited);
    collectLegacyAssetCandidatesFromValue(scene.userData?.behaviors, "scene.userData.behaviors", candidates, visited);
    collectLegacyAssetCandidatesFromValue(scene.userData?.lambdaInstances, "scene.userData.lambdaInstances", candidates, visited);

    traverseObjectDepthFirst(scene, object => {
        collectLegacyAssetCandidatesFromValue(object.userData?.behaviors, `${object.name || object.uuid}.userData.behaviors`, candidates, visited);
        collectLegacyAssetCandidatesFromValue(object.userData?.lambdaComponents, `${object.name || object.uuid}.userData.lambdaComponents`, candidates, visited);
        collectLegacyAssetCandidatesFromValue(object.userData?.materialSettings, `${object.name || object.uuid}.userData.materialSettings`, candidates, visited);
    });

    return [...candidates.values()];
};

const resolveLegacyAssets = async (
    candidates: LegacyAssetCandidate[],
    usedPaths: Set<string>,
    usedImportNames: Set<string>,
    notes: Set<string>,
    mode: "dump" | "export",
): Promise<ResolvedLegacyAsset[]> => {
    const resolved = new Map<string, ResolvedLegacyAsset>();

    for (const candidate of candidates) {
        try {
            const parsedFromSource = candidate.sourceUrl ? parseLegacyAssetUrl(candidate.sourceUrl) : null;
            let normalizedPath = parsedFromSource?.normalizedPath || null;

            if (!normalizedPath && candidate.legacyId) {
                normalizedPath = await resolveLegacyDownloadPathById(candidate.type, candidate.legacyId);
            }

            if (!normalizedPath) {
                notes.add(`Could not resolve legacy ${candidate.type} asset from ${candidate.sourceLabel}.`);
                continue;
            }

            if (resolved.has(normalizedPath)) {
                continue;
            }

            const parsed = parseLegacyAssetUrl(normalizedPath);
            if (!parsed) {
                notes.add(`Could not parse resolved legacy URL ${normalizedPath} from ${candidate.sourceLabel}.`);
                continue;
            }

            const ext = extensionFromFilename(parsed.filename, parsed.type === "audio" ? "mp3" : "png");
            const derivedName = parsed.filename.replace(/\.[^.]+$/, "") || `${parsed.type}-${parsed.legacyId}`;
            const importName = makeUniqueDisplayName(derivedName, usedImportNames, `${parsed.type}-${parsed.legacyId}`);
            const filePath = mode === "dump"
                ? makeUnique(
                    `${parsed.type === "audio" ? "audio" : "textures"}/${sanitizePathPart(derivedName, `${parsed.type}-${parsed.legacyId}`)}.${ext}`,
                    usedPaths,
                )
                : "";

            let blob: Blob | undefined;
            let url: string | undefined;
            if (mode === "dump") {
                blob = await fetchLegacyAssetBlob(parsed.normalizedPath);
            } else {
                url = backendUrlFromPath(parsed.normalizedPath) || parsed.normalizedPath;
            }

            resolved.set(parsed.normalizedPath, {
                type: parsed.type,
                legacyId: candidate.legacyId || parsed.legacyId,
                name: derivedName,
                importName,
                filePath,
                url,
                normalizedPath: parsed.normalizedPath,
                blob,
            });
        } catch (error) {
            notes.add(`Failed to export legacy ${candidate.type} asset from ${candidate.sourceLabel}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return [...resolved.values()];
};

export const exportCurrentSceneBundle = async (
    options: ExportSceneBundleOptions = {},
): Promise<ExportSceneBundleResult> => {
    const app = global.app;
    const editor = app?.editor;
    const scene = app?.scene;
    const sceneId = editor?.sceneID;
    const currentUserId = app?.authManager?.getUserData()?.id;
    const ownerId = editor?.projectUserId;
    const mode: "dump" | "export" = options.mode || "dump";

    if (!app || !editor || !scene || !sceneId) {
        return {success: false, message: "No active scene is open."};
    }

    if (!currentUserId || !ownerId || currentUserId !== ownerId) {
        return {success: false, message: "Only the scene owner can export the current scene bundle."};
    }

    const exportRootName = sanitizePathPart(options.suggestedName || editor.sceneName || "scene-export", "scene-export");
    const zipFileName = `${exportRootName}.zip`;

    // Acquire the file handle NOW while the user gesture is still active,
    // before any heavy async work that would expire the transient activation.
    let saveHandle: FileHandle | null = null;
    try {
        saveHandle = await acquireSaveHandle(zipFileName);
    } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") {
            return {success: false, message: "Export cancelled."};
        }
        // File System Access API unavailable — fall through to anchor download.
    }

    const bundleSlug = sanitizePathPart((editor.sceneName || exportRootName).toLowerCase(), "scene-export");
    const stemscriptName = `${bundleSlug}.stemscript`;
    const zip = new JSZip();
    const zipRoot = zip.folder(exportRootName)!;
    const fileList: string[] = [];
    const notes = new Set<string>();

    try {
        editor.component?.handleLoading(true);

        const sceneAssetsResponse = await getSceneAssets(sceneId, {includeLatestRelease: true});
        const sceneAssets = [...(sceneAssetsResponse.assets || [])];
        const assetContext = getAssetResolutionContext(scene, true) || emptyAssetResolutionContext;
        const discoveredAssetIds = new Set<string>();
        traverseAssetRefs(scene, assetContext, (assetId, context) => {
            const resolvedId = resolveAssetId(assetId, context);
            if (resolvedId) {
                discoveredAssetIds.add(resolvedId);
            }
        });
        for (const discoveredAssetId of discoveredAssetIds) {
            if (sceneAssets.some(asset => asset.id === discoveredAssetId)) {
                continue;
            }
            try {
                const discoveredAsset = await getAsset(discoveredAssetId, {includeLatestRelease: true});
                sceneAssets.push(discoveredAsset);
            } catch (error) {
                notes.add(`Referenced asset "${discoveredAssetId}" was not available through scene dependencies and could not be loaded directly: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        const assetById = new Map(sceneAssets.map(asset => [asset.id, asset]));
        const usedPaths = new Set<string>();
        const usedImportNames = new Set<string>();
        const usedScriptIds = new Set<string>();

        const behaviorAliasMap = getBehaviorRegistryAliases();
        const lambdaAliasMap = getLambdaRegistryAliases();

        const behaviorByAssetId = new Map<string, ExportedBehaviorAsset>();
        const lambdaByAssetId = new Map<string, ExportedLambdaAsset>();
        const binaryAssetById = new Map<string, ExportedBinaryAsset>();
        const scriptImportByAssetId = new Map<string, ExportedScriptImport>();
        const assetImportNameById = new Map<string, string>();
        const legacyAssets = await resolveLegacyAssets(
            collectLegacyAssetCandidates(scene),
            usedPaths,
            usedImportNames,
            notes,
            mode,
        );
        const legacyImportNameByPath = new Map(legacyAssets.map(asset => [asset.normalizedPath, asset.importName]));

        if (mode === "dump") {
            for (const legacyAsset of legacyAssets) {
                if (legacyAsset.blob) {
                    writeBinaryFile(zipRoot, legacyAsset.filePath, legacyAsset.blob, fileList);
                }
            }
            if (legacyAssets.length > 0) {
                notes.add(`Migrated ${legacyAssets.length} legacy media asset(s) to bundled import files.`);
            }
        } else if (legacyAssets.length > 0) {
            notes.add(`Referenced ${legacyAssets.length} legacy media asset(s) by URL; they will be fetched on import.`);
        }

        for (const asset of sceneAssets) {
            const revisionId = resolveAssetRevisionId(asset.id, assetContext) || asset.latestRelease?.revisionId || asset.headRevisionId;
            if (!revisionId) {
                notes.add(`Skipped asset "${asset.name}" (${asset.id}) because no active revision could be resolved.`);
                continue;
            }

            if (asset.type === AssetType.Script) {
                try {
                    const revisionData = await getAssetRevisionData(asset.id, revisionId, "json");
                    const code = typeof revisionData.code === "string" ? revisionData.code : "";
                    const importName = makeUniqueDisplayName(asset.name || asset.id, usedImportNames, asset.id);
                    const description = asset.description && asset.description.trim() ? asset.description.trim() : undefined;
                    const fileBase = sanitizePathPart(asset.name.replace(/\.[^.]+$/, ""), asset.id);
                    const filePath = makeUnique(`imports/${fileBase}.yaml`, usedPaths);
                    if (mode === "dump") {
                        const {buildImportDocument} = await import("../../editor/assets/v2/AssetsLibrary/exportImportUtils");
                        const yamlContent = buildImportDocument({name: importName, description}, code);
                        writeTextFile(zipRoot, filePath, yamlContent, fileList);
                    }
                    scriptImportByAssetId.set(asset.id, {
                        assetId: asset.id,
                        revisionId,
                        filePath,
                        importName,
                        code,
                        description,
                    });
                    assetImportNameById.set(asset.id, importName);
                } catch (error) {
                    notes.add(`Failed to export script import "${asset.name}" (${asset.id}): ${error instanceof Error ? error.message : String(error)}`);
                }
                continue;
            }

            if (asset.type === AssetType.Behavior || asset.type === AssetType.Lambda) {
                const revisionData = await getAssetRevisionData(asset.id, revisionId, "json");
                const parsedConfig = typeof revisionData.config === "string"
                    ? JSON.parse(revisionData.config)
                    : revisionData.config;
                const aliases = asset.type === AssetType.Behavior
                    ? (behaviorAliasMap.get(asset.id) || [])
                    : (lambdaAliasMap.get(asset.id) || []);
                const scriptId = chooseStableScriptId(
                    typeof parsedConfig?.id === "string" ? parsedConfig.id : undefined,
                    aliases,
                    asset.name,
                    usedScriptIds,
                    "exported",
                );
                const configWithStableId = {...parsedConfig, id: scriptId};
                const fileName = makeUnique(
                    sanitizePathPart(asset.name || scriptId, asset.type === AssetType.Behavior ? "behavior" : "lambda"),
                    usedPaths,
                );
                const filePath = `${asset.type === AssetType.Behavior ? "behaviors" : "lambdas"}/${fileName}.yaml`;
                const yamlContent = buildExportHeader(
                    asset.type === AssetType.Behavior ? "behavior" : "lambda",
                    configWithStableId,
                    revisionData.code,
                );

                writeTextFile(zipRoot, filePath, yamlContent, fileList);

                if (asset.type === AssetType.Behavior) {
                    behaviorByAssetId.set(asset.id, {
                        assetId: asset.id,
                        revisionId,
                        filePath,
                        config: configWithStableId,
                        code: revisionData.code,
                        scriptId,
                    });
                } else {
                    lambdaByAssetId.set(asset.id, {
                        assetId: asset.id,
                        revisionId,
                        filePath,
                        config: configWithStableId as LambdaConfig,
                        code: revisionData.code,
                        scriptId,
                    });
                }
                continue;
            }

            const importName = makeUniqueDisplayName(asset.name || asset.id, usedImportNames, asset.id);
            assetImportNameById.set(asset.id, importName);

            if (mode === "dump") {
                const ext = getExtension(asset);
                const fileBase = sanitizePathPart(asset.name.replace(/\.[^.]+$/, ""), asset.id);
                const filePath = makeUnique(
                    `${buildBinaryDirectory(asset.type)}/${fileBase}.${ext}`,
                    usedPaths,
                );
                try {
                    const blob = await getAssetRevisionData(asset.id, revisionId, "blob");
                    writeBinaryFile(zipRoot, filePath, blob, fileList);
                    binaryAssetById.set(asset.id, {
                        assetId: asset.id,
                        revisionId,
                        filePath,
                        importName,
                        asset,
                    });
                } catch (error) {
                    notes.add(`Failed to export binary asset "${asset.name}" (${asset.id}): ${error instanceof Error ? error.message : String(error)}`);
                }
            } else {
                // Export mode: no blob download, no file written — reference by signed dataUrl.
                try {
                    const revision = await getAssetRevision(asset.id, revisionId, {includeDataUrl: true});
                    const url = revision.dataUrl;
                    if (!url) {
                        notes.add(`Skipped asset "${asset.name}" (${asset.id}) because revision ${revisionId} has no dataUrl.`);
                        continue;
                    }
                    binaryAssetById.set(asset.id, {
                        assetId: asset.id,
                        revisionId,
                        filePath: "",
                        url,
                        importName,
                        asset,
                    });
                } catch (error) {
                    notes.add(`Failed to resolve dataUrl for "${asset.name}" (${asset.id}): ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }

        const exportables = classifyExportableObjects(scene, notes);
        const exportNameByObjectUuid = buildExportNameMap(exportables);
        const stemscriptLines: string[] = [];
        stemscriptLines.push("# Generated by Script Tool scene export");
        stemscriptLines.push(`# Source scene: ${editor.sceneName || "Untitled Scene"} (${sceneId})`);
        stemscriptLines.push("");

        const mediaAssets = [...binaryAssetById.values()]
            .filter(item => item.asset.type === AssetType.Image || item.asset.type === AssetType.Audio || item.asset.type === AssetType.Video)
            .sort((a, b) => a.importName.localeCompare(b.importName));
        const legacyMediaAssets = [...legacyAssets].sort((a, b) => a.importName.localeCompare(b.importName));
        const behaviorAssets = [...behaviorByAssetId.values()].sort((a, b) => a.config.name.localeCompare(b.config.name));
        const lambdaAssets = [...lambdaByAssetId.values()].sort((a, b) => a.config.name.localeCompare(b.config.name));

        for (const item of mediaAssets) {
            const importType = item.asset.type === AssetType.Image
                ? "image"
                : item.asset.type === AssetType.Audio
                    ? "audio"
                    : "video";
            stemscriptLines.push(buildCommand(`import ${importType}`, {
                name: item.importName,
                ...(mode === "export" && item.url ? {url: item.url} : {filepath: item.filePath}),
                comment: item.asset.name,
            }));
        }

        for (const item of legacyMediaAssets) {
            stemscriptLines.push(buildCommand(`import ${item.type}`, {
                name: item.importName,
                ...(mode === "export" && item.url ? {url: item.url} : {filepath: item.filePath}),
                comment: `legacy:${item.legacyId}`,
            }));
        }

        const scriptImportAssets = [...scriptImportByAssetId.values()].sort((a, b) => a.importName.localeCompare(b.importName));
        for (const scriptImport of scriptImportAssets) {
            stemscriptLines.push(buildCommand("import script", {
                name: scriptImport.importName,
                filepath: scriptImport.filePath,
                ...(scriptImport.description ? {comment: scriptImport.description} : {}),
            }));
        }

        for (const behavior of behaviorAssets) {
            stemscriptLines.push(buildCommand("import behavior", {
                name: behavior.config.name,
                filepath: behavior.filePath,
                comment: behavior.config.description || behavior.config.name,
            }));
        }

        for (const lambda of lambdaAssets) {
            stemscriptLines.push(buildCommand("import lambda", {
                name: lambda.config.name,
                filepath: lambda.filePath,
                comment: lambda.config.description || lambda.config.name,
            }));
        }

        for (const item of exportables.filter(entry => entry.kind === "model")) {
            const exportName = exportNameByObjectUuid.get(item.object.uuid)!;
            const modelId = getModelId(item.object);
            if (!modelId) continue;
            const binary = binaryAssetById.get(modelId);
            if (!binary) {
                notes.add(`Model object "${exportName}" references asset "${modelId}" but its binary payload was not exported. The object was omitted from the generated .stemscript.`);
                continue;
            }
            stemscriptLines.push(buildCommand("import model", {
                name: exportName,
                ...(mode === "export" && binary.url ? {url: binary.url} : {filepath: binary.filePath}),
                comment: binary.asset.name,
            }));
        }

        if (stemscriptLines[stemscriptLines.length - 1] !== "") {
            stemscriptLines.push("");
        }

        stemscriptLines.push(buildCommand("project title", {title: editor.sceneName || exportRootName}));

        const gameSettings = scene.userData?.game || {};
        const renderingSettings = scene.userData?.rendering || {};
        const background = renderingSettings.background || {};
        const fog = renderingSettings.fog || {};
        const toneMapping = renderingSettings.toneMapping || {};
        const postProcessing = scene.userData?.postProcessing || {};
        const backgroundTextureAssetRef = isAssetRef(background.textureAsset) ? background.textureAsset : undefined;
        const backgroundTextureFromAsset = backgroundTextureAssetRef
            ? assetImportNameById.get(backgroundTextureAssetRef.assetId)
            : undefined;
        if (backgroundTextureAssetRef && !backgroundTextureFromAsset) {
            notes.add(`Background texture asset "${backgroundTextureAssetRef.assetId}" could not be resolved to an imported file; keeping original texture value.`);
        }
        const backgroundTextureValue = backgroundTextureFromAsset
            || rewriteLegacyMediaStringReferences(
                background.texture,
                legacyImportNameByPath,
                notes,
                "scene.userData.rendering.background.texture",
            );

        const backgroundCubemapAssetRefs = Array.isArray(background.cubemapAssets)
            ? background.cubemapAssets
            : [];
        const backgroundCubemapSources = Array.isArray(background.cubemap)
            ? background.cubemap
            : [];
        const backgroundCubemapValue = Array.from({length: 6}, (_, index) => {
            const faceAssetRef = isAssetRef(backgroundCubemapAssetRefs[index])
                ? backgroundCubemapAssetRefs[index]
                : undefined;
            if (faceAssetRef) {
                const mapped = assetImportNameById.get(faceAssetRef.assetId);
                if (mapped) {
                    return mapped;
                }
                notes.add(`Background cubemap face ${index + 1} asset "${faceAssetRef.assetId}" could not be resolved to an imported file; keeping original value.`);
            }
            const faceSource = backgroundCubemapSources[index];
            return rewriteLegacyMediaStringReferences(
                faceSource,
                legacyImportNameByPath,
                notes,
                `scene.userData.rendering.background.cubemap[${index}]`,
            );
        });

        // Physics engine — emit `physics engine <type> [gravity=<n>]` when a
        // non-default engine is set on the scene, OR when gravity differs from
        // the runtime default. Keeps round-tripped scripts clean on default scenes.
        const scenePhysics = (scene.userData?.physics as {engine?: string; gravity?: number} | undefined) || {};
        const legacyGravity = typeof (gameSettings as {gravity?: number}).gravity === "number"
            ? (gameSettings as {gravity?: number}).gravity
            : undefined;
        const resolvedEngine = scenePhysics.engine;
        const resolvedGravity = typeof scenePhysics.gravity === "number" ? scenePhysics.gravity : legacyGravity;
        const DEFAULT_PHYSICS_ENGINE = "ammo";
        const DEFAULT_PHYSICS_GRAVITY = -9.81;
        const engineDiffers = typeof resolvedEngine === "string" && resolvedEngine !== DEFAULT_PHYSICS_ENGINE;
        const gravityDiffers = typeof resolvedGravity === "number" && resolvedGravity !== DEFAULT_PHYSICS_GRAVITY;
        if (engineDiffers || gravityDiffers) {
            const engineValue = typeof resolvedEngine === "string" ? resolvedEngine : DEFAULT_PHYSICS_ENGINE;
            // Emit the engine as a bare positional token (`physics engine rapier`)
            // to match human-authored scripts; gravity stays as a named param.
            const tokens = ["physics engine", engineValue];
            if (gravityDiffers) {
                tokens.push(`gravity=${toStemLiteral(resolvedGravity)}`);
            }
            stemscriptLines.push(tokens.join(" "));
        }

        // Compartments — only emit when enabled (off is the default; keeps round-tripped scripts clean).
        if (scene.userData?.compartmentsEnabled === true) {
            stemscriptLines.push("scene compartments on");
        }

        const gameSettingsCommand = buildCommandIfAny("game settings", {
            isGame: stripDefaults(gameSettings.isGame ?? gameSettings.enabled, DEFAULT_GAME_SETTINGS.isGame),
            lives: stripDefaults(gameSettings.lives, DEFAULT_GAME_SETTINGS.lives),
            maxScore: stripDefaults(gameSettings.maxScore, DEFAULT_GAME_SETTINGS.maxScore),
            timer: stripDefaults(gameSettings.timer, DEFAULT_GAME_SETTINGS.timer),
            useAvatar: stripDefaults(gameSettings.useAvatar, DEFAULT_GAME_SETTINGS.useAvatar),
            isMultiplayer: stripDefaults(gameSettings.isMultiplayer, DEFAULT_GAME_SETTINGS.isMultiplayer),
            showHUD: stripDefaults(gameSettings.showHUD, DEFAULT_GAME_SETTINGS.showHUD),
            isSandbox: stripDefaults(gameSettings.isSandbox, DEFAULT_GAME_SETTINGS.isSandbox),
            voiceChatEnabled: stripDefaults(gameSettings.voiceChatEnabled, DEFAULT_GAME_SETTINGS.voiceChatEnabled),
        });
        if (gameSettingsCommand) {
            stemscriptLines.push(gameSettingsCommand);
        }

        const renderSettingsCommand = buildCommandIfAny("render settings", {
            useShadows: stripDefaults(gameSettings.useShadows, DEFAULT_RENDER_SETTINGS.useShadows),
            useInstancing: stripDefaults(gameSettings.useInstancing, DEFAULT_RENDER_SETTINGS.useInstancing),
            shadowMapType: stripDefaults(renderingSettings.shadowMapType, DEFAULT_RENDER_SETTINGS.shadowMapType),
            usePhysicsWorker: stripDefaults(gameSettings.usePhysicsWorker, DEFAULT_RENDER_SETTINGS.usePhysicsWorker),
        });
        if (renderSettingsCommand) {
            stemscriptLines.push(renderSettingsCommand);
        }

        const lightingCommand = buildCommandIfAny("scene lighting", {
            ambient: stripDefaults(renderingSettings.ambient, DEFAULT_SCENE_LIGHTING.ambient),
            hemisphere: stripDefaults(renderingSettings.hemisphere, DEFAULT_SCENE_LIGHTING.hemisphere),
            shadows: stripDefaults({
                enabled: gameSettings.useShadows,
                mapType: renderingSettings.shadowMapType,
            }, DEFAULT_SCENE_LIGHTING.shadows),
        });
        if (lightingCommand) {
            stemscriptLines.push(lightingCommand);
        }

        const fogCommand = buildCommandIfAny("scene fog", {
            type: stripDefaults(fog.type, DEFAULT_SCENE_FOG.type),
            color: stripDefaults(fog.color, DEFAULT_SCENE_FOG.color),
            near: stripDefaults(fog.near, DEFAULT_SCENE_FOG.near),
            far: stripDefaults(fog.far, DEFAULT_SCENE_FOG.far),
            density: stripDefaults(fog.density, DEFAULT_SCENE_FOG.density),
        });
        if (fogCommand) {
            stemscriptLines.push(fogCommand);
        }

        const backgroundCommand = buildCommandIfAny("scene background", {
            type: stripDefaults(background.type, DEFAULT_SCENE_BACKGROUND.type),
            color: stripDefaults(background.color, DEFAULT_SCENE_BACKGROUND.color),
            texture: stripDefaults(backgroundTextureValue, DEFAULT_SCENE_BACKGROUND.texture),
            cubemap: stripDefaults(backgroundCubemapValue, DEFAULT_SCENE_BACKGROUND.cubemap),
            gradient: stripDefaults(background.gradient, DEFAULT_SCENE_BACKGROUND.gradient),
            gradientMode: stripDefaults(background.gradientMode, DEFAULT_SCENE_BACKGROUND.gradientMode),
            rotation: stripDefaults(background.rotation, DEFAULT_SCENE_BACKGROUND.rotation),
            intensity: stripDefaults(background.intensity, DEFAULT_SCENE_BACKGROUND.intensity),
            blurriness: stripDefaults(background.blurriness, DEFAULT_SCENE_BACKGROUND.blurriness),
        });
        if (backgroundCommand) {
            stemscriptLines.push(backgroundCommand);
        }

        const toneMappingCommand = buildCommandIfAny("scene tonemapping", {
            type: stripDefaults(toneMapping.type, DEFAULT_TONE_MAPPING.type),
            exposure: stripDefaults(toneMapping.exposure, DEFAULT_TONE_MAPPING.exposure),
        });
        if (toneMappingCommand) {
            stemscriptLines.push(toneMappingCommand);
        }

        const postProcessingCommand = buildCommandIfAny("scene postprocessing", {
            ao: postProcessing.ao,
            bloom: postProcessing.bloom,
            ssr: postProcessing.ssr,
            dof: postProcessing.dof,
            outline: postProcessing.outline,
        });
        if (postProcessingCommand) {
            stemscriptLines.push(postProcessingCommand);
        }

        const defaultCamera = findObjectByNameDepthFirst(scene, "DefaultCamera") as (Object3D & {isCamera?: boolean; fov?: number; near?: number; far?: number}) | null;
        if (defaultCamera?.isCamera) {
            const cameraData = defaultCamera.userData?.cameraData || {};
            const cameraCommand = buildCommandIfAny("camera \"DefaultCamera\"", {
                fov: stripDefaults(cameraData.cameraFOV ?? defaultCamera.fov, DEFAULT_CAMERA_SETTINGS.fov),
                near: stripDefaults(cameraData.cameraNear ?? defaultCamera.near, DEFAULT_CAMERA_SETTINGS.near),
                far: stripDefaults(cameraData.cameraFar ?? defaultCamera.far, DEFAULT_CAMERA_SETTINGS.far),
                cameraType: stripDefaults(cameraData.cameraType, DEFAULT_CAMERA_SETTINGS.cameraType),
                defaultDistance: stripDefaults(cameraData.cameraDefaultDistance, DEFAULT_CAMERA_SETTINGS.defaultDistance),
                minDistance: stripDefaults(cameraData.cameraMinDistance, DEFAULT_CAMERA_SETTINGS.minDistance),
                maxDistance: stripDefaults(cameraData.cameraMaxDistance, DEFAULT_CAMERA_SETTINGS.maxDistance),
                headHeight: stripDefaults(cameraData.cameraHeadHeight, DEFAULT_CAMERA_SETTINGS.headHeight),
                axis: stripDefaults(cameraData.cameraAxis, DEFAULT_CAMERA_SETTINGS.axis),
                occlusionType: cameraData.occlusionType,
            });
            if (cameraCommand) {
                stemscriptLines.push(cameraCommand);
            }
        }

        const directional = findObjectByNameDepthFirst(scene, "Directional Light");
        if (directional) {
            const lightTarget = directional.name || "Directional Light";
            const lightData = directional as Object3D & {
                intensity?: number;
                color?: {getHexString: () => string};
                castShadow?: boolean;
                shadow?: {mapSize?: {x: number}; bias?: number; normalBias?: number; radius?: number};
            };
            const lightCommand = buildCommandIfAny(`light ${toStemLiteral(lightTarget)}`, {
                intensity: stripDefaults(lightData.intensity, DEFAULT_DIRECTIONAL_LIGHT.intensity),
                color: stripDefaults(lightData.color ? `#${lightData.color.getHexString()}` : undefined, DEFAULT_DIRECTIONAL_LIGHT.color),
                castShadow: stripDefaults(lightData.castShadow, DEFAULT_DIRECTIONAL_LIGHT.castShadow),
                shadowMapSize: stripDefaults(lightData.shadow?.mapSize?.x, DEFAULT_DIRECTIONAL_LIGHT.shadowMapSize),
                shadowBias: stripDefaults(lightData.shadow?.bias, DEFAULT_DIRECTIONAL_LIGHT.shadowBias),
                shadowNormalBias: stripDefaults(lightData.shadow?.normalBias, DEFAULT_DIRECTIONAL_LIGHT.shadowNormalBias),
                shadowRadius: stripDefaults(lightData.shadow?.radius, DEFAULT_DIRECTIONAL_LIGHT.shadowRadius),
            });
            if (lightCommand) {
                stemscriptLines.push(lightCommand);
            }

            const lightPositionCommand = buildCommandIfAny(`update ${toStemLiteral(lightTarget)}`, {
                position: stripDefaults({
                    x: round(directional.position.x),
                    y: round(directional.position.y),
                    z: round(directional.position.z),
                }, DEFAULT_DIRECTIONAL_LIGHT.position),
            });
            if (lightPositionCommand) {
                stemscriptLines.push(lightPositionCommand);
            }
        }

        stemscriptLines.push("");

        for (const item of exportables) {
            const exportName = exportNameByObjectUuid.get(item.object.uuid)!;
            const parentObject = item.object.parent;
            const parentExportName = parentObject ? exportNameByObjectUuid.get(parentObject.uuid) : undefined;
            const hasExportedParent = Boolean(parentExportName);
            const transform = getObjectTransform(item.object, hasExportedParent);
            const objectSettings = getObjectSettings(item.object);
            const tags = getObjectTags(item.object);
            const materialSettings = getMaterialSettings(item.object);

            if (isWaypointPathObject(item.object)) {
                const waypointPathData = item.object.userData?.aiWaypointPath || {};
                if (!deepEqual(transform.rotation, DEFAULT_TRANSFORM.rotation) || !deepEqual(transform.scale, DEFAULT_TRANSFORM.scale)) {
                    notes.add(`Waypoint path "${exportName}" has non-default rotation or scale. Export only preserves its name, parent, position, and loop flag.`);
                }
                stemscriptLines.push(buildCommand("waypoint path add", pruneUndefined({
                    name: exportName,
                    position: transform.position,
                    parent: parentExportName,
                    loop: stripDefaults(waypointPathData.loop, true),
                })));
                continue;
            }

            if (isWaypointMarkerObject(item.object)) {
                const waypointData = item.object.userData?.aiWaypoint || {};
                const pathLabel = parentExportName
                    || exportNameByObjectUuid.get(waypointData.path)
                    || waypointData.pathName;
                if (!pathLabel) {
                    notes.add(`Waypoint "${exportName}" is missing a resolvable path parent. Falling back to generic object export is not supported; recreate it manually after import.`);
                    continue;
                }
                if (!deepEqual(transform.rotation, DEFAULT_TRANSFORM.rotation) || !deepEqual(transform.scale, DEFAULT_TRANSFORM.scale)) {
                    notes.add(`Waypoint "${exportName}" has non-default rotation or scale. Export only preserves its path, name, position, and waypoint metadata.`);
                }
                stemscriptLines.push(buildCommand("waypoint add", pruneUndefined({
                    path: pathLabel,
                    name: exportName,
                    position: transform.position,
                    order: waypointData.order,
                    waitTime: stripDefaults(waypointData.waitTime, 0),
                    arrivalRadius: stripDefaults(waypointData.arrivalRadius, 1),
                })));
                continue;
            }

            if (item.kind === "group") {
                stemscriptLines.push(buildCommand("add group", pruneUndefined({
                    name: exportName,
                    position: transform.position,
                    rotation: transform.rotation,
                    scale: transform.scale,
                    parent: parentExportName,
                    objectSettings,
                })));
            } else if (item.kind === "primitive") {
                const primitiveType = item.primitiveType!;
                const primitiveParams = getPrimitiveCommandParams(item.object, primitiveType);
                stemscriptLines.push(buildCommand(`add ${primitiveType}`, pruneUndefined({
                    name: exportName,
                    position: transform.position,
                    rotation: transform.rotation,
                    ...primitiveParams,
                    scale: transform.scale,
                    color: getMaterialColor(item.object),
                    parent: parentExportName,
                    objectSettings,
                })));
            } else if (item.kind === "model") {
                if (parentExportName) {
                    stemscriptLines.push(buildCommand(`move ${toStemLiteral(exportName)}`, {parent: parentExportName}));
                }
                const updateCommand = buildCommandIfAny(`update ${toStemLiteral(exportName)}`, {
                    position: stripDefaults(transform.position, DEFAULT_TRANSFORM.position),
                    rotation: stripDefaults(transform.rotation, DEFAULT_TRANSFORM.rotation),
                    scale: stripDefaults(transform.scale, DEFAULT_TRANSFORM.scale),
                    objectSettings,
                });
                if (updateCommand) {
                    stemscriptLines.push(updateCommand);
                }
            }

            for (const tag of tags) {
                stemscriptLines.push(buildCommand(`update ${toStemLiteral(exportName)}`, {tag}));
            }

            const physicsConfig = PhysicsUtil.getPhysicsConfig(item.object);
            if (physicsConfig) {
                stemscriptLines.push(buildCommand(`physics set ${toStemLiteral(exportName)}`, {
                    config: pruneUndefined({
                        enabled: physicsConfig.enabled,
                        shape: {
                            btBoxShape: "box",
                            btSphereShape: "sphere",
                            btCapsuleShape: "capsule",
                            btConvexHullShape: "convexHull",
                            btConcaveHullShape: "concaveHull",
                        }[physicsConfig.shape] || physicsConfig.shape,
                        shapeExcludesHiddenObjects: physicsConfig.shapeExcludesHiddenObjects,
                        mass: physicsConfig.mass,
                        restitution: physicsConfig.restitution,
                        friction: physicsConfig.friction,
                        rollingFriction: physicsConfig.rollingFriction,
                        spinningFriction: physicsConfig.spinningFriction,
                        contactStiffness: physicsConfig.contactStiffness,
                        contactDamping: physicsConfig.contactDamping,
                        ctype: physicsConfig.ctype,
                        userShapeOffset: physicsConfig.userShapeOffset,
                        userShapeScale: physicsConfig.userShapeScale,
                        rotationLock: physicsConfig.rotationLock,
                        enable_preview: physicsConfig.enable_preview,
                        collision_material: physicsConfig.collision_material,
                        climbable: physicsConfig.climbable,
                    }),
                }));
            }

            if (materialSettings && item.kind !== "model") {
                stemscriptLines.push(buildCommand(`material ${toStemLiteral(exportName)}`, materialSettings));
            }

            if (hasTextureMaps(item.object)) {
                notes.add(`Object "${exportName}" has direct texture map assignments. The exporter preserved the texture asset files, but Script Tool replay for direct material textures still needs manual relinking.`);
            }
        }

        const appendBehaviorLines = (targetLabel: string, behaviors: BehaviorData[] | undefined) => {
            if (!behaviors || behaviors.length === 0) return;

            for (const behavior of behaviors) {
                const exportedBehavior = behaviorByAssetId.get(behavior.id);
                const behaviorId = exportedBehavior?.scriptId || behavior.id;
                const behaviorConfig = exportedBehavior?.config
                    || global.app?.editor?.behaviorConfigRegistry?.getConfig(behavior.id)
                    || global.app?.editor?.behaviorConfigRegistry?.getConfig(behaviorId);
                const attachConfig = rewriteBehaviorConfigForStemscript(
                    behaviorConfig as Record<string, any> | null,
                    behavior.attributesData,
                    assetImportNameById,
                    legacyImportNameByPath,
                    exportNameByObjectUuid,
                    notes,
                    targetLabel,
                );
                if (behaviorId === "navmesh") {
                    stemscriptLines.push(buildCommand("navmesh add", pruneUndefined({
                        target: targetLabel,
                        ...(attachConfig || {}),
                    })));
                } else if (behaviorId === "navmesh-connection") {
                    const targetObject = attachConfig?.targetObject;
                    if (typeof targetObject === "string" && targetObject.trim()) {
                        const restConfig = {...(attachConfig || {})};
                        delete restConfig.targetObject;
                        stemscriptLines.push(buildCommand(`navmesh connection add ${toStemLiteral(targetLabel)}`, pruneUndefined({
                            target: targetObject,
                            ...restConfig,
                        })));
                    } else {
                        notes.add(`NavMesh connection on "${targetLabel}" is missing a resolvable target object. Exporting it as a generic behavior attachment instead.`);
                        stemscriptLines.push(buildCommand(`behavior attach ${toStemLiteral(targetLabel)}`, pruneUndefined({
                            behaviorId,
                            config: attachConfig,
                        })));
                    }
                } else {
                    stemscriptLines.push(buildCommand(`behavior attach ${toStemLiteral(targetLabel)}`, pruneUndefined({
                        behaviorId,
                        config: attachConfig,
                    })));
                }

                if (behavior.enabled === false) {
                    stemscriptLines.push(buildCommand(`behavior config ${toStemLiteral(targetLabel)}`, {
                        behaviorId,
                        enabled: false,
                    }));
                }

                if (behavior.throttleConfig) {
                    notes.add(`Behavior "${behaviorId}" on "${targetLabel}" uses throttle settings that are not currently exported through Script Tool commands. Reapply them manually if needed.`);
                }
            }
        };

        appendBehaviorLines("Default Scene", scene.userData?.behaviors as BehaviorData[] | undefined);
        for (const item of exportables) {
            const exportName = exportNameByObjectUuid.get(item.object.uuid)!;
            appendBehaviorLines(exportName, item.object.userData?.behaviors as BehaviorData[] | undefined);
        }

        const lambdaBindings = {
            sceneInstances: ((scene.userData?.lambdaInstances as LambdaInstanceData[] | undefined) || []).map((instance) => ({
                lambdaId: lambdaByAssetId.get(instance.lambdaId)?.scriptId || instance.lambdaId,
                instanceId: instance.instanceId,
                enabled: instance.enabled,
                attributes: rewriteLegacyMediaStringReferences(
                    instance.attributes,
                    legacyImportNameByPath,
                    notes,
                    `lambdaInstance:${instance.instanceId}.attributes`,
                ),
            })),
            objectComponents: exportables.flatMap((item) => {
                const exportName = exportNameByObjectUuid.get(item.object.uuid)!;
                const components = (item.object.userData?.lambdaComponents as LambdaComponentData[] | undefined) || [];
                return components.map(component => ({
                    objectName: exportName,
                    lambdaId: lambdaByAssetId.get(component.lambdaId)?.scriptId || component.lambdaId,
                    instanceId: component.instanceId,
                    enabled: component.enabled,
                    autoApply: component.autoApply,
                    isCritical: component.isCritical,
                    componentData: rewriteLegacyMediaStringReferences(
                        component.componentData,
                        legacyImportNameByPath,
                        notes,
                        `lambdaComponent:${exportName}:${component.instanceId}.componentData`,
                    ),
                }));
            }),
        };

        if (lambdaBindings.sceneInstances.length > 0 || lambdaBindings.objectComponents.length > 0) {
            writeTextFile(
                zipRoot,
                "lambdas/scene-lambda-bindings.json",
                JSON.stringify(lambdaBindings, null, 2),
                fileList,
            );
            notes.add("Lambda YAML assets were exported, and lambda bindings were written to lambdas/scene-lambda-bindings.json. Script Tool replay for lambda attachment is not automated yet.");
            stemscriptLines.push("");
            stemscriptLines.push("# Lambda bindings were exported to lambdas/scene-lambda-bindings.json for manual reattachment.");
        }

        const stemscriptContent = stemscriptLines.join("\n") + "\n";
        writeTextFile(zipRoot, stemscriptName, stemscriptContent, fileList);

        const sceneObjectSummary = exportables.map((item) => ({
            sourceName: item.object.name || null,
            exportName: exportNameByObjectUuid.get(item.object.uuid),
            uuid: item.object.uuid,
            kind: item.kind,
            parentUuid: item.object.parent?.uuid || null,
            parentExportName: item.object.parent ? exportNameByObjectUuid.get(item.object.parent.uuid) || null : null,
            assetId: item.kind === "model" ? getModelId(item.object) : null,
        }));

        const conversionPlan = [
            "# Export Plan",
            "",
            `- Mode: ${mode}`,
            `- Scene name: ${editor.sceneName || "Untitled Scene"}`,
            `- Scene ID: ${sceneId}`,
            `- Owner ID: ${ownerId}`,
            `- Export root: ${exportRootName}.zip`,
            `- Main stemscript: ${stemscriptName}`,
            `- Exported scene assets: ${sceneAssets.length}`,
            `- Legacy media assets: ${legacyAssets.length}`,
            `- Exported scene objects: ${exportables.length}`,
            "",
            "## Notes",
            "",
            ...([...notes].length > 0 ? [...notes].map(note => `- ${note}`) : ["- No known export gaps were detected during bundle generation."]),
            "",
        ].join("\n");
        writeTextFile(zipRoot, "conversion-plan.md", conversionPlan, fileList);

        const conversionNotes = [
            "# Conversion Notes",
            "",
            `This bundle was generated directly from the live StemStudio scene "${editor.sceneName || "Untitled Scene"}" (${sceneId}).`,
            "",
            "## Known Gaps",
            "",
            ...([...notes].length > 0 ? [...notes].map(note => `- ${note}`) : ["- No known gaps detected."]),
            "",
        ].join("\n");
        writeTextFile(zipRoot, "conversion-notes.md", conversionNotes, fileList);

        const readme = [
            `# ${editor.sceneName || "Scene Export"}`,
            "",
            `This bundle was generated by the Script Tool scene ${mode === "dump" ? "dump" : "export"}er.`,
            "",
            "## Quick Start",
            "",
            `1. Open the Script Tool terminal in StemStudio.`,
            `2. Run \`exec\` and choose this bundle folder.`,
            `3. Execute \`${stemscriptName}\`.`,
            "",
            "## Bundle Layout",
            "",
            `- \`${stemscriptName}\`: main Script Tool entrypoint`,
            "- `behaviors/`: exported behavior YAML files",
            "- `lambdas/`: exported lambda YAML files and lambda binding data",
            ...(mode === "dump"
                ? ["- `models/`, `textures/`, `audio/`, `videos/`: exported binary assets"]
                : ["- Asset binaries are **not** bundled. `import` lines carry `url=` params; `exec` fetches each URL at import time."]),
            "- `conversion-plan.md`, `conversion-notes.md`, `source-map.md`, `source-analysis.json`: export metadata",
            "",
            "## Important",
            "",
            "- Model imports are emitted per scene object for reliable Script Tool replay. Re-importing repeated model files will create repeated assets unless you deduplicate them manually afterward.",
            "- Lambda bindings are exported for reference, but the current Script Tool does not automatically recreate them.",
            "- Direct material texture assignments and some advanced behavior references may still need manual relinking after import.",
            ...(mode === "export"
                ? ["- Signed URLs in `import … url=…` lines expire with the asset server's signing window. Re-export if the bundle sits unused for an extended period."]
                : []),
            "",
        ].join("\n");
        writeTextFile(zipRoot, "README.md", readme, fileList);

        const sourceMap = [
            "# Source Map",
            "",
            "| Source Name | Export Name | UUID | Kind | Asset |",
            "| --- | --- | --- | --- | --- |",
            ...sceneObjectSummary.map((item) => {
                const asset = item.assetId ? assetById.get(item.assetId)?.name || item.assetId : "";
                return `| ${item.sourceName || "(unnamed)"} | ${item.exportName || ""} | ${item.uuid} | ${item.kind} | ${asset} |`;
            }),
            "",
        ].join("\n");
        writeTextFile(zipRoot, "source-map.md", sourceMap, fileList);

        const analysis = {
            exportVersion: EXPORT_VERSION,
            tool: "script-tool-scene-export",
            mode,
            scene: {
                id: sceneId,
                name: editor.sceneName || "Untitled Scene",
                ownerId,
                currentUserId,
            },
            counts: {
                assets: sceneAssets.length,
                behaviors: behaviorByAssetId.size,
                lambdas: lambdaByAssetId.size,
                binaryAssets: binaryAssetById.size + legacyAssets.length,
                objects: exportables.length,
            },
            sceneAssets: sceneAssets.map((asset) => ({
                id: asset.id,
                name: asset.name,
                type: asset.type,
                format: asset.format,
                revisionId: resolveAssetRevisionId(asset.id, assetContext) || asset.latestRelease?.revisionId || asset.headRevisionId,
                exportedPath: behaviorByAssetId.get(asset.id)?.filePath
                    || lambdaByAssetId.get(asset.id)?.filePath
                    || binaryAssetById.get(asset.id)?.filePath
                    || null,
                exportedUrl: binaryAssetById.get(asset.id)?.url || null,
            })),
            objects: sceneObjectSummary,
            lambdaBindings,
            legacyMediaAssets: legacyAssets.map(asset => ({
                type: asset.type,
                legacyId: asset.legacyId,
                importName: asset.importName,
                exportedPath: asset.filePath || null,
                exportedUrl: asset.url || null,
                sourcePath: asset.normalizedPath,
            })),
            notes: [...notes],
        };
        writeTextFile(zipRoot, "source-analysis.json", JSON.stringify(analysis, null, 2), fileList);

        const manifest = {
            exportVersion: EXPORT_VERSION,
            sourceScene: {
                id: sceneId,
                name: editor.sceneName || "Untitled Scene",
                ownerId,
            },
            bundle: {
                rootFile: stemscriptName,
                generatedAt: new Date().toISOString(),
                zipRoot: exportRootName,
            },
            files: [...fileList, "conversion-manifest.json"].sort(),
        };
        writeTextFile(zipRoot, "conversion-manifest.json", JSON.stringify(manifest, null, 2), fileList);

        const zipBlob = await zip.generateAsync({type: "blob"});
        await downloadZip(zipBlob, zipFileName, saveHandle);

        return {
            success: true,
            message: `Exported scene bundle with ${fileList.length} files.`,
        };
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : "Failed to export scene bundle.",
        };
    } finally {
        editor.component?.handleLoading(false);
    }
};

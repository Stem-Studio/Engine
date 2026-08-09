import * as THREE from "three";
import {Object3D} from "three";

import {AssetType, getAsset, getAssets} from "@stem/network/api/asset";
import {
    getAssetResolutionContext,
    resolveAssetRevisionId,
    setAssetRevision,
} from "../../asset-management/AssetResolutionContext";
import * as Commands from "../../command/Commands";
import AIWorldController from "../../controls/AiWorldController/AiWorldController";
import {urlToFile} from "../../controls/AiWorldController/AiWorldController.utils";
import {createAsset} from "../../editor/asset-management/hooks/assets";
import {
    applyMaterialValueOverridesToObject,
    applyTextureOverridesToObject,
} from "../../editor/assets/v2/materials/materialUtils";
import {IMaterialSettingsTextures} from "../../editor/assets/v2/RightPanel/sections/MaterialRenderingSection/types";
import EngineRuntime from "../../EngineRuntime";
import {uploadModelFromUrl} from "../../model/uploadModelFromUrl";
import {GENERATOR_TYPES} from "../../utils/ModelGeneratorProvider";
import TagUtil from "../../utils/TagUtil";
import {cloneJsonCompatible} from "../../utils/cloneJsonCompatible";
import {findObjectByUuidOrNameDepthFirst, findObjectDepthFirst} from "../../utils/SceneTraverser";
import {SupportedCommands} from "../CommandsRegistry";
import {CommandResult} from "../types/ACPTypes";
import {getObjectBaseMetaData, serializeObjectForAI} from "../utils/serialization";

/** Map an agent-supplied provider string to a generator, defaulting to Meshy. */
function resolveGenerator(provider?: string): GENERATOR_TYPES {
    switch ((provider ?? "").trim().toLowerCase()) {
        case "tripo":
            return GENERATOR_TYPES.TRIPO;
        case "rodin":
            return GENERATOR_TYPES.RODIN;
        case "meshy":
            return GENERATOR_TYPES.MESHY;
        default:
            return GENERATOR_TYPES.MESHY;
    }
}

type BaseObjectData = {
    uuid: string;
    name: string;
    type: string;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
};

enum AssetsType {
    Models = "models",
    Prefabs = "prefabs",
    Textures = "textures",
    HDRIS = "hdris",
}

/**
 * Subset of Object3D.userData properties that the AI Agent is allowed to read and write.
 * These correspond directly to settings exposed in the editor's right-panel sections:
 * - RenderingSection   → isBatchable, isStatic
 * - InGameSettingsSection → isSelectable, enableAtStart, visibleByAI
 * - VisibilitySection  → gameVisibility
 * - ModelSection       → EnableMorphing
 */
export type ObjectSettings = {
    /** Enable GPU instanced batching for this object (RenderingSection). Default: true */
    isBatchable?: boolean;
    /** Mark this object (and all children) as static – no runtime transforms (RenderingSection). Default: false */
    isStatic?: boolean;
    /** Allow the player to select this object at runtime (InGameSettingsSection). Default: true */
    isSelectable?: boolean;
    /** Whether the object is active/enabled at game start (InGameSettingsSection). Default: true */
    enableAtStart?: boolean;
    /** Whether AI NPCs can perceive this object (InGameSettingsSection). Default: true */
    visibleByAI?: boolean;
    /** Object visibility during Play Mode (VisibilitySection). Default: true */
    gameVisibility?: boolean;
    /** Enable morph-target animation on mobile devices (ModelSection). Default: false */
    EnableMorphing?: boolean;
};

type PrimitiveSegmentParams = {
    widthSegments?: number;
    heightSegments?: number;
    depthSegments?: number;
    radialSegments?: number;
    tubularSegments?: number;
    thetaSegments?: number;
    phiSegments?: number;
    capSegments?: number;
};

const OBJECT_SETTING_KEYS = [
    "isBatchable",
    "isStatic",
    "isSelectable",
    "enableAtStart",
    "visibleByAI",
    "gameVisibility",
    "EnableMorphing",
] as const;

const GEOMETRY_KIND_BY_TYPE: Record<string, string> = {
    BoxGeometry: "box",
    SphereGeometry: "sphere",
    CylinderGeometry: "cylinder",
    ConeGeometry: "cone",
    PlaneGeometry: "plane",
    TorusGeometry: "torus",
    TorusKnotGeometry: "torusknot",
    TetrahedronGeometry: "triangle",
    CapsuleGeometry: "capsule",
    IcosahedronGeometry: "icosahedron",
    OctahedronGeometry: "octahedron",
    DodecahedronGeometry: "dodecahedron",
    RingGeometry: "ring",
};

const toSegmentCount = (value: number | undefined, min: number): number | undefined => {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    return Math.max(min, Math.floor(value));
};

const normalizeKind = (kind: string | undefined): string | undefined =>
    kind?.trim().toLowerCase().replace(/[\s_-]/g, "");

/**
 * Object manipulation command handlers for CommandsRegistry
 */
export class ObjectHandlers {
    constructor(
        private engine: EngineRuntime,
        private aiWorldController: AIWorldController,
    ) {}

    /**
     * Apply ObjectSettings to an object's userData. Only defined keys are written.
     * @param object
     * @param settings
     */
    private applyObjectSettings(object: Object3D, settings: ObjectSettings): void {
        if (settings.isBatchable !== undefined) object.userData.isBatchable = settings.isBatchable;
        if (settings.isStatic !== undefined) object.userData.isStatic = settings.isStatic;
        if (settings.isSelectable !== undefined) object.userData.isSelectable = settings.isSelectable;
        if (settings.enableAtStart !== undefined) object.userData.enableAtStart = settings.enableAtStart;
        if (settings.visibleByAI !== undefined) object.userData.visibleByAI = settings.visibleByAI;
        if (settings.gameVisibility !== undefined) object.userData.gameVisibility = settings.gameVisibility;
        if (settings.EnableMorphing !== undefined) object.userData.EnableMorphing = settings.EnableMorphing;
    }

    private objectHasMaterialTarget(object: Object3D): boolean {
        return findObjectDepthFirst(
            object,
            child => (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) && !!child.material,
        ) !== null;
    }

    private clonePlainValue<T>(value: T): T {
        if (value === undefined || value === null) {
            return value;
        }

        try {
            return cloneJsonCompatible(value);
        } catch {
            return value;
        }
    }

    private vectorToData(value: THREE.Vector3): {x: number; y: number; z: number} {
        return {x: value.x, y: value.y, z: value.z};
    }

    private eulerToData(value: THREE.Euler): {x: number; y: number; z: number; order: string} {
        return {x: value.x, y: value.y, z: value.z, order: value.order};
    }

    private findFirstMesh(object: Object3D): THREE.Mesh | THREE.SkinnedMesh | null {
        return findObjectDepthFirst(
            object,
            child => child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh,
        ) as THREE.Mesh | THREE.SkinnedMesh | null;
    }

    private findFirstMaterial(object: Object3D): THREE.Material | null {
        const mesh = this.findFirstMesh(object);
        const material = mesh?.material;
        if (Array.isArray(material)) {
            return material[0] || null;
        }
        return material || null;
    }

    private getPrimaryMaterialSettings(object: Object3D): Record<string, any> | null {
        const materialSettings = object.userData?.materialSettings;
        if (!materialSettings || typeof materialSettings !== "object") {
            return null;
        }

        if ("textures" in materialSettings || "texturesSettings" in materialSettings) {
            return materialSettings as Record<string, any>;
        }

        const firstKey = Object.keys(materialSettings)[0];
        if (!firstKey) {
            return materialSettings as Record<string, any>;
        }

        const firstValue = (materialSettings as Record<string, any>)[firstKey];
        return firstValue && typeof firstValue === "object" ? firstValue as Record<string, any> : null;
    }

    private serializeMaterialSettings(object: Object3D): Record<string, any> {
        const material = this.findFirstMaterial(object);
        const primarySettings = this.getPrimaryMaterialSettings(object);
        const texturesSettings = primarySettings?.texturesSettings as Record<string, any> | undefined;
        const materialData: Record<string, any> = {
            materialSettings: this.clonePlainValue(object.userData?.materialSettings ?? null),
        };

        if (material) {
            materialData.material = {
                uuid: material.uuid,
                name: material.name,
                type: material.type,
                color:
                    "color" in material && material.color instanceof THREE.Color
                        ? `#${material.color.getHexString()}`
                        : undefined,
                opacity: material.opacity,
                transparent: material.transparent,
                metalness:
                    material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial
                        ? material.metalness
                        : undefined,
                roughness:
                    material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial
                        ? material.roughness
                        : undefined,
                side: material.side,
            };
        }

        materialData.color = texturesSettings?.color ?? materialData.material?.color;
        materialData.opacity = texturesSettings?.opacity ?? materialData.material?.opacity;
        materialData.metalness = texturesSettings?.metallic ?? materialData.material?.metalness;
        materialData.roughness = texturesSettings?.roughness ?? materialData.material?.roughness;
        materialData.tileAmountX = primarySettings?.tileAmountX;
        materialData.tileAmountY = primarySettings?.tileAmountY;
        materialData.panningSpeedX = primarySettings?.panningSpeedX;
        materialData.panningSpeedY = primarySettings?.panningSpeedY;
        materialData.textures = this.clonePlainValue(primarySettings?.textures ?? null);

        return materialData;
    }

    private inferObjectKind(object: Object3D): string {
        if (object instanceof THREE.Group) {
            return "group";
        }
        if (object instanceof THREE.Camera) {
            return "camera";
        }
        if (object instanceof THREE.Light) {
            return "light";
        }

        const mesh = this.findFirstMesh(object);
        const geometryType = mesh?.geometry?.type;
        if (geometryType && GEOMETRY_KIND_BY_TYPE[geometryType]) {
            return GEOMETRY_KIND_BY_TYPE[geometryType];
        }

        if (mesh) {
            return "mesh";
        }

        return object.type.toLowerCase();
    }

    private serializeGeometrySettings(object: Object3D): Record<string, any> | null {
        const mesh = this.findFirstMesh(object);
        if (!mesh?.geometry) {
            return null;
        }

        return {
            type: mesh.geometry.type,
            kind: GEOMETRY_KIND_BY_TYPE[mesh.geometry.type] ?? "mesh",
            parameters: this.clonePlainValue(
                (mesh.geometry as THREE.BufferGeometry & {parameters?: Record<string, unknown>}).parameters ?? {},
            ),
        };
    }

    private serializeObjectSettings(object: Object3D): Record<string, unknown> {
        const objectSettings: Record<string, unknown> = {};
        for (const key of OBJECT_SETTING_KEYS) {
            if (Object.prototype.hasOwnProperty.call(object.userData || {}, key)) {
                objectSettings[key] = object.userData[key];
            }
        }

        return {
            uuid: object.uuid,
            name: object.name,
            type: object.type,
            kind: this.inferObjectKind(object),
            parent: object.parent ? {uuid: object.parent.uuid, name: object.parent.name, type: object.parent.type} : null,
            visible: object.visible,
            transform: {
                position: this.vectorToData(object.position),
                rotation: this.eulerToData(object.rotation),
                scale: this.vectorToData(object.scale),
            },
            geometry: this.serializeGeometrySettings(object),
            material: this.serializeMaterialSettings(object),
            objectSettings,
            physics: this.clonePlainValue(object.userData?.physics ?? null),
            behaviors: this.clonePlainValue(object.userData?.behaviors ?? []),
            tags: this.clonePlainValue(object.userData?.tags ?? []),
            userData: {
                prefab: this.clonePlainValue(object.userData?.prefab ?? object.userData?.prefabId ?? null),
                assetId: object.userData?.assetId,
                assetType: object.userData?.assetType,
            },
        };
    }

    private mapTextureTypeToMaterialKey(textureType?: string): keyof IMaterialSettingsTextures | null {
        switch ((textureType || "map").trim().toLowerCase()) {
            case "map":
            case "colormap":
            case "basemap":
            case "base":
                return "base";
            case "aomap":
            case "ambient":
            case "ambientmap":
                return "ambient";
            case "roughnessmap":
            case "roughness":
                return "roughness";
            case "metalnessmap":
            case "metallic":
            case "metallicmap":
            case "metalness":
                return "metallic";
            case "normalmap":
            case "normal":
                return "normal";
            case "emissivemap":
            case "emissive":
                return "emissive";
            case "specularmap":
            case "specular":
                return "specular";
            case "orm":
            case "arm":
                return "orm";
            default:
                return null;
        }
    }

    private isLikelyUrlOrPath(value: string): boolean {
        const trimmed = value.trim();
        if (!trimmed) {
            return false;
        }

        return (
            /^(https?:|data:|blob:|file:|\/|\.\.?\/)/i.test(trimmed) ||
            trimmed.includes("/") ||
            /\.(png|jpe?g|webp|gif|bmp|svg|avif)(?:[?#].*)?$/i.test(trimmed)
        );
    }

    private async resolveTextureAsset(
        textureSource?: string,
        imageAsset?: string,
    ): Promise<{assetId: string; revisionId: string}> {
        const assetSource = this.engine.editor?.assetSource;
        if (!assetSource) {
            throw new Error("No active editing context (scene or stem) available to save imported textures.");
        }

        const trimmedTextureSource = textureSource?.trim();
        const trimmedImageAsset = imageAsset?.trim();
        const directAssetCandidate = trimmedImageAsset || trimmedTextureSource;
        const directAssetIdMatch = directAssetCandidate?.match(/^([a-f0-9]{24}|[0-9a-f-]{36})$/i)?.[1];

        if (directAssetIdMatch) {
            const asset = await getAsset(directAssetIdMatch);
            const revisionId = asset.latestRelease?.revisionId ?? asset.headRevisionId;
            if (!revisionId) {
                throw new Error(`Asset revision not found for texture asset ${directAssetIdMatch}.`);
            }
            return {assetId: asset.id, revisionId};
        }

        const resolveImageAssetByName = async (assetName: string) => {
            const {assets} = await assetSource.getAssets({types: [AssetType.Image], includeLatestRelease: true});
            const matchingAsset = assets.find(asset => asset.name?.toLowerCase() === assetName.toLowerCase());
            if (!matchingAsset) {
                return null;
            }

            const context = getAssetResolutionContext(this.engine.scene);
            const revisionId =
                (context ? resolveAssetRevisionId(matchingAsset.id, context) : undefined) ||
                matchingAsset.latestRelease?.revisionId ||
                matchingAsset.revisionId ||
                matchingAsset.headRevisionId;

            if (!revisionId) {
                throw new Error(`Asset revision not found for texture asset ${matchingAsset.id}.`);
            }

            return {assetId: matchingAsset.id, revisionId};
        };

        if (trimmedImageAsset) {
            const resolvedImageAsset = await resolveImageAssetByName(trimmedImageAsset);
            if (!resolvedImageAsset) {
                throw new Error(`Image asset "${trimmedImageAsset}" not found.`);
            }
            return resolvedImageAsset;
        }

        if (trimmedTextureSource && !this.isLikelyUrlOrPath(trimmedTextureSource)) {
            const matchingAsset = await resolveImageAssetByName(trimmedTextureSource);
            if (matchingAsset) {
                return matchingAsset;
            }
        }

        if (!trimmedTextureSource) {
            throw new Error("Either textureUrl or imageAsset must be provided.");
        }

        const fileName = trimmedTextureSource.split("/").pop()?.split("?")[0] || `texture-${Date.now()}.png`;
        const extension = fileName.split(".").pop()?.toLowerCase() || "png";
        const contentType = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
        const file = await urlToFile(trimmedTextureSource, fileName, contentType);
        const asset = await createAsset({
            assetSource,
            type: AssetType.Image,
            name: file.name,
            data: file,
            format: file.name.split(".").pop()?.toLowerCase() || extension,
            contentType: file.type || contentType,
        });

        return {assetId: asset.id, revisionId: asset.headRevisionId};
    }

    async handleCreatePrimitive({
        type,
        name,
        position,
        size,
        scale,
        rotation,
        color,
        parent,
        objectSettings,
        widthSegments,
        heightSegments,
        depthSegments,
        radialSegments,
        tubularSegments,
        thetaSegments,
        phiSegments,
        capSegments,
    }: {
        type: string;
        name?: string;
        position?: {x: number; y: number; z: number};
        size?: {x: number; y: number; z: number};
        scale?: {x: number; y: number; z: number};
        rotation?: {x: number; y: number; z: number};
        color?: string;
        parent?: string;
        objectSettings?: ObjectSettings;
        widthSegments?: number;
        heightSegments?: number;
        depthSegments?: number;
        radialSegments?: number;
        tubularSegments?: number;
        thetaSegments?: number;
        phiSegments?: number;
        capSegments?: number;
    }): Promise<CommandResult> {
        // Idempotent: update existing object instead of creating a duplicate
        if (name) {
            const existing = this.findObject(name);
            if (existing) {
                return this.handleModifyObject({target: name, position, scale, rotation, color, objectSettings});
            }
        }

        const sx = size?.x ?? 1;
        const sy = size?.y ?? 1;
        const sz = size?.z ?? 1;
        const segments: PrimitiveSegmentParams = {
            widthSegments: toSegmentCount(widthSegments, 1),
            heightSegments: toSegmentCount(heightSegments, 1),
            depthSegments: toSegmentCount(depthSegments, 1),
            radialSegments: toSegmentCount(radialSegments, 3),
            tubularSegments: toSegmentCount(tubularSegments, 3),
            thetaSegments: toSegmentCount(thetaSegments, 3),
            phiSegments: toSegmentCount(phiSegments, 1),
            capSegments: toSegmentCount(capSegments, 1),
        };

        let geometry: THREE.BufferGeometry;
        switch (type.toLowerCase()) {
            case "box":
                geometry = new THREE.BoxGeometry(
                    sx,
                    sy,
                    sz,
                    segments.widthSegments,
                    segments.heightSegments,
                    segments.depthSegments,
                );
                break;
            case "sphere":
                geometry = new THREE.SphereGeometry(
                    sx / 2,
                    segments.widthSegments ?? 32,
                    segments.heightSegments ?? 32,
                );
                break;
            case "cylinder":
                geometry = new THREE.CylinderGeometry(
                    sx / 2,
                    sx / 2,
                    sy,
                    segments.radialSegments ?? 32,
                    segments.heightSegments,
                );
                break;
            case "cone":
                geometry = new THREE.ConeGeometry(sx / 2, sy, segments.radialSegments ?? 32, segments.heightSegments);
                break;
            case "plane":
                geometry = new THREE.PlaneGeometry(sx, sz, segments.widthSegments, segments.heightSegments);
                geometry.rotateX(-Math.PI / 2);
                break;
            case "torus":
                geometry = new THREE.TorusGeometry(
                    sx / 2,
                    sy / 2,
                    segments.radialSegments ?? 16,
                    segments.tubularSegments ?? 100,
                );
                break;
            case "torusknot":
                geometry = new THREE.TorusKnotGeometry(
                    sx / 2,
                    sy / 2,
                    segments.tubularSegments ?? 64,
                    segments.radialSegments ?? 12,
                    2,
                    3,
                );
                break;
            case "triangle":
            case "pyramid":
                geometry = new THREE.TetrahedronGeometry(sx, 0);
                break;
            case "capsule":
                geometry = new THREE.CapsuleGeometry(
                    sx / 2,
                    sy,
                    segments.capSegments ?? 4,
                    segments.radialSegments ?? 8,
                );
                break;
            case "icosahedron":
                geometry = new THREE.IcosahedronGeometry(sx / 2, 0);
                break;
            case "octahedron":
                geometry = new THREE.OctahedronGeometry(sx / 2, 0);
                break;
            case "dodecahedron":
                geometry = new THREE.DodecahedronGeometry(sx / 2, 0);
                break;
            case "ring":
                geometry = new THREE.RingGeometry(sx / 2, sy / 2, segments.thetaSegments ?? 32, segments.phiSegments);
                break;
            default:
                throw new Error(`Unknown object type: ${type}`);
        }

        const material = new THREE.MeshStandardMaterial({
            color: color ? new THREE.Color(color) : new THREE.Color(0xcccccc),
        });
        const mesh = new THREE.Mesh(geometry, material);
        let parentObj: Object3D | undefined;

        if (name) mesh.name = name;
        if (position) mesh.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
        if (scale) mesh.scale.set(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1);
        if (rotation) mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
        if (parent) parentObj = this.findObject(parent) || undefined;
        if (objectSettings) this.applyObjectSettings(mesh, objectSettings);

        const res = await new Commands.AddObjectCommand(mesh, parentObj, null, false, true).execute();
        return {
            ...res,
            data: getObjectBaseMetaData(mesh),
        };
    }

    async handleCreateGroup({
        name,
        position,
        scale,
        rotation,
        parent,
        objectSettings,
    }: {
        name?: string;
        position?: {x: number; y: number; z: number};
        scale?: {x: number; y: number; z: number};
        rotation?: {x: number; y: number; z: number};
        parent?: string;
        objectSettings?: ObjectSettings;
    }): Promise<CommandResult> {
        // Idempotent: update existing object instead of creating a duplicate
        if (name) {
            const existing = this.findObject(name);
            if (existing) {
                return this.handleModifyObject({target: name, position, scale, rotation, objectSettings});
            }
        }

        const group = new THREE.Group();
        let parentObj: Object3D | undefined;

        if (name) group.name = name;
        if (position) group.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
        if (scale) group.scale.set(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1);
        if (rotation) group.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
        if (parent) parentObj = this.findObject(parent) || undefined;
        if (objectSettings) this.applyObjectSettings(group, objectSettings);

        const res = await new Commands.AddObjectCommand(group, parentObj, null, false, true).execute();
        return {
            ...res,
            data: getObjectBaseMetaData(group),
        };
    }

    async handleCloneObject({
        target,
        position,
    }: {
        target: string;
        position?: {x: number; y: number; z: number};
    }): Promise<CommandResult> {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
            };
        }
        let clonedObjectData: unknown = null;
        await this.engine.editor?.cloneObjectByUuid(object.uuid, undefined, position, (clonedObj: Object3D) => {
            clonedObjectData = getObjectBaseMetaData(clonedObj);
        });
        return {
            status: "success",
            message: `Object ${target} cloned successfully`,

            data: clonedObjectData,
        };
    }

    async handleDeleteObject({target}: {target: string}): Promise<CommandResult> {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
            };
        }

        const res = await new Commands.RemoveObjectCommand(object).execute();
        return {
            ...res,
            data: null,
        };
    }

    async handleMoveObject({
        target,
        parent,
        keepLocalSpace = true,
    }: {
        target: string;
        parent: string | null;
        keepLocalSpace?: boolean;
    }): Promise<CommandResult> {
        const object = this.findObject(target);
        if (!object) {
            console.warn(
                `[ScriptTool] move: Object "${target}" not found in scene. Check the object name matches exactly (case-sensitive). Use "list objects" to see all scene objects.`,
            );
            return {
                status: "failed",
                message: `Object not found: ${target}`,
            };
        }

        let newParent: THREE.Object3D | null = null;
        if (parent && parent !== "null") {
            newParent = this.findObject(parent);
            if (!newParent) {
                console.warn(
                    `[ScriptTool] move: Parent object "${parent}" not found in scene. Check the object name matches exactly (case-sensitive). Use "list objects" to see all scene objects.`,
                );
                return {
                    status: "failed",
                    message: `Parent object not found: ${parent}`,
                };
            }
        }

        const res = await new Commands.MoveObjectCommand(
            object,
            newParent ?? this.engine.editor!.scene,
            undefined,
            keepLocalSpace,
        ).execute();
        return {
            ...res,
            data: getObjectBaseMetaData(object),
        };
    }

    handleModifyObject({
        target,
        position,
        rotation,
        scale,
        color,
        name,
        tag,
        objectSettings,
    }: {
        target: string;
        position?: {x: number; y: number; z: number};
        rotation?: {x: number; y: number; z: number};
        scale?: {x: number; y: number; z: number};
        color?: string;
        name?: string;
        tag?: string | string[];
        objectSettings?: ObjectSettings;
    }): CommandResult {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
            };
        }

        if (position) {
            new Commands.SetPositionCommand(
                object,
                new THREE.Vector3(
                    position.x ?? object.position.x,
                    position.y ?? object.position.y,
                    position.z ?? object.position.z,
                ),
            ).execute();
        }

        if (rotation) {
            new Commands.SetRotationCommand(
                object,
                new THREE.Euler(
                    rotation.x ?? object.rotation.x,
                    rotation.y ?? object.rotation.y,
                    rotation.z ?? object.rotation.z,
                ),
            ).execute();
        }

        if (scale) {
            new Commands.SetScaleCommand(
                object,
                new THREE.Vector3(scale.x ?? object.scale.x, scale.y ?? object.scale.y, scale.z ?? object.scale.z),
            ).execute();
        }

        if (color && object instanceof THREE.Mesh) {
            new Commands.SetMaterialColorCommand(object, "color", new THREE.Color(color)).execute();
        }

        if (name) {
            object.name = name;
        }

        if (tag) {
            const tags = Array.isArray(tag) ? tag : [tag];
            TagUtil.addTag(object, tags);
            this.engine.call("objectChanged", object, object);
        }

        if (objectSettings) {
            this.applyObjectSettings(object, objectSettings);
            this.engine.call("objectChanged", object, object);
        }

        return {
            status: "success",
            message: `Object ${target} modified successfully`,
            data: getObjectBaseMetaData(object),
        };
    }

    handleSceneGetObjects({filter}: {filter?: string}): CommandResult {
        filter = filter?.toLowerCase();
        if (filter === "*") {
            filter = undefined;
        }

        // Get minimal metadata for all objects instead of full serialization
        const objects: BaseObjectData[] = [];
        this.traverseSceneObjects(this.engine.scene, (obj: THREE.Object3D) => {
            if (obj.uuid !== this.engine.scene.uuid) {
                objects.push({
                    uuid: obj.uuid,
                    name: obj.name,
                    type: obj.type,
                    position: obj.position,
                    rotation: obj.rotation,
                    scale: obj.scale,
                });
            }
        });

        const filtered = objects.filter((obj: BaseObjectData) => {
            if (!filter) return true;
            return obj.name.toLowerCase().includes(filter);
        });
        return {
            status: "success",
            message: `Retrieved ${filtered?.length ?? 0} objects from the scene (metadata only)`,
            data: filtered,
        };
    }

    handleGetObject({target}: {target: string}): CommandResult {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
            };
        }

        return {
            status: "success",
            message: `Object ${target} retrieved successfully`,
            data: serializeObjectForAI(object, this.engine.editor),
        };
    }

    handleGetObjectSettings({
        target,
        kind,
    }: {
        target: string;
        kind?: string;
    }): CommandResult {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
                data: null,
            };
        }

        const data = this.serializeObjectSettings(object);
        const expectedKind = normalizeKind(kind);
        const actualKind = normalizeKind(data.kind as string);
        const enforcedKinds = new Set([
            "box",
            "sphere",
            "cylinder",
            "cone",
            "plane",
            "torus",
            "torusknot",
            "triangle",
            "capsule",
            "icosahedron",
            "octahedron",
            "dodecahedron",
            "ring",
            "group",
            "mesh",
            "camera",
            "light",
        ]);

        if (expectedKind && enforcedKinds.has(expectedKind) && expectedKind !== actualKind) {
            return {
                status: "failed",
                message: `Object ${target} is ${data.kind}, not ${kind}`,
                data,
            };
        }

        return {
            status: "success",
            message: `Object settings for ${target} retrieved successfully`,
            data: {
                ...data,
                expectedKind: kind,
            },
        };
    }

    handleGetMaterialSettings({target}: {target: string}): CommandResult {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
                data: null,
            };
        }

        return {
            status: "success",
            message: `Material settings for ${target} retrieved successfully`,
            data: {
                uuid: object.uuid,
                name: object.name,
                ...this.serializeMaterialSettings(object),
            },
        };
    }

    handleGetBehaviorSettings({
        target,
        behaviorId,
    }: {
        target: string;
        behaviorId?: string;
    }): CommandResult {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
                data: null,
            };
        }

        const behaviors = Array.isArray(object.userData?.behaviors)
            ? this.clonePlainValue(object.userData.behaviors)
            : [];
        const behavior = behaviorId
            ? behaviors.find((entry: Record<string, unknown>) => entry.id === behaviorId || entry.uuid === behaviorId)
            : undefined;

        if (behaviorId && !behavior) {
            return {
                status: "failed",
                message: `Behavior ${behaviorId} not found on object ${target}`,
                data: {
                    uuid: object.uuid,
                    name: object.name,
                    behaviors,
                },
            };
        }

        return {
            status: "success",
            message: behaviorId
                ? `Behavior settings for ${behaviorId} on ${target} retrieved successfully`
                : `Behavior settings for ${target} retrieved successfully`,
            data: {
                uuid: object.uuid,
                name: object.name,
                behaviors,
                behavior: behavior ?? null,
            },
        };
    }

    handleGetSelectedObject(): CommandResult {
        const selected = this.engine.editor?.selected;
        if (!selected) {
            return {
                status: "failed",
                message: `No object is currently selected`,
            };
        }
        // Handle both single object and array
        if (Array.isArray(selected)) {
            const serialized = selected.map(obj => this.engine.editor?.serializeObject(obj));
            return {
                status: "success",
                message: `Retrieved ${serialized.length} selected objects`,
                data: serialized,
            };
        }
        return {
            status: "success",
            message: `Object ${selected.name} retrieved successfully`,
            data: serializeObjectForAI(selected, this.engine.editor),
        };
    }

    handleSetMaterial({
        target,
        color,
        opacity,
        metalness,
        roughness,
        tileAmountX,
        tileAmountY,
        panningSpeedX,
        panningSpeedY,
    }: {
        target: string;
        color?: string;
        opacity?: number;
        metalness?: number;
        roughness?: number;
        tileAmountX?: number;
        tileAmountY?: number;
        panningSpeedX?: number;
        panningSpeedY?: number;
    }): CommandResult {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
            };
        }

        if (!this.objectHasMaterialTarget(object)) {
            return {
                status: "failed",
                message: `Object has no material slots to override: ${target}`,
            };
        }

        const context = getAssetResolutionContext(this.engine.scene);
        applyMaterialValueOverridesToObject(
            object,
            {
                color,
                opacity,
                metalness,
                roughness,
                tileAmountX,
                tileAmountY,
                panningSpeedX,
                panningSpeedY,
            },
            context,
        );
        this.engine.call("objectChanged", this.engine.editor, object);

        return {
            status: "success",
            message: `Material of object ${target} updated successfully`,
            data: getObjectBaseMetaData(object),
        };
    }

    async handleSetTexture({
        target,
        textureUrl,
        imageAsset,
        textureType,
    }: {
        target: string;
        textureUrl?: string;
        imageAsset?: string;
        textureType?: string;
    }): Promise<CommandResult> {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
            };
        }

        if (!this.objectHasMaterialTarget(object)) {
            return {
                status: "failed",
                message: `Object has no material slots to override: ${target}`,
            };
        }

        if (!textureUrl && !imageAsset) {
            return {
                status: "failed",
                message: "Either textureUrl or imageAsset must be provided",
            };
        }

        const materialTextureKey = this.mapTextureTypeToMaterialKey(textureType);
        if (!materialTextureKey) {
            return {
                status: "failed",
                message: `Unsupported textureType for persisted material overrides: ${textureType || "map"}`,
            };
        }

        const {assetId, revisionId} = await this.resolveTextureAsset(textureUrl, imageAsset);
        setAssetRevision(this.engine.scene, assetId, revisionId);

        const context = getAssetResolutionContext(this.engine.scene);
        const overrides =
            materialTextureKey === "orm"
                ? {ambient: assetId, roughness: assetId, metallic: assetId}
                : {[materialTextureKey]: assetId};

        applyTextureOverridesToObject(object, overrides, context);
        this.engine.call("objectChanged", this.engine.editor, object);

        return {
            status: "success",
            message: `Texture applied to object ${target} via asset-backed material settings`,
            data: getObjectBaseMetaData(object),
        };
    }

    async handleSetExternalTexture({
        target,
        assetId,
        assetType,
        name,
        provider,
    }: {
        target: string;
        assetId: string;
        assetType: string;
        name: string;
        provider: string;
    }): Promise<CommandResult> {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
            };
        }

        try {
            const command = new Commands.SetMaterialTextureCommand(object, assetId, assetType, name, provider);

            const result = await command.execute();

            if (result.status === "error") {
                return {
                    status: "failed",
                    message: result.message,
                };
            }

            return {
                status: "success",
                message: `External ${assetType === "textures" ? "texture" : "HDRI"} "${name}" applied to object ${target} successfully`,
                data: getObjectBaseMetaData(object),
            };
        } catch (error) {
            console.error("Error applying external texture:", error);
            return {
                status: "failed",
                message: `Failed to apply external ${assetType}: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    async handleGenerate3DModel({
        prompt,
        name,
        position,
        provider,
    }: {
        prompt: string;
        name?: string;
        position?: {x: number; y: number; z: number};
        parent?: string;
        provider?: string;
    }): Promise<CommandResult> {
        const sceneId = this.engine.editor?.sceneID;
        if (!sceneId) {
            return {status: "failed", message: "No scene is currently open.", data: null};
        }

        // This app has no server-side generation jobs, so generate
        // synchronously: create the provider task, poll to completion, fetch
        // the GLB URL, import it, and place it in the scene.
        const generator = resolveGenerator(provider);
        const modelName = name || prompt;

        try {
            const res = await this.aiWorldController.generate3dObject({
                generationType: "text_to_model",
                prompt,
                generator,
            });
            if (!res?.model) {
                return {status: "failed", message: "Model generation returned no model URL.", data: null};
            }

            const uploaded = await uploadModelFromUrl({url: res.model, name: modelName});
            const point = position ? new THREE.Vector3(position.x, position.y, position.z) : undefined;
            const placed = this.aiWorldController.addObjectToScene(
                uploaded.object,
                false,
                undefined,
                undefined,
                point,
            );

            return {
                status: "success",
                message: `Generated and placed "${modelName}" with ${generator}.`,
                data: {assetId: uploaded.assetId, uuid: placed.uuid},
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Failed to generate 3D model: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    handleGetPlayer(): CommandResult {
        const player = this.engine.scene.getObjectByName("Player");
        if (!player)
            return {
                status: "failed",
                message: "Player not found",
            };
        return {
            status: "success",
            message: "Player found",
            data: serializeObjectForAI(player, this.engine.editor),
        };
    }

    async handleGetLibraryAsset({assetId}: {assetId: string}): Promise<CommandResult> {
        try {
            if (!assetId) {
                return {
                    status: "failed",
                    message: "No assetId provided",
                    data: null,
                };
            }

            const asset = await getAsset(assetId, {includeLatestRelease: true, includeThumbnails: true});

            if (!asset) {
                return {
                    status: "failed",
                    message: `Asset ${assetId} not found`,
                    data: null,
                };
            }

            return {
                status: "success",
                message: `Retrieved asset ${asset.name} (${assetId})`,
                data: asset,
            };
        } catch (error) {
            console.error("Error fetching library asset:", error);
            return {
                status: "failed",
                message: `Error fetching asset: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    async handleSearchLocalAssets({
        phrases,
        type = "model",
    }: {
        phrases: string[];
        type?: "model" | "audio" | "image" | "behavior" | "prefab" | "vfx";
    }): Promise<CommandResult> {
        try {
            const assetTypeMap: Record<string, (typeof AssetType)[keyof typeof AssetType]> = {
                model: AssetType.Model,
                audio: AssetType.Audio,
                image: AssetType.Image,
                behavior: AssetType.Behavior,
                prefab: AssetType.Prefab,
                vfx: AssetType.Quarks,
            };

            const resolvedAssetType = assetTypeMap[type] ?? AssetType.Model;
            const isModel = resolvedAssetType === AssetType.Model;
            const isPrefab = resolvedAssetType === AssetType.Prefab;

            console.log(`Searching local assets with phrases: ${phrases.join(", ")} and type: ${type}`);
            const response = await getAssets({
                owner: "all",
                released: "all",
                types: [resolvedAssetType],
                includeThumbnails: isModel || isPrefab,
                includeLatestRelease: true,
                limit: 100,
            });

            // Filter client-side: keep assets where any phrase matches name, format, or any tag (case-insensitive)
            const normalizedPhrases = phrases.map(p => p.toLowerCase());

            const assets = response.assets.filter(asset => {
                const name = (asset.name ?? "").toLowerCase();
                const format = (asset.format ?? "").toLowerCase();
                const tags = (asset.tags ?? []).map((t: string) => t.toLowerCase());
                return normalizedPhrases.some(
                    phrase =>
                        name.includes(phrase) || format.includes(phrase) || tags.some(tag => tag.includes(phrase)),
                );
            });

            if (assets.length === 0) {
                return {
                    status: "success",
                    message: `No assets found matching the search phrases`,
                    data: {assets: []},
                };
            }

            // Only create interactive result for 3D models and prefabs
            if (isModel || isPrefab) {
                const interactiveResult = {
                    id: THREE.MathUtils.generateUUID(),
                    type: "asset_search" as const,
                    title: `Found ${assets.length} asset${assets.length > 1 ? "s" : ""}`,
                    description: "Select an asset to add to your scene",
                    items: assets.map(asset => ({
                        id: asset.id,
                        name: asset.name,
                        description: asset.description || asset.name,
                        thumbnailUrl: (asset as any).thumbnailUrl ?? null,
                        previewUrl: (asset as any).thumbnailUrl ?? null,
                        metadata: {
                            provider: "local",
                            assetType: isModel ? AssetsType.Models : AssetsType.Prefabs,
                            assetId: asset.id,
                            revisionId: asset.latestRelease?.revisionId ?? asset.headRevisionId,
                            tags: asset.tags || [],
                        },
                        data: asset,
                    })),
                    command: isModel ? SupportedCommands.AddModelToScene : SupportedCommands.AddPrefabToScene,
                    commandParams: {
                        phrases,
                        provider: "local",
                    },
                    messageId: Date.now().toString(),
                };

                return {
                    status: "success",
                    message: `Found ${assets.length} assets matching the search phrases`,
                    data: assets,
                    interactive: interactiveResult,
                };
            }

            return {
                status: "success",
                message: `Found ${assets.length} assets matching the search phrases`,
                data: assets,
            };
        } catch (error) {
            console.error("Error searching assets:", error);

            return {
                status: "failed",
                message: `Error searching assets: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    async handleSearchExternalAssets({prompt, provider}: {prompt: string; provider?: string}): Promise<CommandResult> {
        try {
            const res = await this.aiWorldController.searchExternalAssets(prompt, provider);

            if (!res || !res.assets || res.assets.length === 0) {
                return {
                    status: "success",
                    message: `No assets found for query: "${prompt}"`,
                    data: {assets: []},
                };
            }

            const assetsType = res.assets[0].assetType || AssetsType.Models;
            const description =
                assetsType === AssetsType.Models
                    ? "Select an asset to add to your scene"
                    : "Choose a texture to apply to selected object(s)";
            // Convert search results to interactive result format
            const interactiveResult = {
                id: THREE.MathUtils.generateUUID(),
                type: "asset_search" as const,
                title: `Found ${res.assets.length} asset${res.assets.length > 1 ? "s" : ""} for "${prompt}"`,
                description,
                items: res.assets.map(asset => ({
                    id: asset.id,
                    name: asset.name,
                    description: asset.description || `${asset.assetType} from ${asset.provider}`,
                    thumbnailUrl: asset.previewUrl,
                    previewUrl: asset.previewUrl,
                    metadata: {
                        provider: asset.provider,
                        assetType: asset.assetType,
                        category: asset.category,
                        license: asset.license,
                        downloadUrl: asset.downloadUrl,
                    },
                    data: asset,
                })),
                command:
                    assetsType === AssetsType.Models
                        ? SupportedCommands.AddModelToScene
                        : SupportedCommands.SetExternalTexture,
                commandParams: {
                    prompt,
                    provider,
                },
                messageId: Date.now().toString(),
            };

            console.log("External asset search interactive result:", interactiveResult);

            return {
                status: "success",
                message: `Found ${res.assets.length} assets`,
                data: res.assets,
                interactive: interactiveResult,
            };
        } catch (error) {
            console.error("Error searching external assets:", error);
            return {
                status: "failed",
                message: `Error searching external assets: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    async handleAddModelToScene({
        id,
        name,
        provider,
        downloadUrl,
        position,
        width = 1,
        height = 1,
        parent,
    }: {
        id: string;
        name: string;
        provider: string;
        downloadUrl: string;
        position?: {x: number; y: number; z: number};
        width?: number;
        height?: number;
        parent?: string;
    }): Promise<CommandResult> {
        try {
            const positionVector = position
                ? new THREE.Vector3(position.x, position.y, position.z)
                : new THREE.Vector3(0, 0, 0);

            let modelObject: THREE.Object3D | null = null;

            const command = new Commands.Add3dObjectCommand(
                id,
                name,
                provider,
                downloadUrl,
                positionVector,
                width,
                height,
                (model: THREE.Object3D) => {
                    modelObject = model;
                },
                parent ? this.findObject(parent) || undefined : undefined,
            );

            const result = await command.execute();

            if (result && result.status === "error") {
                return {
                    status: "failed",
                    message: result.message,
                    data: null,
                };
            }

            return {
                status: "success",
                message: `External model "${name}" from ${provider} added to scene successfully`,
                data: modelObject ? this.engine.editor?.serializeObject(modelObject) : null,
            };
        } catch (error) {
            console.error("Error adding external model to scene:", error);
            return {
                status: "failed",
                message: `Failed to add external model: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    private findObject(identifier: string): THREE.Object3D | null {
        return findObjectByUuidOrNameDepthFirst(this.engine.scene, identifier);
    }

    private traverseSceneObjects(scene: Object3D, callback: (object: Object3D) => void) {
        const stack: Object3D[] = [];
        for (let i = scene.children.length - 1; i >= 0; i--) {
            const child = scene.children[i];
            if (child) stack.push(child);
        }

        while (stack.length > 0) {
            const object = stack.pop()!;
            if (object.name === "[Dynamic]" || object.userData?.isRuntimeOnly) {
                continue;
            }

            callback(object);

            if (object.userData?.Server) {
                continue;
            }

            for (let i = object.children.length - 1; i >= 0; i--) {
                const child = object.children[i];
                if (child) stack.push(child);
            }
        }
    }
}

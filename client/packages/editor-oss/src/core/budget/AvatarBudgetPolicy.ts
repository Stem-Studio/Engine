import * as THREE from "three";

import {DetectDevice} from "@stem/editor-oss/utils/DetectDevice";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {getRuntimeBudgetCoordinatorFromEngine, type RuntimeBudgetPressure} from "./RuntimeBudgetCoordinator";
import type {IQualitySettings} from "../quality/interfaces/IQualityManager";

export type AvatarBudgetState = "full" | "ghost" | "culled";
export type AvatarBudgetRole = "local" | "remote" | "npc" | "unknown";
export type AvatarBudgetSource = "profile-avatar" | "multiplayer-template" | "vrm" | "scene-character";

export interface AvatarBudgetStats {
    triangles: number;
    drawCalls: number;
    bones: number;
    bounds: THREE.Vector3;
    textureBytes: number;
    textureCount: number;
}

export interface AvatarBudgetMetadata {
    enabled?: boolean;
    isLocal?: boolean;
    role?: AvatarBudgetRole;
    playerId?: string;
    sessionId?: string;
    playerName?: string;
    sourceObjectUuid?: string;
    usesProfileAvatar?: boolean;
    avatarSource?: AvatarBudgetSource;
    stats?: AvatarBudgetStats;
    lastState?: AvatarBudgetState;
    lastDecision?: AvatarBudgetDecision;
    visibilityManaged?: boolean;
    previousVisible?: boolean;
}

export interface AvatarBudgetDecision {
    state: AvatarBudgetState;
    distanceSq: number;
    visible: boolean;
    isLocal: boolean;
    animationIntervalSec: number;
    expressionIntervalSec: number;
    shouldUpdateAnimation: boolean;
    shouldUpdateExpression: boolean;
    reason: string;
}

export interface AvatarBudgetPolicyOptions {
    runtimePressure?: RuntimeBudgetPressure;
    runtimeDistanceScale?: number;
    runtimeUpdateRateScale?: number;
    isMobile?: boolean;
    nearDistance?: number;
    fullDistance?: number;
    cullDistance?: number;
    offscreenGhostDistance?: number;
    offscreenCullDistance?: number;
    nearAnimationHz?: number;
    edgeAnimationHz?: number;
    nearExpressionHz?: number;
    edgeExpressionHz?: number;
    heavyTriangleLimit?: number;
    heavyDrawCallLimit?: number;
    heavyBoneLimit?: number;
    heavyTextureBytesLimit?: number;
}

export type AvatarBudgetPlayerMetadata = Pick<
    AvatarBudgetMetadata,
    "avatarSource" | "enabled" | "playerId" | "playerName" | "sessionId" | "sourceObjectUuid" | "stats" | "usesProfileAvatar"
>;

type TimedUpdateKey = "animation" | "expression";
type TextureSlot =
    | "alphaMap"
    | "aoMap"
    | "bumpMap"
    | "clearcoatMap"
    | "clearcoatNormalMap"
    | "clearcoatRoughnessMap"
    | "displacementMap"
    | "emissiveMap"
    | "envMap"
    | "iridescenceMap"
    | "iridescenceThicknessMap"
    | "lightMap"
    | "map"
    | "metalnessMap"
    | "normalMap"
    | "roughnessMap"
    | "sheenColorMap"
    | "sheenRoughnessMap"
    | "specularColorMap"
    | "specularIntensityMap"
    | "thicknessMap"
    | "transmissionMap";

const TEXTURE_SLOTS: TextureSlot[] = [
    "alphaMap",
    "aoMap",
    "bumpMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "iridescenceMap",
    "iridescenceThicknessMap",
    "lightMap",
    "map",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
    "sheenColorMap",
    "sheenRoughnessMap",
    "specularColorMap",
    "specularIntensityMap",
    "thicknessMap",
    "transmissionMap",
];

const BYTES_PER_RGBA_PIXEL = 4;
const MIP_CHAIN_MULTIPLIER = 4 / 3;
const DEFAULT_BOUNDS_RADIUS = 1;

/**
 * Shared runtime policy for remote avatar fidelity. It deliberately does not
 * load or unload assets yet; first it gives update loops one budget language.
 */
export class AvatarBudgetPolicy {
    private options: Required<AvatarBudgetPolicyOptions>;
    private configuredOverrides: AvatarBudgetPolicyOptions;
    private readonly frustum = new THREE.Frustum();
    private readonly frustumMatrix = new THREE.Matrix4();
    private readonly objectWorldPosition = new THREE.Vector3();
    private readonly cameraWorldPosition = new THREE.Vector3();
    private readonly visibilitySphere = new THREE.Sphere();
    private preparedCamera: THREE.Camera | null = null;
    private preparedCameraLocked = false;

    constructor(options: AvatarBudgetPolicyOptions = {}) {
        this.configuredOverrides = {...options};
        this.options = AvatarBudgetPolicy.resolveOptions(options);
    }

    configure(options: AvatarBudgetPolicyOptions = {}): void {
        this.configuredOverrides = {...this.configuredOverrides, ...options};
        this.options = AvatarBudgetPolicy.resolveOptions(this.configuredOverrides);
    }

    configureFromQuality(settings: IQualitySettings | null | undefined, overrides: AvatarBudgetPolicyOptions = {}): void {
        this.options = AvatarBudgetPolicy.resolveOptions(
            getAvatarBudgetOptionsFromQuality(settings, {...this.configuredOverrides, ...overrides}),
        );
    }

    static resolveOptions(options: AvatarBudgetPolicyOptions = {}): Required<AvatarBudgetPolicyOptions> {
        const isMobile = options.isMobile ?? DetectDevice.isMobile();

        return {
            isMobile,
            nearDistance: options.nearDistance ?? 4,
            fullDistance: options.fullDistance ?? (isMobile ? 18 : 35),
            cullDistance: options.cullDistance ?? (isMobile ? 55 : 110),
            offscreenGhostDistance: options.offscreenGhostDistance ?? (isMobile ? 12 : 25),
            offscreenCullDistance: options.offscreenCullDistance ?? (isMobile ? 28 : 70),
            nearAnimationHz: options.nearAnimationHz ?? (isMobile ? 30 : 60),
            edgeAnimationHz: options.edgeAnimationHz ?? (isMobile ? 12 : 20),
            nearExpressionHz: options.nearExpressionHz ?? (isMobile ? 15 : 30),
            edgeExpressionHz: options.edgeExpressionHz ?? (isMobile ? 6 : 10),
            heavyTriangleLimit: options.heavyTriangleLimit ?? (isMobile ? 12000 : 30000),
            heavyDrawCallLimit: options.heavyDrawCallLimit ?? (isMobile ? 4 : 12),
            heavyBoneLimit: options.heavyBoneLimit ?? (isMobile ? 100 : 140),
            heavyTextureBytesLimit: options.heavyTextureBytesLimit ?? (isMobile ? 32 : 96) * 1024 * 1024,
            runtimePressure: options.runtimePressure ?? "normal",
            runtimeDistanceScale: options.runtimeDistanceScale ?? 1,
            runtimeUpdateRateScale: options.runtimeUpdateRateScale ?? 1,
        };
    }

    isEnabled(object: THREE.Object3D): boolean {
        return getAvatarBudgetMetadata(object)?.enabled === true;
    }

    beginFrame(camera: THREE.Camera): void {
        this.prepareCamera(camera);
        this.preparedCameraLocked = true;
    }

    endFrame(): void {
        this.preparedCamera = null;
        this.preparedCameraLocked = false;
    }

    decide(
        object: THREE.Object3D,
        camera: THREE.Camera,
        overrides: {isLocal?: boolean; visible?: boolean} = {},
    ): AvatarBudgetDecision {
        this.ensureCameraPrepared(camera);
        const metadata = ensureAvatarBudgetMetadata(object);
        const isLocal = overrides.isLocal ?? metadata.isLocal === true;
        const distanceSq = this.getDistanceSq(object);

        if (!this.isEnabled(object) || isLocal) {
            return this.storeDecision(object, {
                state: "full",
                distanceSq,
                visible: true,
                isLocal,
                animationIntervalSec: 0,
                expressionIntervalSec: 0,
                shouldUpdateAnimation: true,
                shouldUpdateExpression: true,
                reason: isLocal ? "local-avatar" : "budget-disabled",
            });
        }

        const visible = overrides.visible ?? this.isVisibleAtPreparedPosition(object);
        const thresholds = this.getCostAdjustedThresholds(object);
        const distance = Math.sqrt(distanceSq);
        let state: AvatarBudgetState = "full";
        let reason = "near-visible";

        if (distance > thresholds.cullDistance || (!visible && distance > thresholds.offscreenCullDistance)) {
            state = "culled";
            reason = visible ? "distance-cull" : "offscreen-cull";
        } else if (distance > thresholds.fullDistance || (!visible && distance > thresholds.offscreenGhostDistance)) {
            state = "ghost";
            reason = visible ? "distance-ghost" : "offscreen-ghost";
        }

        const animationIntervalSec = state === "full"
            ? this.getIntervalSec(
                distance,
                thresholds.fullDistance,
                this.options.nearAnimationHz * this.options.runtimeUpdateRateScale,
                this.options.edgeAnimationHz * this.options.runtimeUpdateRateScale,
            )
            : Number.POSITIVE_INFINITY;
        const expressionIntervalSec = state === "full"
            ? this.getIntervalSec(
                distance,
                thresholds.fullDistance,
                this.options.nearExpressionHz * this.options.runtimeUpdateRateScale,
                this.options.edgeExpressionHz * this.options.runtimeUpdateRateScale,
            )
            : Number.POSITIVE_INFINITY;

        return this.storeDecision(object, {
            state,
            distanceSq,
            visible,
            isLocal,
            animationIntervalSec,
            expressionIntervalSec,
            shouldUpdateAnimation: state === "full",
            shouldUpdateExpression: state === "full",
            reason,
        });
    }

    shouldRunAnimationUpdate(object: THREE.Object3D, decision: AvatarBudgetDecision, deltaSec: number): boolean {
        if (!decision.shouldUpdateAnimation) return false;
        return this.shouldRunTimedUpdate(object, "animation", decision.animationIntervalSec, deltaSec);
    }

    shouldRunExpressionUpdate(object: THREE.Object3D, decision: AvatarBudgetDecision, deltaSec: number): boolean {
        if (!decision.shouldUpdateExpression) return false;
        return this.shouldRunTimedUpdate(object, "expression", decision.expressionIntervalSec, deltaSec);
    }

    applyVisibilityState(object: THREE.Object3D, decision: AvatarBudgetDecision): void {
        const metadata = ensureAvatarBudgetMetadata(object);

        if (decision.state === "culled") {
            if (!metadata.visibilityManaged) {
                metadata.previousVisible = object.visible;
                metadata.visibilityManaged = true;
            }
            object.visible = false;
            return;
        }

        if (metadata.visibilityManaged) {
            object.visible = metadata.previousVisible ?? true;
            metadata.previousVisible = undefined;
            metadata.visibilityManaged = false;
        }
    }

    private storeDecision(object: THREE.Object3D, decision: AvatarBudgetDecision): AvatarBudgetDecision {
        const metadata = ensureAvatarBudgetMetadata(object);
        metadata.lastState = decision.state;
        metadata.lastDecision = decision;
        object.userData.avatarBudgetState = decision.state;
        return decision;
    }

    private getDistanceSq(object: THREE.Object3D): number {
        object.getWorldPosition(this.objectWorldPosition);
        return this.objectWorldPosition.distanceToSquared(this.cameraWorldPosition);
    }

    private isVisibleAtPreparedPosition(object: THREE.Object3D): boolean {
        const metadata = ensureAvatarBudgetMetadata(object);
        if (!object.visible && !metadata.visibilityManaged) return false;

        this.visibilitySphere.center.copy(this.objectWorldPosition);
        this.visibilitySphere.radius = getAvatarBoundsRadius(object);
        return this.frustum.intersectsSphere(this.visibilitySphere);
    }

    private ensureCameraPrepared(camera: THREE.Camera): void {
        if (this.preparedCameraLocked && this.preparedCamera === camera) return;
        this.prepareCamera(camera);
    }

    private prepareCamera(camera: THREE.Camera): void {
        camera.updateMatrixWorld();
        camera.getWorldPosition(this.cameraWorldPosition);
        this.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.frustumMatrix);
        this.preparedCamera = camera;
    }

    private getCostAdjustedThresholds(object: THREE.Object3D) {
        const stats = getAvatarBudgetMetadata(object)?.stats;
        const isHeavy =
            !!stats &&
            (stats.triangles > this.options.heavyTriangleLimit ||
                stats.drawCalls > this.options.heavyDrawCallLimit ||
                stats.bones > this.options.heavyBoneLimit ||
                stats.textureBytes > this.options.heavyTextureBytesLimit);
        const multiplier = isHeavy ? 0.75 : 1;
        const runtimeScale = THREE.MathUtils.clamp(this.options.runtimeDistanceScale, 0.3, 1.25);
        const fullDistance = Math.max(this.options.nearDistance, this.options.fullDistance * multiplier * runtimeScale);
        const cullDistance = Math.max(fullDistance + 1, this.options.cullDistance * (isHeavy ? 0.85 : 1) * runtimeScale);
        const offscreenGhostDistance = Math.max(
            this.options.nearDistance,
            this.options.offscreenGhostDistance * multiplier * runtimeScale,
        );
        const offscreenCullDistance = Math.max(
            offscreenGhostDistance + 1,
            this.options.offscreenCullDistance * (isHeavy ? 0.85 : 1) * runtimeScale,
        );

        return {
            fullDistance,
            cullDistance,
            offscreenGhostDistance,
            offscreenCullDistance,
        };
    }

    private getIntervalSec(distance: number, fullDistance: number, nearHz: number, edgeHz: number): number {
        if (nearHz <= 0 || edgeHz <= 0) return 0;
        const range = Math.max(1, fullDistance - this.options.nearDistance);
        const t = THREE.MathUtils.clamp((distance - this.options.nearDistance) / range, 0, 1);
        const hz = THREE.MathUtils.lerp(nearHz, edgeHz, t);
        return 1 / hz;
    }

    private shouldRunTimedUpdate(
        object: THREE.Object3D,
        key: TimedUpdateKey,
        intervalSec: number,
        deltaSec: number,
    ): boolean {
        if (!Number.isFinite(intervalSec) || intervalSec <= 0) return Number.isFinite(intervalSec);

        const data = object.userData as Record<string, unknown>;
        const elapsedKey = key === "animation" ? "_avatarBudgetAnimationElapsed" : "_avatarBudgetExpressionElapsed";
        let elapsed = typeof data[elapsedKey] === "number" ? data[elapsedKey] : undefined;

        if (elapsed === undefined) {
            elapsed = this.getStableOffsetSec(object.uuid, intervalSec);
        }

        elapsed += Math.max(0, deltaSec);

        if (elapsed < intervalSec) {
            data[elapsedKey] = elapsed;
            return false;
        }

        data[elapsedKey] = elapsed % intervalSec;
        return true;
    }

    private getStableOffsetSec(uuid: string, intervalSec: number): number {
        return (stableHash(uuid) % 1000) / 1000 * intervalSec;
    }
}

export function configureAvatarBudgetPolicyFromEngine(policy: AvatarBudgetPolicy, engine: unknown): void {
    const qualityManager = (engine as {qualityManager?: {getCurrentSettings?: () => IQualitySettings}} | null | undefined)
        ?.qualityManager;
    policy.configureFromQuality(
        qualityManager?.getCurrentSettings?.(),
        getRuntimeBudgetCoordinatorFromEngine(engine)?.getAvatarBudgetOverrides?.(),
    );
}

export function getAvatarBudgetOptionsFromQuality(
    settings: IQualitySettings | null | undefined,
    overrides: AvatarBudgetPolicyOptions = {},
): AvatarBudgetPolicyOptions {
    const isMobile = overrides.isMobile ?? DetectDevice.isMobile();
    if (!settings) {
        return {...overrides, isMobile};
    }

    const base = AvatarBudgetPolicy.resolveOptions({isMobile});
    const rendering = settings.rendering;
    const behavior = settings.behavior;
    const pressure = getQualityPressure(settings, isMobile);
    const textureTier = getTextureQualityTier(rendering?.textureQuality);
    const behaviorRate = Math.max(1, behavior?.updateRate ?? base.nearAnimationHz);

    const fullDistance = Math.max(
        base.nearDistance + 4,
        Math.round(base.fullDistance * (1 - pressure * 0.4)),
    );
    const cullDistance = Math.max(
        fullDistance + 8,
        Math.round(base.cullDistance * (1 - pressure * 0.3)),
    );
    const offscreenGhostDistance = Math.max(
        base.nearDistance + 2,
        Math.round(base.offscreenGhostDistance * (1 - pressure * 0.5)),
    );
    const offscreenCullDistance = Math.max(
        offscreenGhostDistance + 6,
        Math.round(base.offscreenCullDistance * (1 - pressure * 0.45)),
    );

    const textureLimitMb = textureTier <= 1
        ? (isMobile ? 20 : 48)
        : textureTier === 2
            ? (isMobile ? 32 : 72)
            : textureTier === 3
                ? (isMobile ? 48 : 96)
                : (isMobile ? 64 : 128);

    return {
        isMobile,
        nearDistance: base.nearDistance,
        fullDistance,
        cullDistance,
        offscreenGhostDistance,
        offscreenCullDistance,
        nearAnimationHz: Math.min(base.nearAnimationHz, behaviorRate),
        edgeAnimationHz: Math.min(base.edgeAnimationHz, textureTier <= 1 ? 8 : textureTier === 2 ? 12 : base.edgeAnimationHz),
        nearExpressionHz: Math.min(base.nearExpressionHz, Math.max(1, Math.floor(behaviorRate / 2))),
        edgeExpressionHz: Math.min(base.edgeExpressionHz, textureTier <= 1 ? 4 : textureTier === 2 ? 6 : base.edgeExpressionHz),
        heavyTriangleLimit: textureTier <= 1 ? Math.floor(base.heavyTriangleLimit * 0.75) : base.heavyTriangleLimit,
        heavyDrawCallLimit: textureTier <= 1 ? Math.max(2, Math.floor(base.heavyDrawCallLimit * 0.75)) : base.heavyDrawCallLimit,
        heavyBoneLimit: textureTier <= 1 ? Math.floor(base.heavyBoneLimit * 0.85) : base.heavyBoneLimit,
        heavyTextureBytesLimit: textureLimitMb * 1024 * 1024,
        ...overrides,
    };
}

export function markObjectForAvatarBudget(object: THREE.Object3D, metadata: AvatarBudgetMetadata = {}): void {
    const current = ensureAvatarBudgetMetadata(object);
    Object.assign(current, metadata);
    if (metadata.role && metadata.isLocal === undefined) {
        current.isLocal = metadata.role === "local";
    } else if (metadata.isLocal !== undefined && metadata.role === undefined) {
        current.role = metadata.isLocal ? "local" : "remote";
    }
    if (metadata.enabled === undefined) {
        current.enabled = true;
    }
    current.stats = metadata.stats ?? current.stats ?? collectAvatarBudgetStats(object);
}

export function markLocalPlayerAvatar(object: THREE.Object3D, metadata: AvatarBudgetPlayerMetadata = {}): void {
    markObjectForAvatarBudget(object, {
        ...metadata,
        enabled: metadata.enabled ?? true,
        isLocal: true,
        role: "local",
    });
}

export function markRemotePlayerAvatar(object: THREE.Object3D, metadata: AvatarBudgetPlayerMetadata = {}): void {
    markObjectForAvatarBudget(object, {
        ...metadata,
        enabled: metadata.enabled ?? true,
        isLocal: false,
        role: "remote",
    });
}

export function getAvatarBudgetMetadata(object: THREE.Object3D): AvatarBudgetMetadata | undefined {
    return (object.userData as {avatarBudget?: AvatarBudgetMetadata}).avatarBudget;
}

export function ensureAvatarBudgetMetadata(object: THREE.Object3D): AvatarBudgetMetadata {
    const data = object.userData as {avatarBudget?: AvatarBudgetMetadata};
    data.avatarBudget ??= {};
    return data.avatarBudget;
}

export function collectAvatarBudgetStats(root: THREE.Object3D): AvatarBudgetStats {
    const geometries = new Set<string>();
    const textures = new Set<string>();
    const bones = new Set<string>();
    const bounds = new THREE.Vector3();
    const box = new THREE.Box3();
    const geometryBox = new THREE.Box3();
    const stats: AvatarBudgetStats = {
        triangles: 0,
        drawCalls: 0,
        bones: 0,
        bounds,
        textureBytes: 0,
        textureCount: 0,
    };

    traverseObjectDepthFirst(root, child => {
        updateMatrixWorldForAvatarStats(child);
        const mesh = child as THREE.Mesh;
        const geometry = mesh.geometry;
        const material = mesh.material;

        if (geometry) {
            if (!geometries.has(geometry.uuid)) {
                geometries.add(geometry.uuid);
                stats.triangles += getGeometryTriangleCount(geometry);
            }
            if (!geometry.boundingBox) {
                geometry.computeBoundingBox();
            }
            if (geometry.boundingBox) {
                geometryBox.copy(geometry.boundingBox).applyMatrix4(child.matrixWorld);
                box.union(geometryBox);
            }
        }

        if (material) {
            if (Array.isArray(material)) {
                stats.drawCalls += Math.max(1, material.length);
                for (const item of material) {
                    addMaterialTextureBytes(item, textures, stats);
                }
            } else {
                stats.drawCalls++;
                addMaterialTextureBytes(material, textures, stats);
            }
        }

        if (child instanceof THREE.SkinnedMesh) {
            for (const bone of child.skeleton.bones) {
                bones.add(bone.uuid);
            }
        }
    });

    if (!box.isEmpty()) {
        box.getSize(bounds);
    }
    stats.bones = bones.size;
    stats.textureCount = textures.size;
    return stats;
}

function updateMatrixWorldForAvatarStats(object: THREE.Object3D): void {
    if (object.matrixAutoUpdate) {
        object.updateMatrix();
    }
    if (object.matrixWorldAutoUpdate !== true) {
        return;
    }

    if (object.parent === null) {
        object.matrixWorld.copy(object.matrix);
    } else {
        object.matrixWorld.multiplyMatrices(object.parent.matrixWorld, object.matrix);
    }
}

export function estimateTextureBytes(texture: THREE.Texture): number {
    const mipmaps = texture.mipmaps as Array<{width?: number; height?: number; data?: {byteLength?: number}}> | undefined;
    if (mipmaps && mipmaps.length > 0) {
        let bytes = 0;
        for (const mip of mipmaps) {
            if (typeof mip.data?.byteLength === "number") {
                bytes += mip.data.byteLength;
            } else {
                bytes += (mip.width ?? 0) * (mip.height ?? 0) * BYTES_PER_RGBA_PIXEL;
            }
        }
        if (bytes > 0) return bytes;
    }

    const {width, height} = getTextureDimensions(texture);
    if (width <= 0 || height <= 0) return 0;

    const baseBytes = width * height * BYTES_PER_RGBA_PIXEL;
    return Math.ceil(texture.generateMipmaps ? baseBytes * MIP_CHAIN_MULTIPLIER : baseBytes);
}

function getGeometryTriangleCount(geometry: THREE.BufferGeometry): number {
    if (geometry.index) {
        return Math.floor(geometry.index.count / 3);
    }

    const position = geometry.getAttribute("position");
    return position ? Math.floor(position.count / 3) : 0;
}

function addMaterialTextureBytes(
    material: THREE.Material,
    textureIds: Set<string>,
    stats: AvatarBudgetStats,
): void {
    const texturedMaterial = material as THREE.Material & Partial<Record<TextureSlot, THREE.Texture | null>>;

    for (const slot of TEXTURE_SLOTS) {
        const texture = texturedMaterial[slot];
        if (!texture || textureIds.has(texture.uuid)) continue;
        textureIds.add(texture.uuid);
        stats.textureBytes += estimateTextureBytes(texture);
    }
}

function getTextureDimensions(texture: THREE.Texture): {width: number; height: number} {
    const image = texture.image as
        | {width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number}
        | undefined;
    if (!image) return {width: 0, height: 0};

    const width = Math.max(image.videoWidth ?? 0, image.naturalWidth ?? 0, image.width ?? 0);
    const height = Math.max(image.videoHeight ?? 0, image.naturalHeight ?? 0, image.height ?? 0);
    return {width, height};
}

function getAvatarBoundsRadius(object: THREE.Object3D): number {
    const metadata = ensureAvatarBudgetMetadata(object);
    metadata.stats ??= collectAvatarBudgetStats(object);
    const radius = metadata.stats.bounds.length() / 2;
    return radius > 0 ? radius : DEFAULT_BOUNDS_RADIUS;
}

function getQualityPressure(settings: IQualitySettings, isMobile: boolean): number {
    const rendering = settings.rendering;
    const textureTier = getTextureQualityTier(rendering?.textureQuality);
    const lodBias = THREE.MathUtils.clamp(rendering?.lodBias ?? 0, 0, 3);
    const pixelRatio = rendering?.pixelRatio ?? (isMobile ? 0.75 : 1);
    const maxLights = rendering?.maxLights ?? (isMobile ? 4 : 8);

    let pressure = 0;
    pressure += (4 - textureTier) * 0.12;
    pressure += lodBias * 0.08;
    if (pixelRatio <= 0.75) pressure += 0.14;
    if (!rendering?.postProcessing) pressure += 0.05;
    if (isMobile) pressure += 0.1;
    if (maxLights <= 2) pressure += 0.06;

    return THREE.MathUtils.clamp(pressure, 0, 0.75);
}

function getTextureQualityTier(quality: IQualitySettings["rendering"]["textureQuality"] | undefined): number {
    switch (quality) {
        case "ultra":
            return 4;
        case "high":
            return 3;
        case "medium":
            return 2;
        case "low":
            return 1;
        default:
            return 2;
    }
}

function stableHash(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (hash << 5) - hash + value.charCodeAt(i) | 0;
    }
    return Math.abs(hash);
}

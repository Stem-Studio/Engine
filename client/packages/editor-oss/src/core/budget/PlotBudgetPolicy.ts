import {Box3, BufferGeometry, Camera, Frustum, LOD, Material, MathUtils, Matrix4, Mesh, Object3D, Scene, Sphere, Texture, Vector3} from "three";
import {DetectDevice} from "@stem/editor-oss/utils/DetectDevice";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {
    createProgressiveYieldController,
    type ProgressiveYieldOptions,
} from "@stem/editor-oss/utils/progressiveYield";
import {getRuntimeBudgetCoordinatorFromEngine, type RuntimeBudgetPressure} from "./RuntimeBudgetCoordinator";
import type {IQualitySettings} from "../quality/interfaces/IQualityManager";
import {
    RuntimeLodController,
    type RuntimeLodDiagnostics,
    type RuntimeLodGroupHandle,
} from "../lod";

export type PlotBudgetState = "near" | "mid" | "far" | "culled";

export interface PlotBudgetStats {
    triangles: number;
    drawCalls: number;
    bounds: Vector3;
    textureBytes: number;
    textureCount: number;
}

export interface PlotBudgetMetadata {
    enabled?: boolean;
    state?: PlotBudgetState;
    stats?: PlotBudgetStats;
    visibilityManaged?: boolean;
    previousVisible?: boolean;
    lastDecision?: PlotBudgetDecision;
}

export interface PlotBudgetDecision {
    state: PlotBudgetState;
    distanceSq: number;
    visible: boolean;
    shouldRender: boolean;
    reason: string;
}

export interface PlotBudgetPolicyOptions {
    runtimePressure?: RuntimeBudgetPressure;
    runtimeDistanceScale?: number;
    runtimeLodDistanceScale?: number;
    isMobile?: boolean;
    nearDistance?: number;
    midDistance?: number;
    farDistance?: number;
    cullDistance?: number;
    offscreenCullDistance?: number;
    lodDistanceMultiplier?: number;
    lodTransitionBudget?: number;
    lodHysteresisRatio?: number;
    batchSize?: number;
    heavyTriangleLimit?: number;
    heavyDrawCallLimit?: number;
    heavyTextureBytesLimit?: number;
}

export type PlotBudgetRebuildProgressOptions = ProgressiveYieldOptions;

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

interface ManagedLod {
    lod: LOD;
    baseDistances: number[];
    originalAutoUpdate?: boolean;
    originalLevelVisibility: boolean[];
    runtimeGroupId: string;
    runtimeHandle?: RuntimeLodGroupHandle;
    runtimeRegistered: boolean;
    scaledThresholds: number[];
}

interface ManagedPlot {
    root: Object3D;
    lods: ManagedLod[];
}

interface PlotBudgetProgressiveProfile {
    hasRenderable: boolean;
    hasRuntimeMetadata: boolean;
    stats: PlotBudgetStats;
    lods: ManagedLod[];
}

interface PlotBudgetStatsCollection {
    geometries: Set<string>;
    textures: Set<string>;
    bounds: Vector3;
    box: Box3;
    geometryBox: Box3;
    stats: PlotBudgetStats;
}

interface PlotBudgetRegistrationProfile {
    stats: PlotBudgetStats;
    lods: ManagedLod[];
}

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
const DEFAULT_BOUNDS_RADIUS = 2;
const PLOT_BUDGET_REBUILD_BATCH_SIZE = 32;
const PLOT_BUDGET_REBUILD_FRAME_BUDGET_MS = 4;
const LOD_REGISTRATION_BOUNDS = new Box3();

export class PlotBudgetPolicy {
    private options: Required<PlotBudgetPolicyOptions>;
    private configuredOverrides: PlotBudgetPolicyOptions;
    private readonly frustum = new Frustum();
    private readonly frustumMatrix = new Matrix4();
    private readonly objectWorldPosition = new Vector3();
    private readonly cameraWorldPosition = new Vector3();
    private readonly visibilitySphere = new Sphere();
    private preparedCamera: Camera | null = null;
    private preparedCameraLocked = false;

    constructor(options: PlotBudgetPolicyOptions = {}) {
        this.configuredOverrides = {...options};
        this.options = PlotBudgetPolicy.resolveOptions(options);
    }

    configure(options: PlotBudgetPolicyOptions = {}): void {
        this.configuredOverrides = {...this.configuredOverrides, ...options};
        this.options = PlotBudgetPolicy.resolveOptions(this.configuredOverrides);
    }

    configureFromQuality(settings: IQualitySettings | null | undefined, overrides: PlotBudgetPolicyOptions = {}): void {
        this.options = PlotBudgetPolicy.resolveOptions(
            getPlotBudgetOptionsFromQuality(settings, {...this.configuredOverrides, ...overrides}),
        );
    }

    static resolveOptions(options: PlotBudgetPolicyOptions = {}): Required<PlotBudgetPolicyOptions> {
        const isMobile = options.isMobile ?? DetectDevice.isMobile();
        return {
            isMobile,
            nearDistance: options.nearDistance ?? (isMobile ? 35 : 80),
            midDistance: options.midDistance ?? (isMobile ? 80 : 180),
            farDistance: options.farDistance ?? (isMobile ? 140 : 360),
            cullDistance: options.cullDistance ?? (isMobile ? 220 : 700),
            offscreenCullDistance: options.offscreenCullDistance ?? (isMobile ? 90 : 220),
            lodDistanceMultiplier: options.lodDistanceMultiplier ?? (isMobile ? 0.75 : 1),
            lodTransitionBudget: options.lodTransitionBudget ?? (isMobile ? 4 : 12),
            lodHysteresisRatio: options.lodHysteresisRatio ?? 0.12,
            batchSize: options.batchSize ?? (isMobile ? 24 : 64),
            heavyTriangleLimit: options.heavyTriangleLimit ?? (isMobile ? 30000 : 120000),
            heavyDrawCallLimit: options.heavyDrawCallLimit ?? (isMobile ? 24 : 80),
            heavyTextureBytesLimit: options.heavyTextureBytesLimit ?? (isMobile ? 48 : 192) * 1024 * 1024,
            runtimePressure: options.runtimePressure ?? "normal",
            runtimeDistanceScale: options.runtimeDistanceScale ?? 1,
            runtimeLodDistanceScale: options.runtimeLodDistanceScale ?? 1,
        };
    }

    getBatchSize(): number {
        return this.options.batchSize;
    }

    getLodDistanceScale(): number {
        return this.options.lodDistanceMultiplier * this.options.runtimeLodDistanceScale;
    }

    getLodTransitionBudget(): number {
        return this.options.lodTransitionBudget;
    }

    getLodHysteresisRatio(): number {
        return this.options.lodHysteresisRatio;
    }

    beginFrame(camera: Camera): void {
        this.prepareCamera(camera);
        this.preparedCameraLocked = true;
    }

    endFrame(): void {
        this.preparedCamera = null;
        this.preparedCameraLocked = false;
    }

    decide(object: Object3D, camera: Camera): PlotBudgetDecision {
        this.ensureCameraPrepared(camera);
        const metadata = ensurePlotBudgetMetadata(object);
        const distanceSq = this.getDistanceSq(object);
        const visible = this.isVisibleAtPreparedPosition(object);
        const thresholds = this.getCostAdjustedThresholds(object);
        const distance = Math.sqrt(distanceSq);
        let state: PlotBudgetState = "near";
        let reason = "near-visible";

        if (distance > thresholds.cullDistance || (!visible && distance > thresholds.offscreenCullDistance)) {
            state = "culled";
            reason = visible ? "distance-cull" : "offscreen-cull";
        } else if (distance > thresholds.farDistance) {
            state = "far";
            reason = "far";
        } else if (distance > thresholds.midDistance) {
            state = "mid";
            reason = "mid";
        }

        const decision: PlotBudgetDecision = {
            state,
            distanceSq,
            visible,
            shouldRender: state !== "culled",
            reason,
        };
        metadata.state = state;
        metadata.lastDecision = decision;
        object.userData.plotBudgetState = state;
        return decision;
    }

    applyVisibilityState(object: Object3D, decision: PlotBudgetDecision): void {
        const metadata = ensurePlotBudgetMetadata(object);

        if (!decision.shouldRender) {
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

    applyLods(lods: ManagedLod[], camera: Camera): void {
        for (const managed of lods) {
            applyScaledLodDistances(managed, this.getLodDistanceScale());
            if (!managed.runtimeRegistered) {
                managed.lod.update(camera);
            }
        }
    }

    private getDistanceSq(object: Object3D): number {
        object.getWorldPosition(this.objectWorldPosition);
        return this.objectWorldPosition.distanceToSquared(this.cameraWorldPosition);
    }

    private isVisibleAtPreparedPosition(object: Object3D): boolean {
        const metadata = ensurePlotBudgetMetadata(object);
        if (!object.visible && !metadata.visibilityManaged) return false;

        this.visibilitySphere.center.copy(this.objectWorldPosition);
        this.visibilitySphere.radius = getPlotBoundsRadius(object);
        return this.frustum.intersectsSphere(this.visibilitySphere);
    }

    private ensureCameraPrepared(camera: Camera): void {
        if (this.preparedCameraLocked && this.preparedCamera === camera) return;
        this.prepareCamera(camera);
    }

    private prepareCamera(camera: Camera): void {
        camera.updateMatrixWorld();
        camera.getWorldPosition(this.cameraWorldPosition);
        this.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.frustumMatrix);
        this.preparedCamera = camera;
    }

    private getCostAdjustedThresholds(object: Object3D) {
        const stats = getPlotBudgetMetadata(object)?.stats;
        const isHeavy =
            !!stats &&
            (stats.triangles > this.options.heavyTriangleLimit ||
                stats.drawCalls > this.options.heavyDrawCallLimit ||
                stats.textureBytes > this.options.heavyTextureBytesLimit);
        const multiplier = isHeavy ? 0.85 : 1;
        const runtimeScale = MathUtils.clamp(this.options.runtimeDistanceScale, 0.3, 1.25);
        const midDistance = Math.max(this.options.nearDistance, this.options.midDistance * multiplier * runtimeScale);
        const farDistance = Math.max(midDistance + 1, this.options.farDistance * multiplier * runtimeScale);
        const cullDistance = Math.max(farDistance + 1, this.options.cullDistance * (isHeavy ? 0.9 : 1) * runtimeScale);
        const offscreenCullDistance = Math.max(
            this.options.nearDistance,
            this.options.offscreenCullDistance * (isHeavy ? 0.85 : 1) * runtimeScale,
        );

        return {
            midDistance,
            farDistance,
            cullDistance,
            offscreenCullDistance,
        };
    }
}

export class PlotBudgetManager {
    private readonly policy: PlotBudgetPolicy;
    private readonly lodController: RuntimeLodController;
    private readonly plots: ManagedPlot[] = [];
    private readonly plotIndexes = new Map<string, number>();
    private cursor = 0;

    constructor(scene?: Scene, options: PlotBudgetPolicyOptions = {}) {
        this.policy = new PlotBudgetPolicy(options);
        this.lodController = new RuntimeLodController({
            maxTransitionsPerFrame: this.policy.getLodTransitionBudget(),
            hysteresisRatio: this.policy.getLodHysteresisRatio(),
        });
        if (scene) {
            this.rebuild(scene);
        }
    }

    configure(options: PlotBudgetPolicyOptions = {}): void {
        this.policy.configure(options);
        this.configureLodController();
    }

    configureFromQuality(settings: IQualitySettings | null | undefined, overrides: PlotBudgetPolicyOptions = {}): void {
        this.policy.configureFromQuality(settings, overrides);
        this.configureLodController();
    }

    rebuild(scene: Scene): void {
        this.clear();
        for (const child of scene.children) {
            this.registerObjectTree(child);
        }
    }

    async rebuildProgressive(scene: Scene, options: PlotBudgetRebuildProgressOptions = {}): Promise<void> {
        this.clear();
        const maybeYield = createProgressiveYieldController(options, {
            batchSize: PLOT_BUDGET_REBUILD_BATCH_SIZE,
            frameBudgetMs: PLOT_BUDGET_REBUILD_FRAME_BUDGET_MS,
        });
        const stack: Object3D[] = [];

        for (let i = scene.children.length - 1; i >= 0; i--) {
            const child = scene.children[i];
            if (child) stack.push(child);
        }

        while (stack.length > 0) {
            const object = stack.pop();
            if (!object || isPlotBudgetExplicitlyDisabled(object)) {
                await maybeYield();
                continue;
            }

            if (shouldInspectPlotBudgetCandidate(object)) {
                const registered = await this.registerProgressive(object, options);
                if (registered) {
                    await maybeYield(true);
                    continue;
                }
            }

            for (let i = object.children.length - 1; i >= 0; i--) {
                const child = object.children[i];
                if (child) stack.push(child);
            }

            await maybeYield();
        }
    }

    registerObjectTree(root: Object3D): void {
        this.walkAndRegister(root);
    }

    /**
     * Register a single node during a shared post-initialization walk.
     * Returning false preserves plot candidate short-circuiting: once a root
     * owns a plot, descendants are part of that root's managed profile and do
     * not need to be considered as independent plots.
     */
    registerObjectNode(object: Object3D): boolean {
        if (isPlotBudgetExplicitlyDisabled(object)) return false;
        if (isPlotBudgetCandidate(object)) {
            this.register(object);
            return false;
        }
        return true;
    }

    unregisterObjectTree(root: Object3D): void {
        traverseObjectDepthFirst(root, object => {
            this.unregister(object);
        });
    }

    update(camera: Camera | null | undefined): void {
        if (!camera || this.plots.length === 0) return;

        const count = Math.min(this.policy.getBatchSize(), this.plots.length);
        this.policy.beginFrame(camera);
        try {
            for (let i = 0; i < count; i++) {
                const index = (this.cursor + i) % this.plots.length;
                const plot = this.plots[index];
                if (!plot) continue;
                if (!plot.root.parent) {
                    this.unregister(plot.root);
                    continue;
                }

                const decision = this.policy.decide(plot.root, camera);
                this.policy.applyVisibilityState(plot.root, decision);
                if (decision.shouldRender) {
                    this.updatePlotLods(plot, camera, true);
                } else {
                    this.updatePlotLods(plot, camera, false);
                }
            }
        } finally {
            this.policy.endFrame();
        }

        this.lodController.update(camera, {maxTransitions: this.policy.getLodTransitionBudget()});

        if (this.plots.length > 0) {
            this.cursor = (this.cursor + count) % this.plots.length;
        } else {
            this.cursor = 0;
        }
    }

    getRegisteredCount(): number {
        return this.plots.length;
    }

    getLodDiagnostics(): RuntimeLodDiagnostics {
        return this.lodController.getDiagnostics();
    }

    clear(): void {
        for (const plot of this.plots) {
            for (const managed of plot.lods) {
                restoreManagedLod(managed);
            }
        }
        this.lodController.dispose();
        this.plots.length = 0;
        this.plotIndexes.clear();
        this.cursor = 0;
    }

    dispose(): void {
        this.clear();
    }

    private walkAndRegister(root: Object3D): void {
        const stack: Object3D[] = [root];

        while (stack.length > 0) {
            const object = stack.pop();
            if (!object || !this.registerObjectNode(object)) continue;

            for (let i = object.children.length - 1; i >= 0; i--) {
                const child = object.children[i];
                if (child) stack.push(child);
            }
        }
    }

    private register(root: Object3D): void {
        if (this.plotIndexes.has(root.uuid)) return;
        const profile = collectPlotBudgetRegistrationProfile(root);
        markObjectForPlotBudget(root, {enabled: true, stats: profile.stats});

        this.addManagedPlot(root, profile.lods);
    }

    private async registerProgressive(root: Object3D, options: PlotBudgetRebuildProgressOptions): Promise<boolean> {
        if (this.plotIndexes.has(root.uuid)) return true;

        const metadata = getPlotBudgetMetadata(root);
        if (metadata?.enabled === false) return false;

        const explicit = metadata?.enabled === true;
        if (!explicit && !root.userData?.isStemObject) return false;

        const profile = await collectPlotBudgetProfileProgressive(root, options, {
            abortOnRuntimeMetadata: !explicit,
        });
        if (!explicit && (!profile.hasRenderable || profile.hasRuntimeMetadata)) {
            return false;
        }

        markObjectForPlotBudget(root, {enabled: true, stats: profile.stats});
        this.addManagedPlot(root, profile.lods);
        return true;
    }

    private addManagedPlot(root: Object3D, lods: ManagedLod[]): void {
        const managed: ManagedPlot = {
            root,
            lods,
        };
        for (const lod of managed.lods) {
            this.registerRuntimeLod(lod);
        }

        this.plotIndexes.set(root.uuid, this.plots.length);
        this.plots.push(managed);
    }

    private unregister(root: Object3D): void {
        const index = this.plotIndexes.get(root.uuid);
        if (index === undefined) return;

        const removed = this.plots[index];
        if (!removed) return;

        const lastIndex = this.plots.length - 1;
        const last = this.plots[lastIndex];
        if (index !== lastIndex && last) {
            this.plots[index] = last;
            this.plotIndexes.set(last.root.uuid, index);
        }

        this.plots.pop();
        this.plotIndexes.delete(root.uuid);

        for (const managed of removed.lods) {
            restoreManagedLod(managed);
        }

        this.cursor = this.plots.length > 0 ? this.cursor % this.plots.length : 0;
    }

    private configureLodController(): void {
        this.lodController.setMaxTransitionsPerFrame(this.policy.getLodTransitionBudget());
        this.lodController.setHysteresisRatio(this.policy.getLodHysteresisRatio());
    }

    private registerRuntimeLod(managed: ManagedLod): void {
        if (!hasUsableLodBounds(managed.lod)) {
            restoreManagedLod(managed);
            return;
        }

        applyScaledLodDistances(managed, this.policy.getLodDistanceScale());
        try {
            managed.runtimeHandle = this.lodController.registerGroup({
                id: managed.runtimeGroupId,
                root: managed.lod,
                levels: managed.lod.levels.map((level, index) => ({
                    id: `${managed.runtimeGroupId}:${index}`,
                    object: level.object,
                    maxDistance: managed.baseDistances[index + 1],
                })),
            });
            managed.runtimeRegistered = true;
            (managed.lod as LOD & {autoUpdate?: boolean}).autoUpdate = false;
        } catch {
            managed.runtimeRegistered = false;
            restoreManagedLod(managed);
        }
    }

    private updatePlotLods(plot: ManagedPlot, camera: Camera, enabled: boolean): void {
        for (const managed of plot.lods) {
            applyScaledLodDistances(managed, this.policy.getLodDistanceScale());
            if (managed.runtimeRegistered) {
                this.lodController.setGroupEnabled(managed.runtimeGroupId, enabled);
                this.lodController.setGroupThresholds(managed.runtimeGroupId, getScaledLodThresholds(managed));
            } else if (enabled) {
                managed.lod.update(camera);
            }
        }
    }
}

export function configurePlotBudgetManagerFromEngine(manager: PlotBudgetManager, engine: unknown): void {
    const qualityManager = (engine as {qualityManager?: {getCurrentSettings?: () => IQualitySettings}} | null | undefined)
        ?.qualityManager;
    manager.configureFromQuality(
        qualityManager?.getCurrentSettings?.(),
        getRuntimeBudgetCoordinatorFromEngine(engine)?.getPlotBudgetOverrides?.(),
    );
}

export function getPlotBudgetOptionsFromQuality(
    settings: IQualitySettings | null | undefined,
    overrides: PlotBudgetPolicyOptions = {},
): PlotBudgetPolicyOptions {
    const isMobile = overrides.isMobile ?? DetectDevice.isMobile();
    if (!settings) {
        return {...overrides, isMobile};
    }

    const base = PlotBudgetPolicy.resolveOptions({isMobile});
    const scene = settings.scene;
    const lodDistances = scene?.lodDistances ?? [];
    const pressure = getQualityPressure(settings, isMobile);
    const distanceScale = MathUtils.clamp(1 - pressure * 0.45, 0.45, 1.05);
    const viewDistance = scene?.viewDistance && scene.viewDistance > 0 ? scene.viewDistance : base.cullDistance;

    return {
        isMobile,
        nearDistance: Math.max(8, Math.round((lodDistances[0] ?? base.nearDistance) * distanceScale)),
        midDistance: Math.max(16, Math.round((lodDistances[1] ?? base.midDistance) * distanceScale)),
        farDistance: Math.max(32, Math.round((lodDistances[2] ?? base.farDistance) * distanceScale)),
        cullDistance: Math.max(48, Math.round(viewDistance * distanceScale)),
        offscreenCullDistance: Math.max(24, Math.round(base.offscreenCullDistance * distanceScale)),
        lodDistanceMultiplier: MathUtils.clamp(1 - pressure * 0.5, 0.4, 1),
        lodTransitionBudget: isMobile ? 4 : 12,
        lodHysteresisRatio: 0.12,
        batchSize: isMobile ? 16 : 48,
        heavyTriangleLimit: Math.floor(base.heavyTriangleLimit * (1 - pressure * 0.25)),
        heavyDrawCallLimit: Math.max(8, Math.floor(base.heavyDrawCallLimit * (1 - pressure * 0.25))),
        heavyTextureBytesLimit: Math.floor(base.heavyTextureBytesLimit * (1 - pressure * 0.35)),
        ...overrides,
    };
}

export function markObjectForPlotBudget(object: Object3D, metadata: PlotBudgetMetadata = {}): void {
    const current = ensurePlotBudgetMetadata(object);
    Object.assign(current, metadata);
    if (metadata.enabled === undefined) {
        current.enabled = true;
    }
    current.stats = metadata.stats ?? current.stats ?? collectPlotBudgetStats(object);
}

export function getPlotBudgetMetadata(object: Object3D): PlotBudgetMetadata | undefined {
    return (object.userData as {plotBudget?: PlotBudgetMetadata}).plotBudget;
}

export function ensurePlotBudgetMetadata(object: Object3D): PlotBudgetMetadata {
    const data = object.userData as {plotBudget?: PlotBudgetMetadata};
    data.plotBudget ??= {};
    return data.plotBudget;
}

export function isPlotBudgetCandidate(object: Object3D): boolean {
    const metadata = getPlotBudgetMetadata(object);
    if (metadata?.enabled === true) return true;
    if (metadata?.enabled === false) return false;
    if (!object.userData?.isStemObject) return false;
    const tree = inspectPlotBudgetCandidateTree(object);
    return tree.hasRenderable && !tree.hasRuntimeMetadata;
}

export function collectPlotBudgetStats(root: Object3D): PlotBudgetStats {
    const collection = createPlotBudgetStatsCollection();

    traverseObjectDepthFirst(root, child => {
        collectPlotBudgetStatsForObject(collection, child);
    });

    return finalizePlotBudgetStatsCollection(collection);
}

function collectPlotBudgetRegistrationProfile(root: Object3D): PlotBudgetRegistrationProfile {
    const collection = createPlotBudgetStatsCollection();
    const lods: ManagedLod[] = [];

    traverseObjectDepthFirst(root, child => {
        collectPlotBudgetStatsForObject(collection, child);
        collectManagedLodForObject(lods, child);
    });

    return {
        stats: finalizePlotBudgetStatsCollection(collection),
        lods,
    };
}

function createPlotBudgetStatsCollection(): PlotBudgetStatsCollection {
    const bounds = new Vector3();
    return {
        geometries: new Set<string>(),
        textures: new Set<string>(),
        bounds,
        box: new Box3(),
        geometryBox: new Box3(),
        stats: {
            triangles: 0,
            drawCalls: 0,
            bounds,
            textureBytes: 0,
            textureCount: 0,
        },
    };
}

function collectPlotBudgetStatsForObject(collection: PlotBudgetStatsCollection, child: Object3D): void {
    updateMatrixWorldForPlotStats(child);
    const mesh = child as Mesh;
    const geometry = mesh.geometry;
    const material = mesh.material;

    if (geometry) {
        if (!collection.geometries.has(geometry.uuid)) {
            collection.geometries.add(geometry.uuid);
            collection.stats.triangles += getGeometryTriangleCount(geometry);
        }
        if (!geometry.boundingBox) {
            geometry.computeBoundingBox();
        }
        if (geometry.boundingBox) {
            collection.geometryBox.copy(geometry.boundingBox).applyMatrix4(child.matrixWorld);
            collection.box.union(collection.geometryBox);
        }
    }

    if (material) {
        if (Array.isArray(material)) {
            collection.stats.drawCalls += Math.max(1, material.length);
            for (const item of material) {
                addMaterialTextureBytes(item, collection.textures, collection.stats);
            }
        } else {
            collection.stats.drawCalls++;
            addMaterialTextureBytes(material, collection.textures, collection.stats);
        }
    }
}

function finalizePlotBudgetStatsCollection(collection: PlotBudgetStatsCollection): PlotBudgetStats {
    if (!collection.box.isEmpty()) {
        collection.box.getSize(collection.bounds);
    }
    collection.stats.textureCount = collection.textures.size;
    return collection.stats;
}

async function collectPlotBudgetProfileProgressive(
    root: Object3D,
    options: PlotBudgetRebuildProgressOptions = {},
    {
        abortOnRuntimeMetadata = false,
    }: {
        abortOnRuntimeMetadata?: boolean;
    } = {},
): Promise<PlotBudgetProgressiveProfile> {
    const maybeYield = createProgressiveYieldController(options, {
        batchSize: PLOT_BUDGET_REBUILD_BATCH_SIZE,
        frameBudgetMs: PLOT_BUDGET_REBUILD_FRAME_BUDGET_MS,
    });
    const collection = createPlotBudgetStatsCollection();
    const profile: PlotBudgetProgressiveProfile = {
        hasRenderable: false,
        hasRuntimeMetadata: false,
        stats: collection.stats,
        lods: [],
    };
    const stack: Object3D[] = [root];

    while (stack.length > 0) {
        const child = stack.pop();
        if (!child) {
            await maybeYield();
            continue;
        }

        updatePlotBudgetCandidateFlags(profile, child);
        if (abortOnRuntimeMetadata && profile.hasRuntimeMetadata) {
            await maybeYield();
            break;
        }

        collectPlotBudgetStatsForObject(collection, child);
        collectManagedLodForObject(profile.lods, child);

        for (let i = child.children.length - 1; i >= 0; i--) {
            const nested = child.children[i];
            if (nested) stack.push(nested);
        }

        await maybeYield();
    }

    finalizePlotBudgetStatsCollection(collection);
    return profile;
}

function updateMatrixWorldForPlotStats(object: Object3D): void {
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

function collectManagedLodForObject(lods: ManagedLod[], child: Object3D): void {
    if (!(child instanceof LOD)) return;
    lods.push({
        lod: child,
        baseDistances: child.levels.map(level => level.distance),
        originalAutoUpdate: (child as LOD & {autoUpdate?: boolean}).autoUpdate,
        originalLevelVisibility: child.levels.map(level => level.object.visible),
        runtimeGroupId: `plot-lod:${child.uuid}`,
        runtimeRegistered: false,
        scaledThresholds: [],
    });
}

function restoreManagedLod(managed: ManagedLod): void {
    managed.runtimeHandle?.unregister();
    managed.runtimeHandle = undefined;
    managed.runtimeRegistered = false;
    const lod = managed.lod as LOD & {autoUpdate?: boolean};
    if (managed.originalAutoUpdate !== undefined) {
        lod.autoUpdate = managed.originalAutoUpdate;
    }
    for (let index = 0; index < managed.lod.levels.length; index++) {
        const level = managed.lod.levels[index];
        if (!level) continue;
        level.distance = managed.baseDistances[index] ?? level.distance;
        level.object.visible = managed.originalLevelVisibility[index] ?? true;
    }
}

function applyScaledLodDistances(managed: ManagedLod, scale: number): void {
    for (let index = 0; index < managed.lod.levels.length; index++) {
        const level = managed.lod.levels[index];
        if (!level) continue;
        level.distance = (managed.baseDistances[index] ?? level.distance) * scale;
    }
}

function getScaledLodThresholds(managed: ManagedLod): number[] {
    const thresholds = managed.scaledThresholds;
    thresholds.length = 0;
    for (let index = 1; index < managed.lod.levels.length; index++) {
        thresholds.push(managed.lod.levels[index]?.distance ?? managed.baseDistances[index] ?? 0);
    }
    return thresholds;
}

function hasUsableLodBounds(lod: LOD): boolean {
    LOD_REGISTRATION_BOUNDS.setFromObject(lod);
    return !LOD_REGISTRATION_BOUNDS.isEmpty();
}

function isPlotBudgetExplicitlyDisabled(object: Object3D): boolean {
    return getPlotBudgetMetadata(object)?.enabled === false;
}

function shouldInspectPlotBudgetCandidate(object: Object3D): boolean {
    const metadata = getPlotBudgetMetadata(object);
    if (metadata?.enabled === true) return true;
    if (metadata?.enabled === false) return false;
    return object.userData?.isStemObject === true;
}

function inspectPlotBudgetCandidateTree(root: Object3D): {hasRenderable: boolean; hasRuntimeMetadata: boolean} {
    let hasRenderable = false;
    let hasRuntimeMetadata = false;
    const stack: Object3D[] = [root];

    while (stack.length > 0) {
        const object = stack.pop();
        if (!object) continue;

        if (!hasRenderable) {
            const renderable = object as Object3D & {isMesh?: boolean; isLOD?: boolean; isSprite?: boolean};
            hasRenderable = !!(renderable.isMesh || renderable.isLOD || renderable.isSprite);
        }

        if (!hasRuntimeMetadata) {
            hasRuntimeMetadata = hasRuntimeBudgetMetadata(object);
        }

        if (hasRenderable && hasRuntimeMetadata) break;

        for (let i = object.children.length - 1; i >= 0; i--) {
            const child = object.children[i];
            if (child) stack.push(child);
        }
    }

    return {hasRenderable, hasRuntimeMetadata};
}

function updatePlotBudgetCandidateFlags(profile: PlotBudgetProgressiveProfile, object: Object3D): void {
    if (!profile.hasRenderable) {
        const renderable = object as Object3D & {isMesh?: boolean; isLOD?: boolean; isSprite?: boolean};
        profile.hasRenderable = !!(renderable.isMesh || renderable.isLOD || renderable.isSprite);
    }

    if (!profile.hasRuntimeMetadata) {
        profile.hasRuntimeMetadata = hasRuntimeBudgetMetadata(object);
    }
}

function hasRuntimeBudgetMetadata(object: Object3D): boolean {
    const data = object.userData ?? {};
    const physics = data.physics as {enabled?: boolean; type?: string} | undefined;
    return (
        data.isRuntimeOnly === true ||
        data.isBillboard === true ||
        data.avatarBudget !== undefined ||
        data.player !== undefined ||
        data.animation !== undefined ||
        (Array.isArray(data.behaviors) && data.behaviors.length > 0) ||
        (Array.isArray(data.lambdaComponents) && data.lambdaComponents.length > 0) ||
        (!!physics && physics.enabled !== false && physics.type !== "static")
    );
}

function getPlotBoundsRadius(object: Object3D): number {
    const metadata = ensurePlotBudgetMetadata(object);
    metadata.stats ??= collectPlotBudgetStats(object);
    const radius = metadata.stats.bounds.length() / 2;
    return radius > 0 ? radius : DEFAULT_BOUNDS_RADIUS;
}

function getGeometryTriangleCount(geometry: BufferGeometry): number {
    if (geometry.index) {
        return Math.floor(geometry.index.count / 3);
    }

    const position = geometry.getAttribute("position");
    return position ? Math.floor(position.count / 3) : 0;
}

function addMaterialTextureBytes(
    material: Material,
    textureIds: Set<string>,
    stats: PlotBudgetStats,
): void {
    const texturedMaterial = material as Material & Partial<Record<TextureSlot, Texture | null>>;

    for (const slot of TEXTURE_SLOTS) {
        const texture = texturedMaterial[slot];
        if (!texture || textureIds.has(texture.uuid)) continue;
        textureIds.add(texture.uuid);
        stats.textureBytes += estimateTextureBytes(texture);
    }
}

function estimateTextureBytes(texture: Texture): number {
    const {width, height} = getTextureDimensions(texture);
    if (width <= 0 || height <= 0) return 0;
    const baseBytes = width * height * BYTES_PER_RGBA_PIXEL;
    return Math.ceil(texture.generateMipmaps ? baseBytes * MIP_CHAIN_MULTIPLIER : baseBytes);
}

function getTextureDimensions(texture: Texture): {width: number; height: number} {
    const image = texture.image as
        | {width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number}
        | undefined;
    if (!image) return {width: 0, height: 0};

    const width = Math.max(image.videoWidth ?? 0, image.naturalWidth ?? 0, image.width ?? 0);
    const height = Math.max(image.videoHeight ?? 0, image.naturalHeight ?? 0, image.height ?? 0);
    return {width, height};
}

function getQualityPressure(settings: IQualitySettings, isMobile: boolean): number {
    const rendering = settings.rendering;
    const scene = settings.scene;
    const textureTier = getTextureQualityTier(rendering?.textureQuality);
    const lodBias = MathUtils.clamp(rendering?.lodBias ?? 0, 0, 3);
    const cullingAggressiveness = MathUtils.clamp(scene?.cullingAggressiveness ?? 0.5, 0, 1);
    let pressure = 0;

    pressure += (4 - textureTier) * 0.12;
    pressure += lodBias * 0.1;
    pressure += cullingAggressiveness * 0.08;
    if ((rendering?.pixelRatio ?? 1) <= 0.75) pressure += 0.08;
    if (isMobile) pressure += 0.12;

    return MathUtils.clamp(pressure, 0, 0.8);
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

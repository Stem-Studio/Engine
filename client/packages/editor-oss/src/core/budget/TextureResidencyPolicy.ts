import {Material, MathUtils, Mesh, Object3D, Scene, Texture} from "three";
import {DetectDevice} from "@stem/editor-oss/utils/DetectDevice";
import {
    estimateTextureBytes,
    getAvatarBudgetMetadata,
    type AvatarBudgetState,
} from "./AvatarBudgetPolicy";
import {getPlotBudgetMetadata, type PlotBudgetState} from "./PlotBudgetPolicy";
import {
    getRuntimeBudgetCoordinatorFromEngine,
    type RuntimeBudgetPressure,
} from "./RuntimeBudgetCoordinator";
import type {IQualitySettings} from "../quality/interfaces/IQualityManager";
import {traverseObjectDepthFirst} from "../../utils/SceneTraverser";
import {
    createProgressiveYieldController,
    type ProgressiveYieldOptions,
} from "../../utils/progressiveYield";

export type TextureResidencyState = "resident" | "reduced" | "evicted";

export interface TextureResidencyStats {
    textureBytes: number;
    textureCount: number;
    residentTextureBytes?: number;
    residentTextureCount?: number;
    materialCount: number;
    sharedMaterialCount: number;
}

export interface TextureResidencyMetadata {
    enabled?: boolean;
    state?: TextureResidencyState;
    stats?: TextureResidencyStats;
    lastDecision?: TextureResidencyDecision;
}

export interface TextureResidencyDecision {
    state: TextureResidencyState;
    reason: string;
    source: "avatar" | "plot" | "explicit" | "none";
    estimatedTextureBytes: number;
    managedTextureBytes: number;
    overBudget: boolean;
}

export interface TextureResidencyOptions {
    runtimePressure?: RuntimeBudgetPressure;
    enabled?: boolean;
    isMobile?: boolean;
    batchSize?: number;
    discoveryBatchSize?: number;
    ownershipRefreshInterval?: number;
    maxResidentTextureBytes?: number;
    reduceGhostAvatars?: boolean;
    reduceFarPlots?: boolean;
    reduceMidPlotsUnderPressure?: boolean;
    evictCulled?: boolean;
    evictGhostAvatarsUnderPressure?: boolean;
    evictFarPlotsUnderPressure?: boolean;
    disposeReducedTextures?: boolean;
    disposeEvictedTextures?: boolean;
    protectSharedMaterials?: boolean;
    protectSharedTextures?: boolean;
}

export type TextureResidencyRebuildProgressOptions = ProgressiveYieldOptions;

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
    | "specularMap"
    | "thicknessMap"
    | "transmissionMap";

type TextureMaterial = Material & Partial<Record<TextureSlot, Texture | null>>;

interface MaterialTextureResidency {
    slots?: Partial<Record<TextureSlot, Texture>>;
}

interface ManagedTextureRoot {
    root: Object3D;
}

interface TextureResidencyCollection {
    materials: Set<Material>;
    textures: Set<Texture>;
    residentTextures: Set<Texture>;
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
    "specularMap",
    "thicknessMap",
    "transmissionMap",
];

const REDUCED_KEEP_SLOTS = new Set<TextureSlot>(["map", "alphaMap"]);
const TEXTURE_RESIDENCY_REBUILD_BATCH_SIZE = 32;
const TEXTURE_RESIDENCY_REBUILD_FRAME_BUDGET_MS = 4;

export class TextureResidencyPolicy {
    private options: Required<TextureResidencyOptions>;
    private configuredOverrides: TextureResidencyOptions;

    constructor(options: TextureResidencyOptions = {}) {
        this.configuredOverrides = {...options};
        this.options = TextureResidencyPolicy.resolveOptions(options);
    }

    configure(options: TextureResidencyOptions = {}): void {
        this.configuredOverrides = {...this.configuredOverrides, ...options};
        this.options = TextureResidencyPolicy.resolveOptions(this.configuredOverrides);
    }

    configureFromQuality(settings: IQualitySettings | null | undefined, overrides: TextureResidencyOptions = {}): void {
        this.options = TextureResidencyPolicy.resolveOptions(
            getTextureResidencyOptionsFromQuality(settings, {...this.configuredOverrides, ...overrides}),
        );
    }

    static resolveOptions(options: TextureResidencyOptions = {}): Required<TextureResidencyOptions> {
        const isMobile = options.isMobile ?? DetectDevice.isMobile();
        return {
            enabled: options.enabled ?? true,
            isMobile,
            batchSize: options.batchSize ?? (isMobile ? 8 : 24),
            discoveryBatchSize: options.discoveryBatchSize ?? (isMobile ? 2 : 6),
            ownershipRefreshInterval: options.ownershipRefreshInterval ?? (isMobile ? 20 : 45),
            maxResidentTextureBytes: options.maxResidentTextureBytes ?? (isMobile ? 96 : 384) * 1024 * 1024,
            reduceGhostAvatars: options.reduceGhostAvatars ?? true,
            reduceFarPlots: options.reduceFarPlots ?? true,
            reduceMidPlotsUnderPressure: options.reduceMidPlotsUnderPressure ?? true,
            evictCulled: options.evictCulled ?? true,
            evictGhostAvatarsUnderPressure: options.evictGhostAvatarsUnderPressure ?? false,
            evictFarPlotsUnderPressure: options.evictFarPlotsUnderPressure ?? false,
            disposeReducedTextures: options.disposeReducedTextures ?? isMobile,
            disposeEvictedTextures: options.disposeEvictedTextures ?? true,
            protectSharedMaterials: options.protectSharedMaterials ?? true,
            protectSharedTextures: options.protectSharedTextures ?? true,
            runtimePressure: options.runtimePressure ?? "normal",
        };
    }

    getBatchSize(): number {
        return this.options.batchSize;
    }

    getDiscoveryBatchSize(): number {
        return this.options.discoveryBatchSize;
    }

    getOwnershipRefreshInterval(): number {
        return this.options.ownershipRefreshInterval;
    }

    getOptions(): Readonly<Required<TextureResidencyOptions>> {
        return this.options;
    }

    decide(object: Object3D, managedTextureBytes: number): TextureResidencyDecision {
        const metadata = ensureTextureResidencyMetadata(object);
        metadata.stats ??= collectTextureResidencyStats(object);

        const overBudget = managedTextureBytes > this.options.maxResidentTextureBytes;
        const criticalPressure = overBudget && this.options.runtimePressure === "critical";
        const avatarState = getObjectAvatarState(object);
        const plotState = getObjectPlotState(object);
        const estimatedTextureBytes = metadata.stats.textureBytes;
        let state: TextureResidencyState = "resident";
        let reason = this.options.enabled ? "resident-default" : "disabled";
        let source: TextureResidencyDecision["source"] = "none";

        if (!this.options.enabled) {
            state = "resident";
        } else if (avatarState) {
            source = "avatar";
            if (avatarState.isLocal || avatarState.state === "full") {
                state = "resident";
                reason = avatarState.isLocal ? "local-avatar" : "avatar-full";
            } else if (avatarState.state === "culled" && this.options.evictCulled) {
                state = "evicted";
                reason = "avatar-culled";
            } else if (
                avatarState.state === "ghost" &&
                criticalPressure &&
                this.options.evictGhostAvatarsUnderPressure
            ) {
                state = "evicted";
                reason = "avatar-ghost-critical-texture-pressure";
            } else if (avatarState.state === "ghost" && this.options.reduceGhostAvatars) {
                state = "reduced";
                reason = "avatar-ghost";
            }
        } else if (plotState) {
            source = "plot";
            if (plotState === "culled" && this.options.evictCulled) {
                state = "evicted";
                reason = "plot-culled";
            } else if (plotState === "far" && criticalPressure && this.options.evictFarPlotsUnderPressure) {
                state = "evicted";
                reason = "plot-far-critical-texture-pressure";
            } else if (plotState === "far" && this.options.reduceFarPlots) {
                state = "reduced";
                reason = "plot-far";
            } else if (plotState === "mid" && overBudget && this.options.reduceMidPlotsUnderPressure) {
                state = "reduced";
                reason = "plot-mid-over-texture-budget";
            } else {
                state = "resident";
                reason = `plot-${plotState}`;
            }
        } else if (metadata.enabled === true) {
            source = "explicit";
            state = "resident";
            reason = "explicit-resident";
        }

        const decision: TextureResidencyDecision = {
            state,
            reason,
            source,
            estimatedTextureBytes,
            managedTextureBytes,
            overBudget,
        };
        metadata.lastDecision = decision;
        return decision;
    }
}

export class TextureResidencyManager {
    private readonly policy: TextureResidencyPolicy;
    private readonly roots: ManagedTextureRoot[] = [];
    private readonly rootIndexes = new Map<string, number>();
    private readonly materialOwners = new Map<string, Set<string>>();
    private readonly textureOwners = new Map<string, Set<string>>();
    private scene?: Scene;
    private cursor = 0;
    private discoveryCursor = 0;
    private framesSinceOwnershipRefresh = Number.POSITIVE_INFINITY;
    private managedTextureBytes = 0;
    private stats: TextureResidencyStats = {
        textureBytes: 0,
        textureCount: 0,
        residentTextureBytes: 0,
        residentTextureCount: 0,
        materialCount: 0,
        sharedMaterialCount: 0,
    };

    constructor(scene?: Scene, options: TextureResidencyOptions = {}) {
        this.policy = new TextureResidencyPolicy(options);
        if (scene) {
            this.rebuild(scene);
        }
    }

    configure(options: TextureResidencyOptions = {}): void {
        this.policy.configure(options);
    }

    configureFromQuality(settings: IQualitySettings | null | undefined, overrides: TextureResidencyOptions = {}): void {
        this.policy.configureFromQuality(settings, overrides);
    }

    rebuild(scene: Scene): void {
        this.scene = scene;
        this.clear();
        for (const child of scene.children) {
            this.walkAndRegister(child, true);
        }
        this.refreshOwnership();
    }

    async rebuildProgressive(scene: Scene, options: TextureResidencyRebuildProgressOptions = {}): Promise<void> {
        this.scene = scene;
        this.clear();
        const maybeYield = createProgressiveYieldController(options, {
            batchSize: TEXTURE_RESIDENCY_REBUILD_BATCH_SIZE,
            frameBudgetMs: TEXTURE_RESIDENCY_REBUILD_FRAME_BUDGET_MS,
        });
        const stack: Object3D[] = [];

        for (let i = scene.children.length - 1; i >= 0; i--) {
            const child = scene.children[i];
            if (child) stack.push(child);
        }

        let registered = false;
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current || isTextureResidencyExplicitlyDisabled(current)) {
                await maybeYield();
                continue;
            }

            if (isTextureResidencyCandidate(current)) {
                registered = this.registerProgressive(current) || registered;
                await maybeYield(true);
                continue;
            }

            for (let i = current.children.length - 1; i >= 0; i--) {
                const child = current.children[i];
                if (child) stack.push(child);
            }

            await maybeYield();
        }

        if (registered) {
            await this.refreshOwnershipProgressive(options);
        }
    }

    registerObjectTree(root: Object3D): void {
        if (this.walkAndRegister(root)) {
            this.framesSinceOwnershipRefresh = Number.POSITIVE_INFINITY;
        }
    }

    /**
     * Register a single node during a shared post-initialization walk.
     * Returning false prunes this consumer below a residency root while
     * allowing other consumers to continue their own discovery.
     */
    registerObjectNode(object: Object3D): boolean {
        if (isTextureResidencyExplicitlyDisabled(object)) return false;
        if (isTextureResidencyCandidate(object)) {
            if (this.register(object)) {
                this.framesSinceOwnershipRefresh = Number.POSITIVE_INFINITY;
            }
            return false;
        }
        return true;
    }

    unregisterObjectTree(root: Object3D): void {
        let removed = false;
        traverseObjectDepthFirst(root, object => {
            removed = this.unregister(object) || removed;
        });
        if (removed) {
            this.framesSinceOwnershipRefresh = Number.POSITIVE_INFINITY;
        }
    }

    update(): void {
        this.discoverCandidates();
        this.maybeRefreshOwnership();
        if (this.roots.length === 0) return;

        const count = Math.min(this.policy.getBatchSize(), this.roots.length);
        for (let i = 0; i < count; i++) {
            const index = (this.cursor + i) % this.roots.length;
            const managed = this.roots[index];
            if (!managed) continue;
            if (!managed.root.parent) {
                this.unregister(managed.root);
                continue;
            }

            const decision = this.policy.decide(managed.root, this.managedTextureBytes);
            this.applyDecision(managed.root, decision);
        }

        this.cursor = this.roots.length > 0 ? (this.cursor + count) % this.roots.length : 0;
    }

    getRegisteredCount(): number {
        return this.roots.length;
    }

    getStats(): TextureResidencyStats {
        return {...this.stats};
    }

    getStatsForFrame(): TextureResidencyStats {
        return this.stats;
    }

    getOptions(): Readonly<Required<TextureResidencyOptions>> {
        return this.policy.getOptions();
    }

    clear(): void {
        for (const managed of this.roots) {
            restoreRootTextures(managed.root);
        }
        this.roots.length = 0;
        this.rootIndexes.clear();
        this.materialOwners.clear();
        this.textureOwners.clear();
        this.cursor = 0;
        this.discoveryCursor = 0;
        this.managedTextureBytes = 0;
        this.stats = {
            textureBytes: 0,
            textureCount: 0,
            residentTextureBytes: 0,
            residentTextureCount: 0,
            materialCount: 0,
            sharedMaterialCount: 0,
        };
    }

    dispose(): void {
        this.clear();
    }

    private walkAndRegister(object: Object3D, deferStats = false): boolean {
        const stack: Object3D[] = [object];
        let registered = false;

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current || isTextureResidencyExplicitlyDisabled(current)) continue;

            if (isTextureResidencyCandidate(current)) {
                registered = this.register(current, deferStats) || registered;
                continue;
            }

            for (let i = current.children.length - 1; i >= 0; i--) {
                const child = current.children[i];
                if (child) stack.push(child);
            }
        }

        return registered;
    }

    private register(root: Object3D, deferStats = false): boolean {
        if (this.rootIndexes.has(root.uuid)) return false;
        if (deferStats) {
            ensureTextureResidencyMetadata(root).enabled = true;
        } else {
            markObjectForTextureResidency(root, {enabled: true});
        }
        this.rootIndexes.set(root.uuid, this.roots.length);
        this.roots.push({root});
        return true;
    }

    private registerProgressive(root: Object3D): boolean {
        if (this.rootIndexes.has(root.uuid)) return false;
        ensureTextureResidencyMetadata(root).enabled = true;
        this.rootIndexes.set(root.uuid, this.roots.length);
        this.roots.push({root});
        return true;
    }

    private unregister(root: Object3D): boolean {
        const index = this.rootIndexes.get(root.uuid);
        if (index === undefined) return false;

        const removed = this.roots[index];
        if (!removed) return false;

        const lastIndex = this.roots.length - 1;
        const last = this.roots[lastIndex];
        if (index !== lastIndex && last) {
            this.roots[index] = last;
            this.rootIndexes.set(last.root.uuid, index);
        }

        this.roots.pop();
        this.rootIndexes.delete(root.uuid);
        restoreRootTextures(removed.root);
        this.cursor = this.roots.length > 0 ? this.cursor % this.roots.length : 0;
        this.framesSinceOwnershipRefresh = Number.POSITIVE_INFINITY;
        return true;
    }

    private discoverCandidates(): void {
        if (!this.scene || this.scene.children.length === 0) return;
        const count = Math.min(this.policy.getDiscoveryBatchSize(), this.scene.children.length);
        for (let i = 0; i < count; i++) {
            const index = (this.discoveryCursor + i) % this.scene.children.length;
            const child = this.scene.children[index];
            if (child) this.registerObjectTree(child);
        }
        this.discoveryCursor = (this.discoveryCursor + count) % this.scene.children.length;
    }

    private maybeRefreshOwnership(): void {
        this.framesSinceOwnershipRefresh++;
        if (this.framesSinceOwnershipRefresh < this.policy.getOwnershipRefreshInterval()) return;
        this.refreshOwnership();
    }

    private refreshOwnership(): void {
        this.materialOwners.clear();
        this.textureOwners.clear();
        const materialIds = new Set<string>();
        const textureIds = new Set<string>();
        const residentTextureIds = new Set<string>();
        let textureBytes = 0;
        let residentTextureBytes = 0;

        for (const managed of this.roots) {
            const rootInfo = collectTextureResidencyInfo(managed.root);

            for (const material of rootInfo.materials) {
                materialIds.add(material.uuid);
                addOwner(this.materialOwners, material.uuid, managed.root.uuid);
            }

            for (const texture of rootInfo.textures) {
                if (!textureIds.has(texture.uuid)) {
                    textureIds.add(texture.uuid);
                    textureBytes += estimateTextureBytes(texture);
                }
                addOwner(this.textureOwners, texture.uuid, managed.root.uuid);
            }

            for (const texture of rootInfo.residentTextures) {
                if (residentTextureIds.has(texture.uuid)) continue;
                residentTextureIds.add(texture.uuid);
                residentTextureBytes += estimateTextureBytes(texture);
            }

            ensureTextureResidencyMetadata(managed.root).stats = getTextureResidencyStatsFromInfo(rootInfo);
        }

        let sharedMaterialCount = 0;
        for (const owners of this.materialOwners.values()) {
            if (owners.size > 1) sharedMaterialCount++;
        }

        this.managedTextureBytes = residentTextureBytes;
        this.stats = {
            textureBytes,
            textureCount: textureIds.size,
            residentTextureBytes,
            residentTextureCount: residentTextureIds.size,
            materialCount: materialIds.size,
            sharedMaterialCount,
        };
        this.framesSinceOwnershipRefresh = 0;
    }

    private async refreshOwnershipProgressive(options: TextureResidencyRebuildProgressOptions = {}): Promise<void> {
        const maybeYield = createProgressiveYieldController(options, {
            batchSize: TEXTURE_RESIDENCY_REBUILD_BATCH_SIZE,
            frameBudgetMs: TEXTURE_RESIDENCY_REBUILD_FRAME_BUDGET_MS,
        });
        this.materialOwners.clear();
        this.textureOwners.clear();
        const materialIds = new Set<string>();
        const textureIds = new Set<string>();
        const residentTextureIds = new Set<string>();
        let textureBytes = 0;
        let residentTextureBytes = 0;

        for (const managed of this.roots) {
            const rootInfo = await collectTextureResidencyInfoProgressive(managed.root, options);

            for (const material of rootInfo.materials) {
                materialIds.add(material.uuid);
                addOwner(this.materialOwners, material.uuid, managed.root.uuid);
            }

            for (const texture of rootInfo.textures) {
                if (!textureIds.has(texture.uuid)) {
                    textureIds.add(texture.uuid);
                    textureBytes += estimateTextureBytes(texture);
                }
                addOwner(this.textureOwners, texture.uuid, managed.root.uuid);
            }

            for (const texture of rootInfo.residentTextures) {
                if (residentTextureIds.has(texture.uuid)) continue;
                residentTextureIds.add(texture.uuid);
                residentTextureBytes += estimateTextureBytes(texture);
            }

            ensureTextureResidencyMetadata(managed.root).stats = getTextureResidencyStatsFromInfo(rootInfo);
            await maybeYield(true);
        }

        let sharedMaterialCount = 0;
        for (const owners of this.materialOwners.values()) {
            if (owners.size > 1) sharedMaterialCount++;
        }

        this.managedTextureBytes = residentTextureBytes;
        this.stats = {
            textureBytes,
            textureCount: textureIds.size,
            residentTextureBytes,
            residentTextureCount: residentTextureIds.size,
            materialCount: materialIds.size,
            sharedMaterialCount,
        };
        this.framesSinceOwnershipRefresh = 0;
    }

    private applyDecision(root: Object3D, decision: TextureResidencyDecision): void {
        const metadata = ensureTextureResidencyMetadata(root);
        if (metadata.state === decision.state) {
            root.userData.textureResidencyState = decision.state;
            return;
        }

        if (decision.state === "resident") {
            restoreRootTextures(root);
        } else if (decision.state === "reduced") {
            reduceRootTextures(root, this.policy.getOptions(), this.materialOwners, this.textureOwners);
        } else {
            evictRootTextures(root, this.policy.getOptions(), this.materialOwners, this.textureOwners);
        }

        metadata.state = decision.state;
        metadata.stats = collectTextureResidencyStats(root);
        root.userData.textureResidencyState = decision.state;
    }
}

export function configureTextureResidencyManagerFromEngine(manager: TextureResidencyManager, engine: unknown): void {
    const qualityManager = (engine as {qualityManager?: {getCurrentSettings?: () => IQualitySettings}} | null | undefined)
        ?.qualityManager;
    manager.configureFromQuality(
        qualityManager?.getCurrentSettings?.(),
        getRuntimeBudgetCoordinatorFromEngine(engine)?.getTextureResidencyOverrides?.(),
    );
}

export function getTextureResidencyOptionsFromQuality(
    settings: IQualitySettings | null | undefined,
    overrides: TextureResidencyOptions = {},
): TextureResidencyOptions {
    const isMobile = overrides.isMobile ?? DetectDevice.isMobile();
    if (!settings) {
        return {...overrides, isMobile};
    }

    const rendering = settings.rendering;
    const scene = settings.scene;
    const textureTier = getTextureQualityTier(rendering?.textureQuality);
    const cullingAggressiveness = MathUtils.clamp(scene?.cullingAggressiveness ?? 0.5, 0, 1);
    const lodBias = MathUtils.clamp(rendering?.lodBias ?? 0, 0, 3);
    const pressure = MathUtils.clamp(
        (4 - textureTier) * 0.14 + cullingAggressiveness * 0.08 + lodBias * 0.08 + (isMobile ? 0.18 : 0),
        0,
        0.85,
    );
    const baseMb = isMobile ? 96 : 384;
    const budgetMb = Math.max(isMobile ? 40 : 160, Math.round(baseMb * (1 - pressure * 0.45)));

    return {
        isMobile,
        batchSize: isMobile ? 6 : 18,
        discoveryBatchSize: isMobile ? 2 : 6,
        ownershipRefreshInterval: isMobile ? 18 : 45,
        maxResidentTextureBytes: budgetMb * 1024 * 1024,
        reduceGhostAvatars: true,
        reduceFarPlots: true,
        reduceMidPlotsUnderPressure: true,
        evictCulled: true,
        disposeReducedTextures: isMobile || textureTier <= 2,
        disposeEvictedTextures: true,
        protectSharedMaterials: true,
        protectSharedTextures: true,
        ...overrides,
    };
}

export function markObjectForTextureResidency(
    object: Object3D,
    metadata: TextureResidencyMetadata = {},
): void {
    const current = ensureTextureResidencyMetadata(object);
    Object.assign(current, metadata);
    if (metadata.enabled === undefined) {
        current.enabled = true;
    }
    current.stats = metadata.stats ?? current.stats ?? collectTextureResidencyStats(object);
}

export function getTextureResidencyMetadata(object: Object3D): TextureResidencyMetadata | undefined {
    return (object.userData as {textureResidency?: TextureResidencyMetadata}).textureResidency;
}

export function ensureTextureResidencyMetadata(object: Object3D): TextureResidencyMetadata {
    const data = object.userData as {textureResidency?: TextureResidencyMetadata};
    data.textureResidency ??= {};
    return data.textureResidency;
}

export function isTextureResidencyCandidate(object: Object3D): boolean {
    const metadata = getTextureResidencyMetadata(object);
    if (metadata?.enabled === true) return true;
    if (metadata?.enabled === false) return false;
    return getAvatarBudgetMetadata(object)?.enabled === true || getPlotBudgetMetadata(object)?.enabled === true;
}

export function collectTextureResidencyStats(root: Object3D): TextureResidencyStats {
    return getTextureResidencyStatsFromInfo(collectTextureResidencyInfo(root));
}

function getTextureResidencyStatsFromInfo(info: TextureResidencyCollection): TextureResidencyStats {
    let textureBytes = 0;
    for (const texture of info.textures) {
        textureBytes += estimateTextureBytes(texture);
    }
    let residentTextureBytes = 0;
    for (const texture of info.residentTextures) {
        residentTextureBytes += estimateTextureBytes(texture);
    }

    return {
        textureBytes,
        textureCount: info.textures.size,
        residentTextureBytes,
        residentTextureCount: info.residentTextures.size,
        materialCount: info.materials.size,
        sharedMaterialCount: 0,
    };
}

function reduceRootTextures(
    root: Object3D,
    options: Required<TextureResidencyOptions>,
    materialOwners: Map<string, Set<string>>,
    textureOwners: Map<string, Set<string>>,
): void {
    visitMaterials(root, material => {
        if (isMaterialProtected(material, root, options, materialOwners)) return;
        for (const slot of TEXTURE_SLOTS) {
            if (REDUCED_KEEP_SLOTS.has(slot)) continue;
            clearMaterialTextureSlot(material, slot, options.disposeReducedTextures, options, textureOwners);
        }
    });
}

function evictRootTextures(
    root: Object3D,
    options: Required<TextureResidencyOptions>,
    materialOwners: Map<string, Set<string>>,
    textureOwners: Map<string, Set<string>>,
): void {
    visitMaterials(root, material => {
        if (isMaterialProtected(material, root, options, materialOwners)) return;
        for (const slot of TEXTURE_SLOTS) {
            clearMaterialTextureSlot(material, slot, options.disposeEvictedTextures, options, textureOwners);
        }
    });
}

function restoreRootTextures(root: Object3D): void {
    visitMaterials(root, material => {
        const residency = getMaterialResidency(material);
        const slots = residency.slots;
        if (!slots) return;

        let changed = false;
        for (const slot of TEXTURE_SLOTS) {
            const texture = slots[slot];
            if (!texture) continue;
            material[slot] = texture;
            texture.needsUpdate = true;
            changed = true;
        }

        if (changed) {
            material.needsUpdate = true;
        }
        delete residency.slots;
    });
}

function clearMaterialTextureSlot(
    material: TextureMaterial,
    slot: TextureSlot,
    disposeTexture: boolean,
    options: Required<TextureResidencyOptions>,
    textureOwners: Map<string, Set<string>>,
): void {
    const texture = material[slot];
    if (!isTexture(texture)) return;

    const residency = getMaterialResidency(material);
    residency.slots ??= {};
    residency.slots[slot] ??= texture;
    material[slot] = null;
    material.needsUpdate = true;

    if (!disposeTexture) return;
    if (options.protectSharedTextures && (textureOwners.get(texture.uuid)?.size ?? 1) > 1) return;
    texture.dispose();
}

function isMaterialProtected(
    material: Material,
    root: Object3D,
    options: Required<TextureResidencyOptions>,
    materialOwners: Map<string, Set<string>>,
): boolean {
    if (!options.protectSharedMaterials) return false;
    const owners = materialOwners.get(material.uuid);
    return !!owners && owners.size > 1 && owners.has(root.uuid);
}

function collectTextureResidencyInfo(root: Object3D): TextureResidencyCollection {
    const info: TextureResidencyCollection = {
        materials: new Set<Material>(),
        textures: new Set<Texture>(),
        residentTextures: new Set<Texture>(),
    };
    visitMaterials(root, material => {
        info.materials.add(material);
        addMaterialTextures(material, info.textures);
        addResidentMaterialTextures(material, info.residentTextures);
    });
    return info;
}

async function collectTextureResidencyInfoProgressive(
    root: Object3D,
    options: TextureResidencyRebuildProgressOptions = {},
): Promise<TextureResidencyCollection> {
    const maybeYield = createProgressiveYieldController(options, {
        batchSize: TEXTURE_RESIDENCY_REBUILD_BATCH_SIZE,
        frameBudgetMs: TEXTURE_RESIDENCY_REBUILD_FRAME_BUDGET_MS,
    });
    const info: TextureResidencyCollection = {
        materials: new Set<Material>(),
        textures: new Set<Texture>(),
        residentTextures: new Set<Texture>(),
    };
    const stack: Object3D[] = [root];

    while (stack.length > 0) {
        const child = stack.pop();
        if (!child) {
            await maybeYield();
            continue;
        }

        const material = (child as Mesh).material;
        if (material) {
            if (Array.isArray(material)) {
                for (const item of material) {
                    if (!item) continue;
                    info.materials.add(item);
                    addMaterialTextures(item, info.textures);
                    addResidentMaterialTextures(item, info.residentTextures);
                }
            } else {
                info.materials.add(material);
                addMaterialTextures(material, info.textures);
                addResidentMaterialTextures(material, info.residentTextures);
            }
        }

        for (let i = child.children.length - 1; i >= 0; i--) {
            const nested = child.children[i];
            if (nested) stack.push(nested);
        }

        await maybeYield();
    }

    return info;
}

function visitMaterials(root: Object3D, visitor: (material: TextureMaterial) => void): void {
    traverseObjectDepthFirst(root, child => {
        const material = (child as Mesh).material;
        if (!material) return;
        if (Array.isArray(material)) {
            for (const item of material) {
                if (item) visitor(item);
            }
        } else {
            visitor(material);
        }
    });
}

function addMaterialTextures(material: TextureMaterial, textures: Set<Texture>): void {
    for (const slot of TEXTURE_SLOTS) {
        const texture = material[slot];
        if (isTexture(texture)) {
            textures.add(texture);
        }
    }

    const savedSlots = getMaterialResidency(material).slots;
    if (savedSlots) {
        for (const texture of Object.values(savedSlots)) {
            if (isTexture(texture)) {
                textures.add(texture);
            }
        }
    }
}

function addResidentMaterialTextures(material: TextureMaterial, textures: Set<Texture>): void {
    for (const slot of TEXTURE_SLOTS) {
        const texture = material[slot];
        if (isTexture(texture)) {
            textures.add(texture);
        }
    }
}

function getMaterialResidency(material: Material): MaterialTextureResidency {
    const data = material.userData as {textureResidency?: MaterialTextureResidency};
    data.textureResidency ??= {};
    return data.textureResidency;
}

function addOwner(map: Map<string, Set<string>>, key: string, owner: string): void {
    let owners = map.get(key);
    if (!owners) {
        owners = new Set<string>();
        map.set(key, owners);
    }
    owners.add(owner);
}

function isTextureResidencyExplicitlyDisabled(object: Object3D): boolean {
    return getTextureResidencyMetadata(object)?.enabled === false;
}

function getObjectAvatarState(object: Object3D): {state: AvatarBudgetState; isLocal: boolean} | null {
    const metadata = getAvatarBudgetMetadata(object);
    if (metadata?.enabled !== true) return null;
    return {
        state: metadata.lastState ?? (object.userData.avatarBudgetState as AvatarBudgetState | undefined) ?? "full",
        isLocal: metadata.isLocal === true,
    };
}

function getObjectPlotState(object: Object3D): PlotBudgetState | null {
    const metadata = getPlotBudgetMetadata(object);
    if (metadata?.enabled !== true) return null;
    return metadata.state ?? (object.userData.plotBudgetState as PlotBudgetState | undefined) ?? "near";
}

function isTexture(value: unknown): value is Texture {
    return !!value && (value as Texture).isTexture === true;
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

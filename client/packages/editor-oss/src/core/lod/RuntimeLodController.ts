import {
    Box3,
    Camera,
    Matrix4,
    MathUtils,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Quaternion,
    Sphere,
    Vector3,
} from "three";

import {DEFAULT_LOD_DISTANCES} from "../quality/constants";

export type RuntimeLodGroupId = string;
export type RuntimeLodLevelId = string;

export interface RuntimeLodLevel {
    id: RuntimeLodLevelId;
    object?: Object3D;
    maxDistance?: number;
    minScreenHeightRatio?: number;
}

export interface RuntimeLodGroupRegistration {
    id: RuntimeLodGroupId;
    levels: RuntimeLodLevel[];
    root?: Object3D;
    bounds?: Sphere | Box3;
    initialLevel?: number | RuntimeLodLevelId;
    enabled?: boolean;
    isLevelResident?: (group: RuntimeLodGroupSnapshot, level: RuntimeLodLevel) => boolean;
    onLevelApplied?: (event: RuntimeLodTransitionEvent) => void;
}

export interface RuntimeLodGroupSnapshot {
    id: RuntimeLodGroupId;
    currentLevelIndex: number;
    currentLevelId: RuntimeLodLevelId;
    targetLevelIndex: number;
    targetLevelId: RuntimeLodLevelId;
    distance: number;
    screenHeightRatio: number;
}

export interface RuntimeLodTransitionEvent extends RuntimeLodGroupSnapshot {
    previousLevelIndex: number;
    previousLevelId: RuntimeLodLevelId;
}

export interface RuntimeLodUpdateOptions {
    enabled?: boolean;
    maxTransitions?: number;
}

export interface RuntimeLodControllerOptions {
    enabled?: boolean;
    maxTransitionsPerFrame?: number;
    hysteresisRatio?: number;
    defaultDistances?: readonly number[];
    now?: () => number;
}

export interface RuntimeLodDiagnostics {
    registeredGroups: number;
    enabledGroups: number;
    currentTierCounts: number[];
    pendingTransitions: number;
    appliedTransitions: number;
    skippedTransitions: number;
    residencyBlockedTransitions: number;
    missingInputGroups: number;
    disabledGroups: number;
    lastUpdateCostMs: number;
    lastUpdateSerial: number;
}

export interface RuntimeLodGroupHandle {
    id: RuntimeLodGroupId;
    unregister: () => boolean;
}

interface RuntimeLodGroup {
    id: RuntimeLodGroupId;
    levels: RuntimeLodLevel[];
    thresholds: number[];
    root?: Object3D;
    sphere: Sphere | null;
    enabled: boolean;
    currentLevelIndex: number;
    originalVisibility: boolean[];
    isLevelResident?: (group: RuntimeLodGroupSnapshot, level: RuntimeLodLevel) => boolean;
    onLevelApplied?: (event: RuntimeLodTransitionEvent) => void;
}

interface RuntimeLodCandidate {
    group: RuntimeLodGroup;
    targetLevelIndex: number;
    distance: number;
    screenHeightRatio: number;
    priority: number;
}

const DEFAULT_MAX_TRANSITIONS_PER_FRAME = 8;
const DEFAULT_HYSTERESIS_RATIO = 0.12;
const MIN_DISTANCE = 0.0001;

export class RuntimeLodController {
    private readonly groups = new Map<RuntimeLodGroupId, RuntimeLodGroup>();
    private readonly candidates: RuntimeLodCandidate[] = [];
    private readonly candidatePool: RuntimeLodCandidate[] = [];
    private readonly defaultDistances: readonly number[];
    private readonly now: () => number;
    private readonly scratchBox = new Box3();
    private readonly scratchInverseMatrix = new Matrix4();
    private readonly scratchSphere = new Sphere();
    private readonly scratchCenter = new Vector3();
    private readonly scratchCameraPosition = new Vector3();
    private readonly scratchPosition = new Vector3();
    private readonly scratchQuaternion = new Quaternion();
    private readonly scratchScale = new Vector3();
    private readonly diagnostics: RuntimeLodDiagnostics = {
        registeredGroups: 0,
        enabledGroups: 0,
        currentTierCounts: [],
        pendingTransitions: 0,
        appliedTransitions: 0,
        skippedTransitions: 0,
        residencyBlockedTransitions: 0,
        missingInputGroups: 0,
        disabledGroups: 0,
        lastUpdateCostMs: 0,
        lastUpdateSerial: 0,
    };
    private readonly scratchSnapshot: RuntimeLodGroupSnapshot = {
        id: "",
        currentLevelIndex: 0,
        currentLevelId: "",
        targetLevelIndex: 0,
        targetLevelId: "",
        distance: 0,
        screenHeightRatio: 0,
    };
    private readonly scratchTransitionEvent: RuntimeLodTransitionEvent = {
        id: "",
        currentLevelIndex: 0,
        currentLevelId: "",
        targetLevelIndex: 0,
        targetLevelId: "",
        distance: 0,
        screenHeightRatio: 0,
        previousLevelIndex: 0,
        previousLevelId: "",
    };
    private enabled: boolean;
    private maxTransitionsPerFrame: number;
    private hysteresisRatio: number;
    private updateSerial = 0;

    constructor(options: RuntimeLodControllerOptions = {}) {
        this.enabled = options.enabled ?? true;
        this.maxTransitionsPerFrame = sanitizeTransitionBudget(options.maxTransitionsPerFrame);
        this.hysteresisRatio = sanitizeHysteresis(options.hysteresisRatio);
        this.defaultDistances = normalizeDefaultDistances(options.defaultDistances ?? DEFAULT_LOD_DISTANCES);
        this.now = options.now ?? getDefaultNow;
    }

    registerGroup(registration: RuntimeLodGroupRegistration): RuntimeLodGroupHandle {
        if (!registration.id) {
            throw new Error("Runtime LOD group requires a stable id.");
        }
        if (this.groups.has(registration.id)) {
            throw new Error(`Runtime LOD group '${registration.id}' is already registered.`);
        }
        if (registration.levels.length === 0) {
            throw new Error(`Runtime LOD group '${registration.id}' requires at least one level.`);
        }

        const levels = registration.levels.slice();
        const currentLevelIndex = resolveInitialLevel(levels, registration.initialLevel);
        const sphere = this.createRuntimeSphere(registration.root, registration.bounds);
        const group: RuntimeLodGroup = {
            id: registration.id,
            levels,
            thresholds: createThresholds(levels, this.defaultDistances),
            root: registration.root,
            sphere,
            enabled: registration.enabled ?? true,
            currentLevelIndex,
            originalVisibility: levels.map(level => level.object?.visible ?? true),
            isLevelResident: registration.isLevelResident,
            onLevelApplied: registration.onLevelApplied,
        };

        this.groups.set(group.id, group);
        this.applyLevelVisibility(group, currentLevelIndex);

        return {
            id: group.id,
            unregister: () => this.unregisterGroup(group.id),
        };
    }

    unregisterGroup(id: RuntimeLodGroupId): boolean {
        const group = this.groups.get(id);
        if (!group) return false;

        this.restoreOriginalVisibility(group);
        this.groups.delete(id);
        return true;
    }

    setGroupEnabled(id: RuntimeLodGroupId, enabled: boolean): boolean {
        const group = this.groups.get(id);
        if (!group) return false;
        group.enabled = enabled;
        return true;
    }

    setGroupThresholds(id: RuntimeLodGroupId, distances: readonly number[]): boolean {
        const group = this.groups.get(id);
        if (!group) return false;
        for (let index = 0; index < group.thresholds.length; index++) {
            group.thresholds[index] = Math.max(MIN_DISTANCE, distances[index] ?? group.thresholds[index] ?? MIN_DISTANCE);
        }
        return true;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    setMaxTransitionsPerFrame(maxTransitions: number): void {
        this.maxTransitionsPerFrame = sanitizeTransitionBudget(maxTransitions);
    }

    setHysteresisRatio(hysteresisRatio: number): void {
        this.hysteresisRatio = sanitizeHysteresis(hysteresisRatio);
    }

    update(camera: Camera | null | undefined, options: RuntimeLodUpdateOptions = {}): void {
        const start = this.now();
        this.resetFrameDiagnostics();
        this.diagnostics.registeredGroups = this.groups.size;
        this.updateSerial += 1;
        this.diagnostics.lastUpdateSerial = this.updateSerial;

        const effectiveEnabled = this.enabled && (options.enabled ?? true);
        if (!effectiveEnabled || !camera) {
            this.diagnostics.disabledGroups = effectiveEnabled ? 0 : this.groups.size;
            if (!camera) this.diagnostics.missingInputGroups = this.groups.size;
            this.rebuildCurrentTierCounts();
            this.finishDiagnostics(start);
            return;
        }

        this.candidates.length = 0;
        camera.getWorldPosition(this.scratchCameraPosition);

        for (const group of this.groups.values()) {
            if (!group.enabled) {
                this.diagnostics.disabledGroups += 1;
                continue;
            }

            this.diagnostics.enabledGroups += 1;
            const evaluation = this.evaluateGroup(group, camera);
            if (!evaluation) {
                this.diagnostics.missingInputGroups += 1;
                continue;
            }

            const {distance, screenHeightRatio} = evaluation;
            const targetLevelIndex = this.chooseTargetLevel(group, distance, screenHeightRatio);
            if (targetLevelIndex === group.currentLevelIndex) continue;

            const snapshot = this.fillSnapshot(this.scratchSnapshot, group, targetLevelIndex, distance, screenHeightRatio);
            const targetLevel = group.levels[targetLevelIndex]!;
            if (group.isLevelResident && !group.isLevelResident(snapshot, targetLevel)) {
                this.diagnostics.residencyBlockedTransitions += 1;
                continue;
            }

            const candidate = this.getCandidate(this.candidates.length);
            candidate.group = group;
            candidate.targetLevelIndex = targetLevelIndex;
            candidate.distance = distance;
            candidate.screenHeightRatio = screenHeightRatio;
            candidate.priority = computeTransitionPriority(group.currentLevelIndex, targetLevelIndex, distance, screenHeightRatio);
            this.candidates.push(candidate);
        }

        if (this.candidates.length > 1) {
            this.candidates.sort(compareCandidates);
        }

        const maxTransitions = sanitizeTransitionBudget(options.maxTransitions ?? this.maxTransitionsPerFrame);
        const applyCount = Math.min(maxTransitions, this.candidates.length);
        for (let i = 0; i < applyCount; i++) {
            this.applyCandidate(this.candidates[i]!);
        }

        this.diagnostics.pendingTransitions = Math.max(0, this.candidates.length - applyCount);
        this.diagnostics.skippedTransitions = this.diagnostics.pendingTransitions;
        this.rebuildCurrentTierCounts();
        this.finishDiagnostics(start);
    }

    getDiagnostics(): RuntimeLodDiagnostics {
        return {
            ...this.diagnostics,
            currentTierCounts: this.diagnostics.currentTierCounts.slice(),
        };
    }

    getCurrentLevelIndex(id: RuntimeLodGroupId): number | undefined {
        return this.groups.get(id)?.currentLevelIndex;
    }

    dispose(): void {
        for (const group of this.groups.values()) {
            this.restoreOriginalVisibility(group);
        }
        this.groups.clear();
        this.candidates.length = 0;
        this.candidatePool.length = 0;
        this.resetFrameDiagnostics();
        this.diagnostics.registeredGroups = 0;
    }

    private createRuntimeSphere(root: Object3D | undefined, bounds: Sphere | Box3 | undefined): Sphere | null {
        if (bounds instanceof Sphere) {
            return bounds.clone();
        }
        if (bounds instanceof Box3) {
            return bounds.getBoundingSphere(new Sphere());
        }
        if (!root) {
            return null;
        }

        this.scratchBox.setFromObject(root);
        if (this.scratchBox.isEmpty()) {
            return null;
        }
        const worldSphere = this.scratchBox.getBoundingSphere(new Sphere());
        return this.convertWorldSphereToRootLocal(root, worldSphere);
    }

    private convertWorldSphereToRootLocal(root: Object3D, worldSphere: Sphere): Sphere {
        root.updateWorldMatrix(true, false);
        root.matrixWorld.decompose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
        const maxScale = Math.max(
            Math.abs(this.scratchScale.x),
            Math.abs(this.scratchScale.y),
            Math.abs(this.scratchScale.z),
            MIN_DISTANCE,
        );

        this.scratchInverseMatrix.copy(root.matrixWorld).invert();
        worldSphere.center.applyMatrix4(this.scratchInverseMatrix);
        worldSphere.radius /= maxScale;
        return worldSphere;
    }

    private evaluateGroup(
        group: RuntimeLodGroup,
        camera: Camera,
    ): {distance: number; screenHeightRatio: number} | null {
        if (!group.sphere) return null;

        const worldSphere = this.scratchSphere.copy(group.sphere);
        if (group.root) {
            this.scratchCenter.copy(group.sphere.center).applyMatrix4(group.root.matrixWorld);
            group.root.matrixWorld.decompose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
            const maxScale = Math.max(Math.abs(this.scratchScale.x), Math.abs(this.scratchScale.y), Math.abs(this.scratchScale.z));
            worldSphere.center.copy(this.scratchCenter);
            worldSphere.radius = group.sphere.radius * maxScale;
        }

        const distance = Math.max(MIN_DISTANCE, this.scratchCameraPosition.distanceTo(worldSphere.center));
        const screenHeightRatio = computeProjectedScreenHeightRatio(camera, distance, worldSphere.radius);
        if (!Number.isFinite(distance) || !Number.isFinite(screenHeightRatio)) return null;

        return {distance, screenHeightRatio};
    }

    private chooseTargetLevel(group: RuntimeLodGroup, distance: number, screenHeightRatio: number): number {
        let distanceTarget = 0;
        for (let boundaryIndex = 0; boundaryIndex < group.thresholds.length; boundaryIndex++) {
            const threshold = group.thresholds[boundaryIndex]!;
            const adjustedThreshold =
                group.currentLevelIndex <= boundaryIndex
                    ? threshold * (1 + this.hysteresisRatio)
                    : threshold * Math.max(0, 1 - this.hysteresisRatio);
            if (distance > adjustedThreshold) {
                distanceTarget = boundaryIndex + 1;
            }
        }

        let screenTarget = 0;
        let hasScreenThreshold = false;
        for (let index = 0; index < group.levels.length; index++) {
            const level = group.levels[index]!;
            if (level.minScreenHeightRatio === undefined) continue;
            hasScreenThreshold = true;
            const threshold = Math.max(0, level.minScreenHeightRatio);
            const adjustedThreshold =
                group.currentLevelIndex <= index
                    ? threshold * Math.max(0, 1 - this.hysteresisRatio)
                    : threshold * (1 + this.hysteresisRatio);
            if (screenHeightRatio >= adjustedThreshold) {
                screenTarget = index;
                break;
            }
            screenTarget = index;
        }

        const target = hasScreenThreshold ? Math.max(distanceTarget, screenTarget) : distanceTarget;
        return MathUtils.clamp(target, 0, group.levels.length - 1);
    }

    private applyCandidate(candidate: RuntimeLodCandidate): void {
        const {group, targetLevelIndex, distance, screenHeightRatio} = candidate;
        const previousLevelIndex = group.currentLevelIndex;
        if (previousLevelIndex === targetLevelIndex) return;

        group.currentLevelIndex = targetLevelIndex;
        this.applyLevelVisibility(group, targetLevelIndex);
        this.diagnostics.appliedTransitions += 1;

        if (group.onLevelApplied) {
            const event = this.fillTransitionEvent(
                group,
                targetLevelIndex,
                distance,
                screenHeightRatio,
                previousLevelIndex,
            );
            group.onLevelApplied(event);
        }
    }

    private applyLevelVisibility(group: RuntimeLodGroup, visibleLevelIndex: number): void {
        for (let index = 0; index < group.levels.length; index++) {
            const object = group.levels[index]!.object;
            if (object) object.visible = index === visibleLevelIndex;
        }
    }

    private restoreOriginalVisibility(group: RuntimeLodGroup): void {
        for (let index = 0; index < group.levels.length; index++) {
            const object = group.levels[index]!.object;
            if (object) object.visible = group.originalVisibility[index] ?? true;
        }
    }

    private fillSnapshot<T extends RuntimeLodGroupSnapshot>(
        target: T,
        group: RuntimeLodGroup,
        targetLevelIndex: number,
        distance: number,
        screenHeightRatio: number,
    ): T {
        target.id = group.id;
        target.currentLevelIndex = group.currentLevelIndex;
        target.currentLevelId = group.levels[group.currentLevelIndex]!.id;
        target.targetLevelIndex = targetLevelIndex;
        target.targetLevelId = group.levels[targetLevelIndex]!.id;
        target.distance = distance;
        target.screenHeightRatio = screenHeightRatio;
        return target;
    }

    private fillTransitionEvent(
        group: RuntimeLodGroup,
        targetLevelIndex: number,
        distance: number,
        screenHeightRatio: number,
        previousLevelIndex: number,
    ): RuntimeLodTransitionEvent {
        const event = this.fillSnapshot(this.scratchTransitionEvent, group, targetLevelIndex, distance, screenHeightRatio);
        event.previousLevelIndex = previousLevelIndex;
        event.previousLevelId = group.levels[previousLevelIndex]!.id;
        return event;
    }

    private getCandidate(index: number): RuntimeLodCandidate {
        let candidate = this.candidatePool[index];
        if (!candidate) {
            candidate = {
                group: undefined as unknown as RuntimeLodGroup,
                targetLevelIndex: 0,
                distance: 0,
                screenHeightRatio: 0,
                priority: 0,
            };
            this.candidatePool[index] = candidate;
        }
        return candidate;
    }

    private countCurrentTier(tier: number): void {
        this.diagnostics.currentTierCounts[tier] = (this.diagnostics.currentTierCounts[tier] ?? 0) + 1;
    }

    private rebuildCurrentTierCounts(): void {
        this.diagnostics.currentTierCounts.length = 0;
        for (const group of this.groups.values()) {
            this.countCurrentTier(group.currentLevelIndex);
        }
    }

    private resetFrameDiagnostics(): void {
        this.diagnostics.enabledGroups = 0;
        this.diagnostics.currentTierCounts.length = 0;
        this.diagnostics.pendingTransitions = 0;
        this.diagnostics.appliedTransitions = 0;
        this.diagnostics.skippedTransitions = 0;
        this.diagnostics.residencyBlockedTransitions = 0;
        this.diagnostics.missingInputGroups = 0;
        this.diagnostics.disabledGroups = 0;
        this.diagnostics.lastUpdateCostMs = 0;
    }

    private finishDiagnostics(start: number): void {
        const elapsed = this.now() - start;
        this.diagnostics.lastUpdateCostMs = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    }
}

export type RuntimeLodAdapter = Pick<
    RuntimeLodController,
    | "registerGroup"
    | "unregisterGroup"
    | "setGroupEnabled"
    | "setGroupThresholds"
    | "setHysteresisRatio"
    | "update"
    | "getDiagnostics"
    | "getCurrentLevelIndex"
    | "dispose"
>;

export function createRuntimeLodAdapter(options?: RuntimeLodControllerOptions): RuntimeLodAdapter {
    return new RuntimeLodController(options);
}

function computeProjectedScreenHeightRatio(camera: Camera, distance: number, radius: number): number {
    const diameter = Math.max(0, radius * 2);
    if (diameter === 0) return 0;

    if (camera instanceof PerspectiveCamera) {
        const verticalFov = MathUtils.degToRad(camera.fov);
        const visibleHeight = 2 * Math.tan(verticalFov / 2) * Math.max(MIN_DISTANCE, distance);
        return diameter / Math.max(MIN_DISTANCE, visibleHeight);
    }

    if (camera instanceof OrthographicCamera) {
        const visibleHeight = Math.max(MIN_DISTANCE, (camera.top - camera.bottom) / Math.max(MIN_DISTANCE, camera.zoom));
        return diameter / visibleHeight;
    }

    return 0;
}

function createThresholds(levels: RuntimeLodLevel[], defaultDistances: readonly number[]): number[] {
    const thresholds: number[] = [];
    for (let index = 0; index < levels.length - 1; index++) {
        thresholds.push(
            Math.max(
                MIN_DISTANCE,
                levels[index]!.maxDistance ?? defaultDistances[Math.min(index, defaultDistances.length - 1)] ?? 50,
            ),
        );
    }
    return thresholds;
}

function normalizeDefaultDistances(distances: readonly number[]): number[] {
    const normalized = distances.filter(distance => Number.isFinite(distance) && distance > 0).sort((a, b) => a - b);
    return normalized.length > 0 ? normalized : [50, 150, 300, 500];
}

function resolveInitialLevel(levels: RuntimeLodLevel[], initialLevel: number | RuntimeLodLevelId | undefined): number {
    if (typeof initialLevel === "string") {
        const index = levels.findIndex(level => level.id === initialLevel);
        return index >= 0 ? index : 0;
    }
    if (typeof initialLevel === "number") {
        return MathUtils.clamp(Math.trunc(initialLevel), 0, levels.length - 1);
    }
    return 0;
}

function sanitizeTransitionBudget(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_TRANSITIONS_PER_FRAME;
    return Math.max(0, Math.trunc(value));
}

function sanitizeHysteresis(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) return DEFAULT_HYSTERESIS_RATIO;
    return MathUtils.clamp(value, 0, 0.9);
}

function computeTransitionPriority(
    currentLevelIndex: number,
    targetLevelIndex: number,
    distance: number,
    screenHeightRatio: number,
): number {
    const tierDelta = Math.abs(targetLevelIndex - currentLevelIndex);
    const upgradeUrgency = targetLevelIndex < currentLevelIndex ? 2 : 1;
    return tierDelta * 1_000_000 + upgradeUrgency * 10_000 + screenHeightRatio * 1_000 + 1 / Math.max(MIN_DISTANCE, distance);
}

function compareCandidates(a: RuntimeLodCandidate, b: RuntimeLodCandidate): number {
    return b.priority - a.priority || a.group.id.localeCompare(b.group.id);
}

function getDefaultNow(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

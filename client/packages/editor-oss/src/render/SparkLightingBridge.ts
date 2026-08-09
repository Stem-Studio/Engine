import {
    SplatEdit,
    SplatEditRgbaBlendMode,
    SplatEditSdf,
    SplatEditSdfType,
} from '@querielo/spark';
import {
    AmbientLight,
    Color,
    DirectionalLight,
    HemisphereLight,
    Light,
    Object3D,
    PointLight,
    Quaternion,
    Scene,
    SpotLight,
    Vector3,
} from 'three';
import {findObjectByNameDepthFirst, traverseObjectVisibleDepthFirst} from '@stem/editor-oss/utils/SceneTraverser';

const SPARK_LIGHTING_ROOT_NAME = '__SparkDynamicLighting';
const DEFAULT_MAX_LIGHTS = 16;
const DEFAULT_POINT_RADIUS = 5;
const DEFAULT_POINT_INTENSITY_SCALE = 0.008;
const DEFAULT_SPOT_INTENSITY_SCALE = 0.02;
const DEFAULT_GLOBAL_INTENSITY_SCALE = 0.08;
const DEFAULT_AMBIENT_INTENSITY_SCALE = 0.1;
const DEFAULT_MAX_OPACITY = 1;
const DEFAULT_SDF_SMOOTH = 0.1;
const DEFAULT_SOFT_EDGE = 1.4;
const DEFAULT_INCLUDE_AMBIENT = false;
const DEFAULT_INCLUDE_DIRECTIONAL = false;
const DEFAULT_SCAN_INTERVAL_MS = 250;
const SPOT_CONE_FORWARD = new Vector3(0, 0, -1);

type SparkLightingOptions = {
    enabled?: boolean;
    maxLights?: number;
    defaultRadius?: number;
    radiusMultiplier?: number;
    intensityScale?: number;
    pointIntensityScale?: number;
    spotIntensityScale?: number;
    globalIntensityScale?: number;
    ambientIntensityScale?: number;
    maxOpacity?: number;
    sdfSmooth?: number;
    softEdge?: number;
    includeAmbient?: boolean;
    includeDirectional?: boolean;
    scanIntervalMs?: number;
};

type SparkLightOverrides = {
    enabled?: boolean;
    angle?: number;
    radius?: number;
    opacity?: number;
    intensityScale?: number;
    maxOpacity?: number;
    color?: Color | string | number;
    sdfSmooth?: number;
    softEdge?: number;
};

type LightUserData = Record<string, unknown> & {
    sparkLighting?: SparkLightOverrides;
    sparkSplatLightRadius?: number;
    sparkSplatLightOpacity?: number;
};

type ManagedSparkLight = {
    edit: SplatEdit;
    sdf: SplatEditSdf;
    singleSdfs: SplatEditSdf[];
    spotSdfs: SplatEditSdf[] | null;
    rangeSdf: SplatEditSdf | null;
};

type ResolvedSparkLightingSettings = Required<SparkLightingOptions>;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const readNumber = (value: unknown, fallback: number, min = -Infinity, max = Infinity): number => {
    if (!isFiniteNumber(value)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, value));
};

const readBoolean = (value: unknown, fallback: boolean): boolean => {
    return typeof value === 'boolean' ? value : fallback;
};

const isVisibleInScene = (object: Object3D): boolean => {
    let current: Object3D | null = object;
    while (current) {
        if (!current.visible) {
            return false;
        }
        current = current.parent;
    }
    return true;
};

const isVisibleGaussianSplat = (object: Object3D): boolean => {
    return object.userData?.__isGaussianSplat === true
        || object.userData?.gaussianSplatFormat
        || object.userData?.type === 'GaussianSplat'
        || object.type === 'SplatMesh';
};

const resolveSceneSettings = (scene: Scene): ResolvedSparkLightingSettings => {
    const splatSettings = scene.userData?.rendering?.splat;
    const rawLightingSettings = (
        splatSettings && typeof splatSettings === 'object' && 'lighting' in splatSettings
            ? (splatSettings as {lighting?: SparkLightingOptions}).lighting
            : undefined
    ) ?? {};
    const lightingSettings = typeof rawLightingSettings === 'object' && rawLightingSettings !== null
        ? rawLightingSettings
        : {};

    return {
        enabled: lightingSettings.enabled !== false,
        maxLights: Math.floor(readNumber(lightingSettings.maxLights, DEFAULT_MAX_LIGHTS, 0, 64)),
        defaultRadius: readNumber(lightingSettings.defaultRadius, DEFAULT_POINT_RADIUS, 0.01, 1000),
        radiusMultiplier: readNumber(lightingSettings.radiusMultiplier, 1, 0.01, 100),
        intensityScale: readNumber(lightingSettings.intensityScale, DEFAULT_POINT_INTENSITY_SCALE, 0, 10),
        pointIntensityScale: readNumber(
            lightingSettings.pointIntensityScale,
            readNumber(lightingSettings.intensityScale, DEFAULT_POINT_INTENSITY_SCALE, 0, 10),
            0,
            10,
        ),
        spotIntensityScale: readNumber(
            lightingSettings.spotIntensityScale,
            readNumber(lightingSettings.intensityScale, DEFAULT_SPOT_INTENSITY_SCALE, 0, 10),
            0,
            10,
        ),
        globalIntensityScale: readNumber(
            lightingSettings.globalIntensityScale,
            DEFAULT_GLOBAL_INTENSITY_SCALE,
            0,
            10,
        ),
        ambientIntensityScale: readNumber(
            lightingSettings.ambientIntensityScale,
            DEFAULT_AMBIENT_INTENSITY_SCALE,
            0,
            10,
        ),
        maxOpacity: readNumber(lightingSettings.maxOpacity, DEFAULT_MAX_OPACITY, 0, 10),
        sdfSmooth: readNumber(lightingSettings.sdfSmooth, DEFAULT_SDF_SMOOTH, 0, 100),
        softEdge: readNumber(lightingSettings.softEdge, DEFAULT_SOFT_EDGE, 0, 1000),
        includeAmbient: readBoolean(lightingSettings.includeAmbient, DEFAULT_INCLUDE_AMBIENT),
        includeDirectional: readBoolean(lightingSettings.includeDirectional, DEFAULT_INCLUDE_DIRECTIONAL),
        scanIntervalMs: readNumber(lightingSettings.scanIntervalMs, DEFAULT_SCAN_INTERVAL_MS, 0, 10000),
    };
};

const getLightOverrides = (light: Light): SparkLightOverrides => {
    const lightUserData = light.userData as LightUserData | undefined;
    return lightUserData?.sparkLighting && typeof lightUserData.sparkLighting === 'object'
        ? lightUserData.sparkLighting
        : {};
};

const getLightColor = (light: Light, overrides: SparkLightOverrides, targetColor: Color): Color => {
    targetColor.copy(light.color);

    if (light instanceof HemisphereLight) {
        targetColor.lerp(light.groundColor, 0.5);
    }

    if (overrides.color instanceof Color) {
        targetColor.copy(overrides.color);
    } else if (typeof overrides.color === 'string' || typeof overrides.color === 'number') {
        targetColor.set(overrides.color);
    }

    return targetColor;
};

const isGlobalLight = (light: Light): boolean => {
    return light instanceof AmbientLight || light instanceof HemisphereLight || light instanceof DirectionalLight;
};

const isSupportedLight = (
    light: Light,
    settings: ResolvedSparkLightingSettings,
    overrides: SparkLightOverrides,
): boolean => {
    if (light instanceof AmbientLight || light instanceof HemisphereLight) {
        return overrides.enabled === true || settings.includeAmbient;
    }

    if (light instanceof DirectionalLight) {
        return overrides.enabled === true || settings.includeDirectional;
    }

    return light instanceof PointLight || light instanceof SpotLight || light.isLight === true;
};

const getLightRadius = (
    light: Light,
    settings: ResolvedSparkLightingSettings,
    overrides: SparkLightOverrides,
): number => {
    const lightUserData = light.userData as LightUserData | undefined;
    const configuredRadius = overrides.radius ?? lightUserData?.sparkSplatLightRadius;
    if (isFiniteNumber(configuredRadius)) {
        return Math.max(0.01, configuredRadius);
    }

    const distance = light instanceof PointLight || light instanceof SpotLight ? light.distance : 0;
    const baseRadius = distance > 0 ? distance : settings.defaultRadius * Math.max(1, Math.sqrt(light.intensity));
    return Math.max(0.01, baseRadius * settings.radiusMultiplier);
};

const getSpotConeRadius = (light: SpotLight, overrides: SparkLightOverrides): number => {
    const angle = readNumber(overrides.angle, light.angle, 0.001, Math.PI / 2);
    return (4 * angle) / Math.PI;
};

const getPointFalloffRadius = (lightRadius: number): number => {
    return Math.max(0.01, lightRadius * 0.5);
};

const getPointFalloffSoftEdge = (lightRadius: number): number => {
    return Math.max(0.01, lightRadius);
};

const getLightStrength = (
    light: Light,
    settings: ResolvedSparkLightingSettings,
    overrides: SparkLightOverrides,
): number => {
    const lightUserData = light.userData as LightUserData | undefined;
    const maxOpacity = readNumber(overrides.maxOpacity, settings.maxOpacity, 0, 10);
    const configuredOpacity = overrides.opacity ?? lightUserData?.sparkSplatLightOpacity;
    if (isFiniteNumber(configuredOpacity)) {
        return Math.min(maxOpacity, Math.max(0, configuredOpacity));
    }

    const fallbackScale = light instanceof AmbientLight || light instanceof HemisphereLight
        ? settings.ambientIntensityScale
        : isGlobalLight(light)
            ? settings.globalIntensityScale
            : light instanceof SpotLight
                ? settings.spotIntensityScale
                : light instanceof PointLight
                    ? settings.pointIntensityScale
                    : settings.intensityScale;
    const intensityScale = readNumber(overrides.intensityScale, fallbackScale, 0, 10);
    return Math.min(maxOpacity, Math.max(0, light.intensity * intensityScale));
};

export class SparkSceneLightingBridge {
    private readonly scene: Scene;
    private readonly root: Object3D;
    private readonly lightEntries = new Map<string, ManagedSparkLight>();
    private readonly discoveredLights: Light[] = [];
    private readonly activeLightIds = new Set<string>();
    private hasVisibleSplat = false;
    private readonly worldPosition = new Vector3();
    private readonly localPosition = new Vector3();
    private readonly targetWorldPosition = new Vector3();
    private readonly targetLocalPosition = new Vector3();
    private readonly spotDirection = new Vector3();
    private readonly worldQuaternion = new Quaternion();
    private readonly lightColor = new Color();
    private lastScanTime = -Infinity;

    constructor(scene: Scene, parent?: Object3D | null) {
        this.scene = scene;
        const existingRoot = findObjectByNameDepthFirst(scene, SPARK_LIGHTING_ROOT_NAME);
        this.root = existingRoot ?? new Object3D();
        this.root.name = SPARK_LIGHTING_ROOT_NAME;
        this.root.userData.isRuntimeOnly = true;
        this.root.userData.sparkLighting = true;
        this.root.clear();

        const targetParent = parent ?? scene;
        if (this.root.parent !== targetParent) {
            targetParent.add(this.root);
        }
    }

    update(): void {
        const settings = resolveSceneSettings(this.scene);
        if (!settings.enabled || settings.maxLights === 0) {
            this.root.visible = false;
            return;
        }

        this.root.visible = true;
        this.root.updateWorldMatrix(true, false);

        const now = globalThis.performance?.now() ?? Date.now();
        if (now - this.lastScanTime >= settings.scanIntervalMs) {
            this.scanLights();
            this.lastScanTime = now;
        }

        if (!this.hasVisibleSplat) {
            this.root.visible = false;
            for (const [lightId, managedLight] of this.lightEntries) {
                this.removeManagedLight(lightId, managedLight);
            }
            return;
        }

        this.activeLightIds.clear();
        let activeLightCount = 0;

        for (const light of this.discoveredLights) {
            if (activeLightCount >= settings.maxLights) {
                break;
            }

            if (light.parent === null || !isVisibleInScene(light)) {
                continue;
            }

            const overrides = getLightOverrides(light);
            if (light.userData?.isRuntimeOnly === true && overrides.enabled !== true) {
                continue;
            }

            if (overrides.enabled === false || !isSupportedLight(light, settings, overrides) || light.intensity <= 0) {
                continue;
            }

            const strength = getLightStrength(light, settings, overrides);
            if (strength <= 0) {
                continue;
            }

            const managedLight = this.ensureManagedLight(light.uuid);
            this.syncManagedLight(managedLight, light, settings, overrides, strength);
            this.activeLightIds.add(light.uuid);
            activeLightCount += 1;
        }

        for (const [lightId, managedLight] of this.lightEntries) {
            if (!this.activeLightIds.has(lightId)) {
                this.removeManagedLight(lightId, managedLight);
            }
        }
    }

    dispose(): void {
        for (const [lightId, managedLight] of this.lightEntries) {
            this.removeManagedLight(lightId, managedLight);
        }
        this.lightEntries.clear();
        this.discoveredLights.length = 0;
        this.activeLightIds.clear();
        this.root.removeFromParent();
    }

    private scanLights(): void {
        this.discoveredLights.length = 0;
        this.hasVisibleSplat = false;
        traverseObjectVisibleDepthFirst(this.scene, (object) => {
            if (object instanceof Light) {
                this.discoveredLights.push(object);
            }

            if (!this.hasVisibleSplat && isVisibleGaussianSplat(object)) {
                this.hasVisibleSplat = true;
            }
        });
    }

    private ensureManagedLight(lightId: string): ManagedSparkLight {
        const existingEntry = this.lightEntries.get(lightId);
        if (existingEntry) {
            return existingEntry;
        }

        const sdf = new SplatEditSdf({
            type: SplatEditSdfType.SPHERE,
            color: new Color(1, 1, 1),
            radius: DEFAULT_POINT_RADIUS,
            opacity: 0,
        });
        sdf.name = `${SPARK_LIGHTING_ROOT_NAME}:Sdf:${lightId}`;
        sdf.userData.isRuntimeOnly = true;
        sdf.userData.sparkLighting = true;

        const singleSdfs = [sdf];

        const edit = new SplatEdit({
            name: `${SPARK_LIGHTING_ROOT_NAME}:Edit:${lightId}`,
            rgbaBlendMode: SplatEditRgbaBlendMode.ADD_RGBA,
            sdfSmooth: DEFAULT_SDF_SMOOTH,
            softEdge: DEFAULT_SOFT_EDGE,
            sdfs: singleSdfs,
        });
        edit.userData.isRuntimeOnly = true;
        edit.userData.sparkLighting = true;
        edit.add(sdf);
        this.root.add(edit);

        const managedLight = {edit, sdf, singleSdfs, spotSdfs: null, rangeSdf: null};
        this.lightEntries.set(lightId, managedLight);
        return managedLight;
    }

    private removeManagedLight(lightId: string, managedLight: ManagedSparkLight): void {
        managedLight.edit.sdfs = [];
        managedLight.sdf.removeFromParent();
        managedLight.rangeSdf?.removeFromParent();
        managedLight.edit.removeFromParent();
        this.lightEntries.delete(lightId);
    }

    private syncSdfColor(sdf: SplatEditSdf, light: Light, overrides: SparkLightOverrides, strength: number): void {
        sdf.opacity = isFiniteNumber(overrides.opacity) ? Math.min(1, Math.max(0, overrides.opacity)) : 0;
        sdf.color
            .copy(getLightColor(light, overrides, this.lightColor))
            .multiplyScalar(strength);
    }

    private ensureRangeSdf(managedLight: ManagedSparkLight, lightId: string): SplatEditSdf {
        if (managedLight.rangeSdf) {
            return managedLight.rangeSdf;
        }

        const rangeSdf = new SplatEditSdf({
            type: SplatEditSdfType.SPHERE,
            color: new Color(1, 1, 1),
            radius: DEFAULT_POINT_RADIUS,
            opacity: 0,
        });
        rangeSdf.name = `${SPARK_LIGHTING_ROOT_NAME}:RangeSdf:${lightId}`;
        rangeSdf.userData.isRuntimeOnly = true;
        rangeSdf.userData.sparkLighting = true;
        managedLight.rangeSdf = rangeSdf;
        managedLight.spotSdfs = [managedLight.sdf, rangeSdf];
        managedLight.edit.add(rangeSdf);
        return rangeSdf;
    }

    private syncSpotLight(
        managedLight: ManagedSparkLight,
        light: SpotLight,
        settings: ResolvedSparkLightingSettings,
        overrides: SparkLightOverrides,
        strength: number,
    ): void {
        light.getWorldPosition(this.worldPosition);
        light.target.getWorldPosition(this.targetWorldPosition);
        if (this.worldPosition.distanceToSquared(this.targetWorldPosition) < 0.000001) {
            light.getWorldQuaternion(this.worldQuaternion);
            this.spotDirection.set(0, 0, -1).applyQuaternion(this.worldQuaternion);
            this.targetWorldPosition.copy(this.worldPosition).add(this.spotDirection);
        }

        const rangeSdf = this.ensureRangeSdf(managedLight, light.uuid);
        this.localPosition.copy(this.worldPosition);
        this.root.worldToLocal(this.localPosition);

        managedLight.edit.invert = true;
        managedLight.edit.sdfs = managedLight.spotSdfs;

        managedLight.sdf.visible = true;
        managedLight.sdf.type = SplatEditSdfType.INFINITE_CONE;
        managedLight.sdf.invert = true;
        managedLight.sdf.position.copy(this.localPosition);
        this.targetLocalPosition.copy(this.targetWorldPosition);
        this.root.worldToLocal(this.targetLocalPosition);
        this.spotDirection.subVectors(this.targetLocalPosition, this.localPosition);
        if (this.spotDirection.lengthSq() > 0) {
            managedLight.sdf.quaternion.setFromUnitVectors(SPOT_CONE_FORWARD, this.spotDirection.normalize());
        } else {
            managedLight.sdf.quaternion.identity();
        }
        managedLight.sdf.radius = getSpotConeRadius(light, overrides);
        this.syncSdfColor(managedLight.sdf, light, overrides, strength);

        rangeSdf.visible = true;
        rangeSdf.type = SplatEditSdfType.SPHERE;
        rangeSdf.invert = true;
        rangeSdf.position.copy(this.localPosition);
        rangeSdf.quaternion.identity();
        rangeSdf.radius = getLightRadius(light, settings, overrides);
        this.syncSdfColor(rangeSdf, light, overrides, strength);
    }

    private syncManagedLight(
        managedLight: ManagedSparkLight,
        light: Light,
        settings: ResolvedSparkLightingSettings,
        overrides: SparkLightOverrides,
        strength: number,
    ): void {
        const editSdfSmooth = readNumber(overrides.sdfSmooth, settings.sdfSmooth, 0, 100);
        const editSoftEdge = readNumber(overrides.softEdge, settings.softEdge, 0, 1000);
        managedLight.edit.sdfSmooth = editSdfSmooth;
        managedLight.edit.softEdge = editSoftEdge;
        managedLight.edit.invert = false;
        managedLight.edit.sdfs = managedLight.singleSdfs;
        if (managedLight.rangeSdf) {
            managedLight.rangeSdf.visible = false;
            managedLight.rangeSdf.invert = false;
        }

        managedLight.sdf.visible = true;
        managedLight.sdf.invert = false;
        this.syncSdfColor(managedLight.sdf, light, overrides, strength);

        if (isGlobalLight(light)) {
            managedLight.sdf.type = SplatEditSdfType.ALL;
            managedLight.sdf.radius = 0;
            managedLight.sdf.position.set(0, 0, 0);
            return;
        }

        if (light instanceof SpotLight) {
            this.syncSpotLight(managedLight, light, settings, overrides, strength);
            return;
        }

        light.getWorldPosition(this.worldPosition);
        this.localPosition.copy(this.worldPosition);
        this.root.worldToLocal(this.localPosition);
        managedLight.sdf.type = SplatEditSdfType.SPHERE;
        managedLight.sdf.position.copy(this.localPosition);
        const pointRadius = getLightRadius(light, settings, overrides);
        if (light instanceof PointLight && !isFiniteNumber(overrides.softEdge)) {
            managedLight.edit.softEdge = getPointFalloffSoftEdge(pointRadius);
            managedLight.sdf.radius = getPointFalloffRadius(pointRadius);
        } else {
            managedLight.sdf.radius = pointRadius;
        }
    }
}

export const createSparkSceneLightingBridge = (scene: Scene, parent?: Object3D | null): SparkSceneLightingBridge => {
    return new SparkSceneLightingBridge(scene, parent);
};

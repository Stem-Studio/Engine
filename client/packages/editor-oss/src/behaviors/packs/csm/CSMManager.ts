import { DirectionalLight, Group, Mesh, Object3D, Vector3 } from "three";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";

import CSMBehavior, { CSMParams } from "./CSMBehavior";
import global from "@stem/editor-oss/global";
import {getOrCreateDynamicRoot} from "@stem/editor-oss/scene/dynamicRoots";
import {findObjectByNameDepthFirst, traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

const RESERVED_TEXTURE_SLOTS = 12;
const CSM_MAX_FAR_SCALE = 1.2;

// Temp variables for updateBefore — avoids per-frame allocations
const _savedPos = /*@__PURE__*/ new Vector3();
const _savedTargetPos = /*@__PURE__*/ new Vector3();
const _worldPos = /*@__PURE__*/ new Vector3();
const _worldTargetPos = /*@__PURE__*/ new Vector3();

function matrixElementsMatch(previous: number[] | undefined, elements: ArrayLike<number> | undefined): boolean {
    if (!previous || !elements || previous.length !== elements.length) return false;
    for (let i = 0; i < elements.length; i++) {
        if (previous[i] !== elements[i]) return false;
    }
    return true;
}

function vectorElementsMatch(previous: number[] | undefined, vector: Vector3): boolean {
    return !!previous && previous.length === 3 &&
        previous[0] === vector.x && previous[1] === vector.y && previous[2] === vector.z;
}

export class ExtendedCSMShadowNode extends CSMShadowNode {
    private _disposed = false;
    private updateInputCache: {
        camera: object | null;
        cameraMatrix: number[];
        lightPosition: number[];
        targetPosition: number[];
        mapSizes: number[];
        lightMargin: number;
    } | null = null;

    invalidateUpdateCache(): void {
        this.updateInputCache = null;
    }

    private canReuseUpdateInputs(
        camera: any,
        lightPosition: Vector3,
        targetPosition: Vector3,
    ): boolean {
        const previous = this.updateInputCache;
        if (!previous || previous.camera !== camera || previous.lightMargin !== this.lightMargin) return false;
        if (!matrixElementsMatch(previous.cameraMatrix, camera?.matrixWorld?.elements)) return false;
        if (!vectorElementsMatch(previous.lightPosition, lightPosition)) return false;
        if (!vectorElementsMatch(previous.targetPosition, targetPosition)) return false;
        if (previous.mapSizes.length !== this.lights.length * 2) return false;
        for (let i = 0; i < this.lights.length; i++) {
            const mapSize = this.lights[i]?.shadow?.mapSize;
            if (!mapSize || previous.mapSizes[i * 2] !== mapSize.width || previous.mapSizes[i * 2 + 1] !== mapSize.height) {
                return false;
            }
            if (this.lights[i]?.parent === null || this.lights[i]?.target?.parent === null) return false;
        }
        return true;
    }

    private captureUpdateInputs(camera: any, lightPosition: Vector3, targetPosition: Vector3): void {
        const cameraElements = camera?.matrixWorld?.elements as ArrayLike<number> | undefined;
        this.updateInputCache = {
            camera,
            cameraMatrix: cameraElements ? Array.from(cameraElements) : [],
            lightPosition: lightPosition.toArray(),
            targetPosition: targetPosition.toArray(),
            mapSizes: this.lights.flatMap(light => [light.shadow?.mapSize?.width ?? 0, light.shadow?.mapSize?.height ?? 0]),
            lightMargin: this.lightMargin,
        };
    }

    _init(args: any) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error: _init exists at runtime but is not declared in the type definitions
        super._init(args);

        if (global.app && global.app.scene) {
            const parent: Object3D = getOrCreateDynamicRoot(global.app.scene);

            let csmRoot = findObjectByNameDepthFirst(parent, "CSM_Root") as Group | null;
            if (!csmRoot) {
                csmRoot = new Group();
                csmRoot.name = "CSM_Root";
                parent.add(csmRoot);
            }

            const lights = this.lights as DirectionalLight[];
            if (lights) {
                for (const light of lights) {
                    csmRoot.add(light.target);
                    csmRoot.add(light);
                }
            }
        }
    }

    /**
     * Override updateBefore to:
     * 1. Use WORLD positions — correct for Unity-style lights and any parent transform
     * 2. Force matrixWorld update on cascade lights after positioning — upstream doesn't
     *    do this, causing stale matrixWorld when ShadowNode.renderShadow() reads it
     * @param builder
     */
    updateBefore(builder?: any): boolean | undefined {
        const light = this.light as DirectionalLight;
        if (!this.camera || !light?.parent) return undefined;

        light.getWorldPosition(_worldPos);
        light.target.getWorldPosition(_worldTargetPos);
        if (this.canReuseUpdateInputs(this.camera, _worldPos, _worldTargetPos)) return undefined;

        // Upstream uses light.position / target.position (local coordinates) to derive
        // light direction and orientation. For Unity-style lights (direction from quaternion)
        // or lights under transformed parents, we need world positions.
        _savedPos.copy(light.position);
        _savedTargetPos.copy(light.target.position);

        light.position.copy(_worldPos);
        light.target.position.copy(_worldTargetPos);

        super.updateBefore(builder);

        // Restore original local positions
        light.position.copy(_savedPos);
        light.target.position.copy(_savedTargetPos);

        // Force matrixWorld update on cascade lights — positions were set in super
        // but matrixWorld is stale (scene.updateMatrixWorld() ran before updateBefore)
        for (let i = 0; i < this.lights.length; i++) {
            const lwLight = this.lights[i];
            if (!lwLight) continue;
            lwLight.updateMatrixWorld(true);
            if (lwLight.target) lwLight.target.updateMatrixWorld(true);
        }

        this.captureUpdateInputs(this.camera, _worldPos, _worldTargetPos);

        return undefined;
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;

        const lights = this.lights as DirectionalLight[];
        if (lights) {
            for (const light of lights) {
                if (light.parent) {
                    light.parent.remove(light.target);
                    light.parent.remove(light);
                }
            }
        }

        this.lights.length = 0;
        this.frustums.length = 0;
        this.invalidateUpdateCache();

        super.dispose();
    }
}

/**
 * CSMManager: Ensures only one DirectionalLight in the scene has CSM enabled at a time.
 *
 * With the engine's dynamic shadowNode support, switching is simply:
 *   light.shadow.shadowNode = csmNode;   // enable CSM
 *   light.shadow.shadowNode = undefined;  // revert to default shadow
 *
 * The engine detects the change, cleans up the old shadow pipeline (without
 * disposing user-provided nodes), and rebuilds automatically on the next
 * setup() pass — which is triggered by invalidating materials.
 */
export class CSMManager {
    private static _instance: CSMManager;
    private currentBehavior: CSMBehavior | null = null;
    private currentLight: DirectionalLight | null = null;
    private currentParams: CSMParams | undefined;
    private csm: ExtendedCSMShadowNode | null = null;
    // updateBefore still follows camera movement every frame. The expensive
    // cascade split/bounds rebuild only depends on projection and CSM
    // parameters, so cache those inputs and invalidate on changes.
    private frustumCache: {
        camera: object | null;
        projection: number[];
        perspective: boolean;
        near: number | null;
        far: number | null;
        fov: number | null;
        aspect: number | null;
        zoom: number | null;
        filmGauge: number | null;
        filmOffset: number | null;
        viewFullWidth: number | null;
        viewFullHeight: number | null;
        viewOffsetX: number | null;
        viewOffsetY: number | null;
        viewWidth: number | null;
        viewHeight: number | null;
        left: number | null;
        right: number | null;
        top: number | null;
        bottom: number | null;
        maxFar: number | null;
        cascades: number | null;
        mode: string | null;
        fade: boolean;
        lightMargin: number | null;
        customSplitsCallback: unknown;
    } | null = null;

    private constructor() {}

    private resetFrustumCache(): void {
        this.frustumCache = null;
    }

    private shouldRefreshFrustums(csm: ExtendedCSMShadowNode, camera: any): boolean {
        const finiteOrNull = (value: unknown): number | null =>
            typeof value === "number" && Number.isFinite(value) ? value : null;
        const previous = this.frustumCache;
        const projectionElements = camera?.projectionMatrix?.elements as ArrayLike<number> | undefined;
        const projectionLength = projectionElements?.length ?? 0;
        const near = finiteOrNull(camera?.near);
        const far = finiteOrNull(camera?.far);
        const fov = finiteOrNull(camera?.fov);
        const aspect = finiteOrNull(camera?.aspect);
        const zoom = finiteOrNull(camera?.zoom);
        const filmGauge = finiteOrNull(camera?.filmGauge);
        const filmOffset = finiteOrNull(camera?.filmOffset);
        const viewFullWidth = finiteOrNull(camera?.view?.fullWidth);
        const viewFullHeight = finiteOrNull(camera?.view?.fullHeight);
        const viewOffsetX = finiteOrNull(camera?.view?.offsetX);
        const viewOffsetY = finiteOrNull(camera?.view?.offsetY);
        const viewWidth = finiteOrNull(camera?.view?.width);
        const viewHeight = finiteOrNull(camera?.view?.height);
        const left = finiteOrNull(camera?.left);
        const right = finiteOrNull(camera?.right);
        const top = finiteOrNull(camera?.top);
        const bottom = finiteOrNull(camera?.bottom);
        const maxFar = finiteOrNull(csm.maxFar);
        const cascades = finiteOrNull(csm.cascades);
        const mode = typeof csm.mode === "string" ? csm.mode : null;
        const fade = csm.fade === true;
        const lightMargin = finiteOrNull(csm.lightMargin);
        const customSplitsCallback = csm.customSplitsCallback;

        if (!previous) {
            const projection = new Array<number>(projectionLength);
            for (let i = 0; i < projectionLength; i++) projection[i] = projectionElements![i] as number;
            this.frustumCache = {
                camera: camera as object,
                projection,
                perspective: camera?.isPerspectiveCamera === true,
                near,
                far,
                fov,
                aspect,
                zoom,
                filmGauge,
                filmOffset,
                viewFullWidth,
                viewFullHeight,
                viewOffsetX,
                viewOffsetY,
                viewWidth,
                viewHeight,
                left,
                right,
                top,
                bottom,
                maxFar,
                cascades,
                mode,
                fade,
                lightMargin,
                customSplitsCallback,
            };
            return true;
        }

        let changed = previous.camera !== camera
            || previous.perspective !== (camera?.isPerspectiveCamera === true)
            || previous.near !== near
            || previous.far !== far
            || previous.fov !== fov
            || previous.aspect !== aspect
            || previous.zoom !== zoom
            || previous.filmGauge !== filmGauge
            || previous.filmOffset !== filmOffset
            || previous.viewFullWidth !== viewFullWidth
            || previous.viewFullHeight !== viewFullHeight
            || previous.viewOffsetX !== viewOffsetX
            || previous.viewOffsetY !== viewOffsetY
            || previous.viewWidth !== viewWidth
            || previous.viewHeight !== viewHeight
            || previous.left !== left
            || previous.right !== right
            || previous.top !== top
            || previous.bottom !== bottom
            || previous.maxFar !== maxFar
            || previous.cascades !== cascades
            || previous.mode !== mode
            || previous.fade !== fade
            || previous.lightMargin !== lightMargin
            || previous.customSplitsCallback !== customSplitsCallback
            || previous.projection.length !== projectionLength;

        if (!changed && projectionElements) {
            for (let i = 0; i < projectionLength; i++) {
                if (previous.projection[i] !== projectionElements[i]) {
                    changed = true;
                    break;
                }
            }
        }

        if (previous.projection.length !== projectionLength) previous.projection.length = projectionLength;
        if (projectionElements) {
            for (let i = 0; i < projectionLength; i++) previous.projection[i] = projectionElements[i] as number;
        }
        previous.camera = camera as object;
        previous.perspective = camera?.isPerspectiveCamera === true;
        previous.near = near;
        previous.far = far;
        previous.fov = fov;
        previous.aspect = aspect;
        previous.zoom = zoom;
        previous.filmGauge = filmGauge;
        previous.filmOffset = filmOffset;
        previous.viewFullWidth = viewFullWidth;
        previous.viewFullHeight = viewFullHeight;
        previous.viewOffsetX = viewOffsetX;
        previous.viewOffsetY = viewOffsetY;
        previous.viewWidth = viewWidth;
        previous.viewHeight = viewHeight;
        previous.left = left;
        previous.right = right;
        previous.top = top;
        previous.bottom = bottom;
        previous.maxFar = maxFar;
        previous.cascades = cascades;
        previous.mode = mode;
        previous.fade = fade;
        previous.lightMargin = lightMargin;
        previous.customSplitsCallback = customSplitsCallback;
        return changed;
    }

    static get instance(): CSMManager {
        if (!CSMManager._instance) {
            CSMManager._instance = new CSMManager();
        }
        return CSMManager._instance;
    }

    enableCSM(light: DirectionalLight, params?: CSMParams) {
        if (this.currentLight && this.currentLight !== light) {
            this.disableCSM();
        }

        if (this.currentLight !== light) {
            this.currentLight = light;
        }

        if (params) {
            this.currentParams = params;
        }

        if (this.csm && this.currentLight === light && params) {
            this.createInternalCSMNode();
        } else {
            this.updateCSMNodeState();
        }
    }

    private updateCSMNodeState() {
        if (!this.currentLight || !global.app || !global.app.camera) return;

        if (this.currentLight.castShadow) {
            if (!this.csm) {
                this.createInternalCSMNode();
            }
        } else {
            if (this.csm) {
                this.removeInternalCSMNode();
            }
        }
    }

    private createInternalCSMNode() {
        if (!this.currentLight) return;

        // Dispose old CSM instance if switching params
        if (this.csm) {
            this.csm.dispose();
            this.csm = null;
        }

        const params = this.currentParams;
        const light = this.currentLight;

        let cascades = params?.cascades ?? 3;
        const maxCascades = this.getMaxCascadesForRenderer();
        if (cascades > maxCascades) {
            cascades = maxCascades;
        }

        // maxFar = view-space forward distance from camera that CSM covers.
        // Non-CSM uses a light-aligned ortho box (±top), CSM uses a view-aligned
        // frustum clipped at maxFar. The scale factor compensates for the geometry
        // difference so CSM roughly matches non-CSM forward reach.
        // Must match what update() syncs each frame.
        const cam = light.shadow.camera;
        const maxFar = (Math.abs(cam.top) || 100) * CSM_MAX_FAR_SCALE;

        this.csm = new ExtendedCSMShadowNode(light, {
            cascades,
            maxFar,
            mode: params?.mode ?? 'practical',
            lightMargin: params?.lightMargin ?? 200,
            customSplitsCallback: params?.customSplitsCallback,
        } as any);
        this.resetFrustumCache();

        // The engine detects this change and rebuilds the shadow pipeline
        light.shadow.shadowNode = this.csm;

        if (global.app) global.app.call(`objectChanged`, light, light);

        // Trigger pipeline rebuild so AnalyticLightNode.setup() picks up the new shadowNode
        this.invalidateSceneMaterials();
    }

    private removeInternalCSMNode() {
        const light = this.currentLight;
        if (!light) return;

        const csmToDispose = this.csm;

        if (csmToDispose) {
            csmToDispose.dispose();
            if (this.csm === csmToDispose) {
                this.csm = null;
            }
        }
        this.resetFrustumCache();

        light.shadow.shadowNode = undefined;

        // Clean up CSM_Root
        if (global.app && global.app.scene) {
            const parent: Object3D = getOrCreateDynamicRoot(global.app.scene);

            const csmRoot = findObjectByNameDepthFirst(parent, "CSM_Root");
            if (csmRoot) {
                csmRoot.removeFromParent();
            }
        }

        if (global.app) global.app.call(`objectChanged`, light, light);

        // Trigger pipeline rebuild so AnalyticLightNode.setup() picks up the change
        this.invalidateSceneMaterials();
    }

    disableCSM() {
        if (this.currentLight) {
            this.removeInternalCSMNode();
        }

        this.currentBehavior = null;
        this.currentLight = null;
        this.currentParams = undefined;
        this.resetFrustumCache();
    }

    getCurrentLight(): DirectionalLight | null {
        return this.currentLight;
    }

    isCSMEnabled(): boolean {
        return !!this.csm && !!this.currentLight;
    }

    update() {
        this.updateCSMNodeState();
        if (this.csm && this.currentLight) {
            if (this.csm.mainFrustum && global.app && global.app.camera && this.csm.camera !== global.app.camera) {
                this.csm.camera = global.app.camera;
            }

            const lights = this.csm.lights as DirectionalLight[];
            if (lights) {
                const mainShadow = this.currentLight.shadow;
                let cascadeInputsChanged = false;

                // Keep the runtime value identical to creation so the first
                // steady-state update does not rebuild cascade frustums solely
                // because of a policy mismatch.
                const desiredMaxFar = (Math.abs(mainShadow.camera.top) || 100) * CSM_MAX_FAR_SCALE;
                if (this.csm.maxFar !== desiredMaxFar) {
                    this.csm.maxFar = desiredMaxFar;
                }

                for (let i = 0; i < lights.length; i++) {
                    const cascadeLight = lights[i];
                    if (!cascadeLight) continue;
                    const shadow = cascadeLight.shadow;

                    if (shadow.mapSize.width !== mainShadow.mapSize.width || shadow.mapSize.height !== mainShadow.mapSize.height) {
                        shadow.mapSize.copy(mainShadow.mapSize);
                        shadow.map = null;
                        shadow.needsUpdate = true;
                        cascadeInputsChanged = true;
                    }

                    if (shadow.bias !== mainShadow.bias * (i + 1)) {
                        shadow.bias = mainShadow.bias * (i + 1);
                    }
                    if (shadow.normalBias !== mainShadow.normalBias * (i + 1)) {
                        shadow.normalBias = mainShadow.normalBias * (i + 1);
                    }
                    if (shadow.radius !== mainShadow.radius) {
                        shadow.radius = mainShadow.radius;
                    }
                    if (shadow.blurSamples !== mainShadow.blurSamples) {
                        shadow.blurSamples = mainShadow.blurSamples;
                    }
                }

                if (cascadeInputsChanged) this.csm.invalidateUpdateCache?.();
            }

            const csmCamera = this.csm.camera;
            if (
                this.csm.updateFrustums &&
                this.csm.mainFrustum &&
                csmCamera &&
                this.shouldRefreshFrustums(this.csm, csmCamera)
            ) {
                this.csm.updateFrustums();
                this.csm.invalidateUpdateCache?.();
            }
        }
    }

    updateCSMParams(params: CSMParams) {
        if (!this.currentLight) return;

        if (this.currentParams) {
            this.currentParams = { ...this.currentParams, ...params };
        } else {
            this.currentParams = params;
        }

        if (!this.csm) return;

        this.enableCSM(this.currentLight, this.currentParams);
    }

    private getMaxCascadesForRenderer(): number {
        const renderer = global.app?.renderer as any;
        if (!renderer) return 8;

        const backend = renderer.backend;
        if (backend?.isWebGPUBackend && backend.device) {
            const maxTextures = backend.device.limits.maxSampledTexturesPerShaderStage ?? 16;
            return Math.max(1, maxTextures - RESERVED_TEXTURE_SLOTS);
        }

        return 8;
    }

    private invalidateSceneMaterials() {
        if (!global.app || !global.app.scene) return;

        traverseObjectDepthFirst(global.app.scene, (object: Object3D) => {
            const mesh = object as Mesh;
            if (mesh.isMesh && mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.needsUpdate = true);
                } else {
                    mesh.material.needsUpdate = true;
                }
            }
        });
    }
}

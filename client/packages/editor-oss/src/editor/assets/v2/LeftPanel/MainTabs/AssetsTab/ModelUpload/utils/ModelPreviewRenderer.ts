import type { SparkWebGpuRenderer } from '@querielo/spark';
import { bayer16 } from "three/addons/tsl/math/Bayer.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { depth, float, pass, texture, uniform, uv, vec3, vec4 } from "three/tsl";
import {
    AmbientLight,
    Color,
    DirectionalLight,
    EquirectangularReflectionMapping,
    Group,
    Material,
    Mesh,
    Object3D,
    OrthographicCamera,
    PCFShadowMap,
    PerspectiveCamera,
    PlaneGeometry,
    RenderTarget,
    Scene,
    Texture,
    Vector3,
} from 'three';
import {MeshBasicNodeMaterial, RenderPipeline} from "three/webgpu";
import type {WebGPURenderer} from "three/webgpu";

import { getObjectBoundingBox, isGaussianSplatObject } from '@stem/editor-oss/model/gaussianSplats';
import { positionCameraForModel } from "../../../../../utils/positionCameraForModel";
import {disposePreviewModel} from "./previewModelResources";

type SparkCompositeBridgeModule = typeof import("../../../../../../../../render/SparkCompositeBridge");
type ThreeWebGPUModule = typeof import("three/webgpu");

let threeWebGPUModulePromise: Promise<ThreeWebGPUModule> | null = null;

function loadThreeWebGPU(): Promise<ThreeWebGPUModule> {
    if (!threeWebGPUModulePromise) {
        threeWebGPUModulePromise = import("three/webgpu");
    }
    return threeWebGPUModulePromise;
}

const PREVIEW_AMBIENT_INTENSITY = 1.8;
const PREVIEW_DIRECTIONAL_INTENSITY = 0.6;
const PREVIEW_ENVIRONMENT_INTENSITY = 0.45;

export class ModelPreviewRenderer {
    renderer: WebGPURenderer | null = null;
    scene: Scene;
    camera: PerspectiveCamera;
    controls: OrbitControls;
    postProcessing?: RenderPipeline;
    shadowState: {
        shadowGroup: Group;
        shadowCamera: OrthographicCamera;
        renderTarget: RenderTarget;
        shadowPlane: Mesh;
        fillPlane: Mesh;
        depthMaterial: MeshBasicNodeMaterial;
    };
    directionalLight: DirectionalLight;
    private sparkComposite: SparkWebGpuRenderer | null;
    private sparkCompositeBridge: SparkCompositeBridgeModule | null = null;
    private sparkLoadGeneration = 0;
    private environmentTexture: Texture | null = null;
    private disposed = false;

    private model?: Object3D;
    private isGaussianSplatModel = false;
    private cameraWarmupFramesRemaining = 0;
    private isRunning = false;
    private width = 100;
    private height = 100;
    private pixelRatio = 1;
    private readonly canvas: HTMLCanvasElement | OffscreenCanvas;

    constructor(canvas: HTMLCanvasElement | OffscreenCanvas, width: number, height: number, pixelRatio: number) {
        this.canvas = canvas;
        this.width = width;
        this.height = height;
        this.pixelRatio = pixelRatio;

        this.scene = new Scene();
        this.scene.name = "ModelPreviewScene";
        const light = new AmbientLight(0xffffff, PREVIEW_AMBIENT_INTENSITY);
        light.name = "AutoLight";
        this.scene.add(light);

        this.directionalLight = new DirectionalLight(0xffffff, PREVIEW_DIRECTIONAL_INTENSITY);
        this.directionalLight.position.set(5, 10, 7.5);
        this.scene.add(this.directionalLight);

        new HDRLoader().load(
            "/assets/hdr/studio.hdr",
            (loadedTexture: Texture) => {
                if (this.disposed) {
                    loadedTexture.dispose();
                    return;
                }

                loadedTexture.mapping = EquirectangularReflectionMapping;
                this.environmentTexture?.dispose();
                this.environmentTexture = loadedTexture;
                this.scene.environment = loadedTexture;
                this.scene.environmentIntensity = PREVIEW_ENVIRONMENT_INTENSITY;
            },
            undefined,
            (error: unknown) => {
                console.error("Failed to load HDR environment:", error);
            },
        );

        this.camera = new PerspectiveCamera(20, width / height, 0.1, 1000);
        this.controls = new OrbitControls(this.camera, canvas as unknown as HTMLElement);
        this.controls.enableDamping = true;

        const shadowGroup = new Group();
        this.scene.add(shadowGroup);

        const renderTarget = new RenderTarget(512, 512, { depthBuffer: true });
        renderTarget.texture.generateMipmaps = false;

        const planeGeometry = new PlaneGeometry(1, 1).rotateX(Math.PI / 2);

        const uBlur = uniform(5.5);
        const uDarkness = uniform(1.0);
        const uShadowOpacity = uniform(1.0);
        const uPlaneOpacity = uniform(0.9);
        const uPlaneColor = uniform(new Color(0x27272a));

        const depthMaterial = new MeshBasicNodeMaterial();
        const alphaDepth = float(1).sub(depth).mul(uDarkness);
        depthMaterial.outputNode = vec4(vec3(0), alphaDepth);
        depthMaterial.depthTest = false;
        depthMaterial.depthWrite = false;

        const shadowPlaneMaterial = new MeshBasicNodeMaterial();
        shadowPlaneMaterial.transparent = true;
        shadowPlaneMaterial.depthWrite = false;
        const blurredShadow = gaussianBlur(texture(renderTarget.texture), uBlur, 4, { premultipliedAlpha: false });
        shadowPlaneMaterial.outputNode = vec4(
            vec3(0),
            blurredShadow.a.mul(uShadowOpacity).add((bayer16(uv().mul(512)) as any).r.sub(0.5).mul(0.05)),
        );

        const shadowPlane = new Mesh(planeGeometry, shadowPlaneMaterial);
        shadowPlane.renderOrder = 1;
        shadowPlane.scale.y = -1;
        shadowPlane.scale.z = -1;
        shadowGroup.add(shadowPlane);

        const fillPlaneMaterial = new MeshBasicNodeMaterial();
        fillPlaneMaterial.transparent = true;
        fillPlaneMaterial.depthWrite = false;
        fillPlaneMaterial.outputNode = vec4(vec3(uPlaneColor as any), uPlaneOpacity);
        const fillPlane = new Mesh(planeGeometry, fillPlaneMaterial);
        fillPlane.rotateX(Math.PI);
        shadowGroup.add(fillPlane);

        const shadowCamera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
        shadowCamera.rotation.x = Math.PI / 2;
        shadowGroup.add(shadowCamera);

        this.shadowState = {
            shadowGroup,
            shadowCamera,
            renderTarget,
            shadowPlane,
            fillPlane,
            depthMaterial,
        };

        this.sparkComposite = null;
    }

    async init() {
        const {WebGPURenderer} = await loadThreeWebGPU();
        if (this.disposed) return;

        const renderer = new WebGPURenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false,
        });
        this.renderer = renderer;
        renderer.setPixelRatio(this.pixelRatio);
        renderer.setSize(this.width, this.height, false);
        renderer.setClearColor(new Color(0x27272a));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFShadowMap;

        await renderer.init();
        if (this.disposed) {
            renderer.dispose();
            if (this.renderer === renderer) {
                this.renderer = null;
            }
            return;
        }

        const scenePass = pass(this.scene, this.camera);
        const colorTex = scenePass.getTextureNode("output");

        const pp = new RenderPipeline(renderer);
        pp.outputNode = colorTex;

        this.postProcessing = pp;
        this.isRunning = true;
        if (this.isGaussianSplatModel && this.model && !this.sparkComposite) {
            this.ensureSparkCompositeForCurrentModel(++this.sparkLoadGeneration);
        }
        this.animate();
    }

    updateModel(model: Object3D) {
        if (this.model) {
            this.scene.remove(this.model);
            disposePreviewModel(this.model);
        }

        this.model = model;
        this.model.name = "PreviewMesh";
        this.scene.add(this.model);
        this.model.updateMatrixWorld(true);
        this.isGaussianSplatModel = isGaussianSplatObject(this.model);
        const sparkGeneration = ++this.sparkLoadGeneration;
        if (this.isGaussianSplatModel) {
            this.ensureSparkCompositeForCurrentModel(sparkGeneration);
        } else if (this.sparkComposite) {
            this.sparkCompositeBridge?.disposeSparkComposite(this.sparkComposite);
            this.sparkComposite = null;
        }
        this.cameraWarmupFramesRemaining = this.isGaussianSplatModel ? 45 : 0;

        positionCameraForModel(this.model, this.camera, this.controls);
        this.updateShadowBounds();
    }

    private async ensureSparkCompositeForCurrentModel(generation: number) {
        try {
            const bridge = this.sparkCompositeBridge ?? await import("../../../../../../../../render/SparkCompositeBridge");
            this.sparkCompositeBridge = bridge;
            if (
                generation !== this.sparkLoadGeneration ||
                !this.isGaussianSplatModel ||
                !this.model ||
                this.sparkComposite
            ) {
                return;
            }

            if (!this.renderer) return;
            this.sparkComposite = bridge.ensureSparkComposite(this.scene, this.renderer);
        } catch (error) {
            console.warn("[ModelPreviewRenderer] Failed to load Spark preview support", error);
        }
    }

    updateShadowBounds() {
        if (!this.model) return;

        const { shadowGroup, shadowCamera, shadowPlane, fillPlane } = this.shadowState;

        if (this.isGaussianSplatModel) {
            shadowPlane.visible = false;
            fillPlane.visible = false;
            return;
        }

        const bbox = getObjectBoundingBox(this.model);
        const sizeVec = bbox.getSize(new Vector3());
        const center = bbox.getCenter(new Vector3());
        const hasFiniteBounds =
            Number.isFinite(sizeVec.x) && Number.isFinite(sizeVec.y) && Number.isFinite(sizeVec.z) &&
            Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z);

        if (!hasFiniteBounds || bbox.isEmpty()) {
            shadowPlane.visible = false;
            fillPlane.visible = false;
            return;
        }

        shadowPlane.visible = true;
        fillPlane.visible = true;

        const maxExtent = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
        const planeY = bbox.min.y - 0.01;

        const lightDistance = maxExtent * 1.5;
        this.directionalLight.position.set(
            center.x + lightDistance,
            center.y + lightDistance,
            center.z + lightDistance,
        );
        this.directionalLight.lookAt(center);

        shadowGroup.position.y = planeY;

        const planeSize = Math.max(0.5, maxExtent * 1.5);
        const cameraHeight = Math.max(0.1, sizeVec.y + 0.5);

        shadowPlane.scale.set(planeSize, -1, -planeSize);
        fillPlane.scale.set(planeSize, 1, planeSize);

        shadowCamera.left = -planeSize / 2;
        shadowCamera.right = planeSize / 2;
        shadowCamera.top = planeSize / 2;
        shadowCamera.bottom = -planeSize / 2;
        shadowCamera.far = cameraHeight;
        shadowCamera.updateProjectionMatrix();
    }

    setSize(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer?.setSize(width, height, false);
    }

    animate = () => {
        if (!this.isRunning) return;
        requestAnimationFrame(this.animate);

        this.controls.update();

        if (this.model && this.cameraWarmupFramesRemaining > 0) {
            this.model.updateMatrixWorld(true);
            positionCameraForModel(this.model, this.camera, this.controls);
            this.updateShadowBounds();
            this.cameraWarmupFramesRemaining--;
        }

        if (!this.postProcessing) return;

        try {
            const { shadowCamera, renderTarget, shadowPlane, fillPlane, depthMaterial } = this.shadowState;

            if (!this.isGaussianSplatModel) {
                const renderer = this.renderer;
                if (!renderer) return;
                const prevOverride = this.scene.overrideMaterial;
                const prevAutoClear = renderer.autoClear;
                const hasGetClearAlpha = typeof renderer.getClearAlpha === "function";
                const prevClearAlpha = hasGetClearAlpha ? renderer.getClearAlpha() : undefined;

                shadowPlane.visible = false;
                fillPlane.visible = false;

                this.scene.overrideMaterial = depthMaterial;
                renderer.autoClear = true;
                if (hasGetClearAlpha && prevClearAlpha !== undefined && renderer.setClearAlpha) {
                    renderer.setClearAlpha(0);
                }

                renderer.setRenderTarget(renderTarget);
                renderer.clear();
                renderer.render(this.scene, shadowCamera);

                this.scene.overrideMaterial = prevOverride;
                renderer.setRenderTarget(null);
                renderer.autoClear = prevAutoClear;
                if (hasGetClearAlpha && prevClearAlpha !== undefined && renderer.setClearAlpha) {
                    renderer.setClearAlpha(prevClearAlpha);
                }

                shadowPlane.visible = true;
                fillPlane.visible = true;
            }

            this.postProcessing.render();
        } catch (error) {
            console.error(error);
        }
    };

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.isRunning = false;
        if (this.model) {
            disposePreviewModel(this.model);
            this.model = undefined;
        }
        this.sparkLoadGeneration++;
        this.sparkCompositeBridge?.disposeSparkComposite(this.sparkComposite);
        this.sparkComposite = null;
        this.postProcessing?.dispose?.();
        this.postProcessing = undefined;
        this.disposeEnvironmentTexture();
        this.disposeShadowState();
        this.renderer?.dispose();
        this.renderer = null;
        this.scene.clear();
        this.controls.dispose();
    }

    private disposeEnvironmentTexture(): void {
        if (!this.environmentTexture) return;
        if (this.scene.environment === this.environmentTexture) {
            this.scene.environment = null;
        }
        this.environmentTexture.dispose();
        this.environmentTexture = null;
    }

    private disposeShadowState(): void {
        const {shadowPlane, fillPlane, depthMaterial, renderTarget} = this.shadowState;
        const shadowGeometry = shadowPlane.geometry;
        const fillGeometry = fillPlane.geometry;
        this.disposeMaterial(shadowPlane.material);
        this.disposeMaterial(fillPlane.material);
        depthMaterial.dispose();
        shadowGeometry.dispose();
        if (fillGeometry !== shadowGeometry) {
            fillGeometry.dispose();
        }
        renderTarget.dispose();
    }

    private disposeMaterial(material: Material | Material[]): void {
        if (Array.isArray(material)) {
            material.forEach(item => item.dispose());
            return;
        }
        material.dispose();
    }

}

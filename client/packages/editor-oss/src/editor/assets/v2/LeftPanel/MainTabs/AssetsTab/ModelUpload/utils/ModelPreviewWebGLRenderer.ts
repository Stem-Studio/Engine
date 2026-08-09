import {
    AmbientLight,
    Color,
    DirectionalLight,
    EquirectangularReflectionMapping,
    Mesh,
    Object3D,
    PCFSoftShadowMap,
    PerspectiveCamera,
    PlaneGeometry,
    Scene,
    ShadowMaterial,
    Texture,
    Vector3,
    WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

import { getObjectBoundingBox } from "@stem/editor-oss/model/gaussianSplats";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import { positionCameraForModel } from "../../../../../utils/positionCameraForModel";
import {disposePreviewModel} from "./previewModelResources";

const PREVIEW_AMBIENT_INTENSITY = 1.8;
const PREVIEW_DIRECTIONAL_INTENSITY = 0.8;
const PREVIEW_ENVIRONMENT_INTENSITY = 0.45;

export class ModelPreviewWebGLRenderer {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
    controls: OrbitControls;

    private directionalLight: DirectionalLight;
    private shadowPlane: Mesh<PlaneGeometry, ShadowMaterial>;
    private environmentTexture?: Texture;
    private model?: Object3D;
    private isRunning = false;

    constructor(canvas: HTMLCanvasElement | OffscreenCanvas, width: number, height: number, pixelRatio: number) {
        this.renderer = new WebGLRenderer({
            canvas: canvas as HTMLCanvasElement,
            antialias: true,
            alpha: false,
        });

        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        this.renderer.setClearColor(new Color(0x27272a));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = PCFSoftShadowMap;

        this.scene = new Scene();
        this.scene.name = "ModelPreviewWebGLScene";

        const ambient = new AmbientLight(0xffffff, PREVIEW_AMBIENT_INTENSITY);
        ambient.name = "AutoLight";
        this.scene.add(ambient);

        this.directionalLight = new DirectionalLight(0xffffff, PREVIEW_DIRECTIONAL_INTENSITY);
        this.directionalLight.position.set(5, 10, 7.5);
        this.directionalLight.castShadow = true;
        this.directionalLight.shadow.mapSize.set(1024, 1024);
        this.scene.add(this.directionalLight);

        new HDRLoader().load(
            "/assets/hdr/studio.hdr",
            (loadedTexture: Texture) => {
                this.environmentTexture?.dispose();
                loadedTexture.mapping = EquirectangularReflectionMapping;
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

        const shadowMaterial = new ShadowMaterial({
            color: 0x000000,
            opacity: 0.28,
            transparent: true,
        });
        const shadowPlane = new Mesh(new PlaneGeometry(1, 1), shadowMaterial);
        shadowPlane.name = "PreviewShadowPlane";
        shadowPlane.rotation.x = -Math.PI / 2;
        shadowPlane.receiveShadow = true;
        this.shadowPlane = shadowPlane;
        this.scene.add(shadowPlane);
    }

    async init() {
        this.isRunning = true;
        this.animate();
    }

    updateModel(model: Object3D) {
        if (this.model) {
            this.scene.remove(this.model);
            disposePreviewModel(this.model);
        }

        this.model = model;
        this.model.name = "PreviewMesh";
        this.setModelShadowFlags(this.model);
        this.scene.add(this.model);
        this.model.updateMatrixWorld(true);

        positionCameraForModel(this.model, this.camera, this.controls);
        this.updateShadowBounds();
    }

    setSize(width: number, height: number) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    }

    dispose() {
        this.isRunning = false;

        if (this.model) {
            disposePreviewModel(this.model);
            this.model = undefined;
        }

        this.environmentTexture?.dispose();
        this.environmentTexture = undefined;
        this.shadowPlane.geometry.dispose();
        this.shadowPlane.material.dispose();
        this.controls.dispose();
        this.scene.clear();
        this.renderer.dispose();
    }

    private animate = () => {
        if (!this.isRunning) return;
        requestAnimationFrame(this.animate);

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    };

    private updateShadowBounds() {
        if (!this.model) return;

        const bbox = getObjectBoundingBox(this.model);
        const sizeVec = bbox.getSize(new Vector3());
        const center = bbox.getCenter(new Vector3());
        const hasFiniteBounds =
            Number.isFinite(sizeVec.x) && Number.isFinite(sizeVec.y) && Number.isFinite(sizeVec.z) &&
            Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z);

        if (!hasFiniteBounds || bbox.isEmpty()) {
            this.shadowPlane.visible = false;
            return;
        }

        this.shadowPlane.visible = true;

        const maxExtent = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
        const planeSize = Math.max(0.5, maxExtent * 1.5);
        const planeY = bbox.min.y - 0.01;
        const lightDistance = Math.max(1, maxExtent * 1.5);

        this.shadowPlane.position.set(center.x, planeY, center.z);
        this.shadowPlane.scale.set(planeSize, planeSize, 1);

        this.directionalLight.position.set(
            center.x + lightDistance,
            center.y + lightDistance,
            center.z + lightDistance,
        );
        this.directionalLight.lookAt(center);
        this.directionalLight.shadow.camera.updateProjectionMatrix();
    }

    private setModelShadowFlags(model: Object3D) {
        traverseObjectDepthFirst(model, child => {
            if (child instanceof Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
    }
}

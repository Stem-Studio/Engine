import React, {useEffect, useMemo, useRef} from "react";
import {outline} from "three/addons/tsl/display/OutlineNode.js";
import {bayer16} from "three/addons/tsl/math/Bayer.js";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {HDRLoader} from "three/addons/loaders/HDRLoader.js";
import {gaussianBlur} from "three/addons/tsl/display/GaussianBlurNode.js";
import {pass, screenUV, vec3, vec4, uniform, texture, depth, float, uv, screenCoordinate} from "three/tsl";
import {
    Box3,
    Color,
    EquirectangularReflectionMapping,
    Group,
    Mesh,
    Object3D,
    Object3DEventMap,
    OrthographicCamera,
    PCFShadowMap,
    PerspectiveCamera,
    PlaneGeometry,
    RenderTarget,
    Scene,
    Texture,
    Vector3,
} from "three";
import {MeshBasicNodeMaterial, RenderPipeline} from "three/webgpu";

import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import global from "@stem/editor-oss/global";
import {
    applyMaterialSettingsToObject,
    applyMaterialSettingsToSpecificMaterial,
    findMaterialByPathKey,
} from "../../materials/materialUtils";
import {MaterialInfo} from "../../RightPanel/ModelEditorButtons/ModelEditorButtons";
import {IMaterialSettings} from "../../RightPanel/sections/MaterialRenderingSection/types";

let environmentPromise: Promise<any> | null = null;
type ThreeWebGPUModule = typeof import("three/webgpu");
let threeWebGPUModulePromise: Promise<ThreeWebGPUModule> | null = null;

function loadThreeWebGPU(): Promise<ThreeWebGPUModule> {
    if (!threeWebGPUModulePromise) {
        threeWebGPUModulePromise = import("three/webgpu");
    }
    return threeWebGPUModulePromise;
}

interface Props {
    materialInfo?: MaterialInfo | null;
    cloneRef: React.MutableRefObject<Object3D | null>;
    pendingSettings?: {settings: IMaterialSettings; pathKey: string} | null;
}

export const PrimitiveViewer: React.FC<Props> = ({materialInfo, cloneRef: externalCloneRef, pendingSettings}) => {
    const {context} = useAssetResolutionContext();
    const app = global.app as EngineRuntime;
    const selectedObj = app.editor?.selected as Object3D<Object3DEventMap>;

    const plane = selectedObj?.userData?.isPlane
        ? (selectedObj.children.find(obj => obj instanceof Mesh) as Mesh)
        : undefined;
    const selected = plane || selectedObj;
    const viewer = useRef<HTMLDivElement>(null);

    const outlinePassRef = useRef<ReturnType<typeof outline> | null>(null);

    useEffect(() => {
        let isMounted = true;
        let disposePreview: (() => void) | null = null;
        if (!viewer.current || !selected) return;

        void (async () => {
            const {WebGPURenderer} = await loadThreeWebGPU();
            if (!isMounted || !viewer.current) return;

        const scene = new Scene();
        scene.name = "PrimitiveViewerScene";

        const camera = new PerspectiveCamera(75, 1, 0.1, 1000);
        const renderer = new WebGPURenderer({antialias: true, alpha: false});
        const rendererInitPromise = renderer.init();
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(new Color(0x282828));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFShadowMap;

        const applySize = () => {
            if (!viewer.current) return;
            camera.aspect = viewer.current.clientWidth / viewer.current.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(viewer.current.clientWidth, viewer.current.clientHeight);
        };
        applySize();

        if (viewer.current.children.length) {
            viewer.current.removeChild(viewer.current.lastChild as Node);
        }
        viewer.current.appendChild(renderer.domElement);

        let sceneEnvironmentTexture: Texture | null = null;
        if (!environmentPromise) {
            environmentPromise = new Promise((resolve, reject) => {
                new HDRLoader().load(
                    "/assets/hdr/environment.hdr",
                    texture => {
                        texture.mapping = EquirectangularReflectionMapping;
                        resolve(texture);
                    },
                    undefined,
                    reject,
                );
            });
        }

        environmentPromise
            .then(texture => {
                if (!isMounted) return;
                sceneEnvironmentTexture?.dispose();
                sceneEnvironmentTexture = texture.clone();
                scene.environment = sceneEnvironmentTexture;
                scene.environmentIntensity = 1;
                selectedClone.visible = true;
                shadowGroup.visible = true;
            })
            .catch(error => {
                console.error("Failed to load HDR environment:", error);
            });

        const selectedClone = selected.clone();
        selectedClone.visible = false;
        try {
            const settings = selected.userData?.materialSettings as IMaterialSettings | undefined;
            if (settings) {
                if (materialInfo) {
                    applyMaterialSettingsToSpecificMaterial(selectedClone, settings, materialInfo.pathKey, context);
                } else {
                    applyMaterialSettingsToObject(selectedClone, settings, context);
                }
            }
        } catch {
            // ignore error
        }

        const bbox = new Box3().setFromObject(selectedClone);
        const center = bbox.getCenter(new Vector3());
        const size = bbox.getSize(new Vector3()).length();

        // NOTE: Helpers for debugging
        // const axisHelper = new AxesHelper(Math.max(1, size * 0.5));
        // scene.add(axisHelper);
        // const bboxHelper = new Box3Helper(new Box3().setFromObject(selectedClone), 0x00ff00);
        // scene.add(bboxHelper);

        // selectedClone.traverse(child => {
        //     if ((child as SkinnedMesh).isSkinnedMesh) {
        //         const skinnedMesh = child as SkinnedMesh;
        //         if (skinnedMesh.skeleton) {
        //             const skeletonHelper = new SkeletonHelper(selectedClone);
        //             (skeletonHelper.material as LineBasicMaterial).linewidth = 3;
        //             scene.add(skeletonHelper);
        //         }
        //     }
        // });

        camera.position.set(center.x, center.y + size * 0.5, center.z + size);
        camera.lookAt(center);
        camera.near = size / 100 || 0.1;
        camera.far = size * 100 || 1000;
        camera.updateProjectionMatrix();

        scene.add(selectedClone);
        externalCloneRef.current = selectedClone;

        const sizeVec = bbox.getSize(new Vector3());
        const maxExtent = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
        const planeY = bbox.min.y - 0.01;

        const shadowGroup = new Group();
        shadowGroup.visible = false;
        shadowGroup.position.set(center.x, planeY, center.z);
        scene.add(shadowGroup);

        const renderTarget = new RenderTarget(512, 512, {depthBuffer: true});
        renderTarget.texture.generateMipmaps = false;

        const PLANE_SIZE = Math.max(0.5, maxExtent * 1.5);
        const CAMERA_HEIGHT = Math.max(0.1, sizeVec.y + 0.5);
        const planeGeometry = new PlaneGeometry(PLANE_SIZE, PLANE_SIZE).rotateX(Math.PI / 2);

        const uBlur = uniform(5.5);
        const uDarkness = uniform(1.0);
        const uShadowOpacity = uniform(1.0);
        const uPlaneOpacity = uniform(0.9);
        const uPlaneColor = uniform(new Color(0x282828));

        const depthMaterial = new MeshBasicNodeMaterial();
        const alphaDepth = float(1).sub(depth).mul(uDarkness);
        depthMaterial.outputNode = vec4(vec3(0), alphaDepth);
        depthMaterial.depthTest = false;
        depthMaterial.depthWrite = false;

        const shadowPlaneMaterial = new MeshBasicNodeMaterial();
        shadowPlaneMaterial.transparent = true;
        shadowPlaneMaterial.depthWrite = false;
        const blurredShadow = gaussianBlur(texture(renderTarget.texture), uBlur, 4, {premultipliedAlpha: false});

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

        const shadowCamera = new OrthographicCamera(
            -PLANE_SIZE / 2,
            PLANE_SIZE / 2,
            PLANE_SIZE / 2,
            -PLANE_SIZE / 2,
            0,
            CAMERA_HEIGHT,
        );
        shadowCamera.rotation.x = Math.PI / 2;
        shadowGroup.add(shadowCamera);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.copy(center);
        controls.enableDamping = true;

        let autoRotate = false;
        let interacted = false;
        let autoRotateTimeout: ReturnType<typeof setTimeout>;

        const stopAutoRotate = () => {
            if (!interacted) {
                interacted = true;
                autoRotate = false;
                controls.autoRotate = false;
                window.removeEventListener("mousedown", stopAutoRotate);
                window.removeEventListener("touchstart", stopAutoRotate);
                window.removeEventListener("keydown", stopAutoRotate);
            }
        };

        autoRotateTimeout = setTimeout(() => {
            if (!interacted) autoRotate = true;
        }, 5000);

        window.addEventListener("mousedown", stopAutoRotate);
        window.addEventListener("touchstart", stopAutoRotate);
        window.addEventListener("keydown", stopAutoRotate);

        const handleResize = () => {
            applySize();
        };
        window.addEventListener("resize", handleResize);

        let postProcessing: RenderPipeline | null = null;
        let outlinePass: ReturnType<typeof outline> | null = null;

        void (async () => {
            try {
                await rendererInitPromise;
                if (!isMounted) return;
                const scenePass = pass(scene, camera);
                const colorTex = scenePass.getTextureNode("output");
                const vignette = screenUV
                    .distance(0.5)
                    .remap(0.5, 1.0)
                    .mul(2.0)
                    .clamp()
                    .oneMinus()
                    .add((bayer16(screenCoordinate) as any).r.sub(0.5).mul(0.1));

                const getUniqueMaterialCount = (obj: Object3D): number => {
                    const materials = new Set<string>();
                    obj.traverse(child => {
                        if (child instanceof Mesh) {
                            const mesh = child as Mesh;
                            if (Array.isArray(mesh.material)) {
                                mesh.material.forEach(m => materials.add(m.uuid));
                            } else if (mesh.material) {
                                materials.add(mesh.material.uuid);
                            }
                        }
                    });
                    return materials.size;
                };

                let selectedObjects: Object3D[] = [];
                if (materialInfo) {
                    // If object has only one unique material, avoid outlining meshes for the selected material
                    const uniqueMatCount = getUniqueMaterialCount(selectedClone);
                    if (uniqueMatCount > 1) {
                        const found = findMaterialByPathKey(selectedClone, materialInfo.pathKey);
                        if (found) {
                            selectedObjects = [found.mesh];
                        }
                    }
                }

                outlinePass = outline(scene, camera, {
                    selectedObjects,
                    edgeGlow: uniform(0.0),
                    edgeThickness: uniform(0.5),
                });

                outlinePassRef.current = outlinePass;

                const {visibleEdge, hiddenEdge} = outlinePass;
                const edgeStrength = uniform(3.0);
                const visibleEdgeColor = uniform(new Color(0xffffff));
                const hiddenEdgeColor = uniform(new Color(0x4e3636));

                const outlineColor = visibleEdge
                    .mul(visibleEdgeColor)
                    .add(hiddenEdge.mul(hiddenEdgeColor))
                    .mul(edgeStrength);

                postProcessing = new RenderPipeline(renderer);
                postProcessing.outputNode = outlineColor.add(colorTex.mul(vignette));
            } catch {
                console.warn("[PrimitiveViewer] Failed to init WebGPU PostProcessing, falling back to direct render.");
            }
        })();

        const animate = () => {
            if (!isMounted) return;
            requestAnimationFrame(animate);
            controls.autoRotate = autoRotate;
            controls.autoRotateSpeed = 0.5;
            controls.update();
            try {
                const prevBg = scene.background as Color | null;
                scene.background = null;
                const prevOverride = scene.overrideMaterial;
                const prevAutoClear = renderer.autoClear;
                const hasGetClearAlpha = typeof renderer.getClearAlpha === "function";
                const prevClearAlpha = hasGetClearAlpha ? renderer.getClearAlpha() : undefined;

                const prevPlaneVisible = shadowPlane.visible;
                const prevFillVisible = fillPlane.visible;
                shadowPlane.visible = false;
                fillPlane.visible = false;

                scene.overrideMaterial = depthMaterial;
                renderer.autoClear = true;
                if (hasGetClearAlpha && prevClearAlpha !== undefined && renderer.setClearAlpha)
                    renderer.setClearAlpha(0);

                renderer.setRenderTarget(renderTarget);
                void renderer.clear();
                void renderer.render(scene, shadowCamera);

                scene.overrideMaterial = prevOverride;
                renderer.setRenderTarget(null);
                renderer.autoClear = prevAutoClear;
                if (hasGetClearAlpha && prevClearAlpha !== undefined && renderer.setClearAlpha)
                    renderer.setClearAlpha(prevClearAlpha);
                scene.background = prevBg;
                shadowPlane.visible = prevPlaneVisible;
                fillPlane.visible = prevFillVisible;
            } catch {
                // ignore error
            }
            if (postProcessing) {
                try {
                    void postProcessing.render();
                } catch {
                    void renderer.render(scene, camera);
                }
            } else {
                void renderer.render(scene, camera);
            }
        };

        rendererInitPromise
            .then(() => {
                if (!isMounted) return;
                animate();
            })
            .catch((err: Error) => {
                console.error("Failed to initialize renderer:", err);
            });

        disposePreview = () => {
            isMounted = false;
            clearTimeout(autoRotateTimeout);
            window.removeEventListener("mousedown", stopAutoRotate);
            window.removeEventListener("touchstart", stopAutoRotate);
            window.removeEventListener("keydown", stopAutoRotate);
            window.removeEventListener("resize", handleResize);
            scene.clear();
            // scene.traverse(obj => {
            //     if ((obj as THREE.Mesh).isMesh) {
            //         MeshUtils.dispose(obj);
            //     }
            // });
            try {
                postProcessing?.dispose?.();
            } catch {
                // ignore error
            }
            try {
                sceneEnvironmentTexture?.dispose();
                sceneEnvironmentTexture = null;
            } catch {
                // ignore error
            }
            try {
                depthMaterial.dispose();
                shadowPlaneMaterial.dispose();
                fillPlaneMaterial.dispose();
                planeGeometry.dispose();
            } catch {
                // ignore error
            }
            try {
                renderTarget.dispose();
            } catch {
                // ignore error
            }
            renderer.dispose();
            if (viewer.current) {
                viewer.current.removeChild(renderer.domElement);
            }
            externalCloneRef.current = null;
        };
        })().catch((error: unknown) => {
            console.error("[PrimitiveViewer] Failed to load WebGPU renderer:", error);
        });

        return () => {
            isMounted = false;
            disposePreview?.();
        };
    }, [selected, materialInfo]);

    type WithMatSettings = Object3D & {userData: {materialSettings?: IMaterialSettings}};
    const settingsDep: IMaterialSettings | undefined = (selected as WithMatSettings | undefined)?.userData
        ?.materialSettings;
    const materialSettingsKey = useMemo(() => {
        try {
            const s = selected as WithMatSettings | undefined;
            return JSON.stringify(s?.userData?.materialSettings ?? {});
        } catch {
            return "";
        }
    }, [selected, settingsDep]);

    useEffect(() => {
        if (!externalCloneRef.current || !selected) return;
        const s = selected as WithMatSettings | undefined;
        const userDataSettings = s?.userData?.materialSettings;

        if (materialInfo) {
            if (pendingSettings && pendingSettings.pathKey === materialInfo.pathKey) {
                const map: {[key: string]: IMaterialSettings} = {};
                map[pendingSettings.pathKey] = pendingSettings.settings;
                applyMaterialSettingsToSpecificMaterial(externalCloneRef.current, map, materialInfo.pathKey, context);
            } else if (userDataSettings) {
                applyMaterialSettingsToSpecificMaterial(
                    externalCloneRef.current,
                    userDataSettings,
                    materialInfo.pathKey,
                    context,
                );
            }
        } else {
            if (userDataSettings) {
                applyMaterialSettingsToObject(externalCloneRef.current, userDataSettings, context);
            }

            if (pendingSettings) {
                const map: {[key: string]: IMaterialSettings} = {};
                map[pendingSettings.pathKey] = pendingSettings.settings;
                applyMaterialSettingsToSpecificMaterial(externalCloneRef.current, map, pendingSettings.pathKey, context);
            }
        }
    }, [materialSettingsKey, materialInfo, context, pendingSettings]);

    useEffect(() => {
        if (!externalCloneRef.current || !outlinePassRef.current) return;
        let selectedObjects: Object3D[] = [];
        if (materialInfo) {
            const found = findMaterialByPathKey(externalCloneRef.current, materialInfo.pathKey);
            if (found) {
                selectedObjects = [found.mesh];
            }
        }
        outlinePassRef.current.selectedObjects = selectedObjects;
    }, [materialInfo, externalCloneRef.current]);

    return <div style={{height: "100%", width: "100%"}}
        ref={viewer}
           />;
};

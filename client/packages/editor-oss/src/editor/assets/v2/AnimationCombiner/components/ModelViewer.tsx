import I18n from "i18next";
import React, {useEffect, useRef} from "react";
import styled from "styled-components";
import * as THREE from "three";
import {bayer16} from "three/addons/tsl/math/Bayer.js";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {gaussianBlur} from "three/addons/tsl/display/GaussianBlurNode.js";
import {pass, screenUV, screenCoordinate, vec3, vec4, uniform, texture, depth, float} from "three/tsl";
import {RenderTarget} from "three";
import {MeshBasicNodeMaterial, RenderPipeline} from "three/webgpu";
import type {WebGPURenderer} from "three/webgpu";
// Experimental node-based shading helpers for vignette & contact shadow
 
 
 

import {AnimationGraph} from "../../../../../animation/AnimationGraph";
import {useModelAnimationCombinerContext} from "@stem/editor-oss/context";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import {loadModel as loadModelById} from "@stem/editor-oss/model/load-util";
import {showToast} from "@stem/editor-oss/showToast";
import MeshUtils from "@stem/editor-oss/utils/MeshUtils";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {positionCameraForModel} from "../../utils/positionCameraForModel";
import loadModel from "../helpers/loadModel";
import resizeWindow from "../helpers/resizeWindow";
import setCamera from "../helpers/setCamera";
import setLights from "../helpers/setLights";



const Container = styled.div`
    display: flex;
    width: 100%;
    height: 100%;
`;

const ViewerContainer = styled.div`
    flex: 1;
    height: 100%;
`;

interface ModelViewerProps {
    fileExt: string | null;
    model: any;
    handleClose: () => void;
    setSerializedAnimationGraph?: (graphStr: string) => void;
    showBoneInfo?: boolean;
}

export const ModelViewer: React.FC<ModelViewerProps> = ({
    fileExt,
    model,
    handleClose,
    setSerializedAnimationGraph,
    showBoneInfo = false,
}) => {
    const viewer = useRef<HTMLDivElement>(null);
    const {
        addMainModel,
        addAnimationFromMainModel,
        addMixer,
        toggleLoading,
        setAnimationGraph,
        // for Escape behavior
        setSelectedNode,
        setSelectedEdge,
        setUploadOptionSelected,
        mixer,
    } = useModelAnimationCombinerContext();
    const {context} = useAssetResolutionContext();
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const graphRef = useRef<AnimationGraph | null>(null);
    const CLEAR_COLOR = new THREE.Color(0x282828);

    useEffect(() => {
        if (mixerRef.current) {
            if (mixerRef.current.stopAllAction) {
                mixerRef.current.stopAllAction();
            }
        }
        if (graphRef.current && typeof graphRef.current.reset === "function") {
            graphRef.current.reset();
        }
    }, []);

    useEffect(() => {
        // On Escape: prevent overlay close, show Parameters panel, and stop all mixer actions
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                // prevent any higher-level Escape handlers
                e.stopPropagation();

                // Ensure ParametersPanel is shown by clearing selections and revealing panel
                setSelectedNode?.(null);
                setSelectedEdge?.(null);
                setUploadOptionSelected?.(false);

                // Stop all running animation actions in the mixer
                try {
                    mixer?.stopAllAction?.();
                } catch {
                    // noop
                }
            }
        };
        window.addEventListener("keydown", onKeyDown, true);

        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [mixer, setSelectedNode, setSelectedEdge, setUploadOptionSelected]);

    const setupJointMarkers = (jointMarkers: any, scene: THREE.Scene, model: THREE.Object3D) => {
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);

        const maxDimension = Math.max(size.x, size.y, size.z);

        const sphereRadius = maxDimension * 0.004;
        const axisLength = maxDimension * 0.02; // Length of axis arrows

        model.traverse((child: THREE.Object3D) => {
            if (child.type === "Bone") {
                const geometry = new THREE.SphereGeometry(sphereRadius, 16, 16);
                const material = new THREE.MeshBasicMaterial({
                    color: 0x0000ff,
                    depthTest: false,
                    depthWrite: false,
                });
                const sphere = new THREE.Mesh(geometry, material);

                sphere.renderOrder = 9999;
                sphere.position.copy(child.getWorldPosition(new THREE.Vector3()));
                // Optional overlays: bone name and axes
                if (showBoneInfo) {
                    const canvas = document.createElement("canvas");
                    const context = canvas.getContext("2d");
                    if (context) {
                        canvas.width = 256;
                        canvas.height = 64;
                        context.fillStyle = "white";
                        context.font = "24px Arial";
                        context.textAlign = "center";
                        context.fillText(child.name || "Bone", canvas.width / 2, canvas.height / 2);

                        const texture = new THREE.CanvasTexture(canvas);
                        const spriteMaterial = new THREE.SpriteMaterial({
                            map: texture,
                            transparent: true,
                            depthTest: false,
                            depthWrite: false,
                        });
                        const sprite = new THREE.Sprite(spriteMaterial);
                        sprite.scale.set(maxDimension * 0.1, maxDimension * 0.025, 1);
                        sprite.position.set(0, sphereRadius * 2, 0);
                        sprite.renderOrder = 10000;
                        sphere.add(sprite);
                    }

                    const axesGroup = new THREE.Group();

                    const xArrow = new THREE.ArrowHelper(
                        new THREE.Vector3(1, 0, 0),
                        new THREE.Vector3(0, 0, 0),
                        axisLength,
                        0xff0000,
                        axisLength * 0.2,
                        axisLength * 0.1,
                    );
                    if (xArrow.line && xArrow.line.material) {
                        (xArrow.line.material as THREE.Material).depthTest = false;
                        (xArrow.line.material as THREE.Material).depthWrite = false;
                    }
                    if (xArrow.cone && xArrow.cone.material) {
                        (xArrow.cone.material as THREE.Material).depthTest = false;
                        (xArrow.cone.material as THREE.Material).depthWrite = false;
                    }
                    axesGroup.add(xArrow);

                    const yArrow = new THREE.ArrowHelper(
                        new THREE.Vector3(0, 1, 0),
                        new THREE.Vector3(0, 0, 0),
                        axisLength,
                        0x00ff00,
                        axisLength * 0.2,
                        axisLength * 0.1,
                    );
                    if (yArrow.line && yArrow.line.material) {
                        (yArrow.line.material as THREE.Material).depthTest = false;
                        (yArrow.line.material as THREE.Material).depthWrite = false;
                    }
                    if (yArrow.cone && yArrow.cone.material) {
                        (yArrow.cone.material as THREE.Material).depthTest = false;
                        (yArrow.cone.material as THREE.Material).depthWrite = false;
                    }
                    axesGroup.add(yArrow);

                    const zArrow = new THREE.ArrowHelper(
                        new THREE.Vector3(0, 0, 1),
                        new THREE.Vector3(0, 0, 0),
                        axisLength,
                        0x0000ff,
                        axisLength * 0.2,
                        axisLength * 0.1,
                    );
                    if (zArrow.line && zArrow.line.material) {
                        (zArrow.line.material as THREE.Material).depthTest = false;
                        (zArrow.line.material as THREE.Material).depthWrite = false;
                    }
                    if (zArrow.cone && zArrow.cone.material) {
                        (zArrow.cone.material as THREE.Material).depthTest = false;
                        (zArrow.cone.material as THREE.Material).depthWrite = false;
                    }
                    axesGroup.add(zArrow);

                    axesGroup.quaternion.copy(child.getWorldQuaternion(new THREE.Quaternion()));
                    axesGroup.renderOrder = 9998;
                    sphere.add(axesGroup);
                }

                jointMarkers.push({sphere, bone: child});
                scene.add(sphere);
            }
        });
    };

    useEffect(() => {
        let cleanupModelViewer: (() => void) | undefined;
        let disposed = false;

        const processModel= async () => {
            if (!model || !fileExt || !viewer.current) return;
            const {WebGPURenderer} = await import("three/webgpu");
            if (disposed || !viewer.current) return;

            const scene = new THREE.Scene();
            scene.name = "AnimationCombinerScene";
            const camera = setCamera(viewer.current);
            const controls = new OrbitControls(camera, viewer.current);
            let mixer: THREE.AnimationMixer | null = null;
            let graph: AnimationGraph | null = null;

            const renderer: WebGPURenderer = new WebGPURenderer({antialias: true, alpha: false});
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setClearColor(CLEAR_COLOR);
            resizeWindow(camera, viewer.current, renderer);
            await renderer.init();

            if (viewer.current.children.length) viewer.current.removeChild(viewer.current.lastChild as Node);
            viewer.current.appendChild(renderer.domElement);

            scene.fog = new THREE.Fog(CLEAR_COLOR, 2000, 3000);

            // Contact shadow & vignette placeholders
            let shadowGroup: THREE.Group | null = null;
            let shadowPlane: THREE.Mesh | null = null;
            let fillPlane: THREE.Mesh | null = null;
            let shadowCamera: THREE.OrthographicCamera | null = null;
            let renderTarget: RenderTarget | null = null;
            let depthMaterial: MeshBasicNodeMaterial | null = null;
            let shadowPlaneMaterial: MeshBasicNodeMaterial | null = null;
            let fillPlaneMaterial: MeshBasicNodeMaterial | null = null;
            let postProcessing: RenderPipeline | null = null;
            let postProcessingReady = false;
            let url = backendUrlFromPath(model.userData.Url);

            let jointMarkers: any[] = [];
            let loadedObjects: THREE.Object3D[] = [];

            const onModelLoaded = (object: any) => {
                toggleLoading();

                if (!object._obj) {
                    object._obj = object;
                }
                if (!object._obj.animations && object.animations) {
                    object._obj.animations = object.animations;
                }

                Object.assign(object._obj.animations, model._obj?.animations || model?.animations);
                addAnimationFromMainModel(object._obj.animations || object.animations);
                mixer = new THREE.AnimationMixer(object);
                addMixer(mixer);
                mixerRef.current = mixer;


                const extensionGraph = object?._obj?.animationGraph as AnimationGraph | undefined;
                if (extensionGraph) {
                    try {
                        const graphJSON = extensionGraph.toJSON();
                        const clipsArr: THREE.AnimationClip[] =
                            object?._obj?.animations || object?.animations || [];
                        const clipMap: Record<string, THREE.AnimationClip> = {};
                        clipsArr.forEach((clip: THREE.AnimationClip) => {
                            if (clip && clip.name) clipMap[clip.name] = clip;
                        });
                        const boundGraph = new AnimationGraph(object);
                        boundGraph.fromJSON(graphJSON, clipMap);
                        graph = boundGraph;
                    } catch (e) {

                        console.warn("Failed to load animation graph from extension, falling back:", e);
                        graph = new AnimationGraph(object);
                    }
                } else {
                    graph = new AnimationGraph(object);
                }

                setAnimationGraph(graph);
                graphRef.current = graph;

                if (setSerializedAnimationGraph) {
                    try {
                        const graphStr = graph.toJSON();
                        setSerializedAnimationGraph(graphStr);
                    } catch (e) {

                        console.warn("Failed to serialize animation graph:", e);
                    }
                }

                scene.add(object);
                loadedObjects.push(object);
                addMainModel(object);
                positionCameraForModel(object, camera, controls);

                const box = new THREE.Box3().setFromObject(object);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());

                object.position.sub(center);

                const boxAfterCenter = new THREE.Box3().setFromObject(object);
                const floorOffset = -boxAfterCenter.min.y;
                if (Number.isFinite(floorOffset)) {
                    object.position.y += floorOffset;
                }

                const boxAfterOffset = new THREE.Box3().setFromObject(object);
                const centerAfterOffset = boxAfterOffset.getCenter(new THREE.Vector3());
                controls.target.copy(centerAfterOffset);
                camera.lookAt(centerAfterOffset);

                const maxDim = Math.max(size.x, size.y, size.z);
                const distance = maxDim * 2;

                const panelFraction = 0.6;
                const visibleWidth = 2 * distance * Math.tan(camera.fov * Math.PI / 360);
                const xShift = visibleWidth * (panelFraction / 2);

                camera.position.set(xShift, maxDim * 0.5, distance);
                controls.update();

                setupJointMarkers(jointMarkers, scene, object);

                object.traverse((child: any) => {
                    if (child.isMesh) child.castShadow = true;
                });

                // Contact shadow setup (depth pre-pass -> gaussian blur -> composite)
                try {
                    const bbox = new THREE.Box3().setFromObject(object);
                    const sizeVec = bbox.getSize(new THREE.Vector3());
                    const maxExtent = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
                    const PLANE_SIZE = Math.max(0.5, maxExtent * 2);
                    const CAMERA_HEIGHT = Math.max(0.1, sizeVec.y + 0.5);
                    shadowGroup = new THREE.Group();
                    scene.add(shadowGroup);
                    renderTarget = new RenderTarget(512, 512, {depthBuffer: true});
                    renderTarget.texture.generateMipmaps = false;
                    const planeGeometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE).rotateX(Math.PI / 2);
                    const uBlur = uniform(3.0);
                    const uDarkness = uniform(1.0);
                    const uShadowOpacity = uniform(1.0);
                    const uPlaneOpacity = uniform(0.9);
                    const uPlaneColor = uniform(new THREE.Color(0x282828));

                    depthMaterial = new MeshBasicNodeMaterial();
                    // Inverted depth: Near (0) -> 1 (Shadow), Far (1) -> 0 (No Shadow).
                    const invertedDepth = float(1.0).sub(depth).mul(uDarkness).clamp();
                    depthMaterial.outputNode = vec4(vec3(0), invertedDepth);
                    depthMaterial.depthTest = true;
                    depthMaterial.depthWrite = true;

                    shadowPlaneMaterial = new MeshBasicNodeMaterial();
                    shadowPlaneMaterial.transparent = true;
                    shadowPlaneMaterial.depthWrite = false;
                    const blurredShadow = gaussianBlur(texture(renderTarget.texture), uBlur, 4, {
                        premultipliedAlpha: false,
                    });
                    // Shadow intensity comes directly from the alpha we baked
                    shadowPlaneMaterial.outputNode = vec4(
                        vec3(0),
                        blurredShadow.a.mul(uShadowOpacity),
                    );

                    shadowPlane = new THREE.Mesh(planeGeometry, shadowPlaneMaterial);
                    shadowPlane.renderOrder = 1;
                    shadowPlane.scale.y = -1;
                    shadowPlane.scale.z = -1;
                    shadowGroup.add(shadowPlane);
                    fillPlaneMaterial = new MeshBasicNodeMaterial();
                    fillPlaneMaterial.transparent = true;
                    fillPlaneMaterial.depthWrite = false;
                    fillPlaneMaterial.outputNode = vec4(uPlaneColor, uPlaneOpacity);
                    fillPlane = new THREE.Mesh(planeGeometry, fillPlaneMaterial);
                    fillPlane.rotateX(Math.PI);
                    // shadowGroup.add(fillPlane);
                    shadowCamera = new THREE.OrthographicCamera(
                        -PLANE_SIZE / 2,
                        PLANE_SIZE / 2,
                        PLANE_SIZE / 2,
                        -PLANE_SIZE / 2,
                        -0.25,
                         CAMERA_HEIGHT,
                    );
                    shadowCamera.rotation.x = Math.PI / 2;
                    shadowGroup.add(shadowCamera);
                    // Vignette post-processing (radial falloff + subtle dithering)
                    const scenePass = pass(scene, camera);
                    const colorTex = scenePass.getTextureNode("output");
                    const vignette = screenUV
                        .distance(0.5)
                        .remap(0.5, 1.0)
                        .mul(2.0)
                        .clamp()
                        .oneMinus()
                        .add((bayer16(screenCoordinate) as any).r.sub(0.5).mul(0.1));
                    postProcessing = new RenderPipeline(renderer);
                    postProcessing.outputNode = colorTex.mul(vignette);
                    postProcessingReady = true;
                } catch {
                    // contact shadow or vignette setup failed – silent fallback
                }
            };

            const onError = () => {
                toggleLoading();
                handleClose();
            };

            toggleLoading();
            // Prioritize modelId (modern asset API) over legacy URL to ensure
            // asset resolution context is properly populated for saving
            if (model.userData.modelId) {
                loadModelById(model.userData.modelId as string, context, {preferLod: 0})
                    .then((object) => {
                        if (object) {
                            Object.assign(object.userData, model.userData, { Server: true });
                            onModelLoaded(object);
                        } else {
                            onError();
                        }
                    })
                    .catch((e) => {
                        console.error(e);
                        showToast({type: "error", title: I18n.t("Failed to load model from ID")});
                        onError();
                    });
            } else if (url) {
                loadModel(
                    url,
                    model.userData,
                    onModelLoaded,
                    onError,
                );
            } else {
                showToast({type: "error", title: I18n.t("No model URL or ID found in model data")});
                toggleLoading();
                handleClose();
            }

            setLights(scene);
            scene.background = new THREE.Color(0x29292a);
            (renderer as any).render(scene, camera);

            const handleResize = () => resizeWindow(camera, viewer.current as HTMLElement, renderer);
            window.addEventListener("resize", handleResize);
            let lastTime = 0;

            let isMounted = true;
            const animate = (time: number) => {
                if (!isMounted) return;
                requestAnimationFrame(animate);

                const delta = (time - lastTime) / 1000;

                // Update mixer only if there is an active animation action
                const mixerHasActiveAction = !!(mixer as any)?._actions?.some((action: THREE.AnimationAction) =>
                    action.isRunning(),
                );

                if (mixer && mixerHasActiveAction) {
                    mixer.update(delta);
                } else if (graph) {
                    graph.update(delta);
                }

                lastTime = time;

                // Update joint markers
                jointMarkers.forEach(({sphere, bone}) => {
                    sphere.position.copy(bone.getWorldPosition(new THREE.Vector3()));
                    // Sprites now follow sphere automatically as children, so no need to update them manually
                });

                // Depth pre-pass for contact shadow
                if (shadowCamera && renderTarget && depthMaterial && shadowPlane && fillPlane) {
                    try {
                        const prevBg = scene.background as THREE.Color | null;
                        scene.background = null;
                        const prevOverride = scene.overrideMaterial;
                        const prevPlaneVisible = shadowPlane.visible;
                        const prevFillVisible = fillPlane.visible;
                        shadowPlane.visible = false;
                        fillPlane.visible = false;

                        const prevClearColor = new THREE.Color();
                        const prevClearAlpha = renderer.getClearAlpha();
                        renderer.getClearColor(prevClearColor as any);
                        renderer.setClearColor(0x000000, 0);

                        scene.overrideMaterial = depthMaterial;
                        renderer.setRenderTarget(renderTarget);

                        renderer.clear();

                        (renderer as any).render(scene, shadowCamera);

                        renderer.setRenderTarget(null);

                        renderer.setClearColor(prevClearColor, prevClearAlpha);

                        scene.overrideMaterial = prevOverride;
                        scene.background = prevBg;
                        shadowPlane.visible = prevPlaneVisible;
                        fillPlane.visible = prevFillVisible;
                    } catch {
                        // depth pre-pass failed
                    }
                }
                controls.update();
                if (postProcessing && postProcessingReady) {
                    try {
                        void postProcessing.render();
                    } catch {
                        (renderer as any).render(scene, camera);
                    }
                } else {
                    (renderer as any).render(scene, camera);
                }
            };

            renderer.init().then(() => {
                animate(0);
            }).catch((err: Error) => {
                console.error("Failed to initialize renderer:", err);
            });

            return () => {
                isMounted = false;
                window.removeEventListener("resize", handleResize);
                // Dispose of all Three.js resources
                if (controls) controls.dispose();
                if (scene) {
                    scene.traverse(obj => {
                        if ((obj as THREE.Mesh).isMesh) {
                            MeshUtils.dispose(obj);
                        }
                    });
                    // Remove loaded objects
                    loadedObjects.forEach(obj => {
                        scene.remove(obj);
                    });
                    // Remove joint marker spheres
                    jointMarkers.forEach(({sphere}) => {
                        scene.remove(sphere);
                        if (sphere.geometry) sphere.geometry.dispose?.();
                        if (sphere.material) (sphere.material as THREE.Material).dispose?.();

                        // Sprites and axes are now children of spheres, so they'll be disposed automatically
                    });
                }
                try {
                    postProcessing?.dispose?.();
                } catch {
                    /* noop */
                }
                try {
                    renderTarget?.dispose?.();
                } catch {
                    /* noop */
                }
                (renderer as any).dispose();
                if (viewer.current && (renderer as any).domElement?.parentNode === viewer.current) {
                    viewer.current.removeChild((renderer as any).domElement);
                }
            };
        };

        void processModel().then(nextCleanup => {
            if (typeof nextCleanup !== "function") return;
            if (disposed) {
                nextCleanup();
                return;
            }
            cleanupModelViewer = nextCleanup;
        });

        return () => {
            disposed = true;
            cleanupModelViewer?.();
        };
    }, [model, fileExt]);

    return (
        <Container>
            <ViewerContainer ref={viewer} />
        </Container>
    );
};

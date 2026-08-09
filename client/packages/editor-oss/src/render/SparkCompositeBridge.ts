import { SparkWebGpuRenderer } from '@querielo/spark';
import { Camera, Float32BufferAttribute, Material, MeshDepthMaterial, Object3D, Scene, SkinnedMesh, WebGLRenderer } from 'three';
import type { BufferAttribute, InterleavedBufferAttribute, Skeleton } from 'three';
import type {WebGPURenderer} from "three/webgpu";
import {findObjectByNameDepthFirst, traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

const SPARK_COMPOSITE_NAME = '__SparkWebGpuRenderer';
const SPARK_SKINNED_DEPTH_PATCHED = Symbol('sparkSkinnedDepthPatched');
const SPARK_SKINNED_DEPTH_MATERIAL = Symbol('sparkSkinnedDepthMaterial');
const SPARK_SKINNED_DEPTH_CANDIDATES = Symbol('sparkSkinnedDepthCandidates');
const SPARK_SKINNED_DEPTH_VISIBLE_MESHES = Symbol('sparkSkinnedDepthVisibleMeshes');
const SPARK_SKINNED_DEPTH_LAST_SCAN_TIME = Symbol('sparkSkinnedDepthLastScanTime');
const SPARK_SKINNED_DEPTH_SCAN_INTERVAL_MS = 250;

type SparkRendererLike = Object3D & {
    render: (scene: Scene, camera: Camera) => unknown;
};

type SparkCompositeRuntime = Object3D & {
    [SPARK_SKINNED_DEPTH_PATCHED]?: boolean;
    [SPARK_SKINNED_DEPTH_MATERIAL]?: MeshDepthMaterial;
    [SPARK_SKINNED_DEPTH_CANDIDATES]?: SkinnedMesh[];
    [SPARK_SKINNED_DEPTH_VISIBLE_MESHES]?: SkinnedMesh[];
    [SPARK_SKINNED_DEPTH_LAST_SCAN_TIME]?: number;
    prepareComposite?: (renderer: WebGPURenderer, scene: Scene, camera: Camera) => unknown;
    spark?: SparkRendererLike;
    webglRenderer?: WebGLRenderer;
};

type SkeletonState = {
    boneMatrices: Float32Array | null;
    previousBoneMatrices: Float32Array | null;
    boneTexture: Skeleton['boneTexture'];
};

type SkeletonWithPreviousMatrices = Skeleton & {
    previousBoneMatrices?: Float32Array | null;
};

type SkinIndexAttribute = BufferAttribute | InterleavedBufferAttribute;

type SkinIndexAttributeSnapshot = {
    geometry: SkinnedMesh['geometry'];
    attribute: SkinIndexAttribute;
};

const webGLSkinIndexAttributeCache = new WeakMap<object, BufferAttribute>();

const findSparkComposite = (scene: Scene): SparkWebGpuRenderer | null => {
    const existing = findObjectByNameDepthFirst(scene, SPARK_COMPOSITE_NAME);
    return existing instanceof SparkWebGpuRenderer ? existing : null;
};

const isSkinnedMesh = (object: Object3D): object is SkinnedMesh => {
    return (object as SkinnedMesh).isSkinnedMesh === true;
};

const getMaterials = (material: SkinnedMesh['material']): Material[] => {
    return Array.isArray(material) ? material : [material];
};

const writesDepth = (mesh: SkinnedMesh): boolean => {
    return getMaterials(mesh.material).some(material => material.visible && material.depthWrite);
};

const isEffectivelyVisible = (object: Object3D, root: Scene): boolean => {
    let current: Object3D | null = object;

    while (current) {
        if (!current.visible) {
            return false;
        }

        if (current === root) {
            return true;
        }

        current = current.parent;
    }

    return false;
};

export const collectSkinnedDepthCandidates = (scene: Scene): SkinnedMesh[] => {
    const meshes: SkinnedMesh[] = [];

    traverseObjectDepthFirst(scene, object => {
        if (isSkinnedMesh(object) && writesDepth(object)) {
            meshes.push(object);
        }
    });

    return meshes;
};

export const getVisibleSkinnedDepthMeshes = (runtime: SparkCompositeRuntime, scene: Scene): SkinnedMesh[] => {
    const now = globalThis.performance?.now() ?? Date.now();
    const lastScanTime = runtime[SPARK_SKINNED_DEPTH_LAST_SCAN_TIME] ?? -Infinity;
    if (!runtime[SPARK_SKINNED_DEPTH_CANDIDATES] || now - lastScanTime >= SPARK_SKINNED_DEPTH_SCAN_INTERVAL_MS) {
        runtime[SPARK_SKINNED_DEPTH_CANDIDATES] = collectSkinnedDepthCandidates(scene);
        runtime[SPARK_SKINNED_DEPTH_LAST_SCAN_TIME] = now;
    }

    const visibleMeshes = runtime[SPARK_SKINNED_DEPTH_VISIBLE_MESHES] ?? [];
    visibleMeshes.length = 0;

    for (const mesh of runtime[SPARK_SKINNED_DEPTH_CANDIDATES]) {
        if (
            mesh.parent !== null &&
            isEffectivelyVisible(mesh, scene) &&
            writesDepth(mesh)
        ) {
            visibleMeshes.push(mesh);
        }
    }

    runtime[SPARK_SKINNED_DEPTH_VISIBLE_MESHES] = visibleMeshes;
    return visibleMeshes;
};

const snapshotSkeletons = (meshes: SkinnedMesh[]): Map<Skeleton, SkeletonState> => {
    const snapshots = new Map<Skeleton, SkeletonState>();

    for (const mesh of meshes) {
        const skeleton = mesh.skeleton;
        if (skeleton && !snapshots.has(skeleton)) {
            const skeletonState = skeleton as SkeletonWithPreviousMatrices;
            snapshots.set(skeleton, {
                boneMatrices: skeleton.boneMatrices,
                previousBoneMatrices: skeletonState.previousBoneMatrices ?? null,
                boneTexture: skeleton.boneTexture,
            });
        }
    }

    return snapshots;
};

const compactSkeletonMatrices = (
    source: Float32Array | null | undefined,
    fallback: Float32Array | null | undefined,
    compactLength: number,
): Float32Array | null => {
    const sourceMatrices = source ?? fallback ?? null;

    if (!sourceMatrices) {
        return null;
    }

    if (fallback && fallback.length === compactLength) {
        if (sourceMatrices !== fallback) {
            fallback.set(sourceMatrices.subarray(0, compactLength));
        }
        return fallback;
    }

    const compactMatrices = new Float32Array(compactLength);
    compactMatrices.set(sourceMatrices.subarray(0, Math.min(sourceMatrices.length, compactLength)));
    return compactMatrices;
};

const restoreSkeletons = (snapshots: Map<Skeleton, SkeletonState>) => {
    for (const [skeleton, snapshot] of snapshots) {
        const skeletonState = skeleton as SkeletonWithPreviousMatrices;
        const compactLength = skeleton.bones.length * 16;
        const currentBoneTexture = skeleton.boneTexture;

        skeleton.boneMatrices = compactSkeletonMatrices(
            skeleton.boneMatrices,
            snapshot.boneMatrices,
            compactLength,
        );
        if (skeletonState.previousBoneMatrices || snapshot.previousBoneMatrices) {
            skeletonState.previousBoneMatrices = compactSkeletonMatrices(
                skeletonState.previousBoneMatrices,
                snapshot.previousBoneMatrices,
                compactLength,
            );
        }

        if (currentBoneTexture && currentBoneTexture !== snapshot.boneTexture) {
            currentBoneTexture.dispose();
        }

        if (snapshot.boneTexture) {
            snapshot.boneTexture.dispose();
        }

        // WebGLRenderer creates a padded boneTexture/boneMatrices pair. The
        // surrounding WebGPU renderer expects compact bone matrix buffers.
        skeleton.boneTexture = null;
    }
};

const getWebGLSkinIndexAttribute = (attribute: SkinIndexAttribute): BufferAttribute => {
    const cached = webGLSkinIndexAttributeCache.get(attribute);
    if (cached) {
        return cached;
    }

    const itemSize = attribute.itemSize;
    const array = new Float32Array(attribute.count * itemSize);

    for (let index = 0; index < attribute.count; index++) {
        for (let component = 0; component < itemSize; component++) {
            array[index * itemSize + component] = attribute.getComponent(index, component);
        }
    }

    const webGLAttribute = new Float32BufferAttribute(array, itemSize, false);
    webGLAttribute.name = attribute.name;
    webGLSkinIndexAttributeCache.set(attribute, webGLAttribute);

    return webGLAttribute;
};

const swapWebGLSkinIndexAttributes = (meshes: SkinnedMesh[]): SkinIndexAttributeSnapshot[] => {
    const snapshots: SkinIndexAttributeSnapshot[] = [];
    const seenGeometries = new Set<object>();

    for (const mesh of meshes) {
        const geometry = mesh.geometry;
        const skinIndex = geometry?.getAttribute('skinIndex') as SkinIndexAttribute | undefined;

        if (!geometry || !skinIndex || seenGeometries.has(geometry)) {
            continue;
        }

        seenGeometries.add(geometry);
        snapshots.push({ geometry, attribute: skinIndex });
        geometry.setAttribute('skinIndex', getWebGLSkinIndexAttribute(skinIndex));
    }

    return snapshots;
};

const restoreSkinIndexAttributes = (snapshots: SkinIndexAttributeSnapshot[]) => {
    for (const snapshot of snapshots) {
        snapshot.geometry.setAttribute('skinIndex', snapshot.attribute);
    }
};

const renderSkinnedDepth = (
    composite: SparkCompositeRuntime,
    scene: Scene,
    camera: Camera,
    skinnedMeshes: SkinnedMesh[],
    depthMaterial: MeshDepthMaterial,
) => {
    const renderer = composite.webglRenderer;
    if (!renderer || skinnedMeshes.length === 0) {
        return;
    }

    const previousOverrideMaterial = scene.overrideMaterial;
    const skeletonSnapshots = snapshotSkeletons(skinnedMeshes);
    const skinIndexAttributeSnapshots = swapWebGLSkinIndexAttributes(skinnedMeshes);
    const visibilitySnapshots: Array<{ object: Object3D; visible: boolean }> = [];
    const meshMaterialSnapshots: Array<{ mesh: SkinnedMesh; material: SkinnedMesh['material'] }> = [];
    const depthMaterialSnapshots = new Map<Material, { colorWrite: boolean; depthWrite: boolean; depthTest: boolean; visible: boolean }>();

    const setVisible = (object: Object3D | null | undefined, visible: boolean) => {
        if (!object) {
            return;
        }

        visibilitySnapshots.push({ object, visible: object.visible });
        object.visible = visible;
    };

    const prepareDepthMaterial = (material: Material) => {
        if (!depthMaterialSnapshots.has(material)) {
            depthMaterialSnapshots.set(material, {
                colorWrite: material.colorWrite,
                depthWrite: material.depthWrite,
                depthTest: material.depthTest,
                visible: material.visible,
            });
        }

        material.colorWrite = false;
        material.depthWrite = true;
        material.depthTest = true;
        material.visible = true;
    };

    try {
        renderer.resetState();
        scene.overrideMaterial = null;
        setVisible(composite, false);
        setVisible(composite.spark, false);

        for (const mesh of skinnedMeshes) {
            const meshDepthMaterial = mesh.customDepthMaterial ?? depthMaterial;

            setVisible(mesh, true);
            prepareDepthMaterial(meshDepthMaterial);
            meshMaterialSnapshots.push({ mesh, material: mesh.material });
            mesh.material = meshDepthMaterial;
        }

        renderer.render(scene, camera);
    } finally {
        restoreSkinIndexAttributes(skinIndexAttributeSnapshots);
        restoreSkeletons(skeletonSnapshots);
        renderer.resetState();

        for (let i = meshMaterialSnapshots.length - 1; i >= 0; i--) {
            const { mesh, material } = meshMaterialSnapshots[i]!;
            mesh.material = material;
        }

        for (const [material, snapshot] of depthMaterialSnapshots) {
            material.colorWrite = snapshot.colorWrite;
            material.depthWrite = snapshot.depthWrite;
            material.depthTest = snapshot.depthTest;
            material.visible = snapshot.visible;
        }

        for (let i = visibilitySnapshots.length - 1; i >= 0; i--) {
            const { object, visible } = visibilitySnapshots[i]!;
            object.visible = visible;
        }

        scene.overrideMaterial = previousOverrideMaterial;
    }
};

const patchSparkSkinnedDepth = (composite: SparkWebGpuRenderer) => {
    const runtime = composite as unknown as SparkCompositeRuntime;

    if (runtime[SPARK_SKINNED_DEPTH_PATCHED]) {
        return;
    }

    if (typeof runtime.prepareComposite !== 'function') {
        return;
    }

    const originalPrepareComposite = runtime.prepareComposite;
    const depthMaterial = new MeshDepthMaterial();
    depthMaterial.colorWrite = false;
    depthMaterial.depthTest = true;
    depthMaterial.depthWrite = true;

    runtime[SPARK_SKINNED_DEPTH_MATERIAL] = depthMaterial;
    runtime.prepareComposite = function prepareCompositeWithSkinnedDepth(renderer, scene, camera) {
        const spark = runtime.spark;
        const skinnedDepthMeshes = getVisibleSkinnedDepthMeshes(runtime, scene);

        if (!spark || skinnedDepthMeshes.length === 0) {
            return originalPrepareComposite.call(this, renderer, scene, camera);
        }

        const originalSparkRender = spark.render;
        spark.render = function renderSparkWithSkinnedDepth(sparkScene, sparkCamera) {
            renderSkinnedDepth(runtime, sparkScene, sparkCamera, skinnedDepthMeshes, depthMaterial);
            return originalSparkRender.call(this, sparkScene, sparkCamera);
        };

        try {
            return originalPrepareComposite.call(this, renderer, scene, camera);
        } finally {
            spark.render = originalSparkRender;
        }
    };
    runtime[SPARK_SKINNED_DEPTH_PATCHED] = true;
};

export const ensureSparkComposite = (
    scene: Scene,
    renderer: WebGPURenderer,
    parent?: Object3D | null,
): SparkWebGpuRenderer => {
    const existing = findSparkComposite(scene);
    if (existing) {
        const targetParent = parent ?? scene;
        if (existing.parent !== targetParent) {
            targetParent.add(existing);
        }
        patchSparkSkinnedDepth(existing);
        return existing;
    }

    const composite = new SparkWebGpuRenderer({ renderer });
    patchSparkSkinnedDepth(composite);
    composite.name = SPARK_COMPOSITE_NAME;
    composite.userData.isRuntimeOnly = true;
    composite.userData.sparkComposite = true;
    (parent ?? scene).add(composite);

    return composite;
};

export const disposeSparkComposite = (composite: SparkWebGpuRenderer | null | undefined) => {
    if (!composite) {
        return;
    }

    composite.removeFromParent();
    (composite as unknown as SparkCompositeRuntime)[SPARK_SKINNED_DEPTH_MATERIAL]?.dispose();
    composite.dispose();
};

import * as THREE from "three";

import {
    findObjectDepthFirst,
    traverseObjectDepthFirst,
} from "@stem/editor-oss/utils/SceneTraverser";
import type {
    PlanItemNode,
    PlanItemSource,
    PlanSceneJson,
    PlanSize3,
} from "./planCadCore";

type LoadablePlanItemSource = PlanItemSource & {
    type: "model";
    url: string;
    format?: "glb" | "gltf";
};

const modelTemplateCache = new Map<string, Promise<THREE.Object3D>>();

function inferModelFormat(source: PlanItemSource) {
    if (source.format === "glb" || source.format === "gltf") return source.format;
    const path = source.url?.split("?")[0]?.toLowerCase() ?? "";
    if (path.endsWith(".glb")) return "glb";
    if (path.endsWith(".gltf")) return "gltf";
    return null;
}

export function isPlanCadLoadableModelSource(
    source: PlanItemSource | null | undefined,
): source is LoadablePlanItemSource {
    return !!source && source.type === "model" && !!source.url && !!inferModelFormat(source);
}

export function getPlanCadModelSourceKey(source: PlanItemSource | null | undefined) {
    if (!isPlanCadLoadableModelSource(source)) return null;
    return [
        source.provider ?? "model",
        source.providerAssetId ?? source.assetId ?? source.url,
        source.url,
    ].join(":");
}

async function loadModelTemplate(source: LoadablePlanItemSource) {
    const key = getPlanCadModelSourceKey(source);
    if (!key) return null;

    let pending = modelTemplateCache.get(key);
    if (!pending) {
        pending = Promise.all([
            import("three/addons/loaders/GLTFLoader.js"),
            import("three/addons/loaders/DRACOLoader.js"),
        ]).then(async ([{ GLTFLoader }, { DRACOLoader }]) => {
            const dracoLoader = new DRACOLoader()
                .setDecoderPath("/assets/js/draco/gltf/");
            const loader = new GLTFLoader()
                .setCrossOrigin("anonymous")
                .setDRACOLoader(dracoLoader);
            try {
                const gltf = await loader.loadAsync(source.url);
                gltf.scene.updateMatrixWorld(true);
                return gltf.scene;
            } finally {
                dracoLoader.dispose();
            }
        });
        modelTemplateCache.set(key, pending);
    }

    return pending;
}

function cloneModelTemplate(template: THREE.Object3D) {
    const clone = template.clone(true);
    traverseObjectDepthFirst(clone, (child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (mesh.geometry) mesh.geometry = mesh.geometry.clone();
        if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((material) => material.clone());
        } else if (mesh.material) {
            mesh.material = mesh.material.clone();
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.isRuntimeOnly = true;
        mesh.userData.isBatchable = false;
        mesh.userData.isPlanCadExternalModelChild = true;
    });
    return clone;
}

function applySourceTransform(model: THREE.Object3D, transform: PlanItemSource["transform"]) {
    if (transform?.offset) {
        model.position.set(transform.offset.x, transform.offset.y, transform.offset.z);
    }
    if (transform?.rotation) {
        model.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
    }
    if (transform?.scale) {
        model.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
    }
}

function getPositiveScaleFactor(size: THREE.Vector3, dimensions: PlanSize3) {
    const factors = [
        size.x > 0 ? dimensions.x / size.x : null,
        size.y > 0 ? dimensions.y / size.y : null,
        size.z > 0 ? dimensions.z / size.z : null,
    ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
    return factors.length ? Math.min(...factors) : 1;
}

function fitObjectToDimensions(object: THREE.Object3D, dimensions: PlanSize3) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const uniformScale = getPositiveScaleFactor(size, dimensions);
    object.scale.multiplyScalar(uniformScale);
    object.updateMatrixWorld(true);

    const fittedBox = new THREE.Box3().setFromObject(object);
    if (fittedBox.isEmpty()) return;

    const center = fittedBox.getCenter(new THREE.Vector3());
    object.position.x -= center.x;
    object.position.y -= fittedBox.min.y;
    object.position.z -= center.z;
}

function disposeObjectTree(object: THREE.Object3D) {
    traverseObjectDepthFirst(object, (child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
            if (material.userData?.isPlanCadSharedMaterial) continue;
            material.dispose();
        }
    });
}

function clearObjectChildren(object: THREE.Object3D) {
    for (const child of [...object.children]) {
        disposeObjectTree(child);
        object.remove(child);
    }
}

function findPlanCadNodeObjectById(
    root: THREE.Object3D | null | undefined,
    nodeId: string | null | undefined,
): THREE.Object3D | null {
    if (!root || !nodeId) return null;
    return findObjectDepthFirst(root, (object) => object.userData?.planNodeId === nodeId);
}

function createModelInstance(template: THREE.Object3D, item: PlanItemNode) {
    const wrapper = new THREE.Group();
    wrapper.name = `${item.name ?? "Pascal model"} model`;
    wrapper.userData.isRuntimeOnly = true;
    wrapper.userData.isBatchable = false;
    wrapper.userData.isPlanCadExternalModel = true;

    const model = cloneModelTemplate(template);
    model.name = "model";
    applySourceTransform(model, item.source?.transform);
    wrapper.add(model);
    fitObjectToDimensions(wrapper, item.dimensions);
    return wrapper;
}

export async function hydratePlanCadModelObject(
    object: THREE.Object3D,
    item: PlanItemNode,
) {
    if (!isPlanCadLoadableModelSource(item.source)) return;
    const key = getPlanCadModelSourceKey(item.source);
    if (!key) return;

    const previous = object.userData.planCadModel as
        | { loadedKey?: string; pendingKey?: string; errorKey?: string; requestId?: string }
        | undefined;
    if (previous?.loadedKey === key || previous?.pendingKey === key || previous?.errorKey === key) return;

    const requestId = `${key}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    object.userData.planCadModel = {
        status: "loading",
        pendingKey: key,
        requestId,
        source: item.source,
    };

    try {
        const template = await loadModelTemplate(item.source);
        const current = object.userData.planCadModel as { requestId?: string } | undefined;
        if (!template || current?.requestId !== requestId) return;

        clearObjectChildren(object);
        object.add(createModelInstance(template, item));
        object.userData.planCadModel = {
            status: "loaded",
            loadedKey: key,
            source: item.source,
        };
    } catch (error) {
        const current = object.userData.planCadModel as { requestId?: string } | undefined;
        if (current?.requestId !== requestId) return;
        object.userData.planCadModel = {
            status: "error",
            errorKey: key,
            source: item.source,
            error: error instanceof Error ? error.message : String(error),
        };
        console.warn("[BIMCAD] Failed to load BIM model source", error);
    }
}

export function hydratePlanCadModelObjects(
    root: THREE.Object3D | null | undefined,
    data: PlanSceneJson | null | undefined,
) {
    if (!root || !data) return [];

    const tasks: Promise<void>[] = [];
    for (const node of Object.values(data.nodes)) {
        if (node.type !== "item" || !isPlanCadLoadableModelSource(node.source)) continue;
        const object = findPlanCadNodeObjectById(root, node.id);
        if (!object) continue;
        tasks.push(hydratePlanCadModelObject(object, node));
    }
    return tasks;
}


import {BufferGeometry, Material, MathUtils, Mesh, Object3D, Scene} from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

import {assetRefKey} from "@stem/editor-oss/asset-management/AssetRef";
import {remapBehaviorAttributeUuids} from "@stem/editor-oss/asset-management/dependencies";
import {getModelId, getModelRevisionId, isModelAssetInstance} from "@stem/editor-oss/model/util";
import {getPrefabId, getPrefabRevisionId, isPrefab} from "@stem/editor-oss/prefab/metadata";
import {retainExistingManagedObjectGpuResources} from "../core/resources/GpuResourceOwnership";
import {TemplateType} from "../types/TemplateType";
import {cloneJsonCompatible} from "./cloneJsonCompatible";
import {findObjectDepthFirst, traverseObjectDepthFirst} from "./SceneTraverser";

type ChildData = {
    uuid: string;
    children: ChildData[];
};

type UserDataSnapshot = {
    object: Object3D;
    userData: Object3D["userData"];
};

const containsSkinnedMesh = (object: Object3D): boolean => {
    const stack: Object3D[] = [object];
    while (stack.length > 0) {
        const current = stack.pop()!;
        if ((current as {isSkinnedMesh?: boolean}).isSkinnedMesh) {
            return true;
        }

        const children = current.children;
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push(children[i]!);
        }
    }

    return false;
};

const clonePlainObjectHierarchyWithoutUserDataSerialization = (object: Object3D): Object3D => {
    const clonedRoot = object.clone(false);
    const sourceStack: Object3D[] = [object];
    const cloneStack: Object3D[] = [clonedRoot];

    while (sourceStack.length > 0) {
        const source = sourceStack.pop()!;
        const clone = cloneStack.pop()!;
        const sourceChildren = source.children;

        for (let i = 0, l = sourceChildren.length; i < l; i++) {
            const sourceChild = sourceChildren[i]!;
            const clonedChild = sourceChild.clone(false);
            clone.add(clonedChild);
            sourceStack.push(sourceChild);
            cloneStack.push(clonedChild);
        }
    }

    return clonedRoot;
};

const cloneWithoutUserDataSerialization = (object: Object3D): Object3D => {
    const snapshots: UserDataSnapshot[] = [];
    traverseObjectDepthFirst(object, source => {
        snapshots.push({object: source, userData: source.userData});
        source.userData = {};
    });

    try {
        return containsSkinnedMesh(object) ? SkeletonUtils.clone(object) : clonePlainObjectHierarchyWithoutUserDataSerialization(object);
    } finally {
        for (let i = 0; i < snapshots.length; i++) {
            const snapshot = snapshots[i]!;
            snapshot.object.userData = snapshot.userData;
        }
    }
};

const processClonedObject = (
    sourceObject: Object3D,
    clonedObject: Object3D,
    options: CloneObjectOptions = {},
): void => {
    clonedObject.uuid = MathUtils.generateUUID();

    if (options?.uuidMap) {
        options.uuidMap.set(sourceObject.uuid, clonedObject.uuid);
    }

    // Clone materials
    if (options?.cloneMaterials) {
        const material = (sourceObject as Mesh).material as Material | Material[];
        const cloneMaterial = (m: Material) => {
            if (options.materialCache?.has(m)) {
                return options.materialCache.get(m)!;
            }
            const cloned = m.clone();
            options.materialCache?.set(m, cloned);
            return cloned;
        };

        if (Array.isArray(material)) {
            (clonedObject as Mesh).material = material.map(cloneMaterial);
        } else if (material) {
            (clonedObject as Mesh).material = cloneMaterial(material);
        }
    }

    // Clone geometry
    if (options?.cloneGeometry) {
        const geometry = (sourceObject as Mesh).geometry as BufferGeometry;
        if (geometry) {
            if (options.geometryCache?.has(geometry)) {
                (clonedObject as Mesh).geometry = options.geometryCache.get(geometry)!;
            } else {
                const cloned = geometry.clone();
                options.geometryCache?.set(geometry, cloned);
                (clonedObject as Mesh).geometry = cloned;
            }
        }
    }

    if (sourceObject.userData) {
        clonedObject.userData = cloneJsonCompatible(sourceObject.userData);
        processCloneBehaviors(clonedObject);
    }
};

const processCloneBehaviors = (clonedObject: Object3D): void => {
    if (!clonedObject.userData.behaviors) {
        return;
    }

    clonedObject.userData.behaviors = clonedObject.userData.behaviors.map((behavior: {uuid: string; [key: string]: unknown}) => ({
        ...behavior,
        uuid: MathUtils.generateUUID(),
    }));
};

const processClonedObjectHierarchy = (
    sourceObject: Object3D,
    clonedObject: Object3D,
    options: CloneObjectOptions = {},
): void => {
    const sourceStack: Object3D[] = [sourceObject];
    const cloneStack: Object3D[] = [clonedObject];

    while (sourceStack.length > 0) {
        const source = sourceStack.pop()!;
        const clone = cloneStack.pop()!;
        processClonedObject(source, clone, options);

        const sourceChildren = source.children;
        const clonedChildren = clone.children;
        for (let index = sourceChildren.length - 1; index >= 0; index--) {
            const sourceChild = sourceChildren[index]!;
            const clonedChild = clonedChildren[index];
            if (!clonedChild) {
                continue;
            }
            sourceStack.push(sourceChild);
            cloneStack.push(clonedChild);
        }
    }
};

type CloneObjectOptions = {
    uuidMap?: Map<string, string>;
    cloneMaterials?: boolean;
    cloneGeometry?: boolean;
    materialCache?: WeakMap<Material, Material>;
    geometryCache?: WeakMap<BufferGeometry, BufferGeometry>;
};

/**
 * Clone the object, its children and its behaviors.
 *
 * @param object - The object to clone
 * @param options - Options
 * @returns The cloned object.
 */
export const cloneObject = (object: Object3D, options: CloneObjectOptions = {}): Object3D => {
    const internalOptions = { ...options };
    if (internalOptions.cloneMaterials && !internalOptions.materialCache) {
        internalOptions.materialCache = new WeakMap();
    }
    if (internalOptions.cloneGeometry && !internalOptions.geometryCache) {
        internalOptions.geometryCache = new WeakMap();
    }
    // Use provided uuidMap or create an internal one for remapping
    const uuidMap = internalOptions.uuidMap || new Map<string, string>();
    internalOptions.uuidMap = uuidMap;

    const clonedObject = cloneWithoutUserDataSerialization(object);

    processClonedObjectHierarchy(object, clonedObject, internalOptions);

    // Remap "object" type behavior attributes to use the new UUIDs
    remapBehaviorAttributeUuids(clonedObject, internalOptions.uuidMap);

    processChildData(clonedObject);

    // Preserve the _obj property, which stores things like animations.
    // TODO: should we clone this data instead of referencing it?
    // TODO: our objects also have a _root property, but I'm not sure if it
    // makes sense to clone / reference that.
    type ObjectWithRefs = Object3D & {_obj?: unknown; _root?: unknown};
    (clonedObject as ObjectWithRefs)._obj = (object as ObjectWithRefs)._obj;
    (clonedObject as ObjectWithRefs)._root = (object as ObjectWithRefs)._root;

    retainExistingManagedObjectGpuResources(clonedObject);

    return clonedObject;
};

export const processChildData = (clonedObject: Object3D, initial?: boolean): void => {
    if (!clonedObject.userData.children && !initial) {
        return;
    }

    clonedObject.userData.children = [];
    const objectStack: Object3D[] = [clonedObject];
    const childrenListStack: ChildData[][] = [clonedObject.userData.children];
    while (objectStack.length > 0) {
        const obj = objectStack.pop()!;
        const childrenList = childrenListStack.pop()!;
        if (obj.userData.Server === true || obj.userData.isRuntimeOnly) continue;
        if (obj.children && obj.userData?.type === undefined) {
            const children = obj.children;
            for (let i = 0, l = children.length; i < l; i++) {
                const n = children[i]!;
                const children1: ChildData[] = [];
                childrenList.push({
                    uuid: n.uuid,
                    children: children1,
                });
                objectStack.push(n);
                childrenListStack.push(children1);
            }
        }
    }
};

export const getObjectTemplateType = (object: Object3D): TemplateType | undefined => {
    if (object.userData.templateType) {
        return object.userData.templateType as TemplateType;
    }

    if (isPrefab(object)) {
        return TemplateType.PREFAB_ASSET;
    }

    if (isModelAssetInstance(object)) {
        return TemplateType.MODEL_ASSET;
    }

    return undefined;
};

export const getObjectTemplate = (object: Object3D): string | undefined => {
    if (object.userData.template) {
        return object.userData.template as string;
    }

    const prefabId = getPrefabId(object);
    if (prefabId) {
        const revisionId = getPrefabRevisionId(object);
        if (!revisionId) {
            console.warn(`Prefab revision not found for ${prefabId}`);
            return undefined;
        }

        return assetRefKey({assetId: prefabId, revisionId});
    }

    const modelId = getModelId(object);
    if (modelId) {
        const revisionId = getModelRevisionId(object);
        if (!revisionId) {
            console.warn(`Model revision not found for ${modelId}`);
            return undefined;
        }

        return assetRefKey({assetId: modelId, revisionId});
    }

    return undefined;
};

export const setObjectTemplate = (object: Object3D, templateType: TemplateType, template: string) => {
    object.userData.templateType = templateType;
    object.userData.template = template;
};

export const getObjectTemplateFromScene = (object: Object3D, scene: Scene): Object3D | undefined => {
    const templateType = getObjectTemplateType(object);
    if (templateType !== TemplateType.UUID) {
        return undefined;
    }

    const templateUuid = getObjectTemplate(object);
    if (!templateUuid) {
        return undefined;
    }

    return findObjectDepthFirst(scene, candidate => candidate.uuid === templateUuid) ?? undefined;
};

export const getVertexCount = (object: Object3D): number => {
    let count = 0;

    traverseObjectDepthFirst(object, child => {
        if (child instanceof Mesh && child.isMesh) {
            if (child.geometry instanceof BufferGeometry) {
                if (child.geometry.index) {
                    count += child.geometry.index.count;
                } else {
                    const position = child.geometry.getAttribute("position");
                    if (position) {
                        count += position.count;
                    }
                }
            }
        }
    });

    return count;
};

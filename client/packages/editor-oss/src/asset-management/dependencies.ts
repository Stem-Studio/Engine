import { Material, Object3D, Texture } from 'three';

import { AssetRef, assetRefKey, isAssetRef } from './AssetRef';
import { AssetResolutionContext, emptyAssetResolutionContext, getAssetResolutionContext, ReadonlyAssetResolutionContext, resolveAssetId, resolveAssetRevisionId } from './AssetResolutionContext';
import { AssetType } from '@stem/network/api/asset';
import BehaviorData from '../behaviors/BehaviorData';
import { isLegacyBehaviorId } from '../behaviors/util';
import { LambdaComponentData } from '../lambdas/Lambda';
import { getModelId, isModelAssetInstance, setModelId } from '../model/util';
import { getPrefabId, isPrefab, setPrefabId } from '../prefab/util';
import { getScriptDependencyEntry } from '../script-runtime/scriptDependencyCache';
import { traverseSceneDepthFirst } from '../utils/SceneUtil';
import { getVfxId, setVfxId } from '../vfx/util';

const isBuiltInLambdaId = (id: string) => !/^[a-fA-F0-9]{24}$/.test(id);

type AssetRefParent = Record<string, unknown> | unknown[];

/**
 * Recursively finds asset refs in a value (handles nested objects and arrays).
 *
 * @param value - The value to search
 * @param parent - The parent object or array containing this value
 * @param key - The key or index in the parent where this value is stored
 * @param callback - Called for each asset ref found, with parent info for modification
 */
const findBehaviorAttributeAssetRefsRecursive = (
    value: unknown,
    parent: AssetRefParent,
    key: string | number,
    callback: (assetRef: AssetRef, parent: AssetRefParent, key: string | number) => void,
): void => {
    if (isAssetRef(value)) {
        callback(value, parent, key);
    } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            findBehaviorAttributeAssetRefsRecursive(value[i], value, i, callback);
        }
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            findBehaviorAttributeAssetRefsRecursive(v, value as Record<string, unknown>, k, callback);
        }
    }
};

/**
 * Finds all assets that are directly used by the given object.
 * 
 * @remarks
 * This function doesn't traverse any child prefabs for dependencies since those
 * are *indirect* dependencies.
 * 
 * @param object - The object to find dependencies for
 * @returns An array of unique asset references.
 */
export const findDirectDependencies = (object: Object3D): AssetRef[] => {
    // Get the current asset resolution context, inheriting from parents.
    const context = getAssetResolutionContext(object, true) || emptyAssetResolutionContext;

    // Use a Map to deduplicate dependencies
    const dependencies = new Map<string, AssetRef>();
    
    traverseSceneDepthFirst(object, (obj) => {
        const isChildPrefab = isPrefab(obj) && obj !== object;
        const isModel = isModelAssetInstance(obj);
        const isServerObject = Boolean(obj.userData.Server);
        const vfxAssetId = getVfxId(obj);
        const isVfx = vfxAssetId !== null;

        // Don't traverse children of child prefabs, model asset instances,
        // server objects, or VFX asset instances. The VFX asset content is a
        // serialized snapshot of the subtree; deps inside it belong to the
        // VFX asset, not the scene.
        const shouldTraverseChildren = !isChildPrefab && !isModel && !isServerObject && !isVfx;

        // Add all (non-legacy) behaviors as dependencies. Skip behaviors on
        // child prefabs (and their children) because they are not *direct*
        // dependencies of this object.
        if (obj.userData.behaviors && !isChildPrefab) {
            for (const behavior of obj.userData.behaviors as BehaviorData[]) {
                if (!isLegacyBehaviorId(behavior.id)) {
                    const revisionId = resolveAssetRevisionId(behavior.id, context);
                    if (revisionId) {
                        const assetRef = { assetId: behavior.id, revisionId };
                        dependencies.set(assetRefKey(assetRef), assetRef);
                        addScriptImportDependencies(dependencies, behavior.id, revisionId);
                    }
                }
            }
        }

        // Add all assets referenced in behavior attributes, including on child
        // prefabs (but not *within* child prefabs), since the behavior
        // attribute *values* are a direct dependency of *this* prefab. Don't
        // search for references in the root object's behaviors because those
        // values are part of the parent's direct dependencies.
        if (obj.userData.behaviors && obj !== object) {
            for (const behavior of obj.userData.behaviors as BehaviorData[]) {
                if (!behavior.attributesData) {
                    continue;
                }

                for (const [key, value] of Object.entries(behavior.attributesData)) {
                    findBehaviorAttributeAssetRefsRecursive(
                        value,
                        behavior.attributesData as Record<string, unknown>,
                        key,
                        (assetRef) => {
                            dependencies.set(assetRefKey(assetRef), assetRef);
                        },
                    );
                }
            }
        }

        // Add all (non-built-in) lambda components as dependencies.
        if (obj.userData.lambdaComponents && !isChildPrefab) {
            for (const lc of obj.userData.lambdaComponents as LambdaComponentData[]) {
                if (!isBuiltInLambdaId(lc.lambdaId)) {
                    const revisionId = resolveAssetRevisionId(lc.lambdaId, context);
                    if (revisionId) {
                        const assetRef = { assetId: lc.lambdaId, revisionId };
                        dependencies.set(assetRefKey(assetRef), assetRef);
                        addScriptImportDependencies(dependencies, lc.lambdaId, revisionId);
                    }
                }
            }
        }

        // Add all AssetRef values in lambda componentData (same logic as
        // behavior attributes — skip root object).
        if (obj.userData.lambdaComponents && obj !== object) {
            for (const lc of obj.userData.lambdaComponents as LambdaComponentData[]) {
                if (!lc.componentData) {
                    continue;
                }

                for (const value of Object.values(lc.componentData)) {
                    if (isAssetRef(value)) {
                        dependencies.set(assetRefKey(value), value);
                    }
                }
            }
        }

        if (isChildPrefab) {
            const prefabId = getPrefabId(obj);
            if (prefabId) {
                const revisionId = resolveAssetRevisionId(prefabId, context);
                if (revisionId) {
                    const prefabRef = { assetId: prefabId, revisionId };
                    dependencies.set(assetRefKey(prefabRef), prefabRef);
                }
            }
        }

        // If this is a model asset instance, add its model as a dependency.
        // Note that if this is also a child prefab, we *don't* add the model
        // because the model is already a dependency of the child prefab.
        if (isModel && !isChildPrefab) {
            const modelId = getModelId(obj);
            if (modelId) {
                const revisionId = resolveAssetRevisionId(modelId, context);
                if (revisionId) {
                    const modelRef = { assetId: modelId, revisionId };
                    dependencies.set(assetRefKey(modelRef), modelRef);
                }
            }
        }

        // VFX/Quarks assets — same treatment as models: the asset id is the
        // direct dep, and the serialized particle subtree is the asset content.
        if (isVfx && !isChildPrefab && vfxAssetId) {
            const revisionId = resolveAssetRevisionId(vfxAssetId, context);
            if (revisionId) {
                const vfxRef = { assetId: vfxAssetId, revisionId };
                dependencies.set(assetRefKey(vfxRef), vfxRef);
            }
        }

        // Add all texture assets as dependencies.
        if ((obj as any).material && !isChildPrefab && !isModel) {
            const materials: Material[] = Array.isArray((obj as any).material) ? (obj as any).material : [(obj as any).material];
            for (const material of materials) {
                for (const key in material) {
                    const value = (material as any)[key];
                    if (value && (value as Texture).isTexture && value.userData?.imageId) {
                        const assetId = value.userData.imageId;
                        const revisionId = resolveAssetRevisionId(assetId, context);
                        if (revisionId) {
                            const assetRef = { assetId, revisionId };
                            dependencies.set(assetRefKey(assetRef), assetRef);
                        }
                    }
                }
            }
        }

        // Add all material settings assets as dependencies
        if (obj.userData.materialSettings && !isChildPrefab) {
            forEachMaterialSettingsTextureRef(obj.userData.materialSettings, (textures, key, assetRef) => {
                if (assetRef) {
                    dependencies.set(assetRefKey(assetRef), assetRef);
                    return;
                }

                const rawValue = textures[key];
                if (typeof rawValue !== 'string') {
                    return;
                }

                const assetId = extractAssetId(rawValue);
                if (!assetId) {
                    return;
                }

                const revisionId = resolveAssetRevisionId(assetId, context);
                if (revisionId) {
                    const resolvedAssetRef = { assetId, revisionId };
                    dependencies.set(assetRefKey(resolvedAssetRef), resolvedAssetRef);
                }
            });
        }

        return shouldTraverseChildren;
    });

    return [...dependencies.values()];
};

type BehaviorSource = {
    type: typeof AssetType.Behavior;
    object: Object3D;
    behavior: BehaviorData;
};

type BehaviorAttributeSource = {
    type: 'behaviorAttribute';
    object: Object3D;
    behavior: BehaviorData;
    attribute: string;
    assetRef: AssetRef;
    parent: Record<string, unknown> | unknown[];
    parentKey: string | number;
}

type LambdaSource = {
    type: typeof AssetType.Lambda;
    object: Object3D;
    lambdaComponent: LambdaComponentData;
};

type LambdaComponentDataSource = {
    type: 'lambdaComponentData';
    object: Object3D;
    lambdaComponent: LambdaComponentData;
    key: string;
};

type BehaviorImportSource = {
    type: 'behaviorImport';
    object: Object3D;
    behavior: BehaviorData;
    ownerRevisionId: string;
    viaAssetId: string;
    viaRevisionId: string;
};

type LambdaImportSource = {
    type: 'lambdaImport';
    object: Object3D;
    lambdaComponent: LambdaComponentData;
    ownerRevisionId: string;
    viaAssetId: string;
    viaRevisionId: string;
};

type ModelSource = {
    type: typeof AssetType.Model;
    object: Object3D;
};

type PrefabSource = {
    type: typeof AssetType.Prefab;
    object: Object3D;
};

type VfxSource = {
    type: typeof AssetType.Quarks;
    object: Object3D;
};

type TextureSource = {
    type: 'textureMap';
    object: Object3D;
    material: Material;
    texture: Texture;
    key: string;
};

type MaterialSettingSource = {
    type: 'materialSetting';
    object: Object3D;
    textures: Record<string, unknown>;
    key: string;
    assetRef?: AssetRef;
}

type AudioSource = {
    type: typeof AssetType.Audio;
};

type TraverseAssetRefsSource =
    | BehaviorSource
    | BehaviorAttributeSource
    | LambdaSource
    | LambdaComponentDataSource
    | BehaviorImportSource
    | LambdaImportSource
    | ModelSource
    | PrefabSource
    | VfxSource
    | AudioSource
    | TextureSource
    | MaterialSettingSource;

type TraverseAssetRefsCallback = (
    assetId: string,
    context: ReadonlyAssetResolutionContext,
    source: TraverseAssetRefsSource,
) => void;

const traverseBehaviorAssetRefs = (
    object: Object3D,
    context: AssetResolutionContext,
    callback: TraverseAssetRefsCallback,
): void => {
    if (!object.userData.behaviors) {
        return;
    }

    const behaviors = object.userData.behaviors as BehaviorData[];
    for (const behavior of behaviors) {
        // Skip legacy behaviors that aren't backed by assets
        const assetId = context.logicalIdToAssetId?.[behavior.id] || behavior.id;
        if (!isLegacyBehaviorId(assetId)) {
            callback(behavior.id, context, {
                type: AssetType.Behavior,
                object,
                behavior,
            });
        }
    }
};

const traverseLambdaAssetRefs = (
    object: Object3D,
    context: AssetResolutionContext,
    callback: TraverseAssetRefsCallback,
): void => {
    if (!object.userData.lambdaComponents) {
        return;
    }

    const lambdaComponents = object.userData.lambdaComponents as LambdaComponentData[];
    for (const lc of lambdaComponents) {
        const assetId = context.logicalIdToAssetId?.[lc.lambdaId] || lc.lambdaId;
        if (!isBuiltInLambdaId(assetId)) {
            callback(lc.lambdaId, context, {
                type: AssetType.Lambda,
                object,
                lambdaComponent: lc,
            });
        }
    }
};

type TraverseBehaviorAttributeAssetRefsCallback = (
    assetRef: AssetRef,
    context: ReadonlyAssetResolutionContext,
    source: TraverseAssetRefsSource,
) => void;

const traverseTextureAssetRefs = (
    object: Object3D,
    context: AssetResolutionContext,
    callback: TraverseAssetRefsCallback,
): void => {
    if ((object as any).material) {
        const materials: Material[] = Array.isArray((object as any).material) ? (object as any).material : [(object as any).material];
        for (const material of materials) {
            for (const key in material) {
                const value = (material as any)[key];
                if (value && (value as Texture).isTexture && value.userData?.imageId) {
                    const assetId = resolveAssetId(value.userData.imageId, context);
                    callback(assetId, context, {
                        type: "textureMap",
                        object,
                        material,
                        texture: value,
                        key,
                    });
                }
            }
        }
    }
};

const extractAssetId = (value: string): string | null => {
    if (!value) return null;
    const match = value.match(/^((?:[a-f0-9]{24})|(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))/i);
    return match ? match[1]! : null;
};

const forEachMaterialSettingsTextureRef = (
    settings: unknown,
    callback: (textures: Record<string, unknown>, key: string, assetRef?: AssetRef) => void,
): void => {
    if (!settings || typeof settings !== 'object') {
        return;
    }

    const processSettings = (value: unknown) => {
        if (!value || typeof value !== 'object' || !('textures' in value)) {
            return;
        }

        const textures = (value as {textures?: Record<string, unknown>}).textures;
        if (!textures || typeof textures !== 'object') {
            return;
        }

        for (const key of Object.keys(textures)) {
            const rawValue = textures[key];

            if (isAssetRef(rawValue)) {
                callback(textures, key, rawValue);
                continue;
            }

            if (typeof rawValue !== 'string') {
                continue;
            }

            if (extractAssetId(rawValue)) {
                callback(textures, key);
            }
        }
    };

    if ('textures' in settings) {
        processSettings(settings);
        return;
    }

    for (const key of Object.keys(settings)) {
        processSettings((settings as Record<string, unknown>)[key]);
    }
};

const traverseMaterialSettingsAssetRefs = (
    object: Object3D,
    context: AssetResolutionContext,
    callback: TraverseAssetRefsCallback,
): void => {
    const settings = object.userData.materialSettings;
    if (!settings) return;

    forEachMaterialSettingsTextureRef(settings, (textures, key, assetRef) => {
        const rawValue = textures[key];
        const assetId = assetRef?.assetId || (typeof rawValue === 'string' ? extractAssetId(rawValue) : null);
        if (!assetId) {
            return;
        }

        const resolvedAssetId = resolveAssetId(assetId, context);
        callback(resolvedAssetId, context, {
            type: 'materialSetting',
            object,
            textures,
            key,
            assetRef,
        });
    });
};


const traverseBehaviorAttributeAssetRefs = (
    object: Object3D,
    context: AssetResolutionContext,
    callback: TraverseBehaviorAttributeAssetRefsCallback,
): void => {
    if (!object.userData.behaviors) {
        return;
    }

    const behaviors = object.userData.behaviors as BehaviorData[];
    for (const behavior of behaviors) {
        if (behavior.attributesData) {
            for (const [key, value] of Object.entries(behavior.attributesData)) {
                findBehaviorAttributeAssetRefsRecursive(
                    value,
                    behavior.attributesData as Record<string, unknown>,
                    key,
                    (assetRef, parent, parentKey) => {
                        callback(assetRef, context, {
                            type: 'behaviorAttribute',
                            object,
                            behavior,
                            attribute: key,
                            assetRef,
                            parent,
                            parentKey,
                        });
                    },
                );
            }
        }
    }
};

const traverseLambdaComponentDataAssetRefs = (
    object: Object3D,
    context: AssetResolutionContext,
    callback: TraverseBehaviorAttributeAssetRefsCallback,
): void => {
    if (!object.userData.lambdaComponents) {
        return;
    }

    const lambdaComponents = object.userData.lambdaComponents as LambdaComponentData[];
    for (const lc of lambdaComponents) {
        if (lc.componentData) {
            for (const [key, value] of Object.entries(lc.componentData)) {
                if (isAssetRef(value)) {
                    callback(value, context, {
                        type: 'lambdaComponentData',
                        object,
                        lambdaComponent: lc,
                        key,
                    });
                }
            }
        }
    }
};

const addScriptImportDependencies = (
    dependencies: Map<string, AssetRef>,
    assetId: string,
    revisionId: string,
    visited = new Set<string>(),
): void => {
    const visitKey = `${assetId}:${revisionId}`;
    if (visited.has(visitKey)) {
        return;
    }
    visited.add(visitKey);

    const entry = getScriptDependencyEntry(assetId, revisionId);
    if (!entry) {
        return;
    }

    for (const [dependencyAssetId, dependencyRevisionId] of Object.entries(entry.dependencies)) {
        const assetRef = {assetId: dependencyAssetId, revisionId: dependencyRevisionId};
        dependencies.set(assetRefKey(assetRef), assetRef);
        addScriptImportDependencies(dependencies, dependencyAssetId, dependencyRevisionId, visited);
    }
};

const traverseScriptImportRefs = (
    rootSource: BehaviorSource | LambdaSource,
    context: ReadonlyAssetResolutionContext,
    assetId: string,
    revisionId: string,
    callback: TraverseAssetRefsCallback,
    visited = new Set<string>(),
): void => {
    const visitKey = `${assetId}:${revisionId}`;
    if (visited.has(visitKey)) {
        return;
    }
    visited.add(visitKey);

    const entry = getScriptDependencyEntry(assetId, revisionId);
    if (!entry) {
        return;
    }

    for (const [dependencyAssetId, dependencyRevisionId] of Object.entries(entry.dependencies)) {
        callback(
            dependencyAssetId,
            context,
            rootSource.type === AssetType.Behavior
                ? {
                    type: 'behaviorImport',
                    object: rootSource.object,
                    behavior: rootSource.behavior,
                    ownerRevisionId: revisionId,
                    viaAssetId: assetId,
                    viaRevisionId: dependencyRevisionId,
                }
                : {
                    type: 'lambdaImport',
                    object: rootSource.object,
                    lambdaComponent: rootSource.lambdaComponent,
                    ownerRevisionId: revisionId,
                    viaAssetId: assetId,
                    viaRevisionId: dependencyRevisionId,
                },
        );
        traverseScriptImportRefs(
            rootSource,
            context,
            dependencyAssetId,
            dependencyRevisionId,
            callback,
            visited,
        );
    }
};

/**
 * Traverse all asset references in the given object and its children.
 * 
 * @remarks
 * The callback function will be called for each asset reference found. The
 * current AssetResolutionContext is passed to the callback function and can be
 * used to resolve the asset reference.
 * 
 * This function serves as the reference implementation for how to traverse
 * asset references, and which asset reesolution context to use for each
 * reference. Therefore, it is best to use this function whenever possible
 * instead of reimplementing the traversal logic.
 * 
 * @param object - The object to traverse
 * @param context - The initial AssetResolutionContext
 * @param callback - The callback function
 */
export const traverseAssetRefs = (
    object: Object3D,
    context: ReadonlyAssetResolutionContext,
    callback: TraverseAssetRefsCallback,
): void => {
    // Traverse behavior attributes using the current context, even if this
    // object has its own revision context. Its own revision context only
    // applies to behavior attributes of its children.
    traverseBehaviorAttributeAssetRefs(object, context, (assetRef, context, source) => {
        callback(assetRef.assetId, context, source);
    });
    traverseLambdaComponentDataAssetRefs(object, context, (assetRef, context, source) => {
        callback(assetRef.assetId, context, source);
    });

    const prefabId = getPrefabId(object);
    if (prefabId) {
        callback(prefabId, context, {
            type: AssetType.Prefab,
            object,
        });
    }

    // If the object has its own revision context (e.g., a prefab), use that
    // when resolving asset refs in its children.
    const childContext = getAssetResolutionContext(object) || context;

    // Traverse behavior asset refs (i.e., the references to the actual behavior
    // assets) using the child context.
    traverseBehaviorAssetRefs(object, childContext, callback);
    traverseLambdaAssetRefs(object, childContext, callback);
    traverseTextureAssetRefs(object, childContext, callback);
    traverseMaterialSettingsAssetRefs(object, childContext, callback);

    if (object.userData.behaviors) {
        for (const behavior of object.userData.behaviors as BehaviorData[]) {
            const assetId = childContext.logicalIdToAssetId?.[behavior.id] || behavior.id;
            if (isLegacyBehaviorId(assetId)) {
                continue;
            }

            const revisionId = resolveAssetRevisionId(assetId, childContext);
            if (!revisionId) {
                continue;
            }

            traverseScriptImportRefs({
                type: AssetType.Behavior,
                object,
                behavior,
            }, childContext, assetId, revisionId, callback);
        }
    }

    if (object.userData.lambdaComponents) {
        for (const lambdaComponent of object.userData.lambdaComponents as LambdaComponentData[]) {
            const assetId = childContext.logicalIdToAssetId?.[lambdaComponent.lambdaId] || lambdaComponent.lambdaId;
            if (isBuiltInLambdaId(assetId)) {
                continue;
            }

            const revisionId = resolveAssetRevisionId(assetId, childContext);
            if (!revisionId) {
                continue;
            }

            traverseScriptImportRefs({
                type: AssetType.Lambda,
                object,
                lambdaComponent,
            }, childContext, assetId, revisionId, callback);
        }
    }

    const modelId = getModelId(object);
    if (modelId) {
        callback(modelId, context, {
            type: AssetType.Model,
            object,
        });
    }

    const vfxAssetId = getVfxId(object);
    if (vfxAssetId) {
        callback(vfxAssetId, context, {
            type: AssetType.Quarks,
            object,
        });
    }

    for (const child of object.children) {
        traverseAssetRefs(child, childContext, callback);
    }
};

type MapAssetRefsCallback = (
    assetId: string,
    context: ReadonlyAssetResolutionContext,
    source: TraverseAssetRefsSource,
) => string;

/**
 * Iterate over all asset references in the given object and its children, and
 * map their asset IDs using the given callback function.
 * 
 * @param object - The object to traverse
 * @param context - The initial AssetResolutionContext
 * @param callback - The callback function to map asset IDs
 */
export const mapAssetIds = (
    object: Object3D,
    context: ReadonlyAssetResolutionContext,
    callback: MapAssetRefsCallback,
): void => {
    traverseAssetRefs(object, context, (assetId, context, source) => {
        const newAssetId = callback(assetId, context, source);

        switch (source.type) {
            case 'behaviorAttribute': {
                source.assetRef.assetId = newAssetId;
                break;
            }
            case AssetType.Behavior:
                source.behavior.id = newAssetId;
                break;
            case AssetType.Lambda:
                source.lambdaComponent.lambdaId = newAssetId;
                break;
            case 'lambdaComponentData': {
                const assetRef = source.lambdaComponent.componentData[source.key] as AssetRef;
                assetRef.assetId = newAssetId;
                break;
            }
            case 'behaviorImport':
            case 'lambdaImport':
                break;
            case AssetType.Model:
                setModelId(source.object, newAssetId);
                break;
            case AssetType.Prefab:
                setPrefabId(source.object, newAssetId);
                break;
            case AssetType.Quarks:
                setVfxId(source.object, newAssetId);
                break;
            case 'materialSetting':
                if (source.assetRef) {
                    source.assetRef.assetId = newAssetId;
                } else {
                    source.textures[source.key] = newAssetId;
                }
                break;
            case 'textureMap':
                source.texture.userData.imageId = newAssetId;
                break;
        }
    });
};

type RemoveAssetRefsCallback = (
    assetId: string,
    context: ReadonlyAssetResolutionContext,
    source: TraverseAssetRefsSource,
) => boolean;

export const removeAssetRefs = (
    object: Object3D,
    context: ReadonlyAssetResolutionContext,
    callback: RemoveAssetRefsCallback,
): void => {
    traverseAssetRefs(object, context, (assetId, context, source) => {
        const remove = callback(assetId, context, source);
        if (!remove) {
            return;
        }

        switch (source.type) {
            case 'behaviorAttribute': {
                // Set the parent's key to null (works for both top-level and nested refs)
                (source.parent as Record<string | number, unknown>)[source.parentKey] = null;
                break;
            }
            case AssetType.Behavior: {
                const behaviors = object.userData.behaviors as BehaviorData[];
                const index = behaviors.indexOf(source.behavior);
                if (index >= 0) {
                    behaviors.splice(index, 1);
                }
                break;
            }
            case AssetType.Lambda: {
                const lambdaComponents = source.object.userData.lambdaComponents as LambdaComponentData[];
                const index = lambdaComponents.indexOf(source.lambdaComponent);
                if (index >= 0) {
                    lambdaComponents.splice(index, 1);
                }
                break;
            }
            case 'lambdaComponentData': {
                source.lambdaComponent.componentData[source.key] = null;
                break;
            }
            case 'behaviorImport': {
                const behaviors = source.object.userData.behaviors as BehaviorData[];
                const index = behaviors.indexOf(source.behavior);
                if (index >= 0) {
                    behaviors.splice(index, 1);
                }
                break;
            }
            case 'lambdaImport': {
                const lambdaComponents = source.object.userData.lambdaComponents as LambdaComponentData[];
                const index = lambdaComponents.indexOf(source.lambdaComponent);
                if (index >= 0) {
                    lambdaComponents.splice(index, 1);
                }
                break;
            }
            case AssetType.Model:
            case AssetType.Prefab:
            case AssetType.Quarks:
                if (source.object.parent) {
                    source.object.parent.remove(source.object);
                }
                break;
            case 'materialSetting':
                source.textures[source.key] = "";
                break;
            case 'textureMap': {
                // Set the texture property to null on the material
                const { material, key } = source;
                (material as any)[key] = null;
                material.needsUpdate = true;
                break;
            }
        }
    });
};

const resolveAssetRef = (assetRef: AssetRef, context: ReadonlyAssetResolutionContext): void => {
    const revisionId = resolveAssetRevisionId(assetRef.assetId, context);
    if (revisionId) {
        // Update the asset ref in place.
        assetRef.revisionId = revisionId;
    } else {
        console.error("Failed to resolve asset ref", { assetRef, context });
    }
};

export const resolveBehaviorAttributeAssetRefs = (
    object: Object3D,
    context: ReadonlyAssetResolutionContext,
    recursive = false,
): void => {
    traverseBehaviorAttributeAssetRefs(object, context, resolveAssetRef);

    if (recursive) {
        // If the object has its own revision context (e.g., a prefab), use that
        // when resolving asset refs in its children.
        const childContext = getAssetResolutionContext(object) || context;

        for (const child of object.children) {
            resolveBehaviorAttributeAssetRefs(child, childContext, true);
        }
    }
};

/**
 * Re-resolve all AssetRef values in behavior attributes and lambda component
 * data across the entire scene tree using the current resolution context.
 *
 * @param scene - The scene root to traverse.
 * @param context - The resolution context to resolve asset refs against.
 */
export const resolveAllSceneAssetRefs = (
    scene: Object3D,
    context: ReadonlyAssetResolutionContext,
): void => {
    resolveBehaviorAttributeAssetRefs(scene, context, true);
    resolveLambdaComponentDataAssetRefs(scene, context, true);
};

export const resolveLambdaComponentDataAssetRefs = (
    object: Object3D,
    context: ReadonlyAssetResolutionContext,
    recursive = false,
): void => {
    traverseLambdaComponentDataAssetRefs(object, context, resolveAssetRef);

    if (recursive) {
        const childContext = getAssetResolutionContext(object) || context;

        for (const child of object.children) {
            resolveLambdaComponentDataAssetRefs(child, childContext, true);
        }
    }
};

/**
 * Recursively remaps UUID values in an attributes object.
 * This is used to update "object" type attribute values when prefab objects
 * are assigned new UUIDs.
 *
 * @param obj - The attributes object to process (modified in place)
 * @param uuidMap - Map from old UUIDs to new UUIDs
 */
const remapAttributeValuesRecursive = (
    obj: Record<string, unknown>,
    uuidMap: Map<string, string>,
): void => {
    for (const key of Object.keys(obj)) {
        const value = obj[key];

        if (typeof value === 'string') {
            const newUuid = uuidMap.get(value);
            if (newUuid) {
                obj[key] = newUuid;
            }
        } else if (Array.isArray(value)) {
            obj[key] = value.map(item => {
                if (typeof item === 'string') {
                    return uuidMap.get(item) ?? item;
                } else if (item && typeof item === 'object' && !isAssetRef(item)) {
                    // Recurse into objects within arrays
                    remapAttributeValuesRecursive(item as Record<string, unknown>, uuidMap);
                }
                return item;
            });
        } else if (value && typeof value === 'object' && !isAssetRef(value)) {
            // Recurse into nested objects (e.g., group attributes)
            remapAttributeValuesRecursive(value as Record<string, unknown>, uuidMap);
        }
    }
};

/**
 * Remaps UUID references in behavior attributes using the provided UUID map.
 * This handles "object" type attributes that reference other objects in the
 * prefab. Should be called after objects have been assigned new UUIDs.
 *
 * @param object - The root object to process
 * @param uuidMap - Map from old UUIDs to new UUIDs
 * @param recursive - Whether to process children (default: true)
 */
export const remapBehaviorAttributeUuids = (
    object: Object3D,
    uuidMap: Map<string, string>,
    recursive = true,
): void => {
    const remapObject = (target: Object3D): void => {
        if (!target.userData?.behaviors) {
            return;
        }

        for (const behavior of target.userData.behaviors as BehaviorData[]) {
            if (behavior.attributesData) {
                remapAttributeValuesRecursive(behavior.attributesData, uuidMap);
            }
        }
    };

    if (!recursive) {
        remapObject(object);
        return;
    }

    const stack: Object3D[] = [object];
    while (stack.length > 0) {
        const target = stack.pop()!;
        remapObject(target);

        const children = target.children;
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push(children[i]!);
        }
    }
};

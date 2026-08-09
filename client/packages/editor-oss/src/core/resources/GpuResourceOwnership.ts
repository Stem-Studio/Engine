import {
    BufferGeometry,
    Material,
    Mesh,
    Object3D,
    Texture,
} from "three";

export type ManagedGpuResource = BufferGeometry | Material | Texture;
export type ManagedGpuResourceKind = "geometry" | "material" | "texture";

export interface GpuResourceOwnershipDiagnostics {
    activeOwners: number;
    activeResources: number;
    retainedResourceLinks: number;
    retainCalls: number;
    releaseCalls: number;
    disposedManagedResources: number;
}

export interface ManagedResourceReleaseResult {
    released: number;
    disposed: Set<ManagedGpuResource>;
}

let resourceRecords = new WeakMap<ManagedGpuResource, {
    kind: ManagedGpuResourceKind;
    refCount: number;
}>();
let ownerResources = new WeakMap<object, Set<ManagedGpuResource>>();
let disposedManagedResources = new WeakSet<ManagedGpuResource>();

const diagnostics: GpuResourceOwnershipDiagnostics = {
    activeOwners: 0,
    activeResources: 0,
    retainedResourceLinks: 0,
    retainCalls: 0,
    releaseCalls: 0,
    disposedManagedResources: 0,
};

const MATERIAL_PROPERTY_SCAN_SKIP_KEYS = new Set<PropertyKey>([
    "uniforms",
    "userData",
]);

const getResourceKind = (value: unknown): ManagedGpuResourceKind | null => {
    if (!!value && typeof value === "object") {
        const candidate = value as {
            isBufferGeometry?: boolean;
            isMaterial?: boolean;
            isTexture?: boolean;
        };
        if (candidate.isBufferGeometry === true) return "geometry";
        if (candidate.isMaterial === true) return "material";
        if (candidate.isTexture === true) return "texture";
    }
    return null;
};

export const isManagedGpuResource = (value: unknown): value is ManagedGpuResource => (
    getResourceKind(value) !== null
);

export const isGpuResourceManaged = (resource: unknown): boolean => (
    isManagedGpuResource(resource) && resourceRecords.has(resource)
);

export const wasManagedGpuResourceDisposed = (resource: unknown): boolean => (
    isManagedGpuResource(resource) && disposedManagedResources.has(resource)
);

const collectTextureValue = (value: unknown, resources: Set<ManagedGpuResource>): void => {
    if (isManagedGpuResource(value) && getResourceKind(value) === "texture") {
        resources.add(value);
        return;
    }

    if (!Array.isArray(value)) {
        return;
    }

    for (const item of value) {
        if (isManagedGpuResource(item) && getResourceKind(item) === "texture") {
            resources.add(item);
        }
    }
};

const collectTextureUniforms = (material: Material, resources: Set<ManagedGpuResource>): void => {
    const uniforms = (material as {uniforms?: Record<string, {value?: unknown} | unknown>}).uniforms;
    if (!uniforms) return;

    for (const uniform of Object.values(uniforms)) {
        const value = uniform && typeof uniform === "object" && "value" in uniform
            ? (uniform as {value?: unknown}).value
            : uniform;
        collectTextureValue(value, resources);
    }
};

const collectOwnMaterialTextureProperties = (material: Material, resources: Set<ManagedGpuResource>): void => {
    for (const key of Reflect.ownKeys(material)) {
        if (MATERIAL_PROPERTY_SCAN_SKIP_KEYS.has(key)) {
            continue;
        }

        let value: unknown;
        try {
            value = (material as unknown as Record<PropertyKey, unknown>)[key];
        } catch {
            continue;
        }

        collectTextureValue(value, resources);
    }
};

export const collectMaterialGpuResources = (
    material: Material,
    resources: Set<ManagedGpuResource> = new Set(),
): Set<ManagedGpuResource> => {
    resources.add(material);
    collectOwnMaterialTextureProperties(material, resources);
    collectTextureUniforms(material, resources);
    return resources;
};

export const collectObjectGpuResources = (
    object: Object3D,
    resources: Set<ManagedGpuResource> = new Set(),
): Set<ManagedGpuResource> => {
    const stack: Object3D[] = [object];

    while (stack.length > 0) {
        const current = stack.pop()!;
        if ((current as Mesh).isMesh) {
            const mesh = current as Mesh;
            if (isManagedGpuResource(mesh.geometry)) {
                resources.add(mesh.geometry);
            }

            const materials = Array.isArray(mesh.material)
                ? mesh.material
                : mesh.material
                    ? [mesh.material]
                    : [];
            for (const material of materials) {
                if (material) {
                    collectMaterialGpuResources(material, resources);
                }
            }
        }

        const children = current.children;
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push(children[i]!);
        }
    }

    return resources;
};

export const retainGpuResources = (
    owner: object,
    resources: Iterable<ManagedGpuResource>,
): number => {
    diagnostics.retainCalls++;

    let retained = 0;
    let owned = ownerResources.get(owner);
    if (!owned) {
        owned = new Set();
        ownerResources.set(owner, owned);
        diagnostics.activeOwners++;
    }

    for (const resource of resources) {
        if (owned.has(resource)) continue;

        owned.add(resource);
        let record = resourceRecords.get(resource);
        if (!record) {
            const kind = getResourceKind(resource);
            if (!kind) continue;
            record = {kind, refCount: 0};
            resourceRecords.set(resource, record);
            diagnostics.activeResources++;
        }

        record.refCount++;
        diagnostics.retainedResourceLinks++;
        retained++;
    }

    if (owned.size === 0) {
        ownerResources.delete(owner);
        diagnostics.activeOwners--;
    }

    return retained;
};

export const retainObjectGpuResources = (owner: Object3D): number => (
    retainGpuResources(owner, collectObjectGpuResources(owner))
);

export const retainExistingManagedObjectGpuResources = (owner: Object3D): number => {
    const managedResources = new Set<ManagedGpuResource>();
    for (const resource of collectObjectGpuResources(owner)) {
        if (resourceRecords.has(resource)) {
            managedResources.add(resource);
        }
    }
    return retainGpuResources(owner, managedResources);
};

const hardDisposeGpuResource = (resource: ManagedGpuResource): void => {
    if (getResourceKind(resource) === "geometry") {
        (resource as BufferGeometry).disposeBoundsTree?.();
    }
    resource.dispose();
};

export const hardDisposeUnmanagedGpuResource = (resource: unknown): boolean => {
    if (!isManagedGpuResource(resource) || resourceRecords.has(resource) || disposedManagedResources.has(resource)) {
        return false;
    }

    hardDisposeGpuResource(resource);
    return true;
};

export const releaseGpuResourcesForOwner = (owner: object): ManagedResourceReleaseResult => {
    diagnostics.releaseCalls++;
    const owned = ownerResources.get(owner);
    const result: ManagedResourceReleaseResult = {released: 0, disposed: new Set()};
    if (!owned) {
        return result;
    }

    ownerResources.delete(owner);
    diagnostics.activeOwners--;

    for (const resource of owned) {
        const record = resourceRecords.get(resource);
        if (!record) continue;

        record.refCount--;
        diagnostics.retainedResourceLinks--;
        result.released++;

        if (record.refCount <= 0) {
            resourceRecords.delete(resource);
            disposedManagedResources.add(resource);
            diagnostics.activeResources--;
            diagnostics.disposedManagedResources++;
            hardDisposeGpuResource(resource);
            result.disposed.add(resource);
        }
    }

    return result;
};

export const getGpuResourceOwnershipDiagnostics = (): GpuResourceOwnershipDiagnostics => ({
    ...diagnostics,
});

export const resetGpuResourceOwnershipForTests = (): void => {
    resourceRecords = new WeakMap();
    ownerResources = new WeakMap();
    disposedManagedResources = new WeakSet();
    diagnostics.activeOwners = 0;
    diagnostics.activeResources = 0;
    diagnostics.retainedResourceLinks = 0;
    diagnostics.retainCalls = 0;
    diagnostics.releaseCalls = 0;
    diagnostics.disposedManagedResources = 0;
};

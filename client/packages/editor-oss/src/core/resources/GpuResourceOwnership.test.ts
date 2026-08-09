import {
    BoxGeometry,
    Group,
    MeshMatcapMaterial,
    MeshPhysicalMaterial,
    Mesh,
    MeshStandardMaterial,
    Texture,
} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {
    collectMaterialGpuResources,
    getGpuResourceOwnershipDiagnostics,
    releaseGpuResourcesForOwner,
    resetGpuResourceOwnershipForTests,
    retainObjectGpuResources,
} from "./GpuResourceOwnership";

describe("GpuResourceOwnership", () => {
    afterEach(() => {
        resetGpuResourceOwnershipForTests();
        vi.restoreAllMocks();
    });

    it("counts a shared texture once per owner tree even when it appears in multiple slots and nodes", () => {
        const root = new Group();
        const geometry = new BoxGeometry();
        const texture = new Texture();
        const material = new MeshStandardMaterial({map: texture, normalMap: texture});
        root.add(
            new Mesh(geometry, material),
            new Mesh(geometry, [material, material]),
        );

        const disposeGeometry = vi.spyOn(geometry, "dispose");
        const disposeMaterial = vi.spyOn(material, "dispose");
        const disposeTexture = vi.spyOn(texture, "dispose");

        expect(retainObjectGpuResources(root)).toBe(3);
        expect(retainObjectGpuResources(root)).toBe(0);
        expect(getGpuResourceOwnershipDiagnostics()).toMatchObject({
            activeOwners: 1,
            activeResources: 3,
            retainedResourceLinks: 3,
        });

        const released = releaseGpuResourcesForOwner(root);

        expect(released.released).toBe(3);
        expect(disposeGeometry).toHaveBeenCalledOnce();
        expect(disposeMaterial).toHaveBeenCalledOnce();
        expect(disposeTexture).toHaveBeenCalledOnce();
        expect(getGpuResourceOwnershipDiagnostics()).toMatchObject({
            activeOwners: 0,
            activeResources: 0,
            retainedResourceLinks: 0,
        });
    });

    it("returns to a zero active-resource plateau across repeated retain/release cycles", () => {
        for (let cycle = 0; cycle < 20; cycle++) {
            const mesh = new Mesh(
                new BoxGeometry(),
                new MeshStandardMaterial({map: new Texture()}),
            );

            retainObjectGpuResources(mesh);
            releaseGpuResourcesForOwner(mesh);

            expect(getGpuResourceOwnershipDiagnostics()).toMatchObject({
                activeOwners: 0,
                activeResources: 0,
                retainedResourceLinks: 0,
            });
        }
    });

    it("collects active own material texture properties without a brittle fixed slot list", () => {
        const matcap = new Texture();
        const specularColorMap = new Texture();
        const specularIntensityMap = new Texture();
        const hiddenOwnTexture = new Texture();
        const material = new MeshPhysicalMaterial();
        const matcapMaterial = new MeshMatcapMaterial({matcap});

        material.specularColorMap = specularColorMap;
        material.specularIntensityMap = specularIntensityMap;
        Object.defineProperty(material, "hiddenRuntimeTexture", {
            configurable: true,
            value: hiddenOwnTexture,
        });

        const resources = collectMaterialGpuResources(material);
        collectMaterialGpuResources(matcapMaterial, resources);

        expect(resources.has(matcap)).toBe(true);
        expect(resources.has(specularColorMap)).toBe(true);
        expect(resources.has(specularIntensityMap)).toBe(true);
        expect(resources.has(hiddenOwnTexture)).toBe(true);
    });

    it("collects shallow uniform texture values and arrays but ignores userData and prototype textures", () => {
        const uniformTexture = new Texture();
        const uniformArrayTexture = new Texture();
        const userDataTexture = new Texture();
        const prototypeTexture = new Texture();
        const material = new MeshStandardMaterial() as MeshStandardMaterial & {
            uniforms?: Record<string, {value: unknown}>;
            runtimeTextures?: Texture[];
        };
        material.uniforms = {
            single: {value: uniformTexture},
            array: {value: [uniformArrayTexture]},
        };
        material.runtimeTextures = [uniformTexture];
        material.userData.texture = userDataTexture;

        const prototype = Object.getPrototypeOf(material) as Record<string, unknown>;
        prototype.prototypeOnlyTexture = prototypeTexture;

        try {
            const resources = collectMaterialGpuResources(material);

            expect(resources.has(uniformTexture)).toBe(true);
            expect(resources.has(uniformArrayTexture)).toBe(true);
            expect(resources.has(userDataTexture)).toBe(false);
            expect(resources.has(prototypeTexture)).toBe(false);
        } finally {
            delete prototype.prototypeOnlyTexture;
        }
    });
});

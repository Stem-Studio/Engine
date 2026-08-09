import {Mesh, MeshStandardMaterial} from "three";
import {describe, expect, it, vi} from "vitest";

import {LoaderSupport} from "./LoaderSupport";
import {LoaderSupport as SharedLoaderSupport} from "../../../../../shared/src/assets/js/loaders/LoaderSupport";

describe("LoaderSupport compatibility helpers", () => {
    it("keeps the public shared re-export and basic validator helpers", () => {
        expect(SharedLoaderSupport).toBe(LoaderSupport);
        expect(LoaderSupport.Validator.isValid(null)).toBe(false);
        expect(LoaderSupport.Validator.verifyInput(undefined, "fallback")).toBe("fallback");
    });

    it("preserves callback registration and mesh override helpers", () => {
        const callbacks = new LoaderSupport.Callbacks();
        const onLoad = vi.fn();
        callbacks.setCallbackOnLoad(onLoad);
        expect(callbacks.onLoad).toBe(onLoad);

        const override = new LoaderSupport.LoadedMeshUserOverride(false, false);
        const mesh = new Mesh();
        override.addMesh(mesh);

        expect(override.isDisregardMesh()).toBe(false);
        expect(override.providesAlteredMeshes()).toBe(true);
        expect(override.meshes).toEqual([mesh]);
    });

    it("keeps resource descriptor and prep-data resource matching behavior", () => {
        const obj = new LoaderSupport.ResourceDescriptor("/assets/model.obj", "obj");
        obj.setContent(new Uint8Array([1, 2, 3]));
        const mtl = new LoaderSupport.ResourceDescriptor("/assets/model.mtl", "mtl");
        mtl.setContent("newmtl default");

        const prepData = new LoaderSupport.PrepData("model");
        prepData.addResource(obj);
        prepData.addResource(mtl);

        expect(obj.path).toBe("/assets/");
        expect(obj.name).toBe("model.obj");
        expect(prepData.checkResourceDescriptorFiles(prepData.resources, [
            {ext: "obj", type: "ArrayBuffer", ignore: false},
            {ext: "mtl", type: "String", ignore: false},
        ])).toEqual({obj, mtl});
    });

    it("builds meshes from legacy mesh payloads", () => {
        const builder = new LoaderSupport.MeshBuilder();
        builder.init();
        const material = new MeshStandardMaterial({color: 0xff0000});
        material.name = "red";
        builder.setMaterials({red: material});

        const meshes = builder.processPayload({
            cmd: "meshData",
            params: {meshName: "triangle"},
            buffers: {
                vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
                indices: null,
                colors: null,
                normals: null,
                uvs: null,
            },
            materials: {
                materialNames: ["red"],
            },
            geometryType: 0,
        });

        expect(meshes).not.toBeNull();
        expect(meshes).toHaveLength(1);
        expect(meshes![0].name).toBe("triangle");
        expect(meshes![0].material).toBe(material);
    });

    it("keeps WorkerSupport callback flow synchronous for compatibility", () => {
        const workerSupport = new LoaderSupport.WorkerSupport();
        const onMesh = vi.fn();
        const onLoad = vi.fn();
        workerSupport.setCallbacks(onMesh, onLoad);

        workerSupport.run({cmd: "meshData", object: new Mesh()});

        expect(onMesh).toHaveBeenCalledWith(expect.objectContaining({cmd: "meshData"}));
        expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({cmd: "complete"}));
    });
});

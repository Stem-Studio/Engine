import {
    BoxGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Texture,
} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {
    resetGpuResourceOwnershipForTests,
    retainObjectGpuResources,
} from "../core/resources/GpuResourceOwnership";
import MeshUtils from "./MeshUtils";

describe("MeshUtils GPU resource disposal", () => {
    afterEach(() => {
        resetGpuResourceOwnershipForTests();
        vi.restoreAllMocks();
    });

    it("hard-disposes unmanaged legacy geometry, materials, and duplicate texture slots once", () => {
        const geometry = new BoxGeometry();
        const texture = new Texture();
        const material = new MeshStandardMaterial({map: texture, normalMap: texture});
        const mesh = new Mesh(geometry, [material, material]);

        const disposeGeometry = vi.spyOn(geometry, "dispose");
        const disposeMaterial = vi.spyOn(material, "dispose");
        const disposeTexture = vi.spyOn(texture, "dispose");

        MeshUtils.dispose(mesh);

        expect(disposeGeometry).toHaveBeenCalledOnce();
        expect(disposeMaterial).toHaveBeenCalledOnce();
        expect(disposeTexture).toHaveBeenCalledOnce();
    });

    it("releases managed resources without hard-disposing them while another owner is live", () => {
        const geometry = new BoxGeometry();
        const texture = new Texture();
        const material = new MeshStandardMaterial({map: texture});
        const first = new Mesh(geometry, material);
        const second = new Mesh(geometry, material);

        retainObjectGpuResources(first);
        retainObjectGpuResources(second);

        const disposeGeometry = vi.spyOn(geometry, "dispose");
        const disposeMaterial = vi.spyOn(material, "dispose");
        const disposeTexture = vi.spyOn(texture, "dispose");

        MeshUtils.dispose(first);

        expect(disposeGeometry).not.toHaveBeenCalled();
        expect(disposeMaterial).not.toHaveBeenCalled();
        expect(disposeTexture).not.toHaveBeenCalled();

        MeshUtils.dispose(second);

        expect(disposeGeometry).toHaveBeenCalledOnce();
        expect(disposeMaterial).toHaveBeenCalledOnce();
        expect(disposeTexture).toHaveBeenCalledOnce();
    });

    it("disposes child resources when called on a non-mesh root", () => {
        const root = new Group();
        const child = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
        root.add(child);

        const rootDispose = vi.fn();
        (root as unknown as Object3D & {dispose: () => void}).dispose = rootDispose;
        const disposeGeometry = vi.spyOn(child.geometry, "dispose");
        const disposeMaterial = vi.spyOn(child.material as MeshStandardMaterial, "dispose");

        MeshUtils.dispose(root);

        expect(rootDispose).toHaveBeenCalledOnce();
        expect(disposeGeometry).toHaveBeenCalledOnce();
        expect(disposeMaterial).toHaveBeenCalledOnce();
    });
});

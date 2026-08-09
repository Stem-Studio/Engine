import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    amfLoad: vi.fn(),
    nrrdLoad: vi.fn(),
    tdsLoad: vi.fn(),
    usdLoad: vi.fn(),
}));

vi.mock("three/addons/loaders/AMFLoader.js", () => ({
    AMFLoader: class MockAMFLoader {
        load = hoisted.amfLoad;
    },
}));

vi.mock("three/addons/loaders/NRRDLoader.js", () => ({
    NRRDLoader: class MockNRRDLoader {
        load = hoisted.nrrdLoad;
    },
}));

vi.mock("three/addons/loaders/TDSLoader.js", () => ({
    TDSLoader: class MockTDSLoader {
        load = hoisted.tdsLoad;
    },
}));

vi.mock("three/addons/loaders/USDLoader.js", () => ({
    USDLoader: class MockUSDLoader {
        load = hoisted.usdLoad;
    },
}));

import AMFLoader from "./AMFLoader";
import NRRDLoader from "./NRRDLoader";
import TDSLoader from "./TDSLoader";
import USDZLoader from "./USDZLoader";

afterEach(() => {
    hoisted.amfLoad.mockReset();
    hoisted.nrrdLoad.mockReset();
    hoisted.tdsLoad.mockReset();
    hoisted.usdLoad.mockReset();
});

describe("legacy addon loader wrappers", () => {
    it("loads AMF models through the maintained Three addon loader", async () => {
        const group = new THREE.Group();
        hoisted.amfLoad.mockImplementation((_url, onLoad) => onLoad(group));

        await expect(new AMFLoader().load("/model.amf")).resolves.toBe(group);

        expect(hoisted.amfLoad).toHaveBeenCalledTimes(1);
        expect(hoisted.amfLoad).toHaveBeenCalledWith("/model.amf", expect.any(Function), undefined, expect.any(Function));
    });

    it("loads NRRD volumes once and returns the three slice meshes", async () => {
        const slices = {
            x: new THREE.Object3D(),
            y: new THREE.Object3D(),
            z: new THREE.Object3D(),
        };
        const volume = {
            RASDimensions: [10, 12, 16],
            extractSlice: vi.fn((axis: "x" | "y" | "z") => ({mesh: slices[axis]})),
        };
        hoisted.nrrdLoad.mockImplementation((_url, onLoad) => onLoad(volume));

        const object = await new NRRDLoader().load("/scan.nrrd");

        expect(hoisted.nrrdLoad).toHaveBeenCalledTimes(1);
        expect(volume.extractSlice).toHaveBeenCalledWith("x", 5);
        expect(volume.extractSlice).toHaveBeenCalledWith("y", 6);
        expect(volume.extractSlice).toHaveBeenCalledWith("z", 4);
        expect(object?.children).toEqual([slices.x, slices.y, slices.z]);
    });

    it("resolves null when supported addon loaders fail", async () => {
        hoisted.amfLoad.mockImplementation((_url, _onLoad, _onProgress, onError) => onError());
        hoisted.nrrdLoad.mockImplementation((_url, _onLoad, _onProgress, onError) => onError());

        await expect(new AMFLoader().load("/broken.amf")).resolves.toBeNull();
        await expect(new NRRDLoader().load("/broken.nrrd")).resolves.toBeNull();
    });

    it("loads 3DS models through the maintained Three addon loader", async () => {
        const group = new THREE.Group();
        hoisted.tdsLoad.mockImplementation((_url, onLoad) => onLoad(group));

        const options = {Name: "chair"};
        await expect(new TDSLoader().load("/model.3ds", options)).resolves.toBe(group);

        expect(hoisted.tdsLoad).toHaveBeenCalledTimes(1);
        expect(hoisted.tdsLoad).toHaveBeenCalledWith("/model.3ds", expect.any(Function), undefined, expect.any(Function));
        expect(group.userData).toMatchObject({
            type: "3DS",
            url: "/model.3ds",
            options,
        });
    });

    it("keeps the legacy 3DS reject-on-error load contract", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const error = new Error("bad 3ds");
        hoisted.tdsLoad.mockImplementation((_url, _onLoad, _onProgress, onError) => onError(error));

        await expect(new TDSLoader().load("/broken.3ds")).rejects.toBe(error);

        expect(console.warn).toHaveBeenCalledWith("TDSLoader: /broken.3ds loading failed.", error);
    });

    it("loads USD variants through Three's maintained USDLoader", async () => {
        const group = new THREE.Group();
        hoisted.usdLoad.mockImplementation((_url, onLoad) => onLoad(group));

        const options = {Name: "asset"};
        await expect(new USDZLoader().load("/model.usda", options)).resolves.toBe(group);

        expect(hoisted.usdLoad).toHaveBeenCalledTimes(1);
        expect(hoisted.usdLoad).toHaveBeenCalledWith("/model.usda", expect.any(Function), undefined, expect.any(Function));
        expect(group.userData).toMatchObject({
            type: "USDZ",
            url: "/model.usda",
            options,
        });
    });

    it("keeps the legacy USD reject-on-error load contract", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const error = new Error("bad usd");
        hoisted.usdLoad.mockImplementation((_url, _onLoad, _onProgress, onError) => onError(error));

        await expect(new USDZLoader().load("/broken.usdz")).rejects.toBe(error);

        expect(console.warn).toHaveBeenCalledWith("USDZLoader: /broken.usdz loading failed.", error);
    });
});

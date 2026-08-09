import {beforeEach, describe, expect, it, vi} from "vitest";

const packageManagerMock = vi.hoisted(() => ({
    construct: vi.fn(),
    require: vi.fn(),
}));

vi.mock("../../../package/PackageManager", () => {
    class MockPackageManager {
        require = packageManagerMock.require;

        constructor() {
            packageManagerMock.construct();
        }
    }

    return {
        default: MockPackageManager,
    };
});

import BaseLoader from "./BaseLoader";

describe("BaseLoader", () => {
    beforeEach(() => {
        packageManagerMock.construct.mockClear();
        packageManagerMock.require.mockReset();
        packageManagerMock.require.mockResolvedValue(["loaded"]);
    });

    it("keeps the default load contract as a resolved null", async () => {
        const loader = new BaseLoader();

        await expect(loader.load("/unused")).resolves.toBeNull();
        expect(packageManagerMock.construct).not.toHaveBeenCalled();
    });

    it("creates the package manager lazily when require is used", async () => {
        const loader = new BaseLoader();

        await expect(loader.require("GLTFLoader")).resolves.toEqual(["loaded"]);
        expect(packageManagerMock.construct).toHaveBeenCalledTimes(1);
        expect(packageManagerMock.require).toHaveBeenCalledWith("GLTFLoader");

        await loader.require(["FBXLoader"]);
        expect(packageManagerMock.construct).toHaveBeenCalledTimes(1);
        expect(packageManagerMock.require).toHaveBeenCalledWith(["FBXLoader"]);
    });

    it("keeps packageManager as a stable public property", () => {
        const loader = new BaseLoader();
        const packageManager = loader.packageManager;

        expect(packageManagerMock.construct).toHaveBeenCalledTimes(1);
        expect(loader.packageManager).toBe(packageManager);
    });
});

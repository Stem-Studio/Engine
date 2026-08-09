import {beforeEach, describe, expect, it, vi} from "vitest";

const loaderMocks = vi.hoisted(() => ({
    cssConstruct: vi.fn(),
    cssLoad: vi.fn(),
    jsConstruct: vi.fn(),
    jsLoad: vi.fn(),
    jsEval: vi.fn(),
}));

vi.mock("../utils/CssLoader", () => ({
    default: class MockCssLoader {
        constructor() {
            loaderMocks.cssConstruct();
        }

        load(url: string) {
            return loaderMocks.cssLoad(url);
        }
    },
}));

vi.mock("../utils/JsLoader", () => ({
    default: class MockJsLoader {
        constructor() {
            loaderMocks.jsConstruct();
        }

        load(url: string) {
            return loaderMocks.jsLoad(url);
        }

        eval() {
            loaderMocks.jsEval();
        }
    },
}));

import PackageList from "./PackageList";
import PackageManager from "./PackageManager";

describe("PackageManager", () => {
    beforeEach(() => {
        PackageList.splice(0, PackageList.length);
        loaderMocks.cssConstruct.mockClear();
        loaderMocks.cssLoad.mockReset();
        loaderMocks.cssLoad.mockResolvedValue(undefined);
        loaderMocks.jsConstruct.mockClear();
        loaderMocks.jsLoad.mockReset();
        loaderMocks.jsLoad.mockResolvedValue(undefined);
        loaderMocks.jsEval.mockClear();
    });

    it("resolves without constructing legacy loaders when the OSS package list is empty", async () => {
        await expect(new PackageManager().require(["GLTFLoader", "FBXLoader"])).resolves.toEqual([]);

        expect(loaderMocks.cssConstruct).not.toHaveBeenCalled();
        expect(loaderMocks.jsConstruct).not.toHaveBeenCalled();
    });

    it("keeps runtime-added package entries loadable", async () => {
        PackageList.push({
            name: "TestPackage",
            assets: ["/legacy/test.css", "/legacy/test.js"],
        });

        await expect(new PackageManager().require("TestPackage")).resolves.toEqual([undefined]);

        expect(loaderMocks.cssConstruct).toHaveBeenCalledTimes(1);
        expect(loaderMocks.cssLoad).toHaveBeenCalledWith("/legacy/test.css");
        expect(loaderMocks.jsConstruct).toHaveBeenCalledTimes(1);
        expect(loaderMocks.jsLoad).toHaveBeenCalledWith("/legacy/test.js");
        expect(loaderMocks.jsEval).toHaveBeenCalledTimes(1);
    });
});

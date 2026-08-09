import {afterEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    get: vi.fn(),
}));

vi.mock("./Ajax", () => ({
    default: {
        get: hoisted.get,
    },
}));

import JsLoader from "./JsLoader";

afterEach(() => {
    hoisted.get.mockReset();
    vi.restoreAllMocks();
});

describe("JsLoader", () => {
    it("stores loaded script data and resolves the asset record", async () => {
        hoisted.get.mockResolvedValue({data: "window.loaded = true;"});
        const loader = new JsLoader();

        const result = await loader.load("/plugin.js");

        expect(hoisted.get).toHaveBeenCalledWith({url: "/plugin.js", needAuthorization: false});
        expect(result).toEqual({url: "/plugin.js", script: "window.loaded = true;"});
        expect(loader.assets).toEqual([result]);
    });

    it("resolves null and keeps the queued asset record on load failure", async () => {
        hoisted.get.mockRejectedValue(new Error("network"));
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const loader = new JsLoader();

        await expect(loader.load("/missing.js")).resolves.toBeNull();

        expect(loader.assets).toEqual([{url: "/missing.js", script: null}]);
        expect(console.warn).toHaveBeenCalledWith("JsLoader: /missing.js loaded failed.");
    });
});

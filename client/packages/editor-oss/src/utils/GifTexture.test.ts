import {afterEach, describe, expect, it, vi} from "vitest";

import global from "../global";
import {GifTexture} from "./GifTexture";

function createGifStub() {
    return {
        width: 1,
        height: 1,
        totalFrames: 0,
        frameAt: vi.fn(() => undefined),
    };
}

describe("GifTexture", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
        vi.restoreAllMocks();
    });

    it("uses one stable animate callback across repeated start and stop calls", () => {
        const app = {on: vi.fn()};
        global.app = app as unknown as typeof global.app;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
        const texture = new GifTexture(document.createElement("canvas"), createGifStub() as any, false);

        texture.start();
        texture.start();

        expect(app.on).toHaveBeenCalledTimes(1);
        expect(app.on).toHaveBeenCalledWith(`animate.GifTexture${texture.uuid}`, expect.any(Function));

        const callback = app.on.mock.calls[0]?.[1];
        expect(callback).toEqual(expect.any(Function));

        texture.stop();
        texture.stop();

        expect(app.on).toHaveBeenCalledTimes(2);
        expect(app.on).toHaveBeenLastCalledWith(`animate.GifTexture${texture.uuid}`, null);

        texture.start();

        expect(app.on).toHaveBeenCalledTimes(3);
        expect(app.on).toHaveBeenLastCalledWith(`animate.GifTexture${texture.uuid}`, callback);

        texture.dispose();
    });

    it("does not duplicate the constructor-started animation subscription", () => {
        const app = {on: vi.fn()};
        global.app = app as unknown as typeof global.app;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
        const texture = new GifTexture(document.createElement("canvas"), createGifStub() as any, true);

        texture.start();

        expect(app.on).toHaveBeenCalledTimes(1);
        expect(app.on).toHaveBeenCalledWith(`animate.GifTexture${texture.uuid}`, expect.any(Function));

        texture.dispose();
    });
});

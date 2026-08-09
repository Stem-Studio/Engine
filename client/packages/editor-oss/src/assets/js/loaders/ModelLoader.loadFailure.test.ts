import {beforeEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    load: vi.fn(),
    dispose: vi.fn(),
}));

vi.mock("./GLTFLoader", () => {
    return {
        default: class FakeGLTFLoader {
            load = hoisted.load;
            dispose = hoisted.dispose;
        },
    };
});

vi.mock("../../../utils/DetectDevice", () => ({
    DetectDevice: {
        isIOS: () => false,
        isMobile: () => false,
    },
}));

import ModelLoader from "./ModelLoader";
import {PriorityTaskQueue} from "../../../utils/PriorityTaskQueue";

describe("ModelLoader load failures", () => {
    beforeEach(() => {
        hoisted.load.mockReset();
        hoisted.dispose.mockReset();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    it("settles rejected loader promises and clears pending loads for retries", async () => {
        hoisted.load.mockRejectedValue(new Error("broken glb"));

        const first = await new ModelLoader().load("/broken.glb", {
            Type: "glb",
            DisableReupload: true,
        });
        const second = await new ModelLoader().load("/broken.glb", {
            Type: "glb",
            DisableReupload: true,
        });

        expect(first).toBeNull();
        expect(second).toBeNull();
        expect(hoisted.load).toHaveBeenCalledTimes(2);
        expect(hoisted.dispose).toHaveBeenCalledTimes(2);
        expect(console.warn).toHaveBeenCalledWith(
            "ModelLoader: failed to load glb model from /broken.glb",
            expect.any(Error),
        );
    });

    it("does not enqueue loads when no model type is provided", async () => {
        const enqueue = vi.spyOn(PriorityTaskQueue.prototype, "enqueue");

        const result = await new ModelLoader().load("/missing-type");

        expect(result).toBeNull();
        expect(enqueue).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith("ModelLoader: no type parameters, and cannot load.");
    });
});

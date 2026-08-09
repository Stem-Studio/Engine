import {afterEach, describe, expect, it, vi} from "vitest";

import AWDLoader from "./AWDLoader";
import BabylonLoader from "./BabylonLoader";
import BinaryLoader from "./BinaryLoader";
import PRWMLoader from "./PRWMLoader";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("unsupported legacy loader wrappers", () => {
    it.each([
        ["AWDLoader", AWDLoader, "/model.awd"],
        ["BabylonLoader", BabylonLoader, "/scene.babylon"],
        ["BinaryLoader", BinaryLoader, "/model.bin"],
        ["PRWMLoader", PRWMLoader, "/model.prwm"],
    ])("%s resolves null with a clear unsupported-format warning", async (name, Loader, url) => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);

        await expect(new Loader().load(url)).resolves.toBeNull();

        expect(console.warn).toHaveBeenCalledWith(
            `${name}: ${url} cannot be loaded because Three.js no longer provides ${name}.`,
        );
    });
});

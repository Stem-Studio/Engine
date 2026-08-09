import {beforeEach, describe, expect, it, vi} from "vitest";

const setAIBackendMock = vi.fn();
vi.mock("@stem/editor-oss/ai", () => ({
    setAIBackend: (b: unknown) => setAIBackendMock(b),
}));

describe("initIntegratedAIBackend compatibility shim", () => {
    beforeEach(() => {
        setAIBackendMock.mockReset();
        vi.resetModules();
    });

    it("does not replace the default OSS AI backend", async () => {
        const {initIntegratedAIBackend: init} = await import("./integratedAIBackend");
        init();

        expect(setAIBackendMock).not.toHaveBeenCalled();
    });

    it("is idempotent", async () => {
        const mod = await import("./integratedAIBackend");
        mod.initIntegratedAIBackend();
        mod.initIntegratedAIBackend();

        expect(setAIBackendMock).not.toHaveBeenCalled();
    });
});

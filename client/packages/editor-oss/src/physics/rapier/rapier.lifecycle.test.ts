import {describe, expect, it} from "vitest";

import {initRapier, teardownRapier} from "./rapier";

describe("Rapier module lifecycle", () => {
    it("reuses the initialized WASM module after a Play/Edit teardown", async () => {
        await expect(initRapier()).resolves.toBeUndefined();
        teardownRapier();
        await expect(initRapier()).resolves.toBeUndefined();
    });
});

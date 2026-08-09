import { describe, expect, it } from "vitest";

import {
    getPlanCadModelSourceKey,
    isPlanCadLoadableModelSource,
} from "./planCadModelAssets";
import type { PlanItemSource } from "./planCadCore";

describe("planCadModelAssets", () => {
    it("accepts GLB/GLTF model sources and rejects unsupported model formats", () => {
        const glbSource: PlanItemSource = {
            type: "model",
            provider: "pascal",
            providerAssetId: "sofa",
            url: "https://example.com/items/sofa/model.glb",
        };
        const objSource: PlanItemSource = {
            type: "model",
            url: "https://example.com/items/chair/model.obj",
            format: "obj",
        };

        expect(isPlanCadLoadableModelSource(glbSource)).toBe(true);
        expect(getPlanCadModelSourceKey(glbSource)).toBe(
            "pascal:sofa:https://example.com/items/sofa/model.glb",
        );
        expect(isPlanCadLoadableModelSource(objSource)).toBe(false);
        expect(getPlanCadModelSourceKey(objSource)).toBeNull();
    });
});

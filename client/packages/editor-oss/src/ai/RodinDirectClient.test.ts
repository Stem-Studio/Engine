import {describe, expect, it} from "vitest";

import {decodeRodinTaskId, encodeRodinTaskId} from "./RodinDirectClient";
import {
    GENERATOR_TYPES,
    getGeneratorCapability,
    MODEL_GENERATOR_CAPABILITIES,
} from "../utils/ModelGeneratorProvider";

describe("Rodin composite task id codec", () => {
    it("round-trips a task uuid and subscription key", () => {
        const id = encodeRodinTaskId("task-uuid", "sub-key");
        expect(id).toBe("task-uuid|sub-key");
        expect(decodeRodinTaskId(id)).toEqual({taskUUID: "task-uuid", subscriptionKey: "sub-key"});
    });

    it("preserves subscription keys that themselves contain the separator", () => {
        const id = encodeRodinTaskId("uuid", "a|b|c");
        expect(decodeRodinTaskId(id)).toEqual({taskUUID: "uuid", subscriptionKey: "a|b|c"});
    });

    it("yields an empty subscription key when the separator is missing", () => {
        expect(decodeRodinTaskId("bare-uuid")).toEqual({taskUUID: "bare-uuid", subscriptionKey: ""});
    });
});

describe("model generator capabilities", () => {
    it("includes every generator enum value", () => {
        for (const value of Object.values(GENERATOR_TYPES)) {
            expect(MODEL_GENERATOR_CAPABILITIES[value]).toBeDefined();
        }
    });

    it("marks Rodin as text-only, browser-direct, no rig/refine", () => {
        const cap = getGeneratorCapability(GENERATOR_TYPES.RODIN);
        expect(cap.byokProvider).toBe("rodin");
        expect(cap.supportsTextToModel).toBe(true);
        expect(cap.supportsImageToModel).toBe(false);
        expect(cap.supportsRefine).toBe(false);
        expect(cap.supportsAutoRig).toBe(false);
        expect(cap.supportsBrowserDirectPlayground).toBe(true);
    });

    it("only offers browser-direct providers in the playground filter", () => {
        const playgroundProviders = Object.values(GENERATOR_TYPES).filter(
            v => getGeneratorCapability(v).supportsBrowserDirectPlayground,
        );
        expect(playgroundProviders).toContain(GENERATOR_TYPES.MESHY);
        expect(playgroundProviders).toContain(GENERATOR_TYPES.RODIN);
        expect(playgroundProviders).not.toContain(GENERATOR_TYPES.TRIPO);
        expect(playgroundProviders).not.toContain(GENERATOR_TYPES.ERTH);
    });
});

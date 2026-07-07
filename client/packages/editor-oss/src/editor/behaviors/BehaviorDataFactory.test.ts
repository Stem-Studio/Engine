import {describe, expect, it} from "vitest";

import BehaviorDataFactory from "./BehaviorDataFactory";
import {BEHAVIOR_DATA_SCHEMA_VERSION} from "../../behaviors/BehaviorData";
import {BehaviorDataSchema} from "../../serialization/schema/BehaviorDataSchema";

describe("BehaviorDataFactory", () => {
    it("stamps new behavior data with the current schema version", () => {
        const data = BehaviorDataFactory.createData("test", {}, 0);

        expect(data.schemaVersion).toBe(BEHAVIOR_DATA_SCHEMA_VERSION);
    });

    it("defaults legacy serialized behavior data to the current schema version", () => {
        const data = BehaviorDataSchema.parse({
            id: "legacy",
            uuid: "behavior-uuid",
            enabled: true,
            priority: 0,
        });

        expect(data.schemaVersion).toBe(BEHAVIOR_DATA_SCHEMA_VERSION);
    });
});

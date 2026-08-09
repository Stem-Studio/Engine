import {Object3D} from "three";
import {describe, it, expect, beforeEach} from "vitest";

import {LambdaQueryRegistry} from "../LambdaQueryRegistry";

describe("LambdaQueryRegistry", () => {
    let registry: LambdaQueryRegistry;

    beforeEach(() => {
        registry = new LambdaQueryRegistry();
    });

    describe("getOrAssignBit", () => {
        it("should assign unique bits to different types", () => {
            const a = registry.getOrAssignBit("velocity");
            const b = registry.getOrAssignBit("collider");

            expect(a).not.toBe(b);
        });

        it("should return same bit for same type", () => {
            const a = registry.getOrAssignBit("velocity");
            const b = registry.getOrAssignBit("velocity");

            expect(a).toBe(b);
        });
    });

    describe("setArchetype / query", () => {
        it("should match objects with required types", () => {
            const obj1 = new Object3D();
            const obj2 = new Object3D();

            // Pre-assign bits so query knows about these types
            registry.getOrAssignBit("velocity");
            registry.getOrAssignBit("collider");
            registry.getOrAssignBit("health");

            registry.setArchetype(obj1, new Set(["velocity", "collider"]));
            registry.setArchetype(obj2, new Set(["velocity", "health"]));

            const results = registry.query({required: ["velocity", "collider"]});

            expect(results).toHaveLength(1);
            expect(results[0]).toBe(obj1);
        });

        it("should match objects with any filter", () => {
            const obj1 = new Object3D();
            const obj2 = new Object3D();
            const obj3 = new Object3D();

            registry.getOrAssignBit("velocity");
            registry.getOrAssignBit("collider");
            registry.getOrAssignBit("health");

            registry.setArchetype(obj1, new Set(["velocity"]));
            registry.setArchetype(obj2, new Set(["collider"]));
            registry.setArchetype(obj3, new Set(["health"]));

            const results = registry.query({any: ["velocity", "collider"]});

            expect(results).toHaveLength(2);
            expect(results).toContain(obj1);
            expect(results).toContain(obj2);
        });

        it("should exclude objects with excluded types", () => {
            const obj1 = new Object3D();
            const obj2 = new Object3D();

            registry.getOrAssignBit("velocity");
            registry.getOrAssignBit("collider");
            registry.getOrAssignBit("disabled");

            registry.setArchetype(obj1, new Set(["velocity", "collider"]));
            registry.setArchetype(obj2, new Set(["velocity", "disabled"]));

            const results = registry.query({
                required: ["velocity"],
                excluded: ["disabled"],
            });

            expect(results).toHaveLength(1);
            expect(results[0]).toBe(obj1);
        });

        it("should combine required, excluded, and any filters", () => {
            const obj1 = new Object3D();
            const obj2 = new Object3D();
            const obj3 = new Object3D();

            registry.getOrAssignBit("velocity");
            registry.getOrAssignBit("collider");
            registry.getOrAssignBit("health");
            registry.getOrAssignBit("disabled");

            registry.setArchetype(obj1, new Set(["velocity", "collider", "health"]));
            registry.setArchetype(obj2, new Set(["velocity", "health", "disabled"]));
            registry.setArchetype(obj3, new Set(["velocity", "collider"]));

            const results = registry.query({
                required: ["velocity"],
                excluded: ["disabled"],
                any: ["health", "collider"],
            });

            expect(results).toHaveLength(2);
            expect(results).toContain(obj1);
            expect(results).toContain(obj3);
        });

        it("should return all objects when descriptor is empty", () => {
            const obj1 = new Object3D();
            const obj2 = new Object3D();

            registry.setArchetype(obj1, new Set(["velocity"]));
            registry.setArchetype(obj2, new Set(["collider"]));

            const results = registry.query({});

            expect(results).toHaveLength(2);
        });

        it("should accept reusable iterable type ids with duplicates", () => {
            const obj = new Object3D();
            const typeIds = ["velocity", "velocity", "collider"];

            registry.setArchetype(obj, typeIds);
            typeIds.length = 0;

            expect(registry.query({required: ["velocity", "collider"]})).toEqual([obj]);
        });

        it("should handle unknown types in query gracefully", () => {
            const obj = new Object3D();
            registry.setArchetype(obj, new Set(["velocity"]));

            // "unknown" has no bit assigned, so the required mask is empty
            const results = registry.query({required: ["unknown"]});

            // unknown type has no bit → empty mask → contains(empty) is true for all
            expect(results).toHaveLength(1);
        });
    });

    describe("removeObject", () => {
        it("should remove object from archetypes", () => {
            const obj = new Object3D();
            registry.getOrAssignBit("velocity");
            registry.setArchetype(obj, new Set(["velocity"]));

            expect(registry.query({required: ["velocity"]})).toHaveLength(1);

            registry.removeObject(obj);

            expect(registry.query({required: ["velocity"]})).toHaveLength(0);
        });
    });

    describe("clearArchetypes", () => {
        it("should clear all object archetypes but keep type bits", () => {
            const obj = new Object3D();
            const bit = registry.getOrAssignBit("velocity");
            registry.setArchetype(obj, new Set(["velocity"]));

            registry.clearArchetypes();

            expect(registry.query({})).toHaveLength(0);
            // Type bit should still be the same
            expect(registry.getOrAssignBit("velocity")).toBe(bit);
        });
    });

    describe("dispose", () => {
        it("should reset everything including type bits", () => {
            const obj = new Object3D();
            registry.getOrAssignBit("velocity");
            registry.setArchetype(obj, new Set(["velocity"]));

            registry.dispose();

            expect(registry.query({})).toHaveLength(0);
            // After dispose, "velocity" should get a new bit (starting from 0)
            expect(registry.getOrAssignBit("velocity")).toBe(0);
        });
    });
});

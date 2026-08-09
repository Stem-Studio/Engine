import {describe, expect, it} from "vitest";
import {Group, Scene} from "three";

import {
    containsPlanCadSelectionMetadata,
    hasPlanCadSelectionMetadata,
    resolvePlanCadSelectionTarget,
} from "./PlanCadSelectionMetadata";

describe("PlanCadSelectionMetadata", () => {
    it("detects BIM metadata on descendants of a wrapper group", () => {
        const wrapper = new Group();
        const child = new Group();
        child.userData.isPlanCadManaged = true;
        wrapper.add(child);

        expect(hasPlanCadSelectionMetadata(wrapper)).toBe(false);
        expect(containsPlanCadSelectionMetadata(wrapper)).toBe(true);
    });

    it("does not treat the scene root as a transformable BIM wrapper", () => {
        const scene = new Scene();
        const child = new Group();
        child.userData.isPlanCadManaged = true;
        scene.add(child);

        expect(containsPlanCadSelectionMetadata(scene)).toBe(false);
    });

    it("detects non-scene BIM groups that store full plan data", () => {
        const scene = new Scene();
        const group = new Group();
        group.userData.planCad = {
            schema: "stem.planCad.v1",
            rootNodeIds: ["site-main"],
            nodes: {
                "site-main": {
                    id: "site-main",
                    type: "site",
                    parentId: null,
                    name: "Site",
                    visible: true,
                },
            },
        };
        const child = new Group();
        scene.add(group);
        group.add(child);

        expect(hasPlanCadSelectionMetadata(group)).toBe(true);
        expect(resolvePlanCadSelectionTarget(child, scene)).toBe(group);
    });

    it("detects legacy BIM groups by name without requiring managed flags", () => {
        const scene = new Scene();
        const group = new Group();
        group.name = "BIM Group";
        group.userData.isRuntimeOnly = true;
        const child = new Group();
        scene.add(group);
        group.add(child);

        expect(hasPlanCadSelectionMetadata(group)).toBe(true);
        expect(resolvePlanCadSelectionTarget(child, scene)).toBe(group);
    });

    it("detects generated BIM render children by owner metadata", () => {
        const scene = new Scene();
        const child = new Group();
        child.userData = {
            isRuntimeOnly: true,
            isPlanCadGeneratedChild: true,
            planCadOwnerNodeId: "wall-1",
            planCadOwnerNodeType: "wall",
        };
        scene.add(child);

        expect(hasPlanCadSelectionMetadata(child)).toBe(true);
        expect(resolvePlanCadSelectionTarget(child, scene)).toBe(child);
    });

    it("does not treat ordinary scene root plan data as a transform target", () => {
        const scene = new Scene();
        scene.name = "BIM Plan";

        expect(hasPlanCadSelectionMetadata(scene)).toBe(false);
        expect(containsPlanCadSelectionMetadata(scene)).toBe(false);
    });
});

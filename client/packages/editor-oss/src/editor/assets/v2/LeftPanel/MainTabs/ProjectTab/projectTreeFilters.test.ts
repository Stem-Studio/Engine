import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { DYNAMIC_ROOT_NAME } from "@stem/editor-oss/scene/dynamicRoots";
import { shouldIncludeProjectTreeObject } from "./projectTreeFilters";

describe("shouldIncludeProjectTreeObject", () => {
    it("keeps dynamic/runtime helpers out of the project tree", () => {
        const dynamicRoot = new THREE.Group();
        dynamicRoot.name = DYNAMIC_ROOT_NAME;
        expect(shouldIncludeProjectTreeObject(dynamicRoot)).toBe(false);

        const runtimeHelper = new THREE.Group();
        runtimeHelper.userData.isRuntimeOnly = true;
        expect(shouldIncludeProjectTreeObject(runtimeHelper)).toBe(false);
    });

    it("keeps generated BIM Plan objects visible in the project tree", () => {
        const planObject = new THREE.Group();
        planObject.userData.isRuntimeOnly = true;
        planObject.userData.isPlanCadManaged = true;

        expect(shouldIncludeProjectTreeObject(planObject)).toBe(true);
    });

    it("keeps BIM groups visible when they use equivalent BIM metadata", () => {
        const planObject = new THREE.Group();
        planObject.userData.isRuntimeOnly = true;
        planObject.userData.managedBy = "BIM Plan";
        planObject.userData.sceneTreeBadge = "BIM";

        expect(shouldIncludeProjectTreeObject(planObject)).toBe(true);
    });

    it("keeps runtime BIM wrapper groups visible when child objects carry BIM metadata", () => {
        const wrapper = new THREE.Group();
        wrapper.userData.isRuntimeOnly = true;

        const planObject = new THREE.Group();
        planObject.userData.isPlanCadManaged = true;
        planObject.userData.planNodeId = "wall-1";
        wrapper.add(planObject);

        expect(shouldIncludeProjectTreeObject(wrapper)).toBe(true);
    });

    it("keeps generated BIM render children out of the project tree", () => {
        const wallSegment = new THREE.Mesh();
        wallSegment.userData = {
            isRuntimeOnly: true,
            isPlanCadGeneratedChild: true,
            planCadOwnerNodeId: "wall-1",
            planCadOwnerNodeType: "wall",
        };

        expect(shouldIncludeProjectTreeObject(wallSegment)).toBe(false);
    });
});

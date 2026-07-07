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
});

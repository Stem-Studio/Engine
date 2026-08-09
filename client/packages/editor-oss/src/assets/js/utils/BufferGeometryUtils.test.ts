import * as THREE from "three";
import * as AddonBufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import {describe, expect, it} from "vitest";

import BufferGeometryUtils, * as FacadeBufferGeometryUtils from "./BufferGeometryUtils";

describe("BufferGeometryUtils compatibility facade", () => {
    it("keeps the legacy mergeBufferGeometries method backed by Three's addon utility", () => {
        const first = new THREE.BoxGeometry(1, 1, 1);
        const second = new THREE.BoxGeometry(1, 1, 1).translate(2, 0, 0);

        const legacyMerged = BufferGeometryUtils.mergeBufferGeometries([first, second]);
        const addonMerged = FacadeBufferGeometryUtils.mergeGeometries([first, second]);

        expect(legacyMerged?.getAttribute("position").count).toBe(addonMerged?.getAttribute("position").count);
        expect(legacyMerged?.index?.count).toBe(addonMerged?.index?.count);
    });

    it("keeps the legacy mergeBufferAttributes alias", () => {
        const first = new THREE.Float32BufferAttribute([0, 1, 2], 3);
        const second = new THREE.Float32BufferAttribute([3, 4, 5], 3);

        const merged = BufferGeometryUtils.mergeBufferAttributes([first, second]);

        expect(Array.from(merged?.array ?? [])).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("mirrors the maintained Three addon utility export surface", () => {
        const facadeKeys = Object.keys(FacadeBufferGeometryUtils)
            .filter(key => key !== "default")
            .sort();
        const addonKeys = Object.keys(AddonBufferGeometryUtils).sort();

        expect(facadeKeys).toEqual(addonKeys);

        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const creasedViaDefault = BufferGeometryUtils.toCreasedNormals(geometry.clone());
        const creasedViaNamed = FacadeBufferGeometryUtils.toCreasedNormals(geometry.clone());
        expect(creasedViaDefault.getAttribute("position").count).toBe(
            creasedViaNamed.getAttribute("position").count,
        );

        const attribute = new THREE.Float32BufferAttribute([0, 1, 2], 3);
        const cloned = BufferGeometryUtils.deepCloneAttribute(attribute);
        expect(cloned).not.toBe(attribute);
        expect(Array.from(cloned.array)).toEqual([0, 1, 2]);
    });
});

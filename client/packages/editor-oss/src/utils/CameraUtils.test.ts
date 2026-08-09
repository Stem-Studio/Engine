import * as THREE from "three";
import {vi} from "vitest";

import CameraUtils from "./CameraUtils";

describe('CameraUtils', () => {
    describe('disableCameraCollision', () => {
        it('should set userData.disableCameraCollision to true on object and its descendants', () => {
            const object = new THREE.Object3D();
            const childObject = new THREE.Object3D();
            object.add(childObject);
            CameraUtils.disableCameraCollision(object);
            expect(object.userData.disableCameraCollision).toBe(true);
            expect(childObject.userData.disableCameraCollision).toBe(true);
        });

        it('should update deep hierarchies without recursive traversal', () => {
            const object = new THREE.Object3D();
            let cursor = object;
            for (let i = 0; i < 12_000; i++) {
                const child = new THREE.Object3D();
                cursor.add(child);
                cursor = child;
            }
            const traverse = vi.spyOn(object, "traverse");

            expect(() => CameraUtils.disableCameraCollision(object)).not.toThrow();

            expect(cursor.userData.disableCameraCollision).toBe(true);
            expect(traverse).not.toHaveBeenCalled();
        });
    });
});

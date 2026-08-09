import {Object3D, Vector3} from "three";
import {describe, expect, it, vi} from "vitest";

import {EndlessTerrainPhysics} from "./EndlessTerrainPhysics";
import {BodyShapeType} from "../../../physics/common/types";

function createInstanceData(object: Object3D, mesh: Object3D, addedToPhysics = false, physicsUuid?: string) {
    return {
        object,
        mesh,
        collisionShape: {
            type: BodyShapeType.CONCAVE_HULL,
            vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            indexes: new Uint32Array([0, 1, 2]),
        },
        shapeReady: true,
        addedToPhysics,
        physicsUuid,
    };
}

describe("EndlessTerrainPhysics", () => {
    it("uses squared distance checks when toggling terrain physics", () => {
        const physics = {
            addConcaveHull: vi.fn(),
            remove: vi.fn(),
        };
        const terrainPhysics = new EndlessTerrainPhysics(physics as any, {} as any);
        terrainPhysics.distanceThreshold = 5;

        const nearObject = new Object3D();
        nearObject.position.set(3, 0, 0);
        const nearMesh = new Object3D();
        const farObject = new Object3D();
        farObject.position.set(10, 0, 0);
        const farMesh = new Object3D();
        (terrainPhysics as any).instanceDataMap.set("near", createInstanceData(nearObject, nearMesh));
        (terrainPhysics as any).instanceDataMap.set("far", createInstanceData(farObject, farMesh, true, "far-body"));

        const nearDistanceTo = vi.spyOn(nearObject.position, "distanceTo");
        const nearDistanceToSquared = vi.spyOn(nearObject.position, "distanceToSquared");
        const farDistanceTo = vi.spyOn(farObject.position, "distanceTo");
        const farDistanceToSquared = vi.spyOn(farObject.position, "distanceToSquared");

        terrainPhysics.update(new Vector3(0, 0, 0));

        expect(nearDistanceTo).not.toHaveBeenCalled();
        expect(farDistanceTo).not.toHaveBeenCalled();
        expect(nearDistanceToSquared).toHaveBeenCalledOnce();
        expect(farDistanceToSquared).toHaveBeenCalledOnce();
        expect(physics.addConcaveHull).toHaveBeenCalledOnce();
        expect(physics.remove).toHaveBeenCalledWith("far-body");
    });
});

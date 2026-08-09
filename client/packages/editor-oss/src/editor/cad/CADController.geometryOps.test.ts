import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {CADController} from "./CADController";
import {MeshData} from "./MeshData";

vi.mock("../../global", () => ({
    default: {
        app: {
            call: vi.fn(),
            on: vi.fn(),
            sceneHelpers: {
                add: vi.fn(),
            },
            editor: {
                renderer: {
                    domElement: {width: 800, height: 600},
                },
            },
        },
    },
}));

vi.mock("i18next", () => ({
    t: (value: string) => value,
}));

vi.mock("../../showToast", () => ({
    showToast: vi.fn(),
}));

function createController(): CADController {
    return new CADController({
        cadSelectionMode: "face",
        cadSelectionShape: "box",
        cadAxisConstraint: ["x", "y", "z"],
        cadTool: "select",
        objectByUuid: vi.fn(() => null),
    } as any);
}

function createQuadMeshData(): {meshData: MeshData; faceId: number} {
    const meshData = new MeshData();
    const a = meshData.addVertex({x: 0, y: 0, z: 0});
    const b = meshData.addVertex({x: 2, y: 0, z: 0});
    const c = meshData.addVertex({x: 2, y: 2, z: 0});
    const d = meshData.addVertex({x: 0, y: 2, z: 0});
    const face = meshData.addFace([a.id, b.id, c.id, d.id]);
    return {meshData, faceId: face.id};
}

function selectedFacePositions(meshData: MeshData, faceIds: number[]): THREE.Vector3Like[] {
    const face = meshData.faces.get(faceIds[0]!);
    expect(face).toBeDefined();
    return face!.vertexIds.map(vertexId => meshData.getVertex(vertexId)!.position);
}

describe("CADController geometry operations", () => {
    let controller: CADController | null = null;

    afterEach(() => {
        controller?.dispose();
        controller = null;
    });

    it("insets a face by moving vertices toward the centroid in plane", () => {
        controller = createController();
        const {meshData, faceId} = createQuadMeshData();

        const result = (controller as any).buildInsetMeshData(meshData, faceId, 0.25);
        const positions = selectedFacePositions(result.meshData, result.selection.faceIds);

        expect(positions).toEqual([
            {x: 0.25, y: 0.25, z: 0},
            {x: 1.75, y: 0.25, z: 0},
            {x: 1.75, y: 1.75, z: 0},
            {x: 0.25, y: 1.75, z: 0},
        ]);
    });

    it("bevels a face by insetting in plane and lifting along the face normal", () => {
        controller = createController();
        const {meshData, faceId} = createQuadMeshData();

        const result = (controller as any).buildBevelMeshData(meshData, faceId, 0.25, 0.5);
        const positions = selectedFacePositions(result.meshData, result.selection.faceIds);

        expect(positions).toEqual([
            {x: 0.25, y: 0.25, z: 0.5},
            {x: 1.75, y: 0.25, z: 0.5},
            {x: 1.75, y: 1.75, z: 0.5},
            {x: 0.25, y: 1.75, z: 0.5},
        ]);
    });
});

import {BufferAttribute, BufferGeometry} from "three";
import {describe, expect, it} from "vitest";

import {HullCompute} from "./HullCompute";

function createGeometry(positions: number[]): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    return geometry;
}

describe("HullCompute", () => {
    it("deduplicates convex hull input and output vertices", () => {
        const geometry = createGeometry([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
            0, 0, 1,
            1, 0, 0,
            0, 1, 0,
            0, 0, 1,
        ]);

        const vertices = HullCompute.convexHull([geometry], {x: 1, y: 1, z: 1});
        const uniqueVertices = new Set<string>();
        for (let i = 0; i < vertices.length; i += 3) {
            uniqueVertices.add(`${vertices[i]},${vertices[i + 1]},${vertices[i + 2]}`);
        }

        expect(vertices).toHaveLength(12);
        expect(uniqueVertices).toEqual(new Set([
            "0,0,0",
            "1,0,0",
            "0,1,0",
            "0,0,1",
        ]));
    });
});

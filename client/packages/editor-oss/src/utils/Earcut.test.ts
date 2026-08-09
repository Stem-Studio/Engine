import Earcut, {Earcut as NamedEarcut} from "./Earcut";

describe("Earcut compatibility wrapper", () => {
    it("preserves the default and named triangulation API", () => {
        expect(Earcut).toBe(NamedEarcut);
        expect(typeof Earcut.triangulate).toBe("function");
    });

    it("triangulates a simple polygon", () => {
        const triangles = Earcut.triangulate([
            0, 0,
            1, 0,
            1, 1,
            0, 1,
        ], [], 2);

        expect(triangles).toHaveLength(6);
        expect(new Set(triangles)).toEqual(new Set([0, 1, 2, 3]));
    });

    it("keeps default arguments and higher-dimensional vertex strides", () => {
        const defaultTriangles = Earcut.triangulate([
            0, 0,
            1, 0,
            0, 1,
        ]);
        const threeDimensionalTriangles = Earcut.triangulate([
            0, 0, 10,
            1, 0, 20,
            0, 1, 30,
        ], [], 3);

        expect(defaultTriangles).toHaveLength(3);
        expect(new Set(defaultTriangles)).toEqual(new Set([0, 1, 2]));
        expect(threeDimensionalTriangles).toEqual(defaultTriangles);
    });

    it("preserves holes while triangulating", () => {
        const triangles = Earcut.triangulate([
            0, 0,
            4, 0,
            4, 4,
            0, 4,
            1, 1,
            1, 3,
            3, 3,
            3, 1,
        ], [4], 2);

        expect(triangles.length).toBeGreaterThan(0);
        expect(triangles.length % 3).toBe(0);
        expect(Math.max(...triangles)).toBeLessThan(8);
    });
});
